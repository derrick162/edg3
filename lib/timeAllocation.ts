// Time-Allocation Trends — Core-owned.
//
// Answers "how is my time actually split across priorities over the past N weeks?"
// ("60% in meetings, 8% on fundraising this month")
//
// Pure keyword matching — no LLM call. Fast, zero cost, fully testable.
// Complements computeAlignment (which fires a Haiku call for the current week only).
// This module covers multi-week trends from the 180-day history already fetched for
// focus recommendations.
//
// Output feeds into: briefing prompt (multi-week context), focusRecommendation.ts.

import type { calendar_v3 } from 'googleapis';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WeeklyBucket {
  weekLabel: string;    // "Jun 9" (Sunday start of that week, UTC)
  weekStart: string;    // ISO date YYYY-MM-DD of week start (Sunday)
  perPriority: { [priorityText: string]: number };  // hours per priority in this week
  otherHours: number;   // hours not attributed to any priority
}

export interface TimeAllocationBucket {
  label: string;          // bucket name: priority text OR 'meetings' / 'routine' / 'other'
  hours: number;          // total hours across the analysis window
  pct: number;            // percentage of total timed hours (0-100)
  weeklyAvg: number;      // avg hours/week in this bucket
}

export interface TimeAllocationResult {
  totalHours: number;                 // total timed calendar hours in the window
  periodWeeks: number;               // number of weeks analyzed
  buckets: TimeAllocationBucket[];   // sorted by hours desc
  biggestMisalignment: string | null; // plain-English summary, or null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROUTINE_TITLES = new Set([
  'breakfast', 'lunch', 'dinner', 'coffee', 'gym', 'workout', 'morning walk',
  'evening walk', 'meal prep', 'sleep', 'commute', 'transit', 'shower',
]);

function isRoutineEvent(title: string): boolean {
  const t = title.toLowerCase().trim();
  return [...ROUTINE_TITLES].some(r => t.includes(r));
}

function isMeetingEvent(title: string): boolean {
  const t = title.toLowerCase();
  return /\b(meeting|sync|standup|stand-up|call|check.?in|1:1|1on1|one.on.one|review|retro|sprint|scrum|interview|kickoff|all.hands|town.hall|workshop|presentation|demo|debrief)\b/.test(t);
}

function eventDurationHours(e: calendar_v3.Schema$Event): number {
  if (e.start?.dateTime && e.end?.dateTime) {
    const ms = new Date(e.end.dateTime).getTime() - new Date(e.start.dateTime).getTime();
    return ms / 3600000;
  }
  // All-day: cap at 8h per day
  if (e.start?.date && e.end?.date) {
    const days = (new Date(e.end.date).getTime() - new Date(e.start.date).getTime()) / 86400000;
    return days > 0 ? Math.min(days * 8, 8) : 0;
  }
  return 0;
}

/**
 * Score how closely an event title matches a priority text.
 * Returns number of meaningful keyword matches (words ≥4 chars, not stopwords).
 */
const STOP = new Set(['with', 'from', 'and', 'the', 'for', 'this', 'that', 'have',
  'will', 'your', 'our', 'are', 'has', 'was', 'call', 'meeting', 'sync']);

function priorityScore(eventTitle: string, priorityText: string): number {
  const pWords = priorityText.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length >= 4 && !STOP.has(w));
  const haystack = eventTitle.toLowerCase();
  return pWords.filter(w => haystack.includes(w)).length;
}

// ── Goal categories ─────────────────────────────────────────────────────────
//
// Some goals are served by activities we'd otherwise treat as "routine" (a
// weight goal is advanced by going to the gym and walking), and some goal
// texts have no keyword the matcher can use ("Get to 130 lbs" → get/130/lbs are
// all too short or stopwords). Without this, exercise time was dumped into the
// routine bucket and the goal showed 0% — falsely triggering a "neglected,
// highest-urgency" flag for a goal the user actively works on.
//
// When a PRIORITY matches a category's `priorityRe`, events matching that
// category's `activityRe` are credited TO the priority instead of routine.
interface GoalCategory {
  name: string;
  priorityRe: RegExp; // matches the priority/anchor text
  activityRe: RegExp; // matches event titles that serve this goal
}

const GOAL_CATEGORIES: GoalCategory[] = [
  {
    name: 'fitness',
    priorityRe: /\b(weight|lbs?|kgs?|pounds?|fitness|gym|workout|muscle|strength|lean|physique|bodyweight|cardio|in shape|lose fat)\b/i,
    activityRe: /\b(gym|workout|work out|lift|lifting|weights?|training|train|cardio|run|running|jog|walk|hike|yoga|pilates|spin|swim|cycle|cycling|ride|exercise|weigh|fitness)\b/i,
  },
];

/** True when the event serves the priority via a known goal category. */
function matchesPriorityCategory(eventTitle: string, priorityText: string): boolean {
  return GOAL_CATEGORIES.some(c => c.priorityRe.test(priorityText) && c.activityRe.test(eventTitle));
}

