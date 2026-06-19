// Priority↔calendar alignment for EDG3 briefings (Core-owned).
//
// Measures how many real calendar hours map to each stated weekly priority, and how many
// hours are unaligned (meetings/events that don't serve any priority). The result is injected
// into the briefing prompt as structured facts so the model can make one concrete, empathetic
// observation — not a vague aside.
//
// Design: ONE Claude-Haiku call classifies all events at once (no per-event round-trips).
// Always degrades safely: any failure returns null, and the briefing falls back gracefully.

import { type calendar_v3 } from 'googleapis';
import { type Priority } from './db';

export interface AlignmentResult {
  perPriority: { priority: string; hours: number; blocked: boolean }[];
  unalignedHours: number;
  routineHours: number;  // subset of unalignedHours that are routine (meals, gym, etc.)
  topUnaligned: { title: string; hours: number }[];
}

function eventDurationHours(e: calendar_v3.Schema$Event): number {
  if (e.start?.dateTime && e.end?.dateTime) {
    const ms = new Date(e.end.dateTime).getTime() - new Date(e.start.dateTime).getTime();
    return Math.round((ms / 3600000) * 10) / 10;
  }
  if (e.start?.date && e.end?.date) {
    // All-day: cap at 8h regardless of span — multi-day blocks (trips/OOO/vacations) are
    // context, not countable work hours. Without this cap a 45-day trip → 360h and Edge
    // would fabricate absurd "hours to allocate" figures from that inflated total.
    const days = (new Date(e.end.date).getTime() - new Date(e.start.date).getTime()) / 86400000;
    return days > 0 ? Math.min(days * 8, 8) : 0;
  }
  return 0;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

const ROUTINE_TITLES_ALIGNMENT = new Set([
  'breakfast', 'lunch', 'dinner', 'coffee', 'gym', 'workout', 'morning walk',
  'evening walk', 'meal prep', 'sleep', 'commute', 'transit', 'shower',
]);
export function isRoutineTitle(title: string): boolean {
  const t = title.toLowerCase().trim();
  return [...ROUTINE_TITLES_ALIGNMENT].some(r => t.includes(r));
}

// Fitness/weight goals are advanced BY exercise — which the routine set above would
// otherwise discard. When the user has a fitness/weight priority, exercise events
// (gym/walk/run/lift…) must count TOWARD it ("Gym" IS the "Get to 130 lbs" work),
// not get dropped into routine/unaligned. Without this, the briefing said the weight
// goal "only got 2.5 hours" while gym hours vanished — a trust-eroding false signal.
// Mirrors the GOAL_CATEGORIES fix in timeAllocation.ts (dashboard) — this is the briefing path.
const FITNESS_PRIORITY_RE = /\b(weight|lbs?|kgs?|pounds?|fitness|gym|workout|muscle|strength|lean|physique|bodyweight|cardio|in shape|lose fat)\b/i;
const EXERCISE_EVENT_RE = /\b(gym|workout|work out|lift|lifting|weights?|training|train|cardio|run|running|jog|walk|hike|yoga|pilates|spin|swim|cycle|cycling|ride|exercise|weigh|fitness)\b/i;

/**
 * Classify this week's calendar events against the user's stated priorities via one Haiku call.
 * Returns a structured result with hours-per-priority and unaligned time sinks.
 * Returns null on ANY failure so callers always degrade gracefully.
 */
export async function computeAlignment(
  priorities: Priority[],
  weekEvents: calendar_v3.Schema$Event[],
  _tz: string,
): Promise<AlignmentResult | null> {
  try {
    if (!priorities.length) return null;

    // sanitizeForPrompt: strip newlines (prevent prompt injection via multiline titles),
    // then cap length. Calendar titles and descriptions come from user-controlled Google
    // Calendar data — an attacker could set a title to inject instructions into the
    // classifier prompt. The output is parsed as structured JSON so injection is low-risk,
    // but defense-in-depth is cheap here.
    const sanitize = (s: string, maxLen: number) =>
      s.replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);

    const events = weekEvents
      .slice(0, 40) // cap to avoid oversized prompts
      .map(e => ({
        title: sanitize(e.summary || 'Untitled', 100),
        // Include the event description so user-added context ("- Edg3 MVP", agendas, notes)
        // is visible to the classifier — generic titles alone often don't reveal the focus area.
        description: sanitize(e.description || '', 200),
        hours: eventDurationHours(e),
      }))
      .filter(e => e.hours > 0);

    // No time-bearing events → all priorities at 0h, nothing unaligned
    if (!events.length) {
      return {
        perPriority: priorities.map(p => ({ priority: p.text, hours: 0, blocked: false })),
        unalignedHours: 0,
        routineHours: 0,
        topUnaligned: [],
      };
    }

    const priorityList = priorities.map((p, i) => `${i + 1}. ${p.text}`).join('\n');
    const eventList = events.map(e =>
      `- "${e.title}"${e.description ? ` [notes: ${e.description}]` : ''} (${e.hours.toFixed(1)}h)`
    ).join('\n');

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      temperature: 0, // deterministic classification — same calendar → same Focus Score on refresh
      messages: [{
        role: 'user',
        content: `Classify each calendar event against the priorities below. Output ONLY a JSON array — no preamble, no markdown, no commentary.

Priorities:
${priorityList}

Events this week:
${eventList}

For each event assign a priority number (1–${priorities.length}) if it contributes to that priority — consider the title AND any [notes] — or "none" if it doesn't relate to any priority.
Output format: [{"event":"EXACT TITLE","priority":"1"},{"event":"EXACT TITLE","priority":"none"},...]`,
      }],
    });

    const raw = res.content
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { type: string; text?: string }) => b.text ?? '')
      .join('')
      .trim();

    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return null;

    const classifications: { event: string; priority: string }[] = JSON.parse(match[0]);

    const hoursMap = new Map<number, number>(priorities.map((_, i) => [i + 1, 0]));
    const unalignedList: { title: string; hours: number }[] = [];
    let routineHoursTotal = 0;

    // 1-based index of a fitness/weight priority (0 = none). Exercise events the model
    // marks "none" get credited here instead of routine — gym IS the weight-goal work.
    const fitnessIdx = priorities.findIndex(p => FITNESS_PRIORITY_RE.test(p.text)) + 1;

    // Match the model's echoed title back to our event robustly — exact-string match was
    // fragile (any case/whitespace drift dropped the event and silently zeroed its hours).
    const norm = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    for (const c of classifications) {
      const target = norm(c.event);
      const ev = events.find(e => norm(e.title) === target);
      if (!ev) continue;
      const idx = parseInt(c.priority, 10);
      if (!isNaN(idx) && idx >= 1 && idx <= priorities.length) {
        hoursMap.set(idx, (hoursMap.get(idx) ?? 0) + ev.hours);
      } else if (fitnessIdx > 0 && EXERCISE_EVENT_RE.test(ev.title)) {
        // Exercise event + the user has a fitness/weight goal → credit it to that goal.
        hoursMap.set(fitnessIdx, (hoursMap.get(fitnessIdx) ?? 0) + ev.hours);
      } else {
        if (isRoutineTitle(ev.title)) routineHoursTotal += ev.hours;
        unalignedList.push({ title: ev.title, hours: ev.hours });
      }
    }

    return {
      perPriority: priorities.map((p, i) => {
        const h = round1(hoursMap.get(i + 1) ?? 0);
        return { priority: p.text, hours: h, blocked: h > 0 };
      }),
      unalignedHours: round1(unalignedList.reduce((s, e) => s + e.hours, 0)),
      routineHours: round1(routineHoursTotal),
      topUnaligned: [...unalignedList]
        .filter(e => !isRoutineTitle(e.title))
        .sort((a, b) => b.hours - a.hours)
        .slice(0, 3)
        .map(e => ({ title: e.title, hours: round1(e.hours) })),
    };
  } catch {
    return null;
  }
}

