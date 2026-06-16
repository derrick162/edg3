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

    if (isRoutineEvent(title)) {
      bucketHours.set('routine', (bucketHours.get('routine') ?? 0) + hours);
      continue;
    }

    // Assign to the best-matching priority (highest score wins)
    let bestPriority: string | null = null;
    let bestScore = 0;
    for (const p of priorities) {
      const score = priorityScore(title, p.text);
      if (score > bestScore) { bestScore = score; bestPriority = p.text; }
    }

    if (bestPriority && bestScore > 0) {
      bucketHours.set(bestPriority, (bucketHours.get(bestPriority) ?? 0) + hours);
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

  // Biggest misalignment: most hours in 'meetings' or 'other' + least hours on a priority
  let biggestMisalignment: string | null = null;
  if (priorities.length > 0) {
    const lowestPriority = [...priorities]
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