/**
 * Can this priority's progress actually be measured from calendar titles?
 * True if it has at least one usable keyword OR belongs to a goal category.
 * We must NOT flag an unmeasurable priority as "neglected" — that's a false
 * signal (we simply can't see its work in the calendar), not real neglect.
 */
function isMeasurablePriority(priorityText: string): boolean {
  const hasKeyword = priorityText.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .some(w => w.length >= 4 && !STOP.has(w));
  const hasCategory = GOAL_CATEGORIES.some(c => c.priorityRe.test(priorityText));
  return hasKeyword || hasCategory;
}

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Analyze 180-day event history and compute time allocation across focus areas.
 *
 * @param events - Past calendar events (from getPastCalendarEvents).
 * @param priorities - Stable priority texts to match events against.
 * @param opts.weeksBack - How many weeks to analyze (default 8).
 */
export function computeTimeAllocation(
  events: calendar_v3.Schema$Event[],
  priorities: { text: string }[],
  opts: { weeksBack?: number } = {},
): TimeAllocationResult | null {
  const weeksBack = opts.weeksBack ?? 8;

  // Filter to timed events in the window
  const cutoff = new Date(Date.now() - weeksBack * 7 * 86400000);
  const timedEvents = events.filter(e => {
    if (!e.start) return false;
    const startStr = e.start.dateTime ?? e.start.date;
    if (!startStr) return false;
    return new Date(startStr) >= cutoff;
  });

  if (timedEvents.length < 5) return null;

  // Determine actual period span in weeks
  const dates = timedEvents.map(e => new Date(e.start!.dateTime ?? e.start!.date!));
  const earliest = new Date(Math.min(...dates.map(d => d.getTime())));
  const latest   = new Date(Math.max(...dates.map(d => d.getTime())));
  const periodWeeks = Math.max(1, Math.round((latest.getTime() - earliest.getTime()) / (7 * 86400000)));

  // Accumulate hours per bucket
  const bucketHours: Map<string, number> = new Map();
  const initBucket = (label: string) => { if (!bucketHours.has(label)) bucketHours.set(label, 0); };

  for (const p of priorities) initBucket(p.text);
  initBucket('meetings');
  initBucket('routine');
  initBucket('other');

  let totalHours = 0;

  for (const e of timedEvents) {
    const title = (e.summary ?? '').trim();
    if (title.length < 2) continue;
    const hours = eventDurationHours(e);
    if (hours <= 0 || hours > 24) continue;  // skip implausible durations
    totalHours += hours;

    // Assign to the best-matching priority (highest score wins). Run this BEFORE
    // the routine catch-all so a fitness goal gets credited for gym/walk time;
    // events with no priority match still fall through to routine below.
    let bestPriority: string | null = null;
    let bestScore = 0;
    for (const p of priorities) {
      // Keyword score, plus a strong boost when the event serves the priority's
      // goal category (e.g. "Gym" → "Get to 130 lbs"), which keyword matching misses.
      const score = priorityScore(title, p.text) + (matchesPriorityCategory(title, p.text) ? 2 : 0);
      if (score > bestScore) { bestScore = score; bestPriority = p.text; }
    }

    if (bestPriority && bestScore > 0) {
      bucketHours.set(bestPriority, (bucketHours.get(bestPriority) ?? 0) + hours);
    } else if (isRoutineEvent(title)) {
      bucketHours.set('routine', (bucketHours.get('routine') ?? 0) + hours);
    } else if (isMeetingEvent(title)) {
      bucketHours.set('meetings', (bucketHours.get('meetings') ?? 0) + hours);
    } else {
      bucketHours.set('other', (bucketHours.get('other') ?? 0) + hours);
    }
  }

  if (totalHours < 1) return null;

  const buckets: TimeAllocationBucket[] = [...bucketHours.entries()]
    .filter(([, h]) => h > 0)
    .map(([label, hours]) => ({
      label,
      hours: Math.round(hours * 10) / 10,
      pct: Math.round((hours / totalHours) * 1000) / 10,
      weeklyAvg: Math.round((hours / periodWeeks) * 10) / 10,
    }))
    .sort((a, b) => b.hours - a.hours);

  // Biggest misalignment: most hours in 'meetings' or 'other' + least hours on a priority.
  // Only consider MEASURABLE priorities — flagging a goal we can't see in the calendar
  // (no keyword, no activity category) as "neglected" is a false signal, not real neglect.
  let biggestMisalignment: string | null = null;
  const measurable = priorities.filter(p => isMeasurablePriority(p.text));
  if (measurable.length > 0) {
    const lowestPriority = [...measurable]
      .map(p => ({ text: p.text, hours: bucketHours.get(p.text) ?? 0 }))
      .sort((a, b) => a.hours - b.hours)[0];
    const meetingHours = bucketHours.get('meetings') ?? 0;
    const meetingPct = Math.round((meetingHours / totalHours) * 100);
    const priorityPct = Math.round(((lowestPriority.hours) / totalHours) * 100);

    if (meetingPct > 40 && priorityPct < 10) {
      biggestMisalignment = `${meetingPct}% of time in meetings; only ${priorityPct}% on "${lowestPriority.text}"`;
    } else if (lowestPriority.hours < 1 && priorityPct === 0) {
      biggestMisalignment = `"${lowestPriority.text}" has received virtually no calendar time in the past ${periodWeeks} weeks`;
    }
  }

  return { totalHours: Math.round(totalHours * 10) / 10, periodWeeks, buckets, biggestMisalignment };
}