/**
 * Detect one concrete calendar hygiene issue from the week's events.
 * Returns a single punchy sentence, or null if the week looks healthy.
 *
 * Checks (in order):
 * 1. A day with 3+ back-to-back meetings (< 15 min gap between consecutive events).
 * 2. 3+ busy days with no 90-minute focus block between any two meetings.
 */
export function detectHygieneFlags(
  weekEvents: calendar_v3.Schema$Event[],
  tz: string,
): string | null {
  // Only timed (non-all-day) events
  const timed = weekEvents.filter(e => e.start?.dateTime && e.end?.dateTime);
  if (!timed.length) return null;

  // Group by day in user's timezone (YYYY-MM-DD in en-CA locale)
  const byDay = new Map<string, { startMs: number; endMs: number }[]>();
  for (const e of timed) {
    const dayKey = new Date(e.start!.dateTime!).toLocaleDateString('en-CA', { timeZone: tz });
    const entry = {
      startMs: new Date(e.start!.dateTime!).getTime(),
      endMs: new Date(e.end!.dateTime!).getTime(),
    };
    if (!byDay.has(dayKey)) byDay.set(dayKey, []);
    byDay.get(dayKey)!.push(entry);
  }

  const GAP_MS = 15 * 60 * 1000;   // 15 min breathing room threshold
  const FOCUS_MS = 90 * 60 * 1000; // 90 min focus block threshold
  const STREAK_MIN = 3;             // 3+ meetings needed to flag back-to-back

  // Check 1: any day with 3+ consecutive meetings with < 15 min gap
  for (const [dayKey, events] of [...byDay.entries()].sort()) {
    if (events.length < STREAK_MIN) continue;
    const sorted = [...events].sort((a, b) => a.startMs - b.startMs);
    let streak = 1;
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].startMs - sorted[i - 1].endMs;
      if (gap < GAP_MS) {
        streak++;
        if (streak >= STREAK_MIN) {
          // dayKey is YYYY-MM-DD in user's tz; noon UTC on that date is always the same weekday
          const dayName = new Date(dayKey + 'T12:00:00Z').toLocaleDateString('en-US', {
            weekday: 'long',
            timeZone: 'UTC',
          });
          return `${dayName} has ${streak}+ back-to-back meetings with no real break`;
        }
      } else {
        streak = 1;
      }
    }
  }

  // Check 2: 3+ busy days with no 90-min focus gap anywhere between meetings
  const busyDays = [...byDay.values()].filter(events => events.length >= 2);
  if (busyDays.length >= 3) {
    const anyFocus = busyDays.some(events => {
      const sorted = [...events].sort((a, b) => a.startMs - b.startMs);
      return sorted.some((_, i) => i > 0 && sorted[i].startMs - sorted[i - 1].endMs >= FOCUS_MS);
    });
    if (!anyFocus) return 'Every busy day this week is packed wall-to-wall — no deep-work blocks anywhere';
  }

  return null;
}