// ── Formatting ────────────────────────────────────────────────────────────────

/**
 * Format time allocation as a compact block for briefing prompt injection.
 * Returns '' when result is null.
 */
export function formatTimeAllocationForBriefing(result: TimeAllocationResult | null): string {
  if (!result) return '';

  const lines: string[] = [`TIME ALLOCATION (past ${result.periodWeeks}w, ${result.totalHours}h total):`];

  for (const b of result.buckets.slice(0, 6)) {
    lines.push(`  ${b.pct}% ${b.label} — ${b.hours}h total, ${b.weeklyAvg}h/week`);
  }

  if (result.biggestMisalignment) {
    lines.push(`⚠ MISALIGNMENT: ${result.biggestMisalignment}`);
  }

  return lines.join('\n');
}

/**
 * Break `events` into `numWeeks` consecutive Sun–Sat weekly buckets ending this week,
 * and for each bucket compute hours attributed to each priority (keyword + goal-category
 * matching, same as computeTimeAllocation) plus unattributed "other" hours.
 *
 * Returns buckets oldest-first. The last bucket is the current (in-progress) week,
 * so its hours reflect time invested so far this week, not the full week.
 *
 * Pure function — no I/O. Uses Date.now() (mockable via vi.setSystemTime in tests).
 */
export function computeWeeklyBreakdown(
  events: calendar_v3.Schema$Event[],
  priorities: { text: string }[],
  numWeeks: number,
): WeeklyBucket[] {
  if (numWeeks < 1 || priorities.length === 0) return [];

  // Find the start of the current week (most recent Sunday 00:00 UTC).
  const now = Date.now();
  const nowDate = new Date(now);
  const dayOfWeek = nowDate.getUTCDay(); // 0=Sun, …, 6=Sat
  const currentWeekStartMs = now - dayOfWeek * 86400000 - (nowDate.getUTCHours() * 3600000 + nowDate.getUTCMinutes() * 60000 + nowDate.getUTCSeconds() * 1000 + nowDate.getUTCMilliseconds());

  const buckets: WeeklyBucket[] = [];
  for (let i = numWeeks - 1; i >= 0; i--) {
    const weekStartMs = currentWeekStartMs - i * 7 * 86400000;
    const weekEndMs   = weekStartMs + 7 * 86400000;
    const weekStartDate = new Date(weekStartMs);

    const weekLabel = weekStartDate.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', timeZone: 'UTC',
    });
    const weekStart = weekStartDate.toISOString().slice(0, 10);

    const perPriority: { [text: string]: number } = {};
    for (const p of priorities) perPriority[p.text] = 0;
    let otherHours = 0;

    for (const e of events) {
      const startStr = e.start?.dateTime ?? e.start?.date;
      if (!startStr) continue;
      const t = new Date(startStr).getTime();
      if (t < weekStartMs || t >= weekEndMs) continue;

      const title = (e.summary ?? '').trim();
      if (!title) continue;
      const hours = eventDurationHours(e);
      if (hours <= 0 || hours > 24) continue;

      let bestPriority: string | null = null;
      let bestScore = 0;
      for (const p of priorities) {
        const score = priorityScore(title, p.text) + (matchesPriorityCategory(title, p.text) ? 2 : 0);
        if (score > bestScore) { bestScore = score; bestPriority = p.text; }
      }

      if (bestPriority && bestScore > 0) {
        perPriority[bestPriority] = (perPriority[bestPriority] ?? 0) + hours;
      } else {
        otherHours += hours;
      }
    }

    // Round to 1 decimal
    for (const key of Object.keys(perPriority)) {
      perPriority[key] = Math.round(perPriority[key] * 10) / 10;
    }

    buckets.push({
      weekLabel,
      weekStart,
      perPriority,
      otherHours: Math.round(otherHours * 10) / 10,
    });
  }

  return buckets;
}

/**
 * Format as a one-line spoken insight for Edge to surface mid-call.
 * Returns null when there's nothing interesting.
 */
export function formatTimeAllocationInsight(result: TimeAllocationResult | null): string | null {
  if (!result || result.buckets.length < 2) return null;

  const top = result.buckets[0];
  const bottom = result.buckets[result.buckets.length - 1];

  if (result.biggestMisalignment) {
    return result.biggestMisalignment;
  }

  if (top.pct >= 50) {
    return `${top.pct}% of your calendar time has been going to ${top.label} over the past ${result.periodWeeks} weeks`;
  }

  if (bottom.pct < 5 && bottom.label !== 'routine' && bottom.label !== 'other') {
    return `"${bottom.label}" has only gotten ${bottom.pct}% of your calendar time (${bottom.weeklyAvg}h/week avg) over the past ${result.periodWeeks} weeks`;
  }

  return null;
}
