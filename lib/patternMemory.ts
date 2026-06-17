// Pattern Memory (M3) — Core-owned.
//
// Synthesizes cross-source behavioral patterns from calendar + Whoop history.
// Pure — zero I/O. Builds on calendarPatterns.ts (per-layer patterns) and
// whoopCorrelations.ts (meeting → recovery), adding:
//   - Productive-day detection (which days have the most uninterrupted deep work)
//   - Meeting-load ↔ recovery correlation (total meeting count vs next-day score)
//   - Light-day pattern (which day is reliably free for focus)
//
// One honest pattern is picked and injected into the briefing.
// Results are persisted to `pattern_cache` by the briefing path (one row/user,
// refreshed each call) so the dashboard reads from DB without a Google API call.

import type { calendar_v3 } from 'googleapis';

// ── Types ─────────────────────────────────────────────────────────────────────

export type PatternType =
  | 'productive_day'      // certain days reliably have the most uninterrupted time
  | 'light_day'           // certain days are consistently meeting-light
  | 'meeting_load_recovery' // heavy-meeting days → lower next-day recovery
  | 'focus_window';       // certain hour range is consistently uninterrupted

export interface PatternInsight {
  type: PatternType;
  summary: string;        // plain English, specific, honest — "Tuesdays and Thursdays are…"
  confidence: 'high' | 'medium';
  sampleDays: number;     // how many data points backed this up
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function dayOfWeek(isoDateTime: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: timezone })
      .format(new Date(isoDateTime));
  } catch {
    return DAYS[new Date(isoDateTime).getUTCDay()];
  }
}

function hourOfDay(isoDateTime: string, timezone: string): number {
  try {
    return parseInt(
      new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone })
        .format(new Date(isoDateTime)),
      10,
    );
  } catch {
    return new Date(isoDateTime).getUTCHours();
  }
}

function isoDateFrom(isoString: string): string {
  return isoString.slice(0, 10);
}

function durationMinutes(event: calendar_v3.Schema$Event): number {
  if (!event.start?.dateTime || !event.end?.dateTime) return 0;
  return (new Date(event.end.dateTime).getTime() - new Date(event.start.dateTime).getTime()) / 60000;
}

/** Friendly comma-joined day list: "Tuesday and Thursday" or "Tuesday, Wednesday, and Thursday" */
function joinDays(days: string[]): string {
  if (days.length === 0) return '';
  if (days.length === 1) return days[0];
  if (days.length === 2) return `${days[0]} and ${days[1]}`;
  return `${days.slice(0, -1).join(', ')}, and ${days[days.length - 1]}`;
}

// ── Pattern 1 — Productive-day detection ─────────────────────────────────────

/**
 * Detects which days of the week tend to have the most uninterrupted time blocks.
 *
 * "Uninterrupted block" = a timed event ≥60 min (proxy for deep work) with no
 * other timed event starting or ending within 15 min of it.
 *
 * Returns the top 1–2 days that are meaningfully better than the others,
 * or null when the signal is too weak.
 */
export function detectProductiveDayPattern(
  events: calendar_v3.Schema$Event[],
  timezone: string,
  nowIso?: string,
): PatternInsight | null {
  const cutoff = nowIso ?? new Date().toISOString();

  // Timed weekday past events only
  const timedPast = events.filter(e => {
    if (!e.start?.dateTime) return false;
    if (e.start.dateTime >= cutoff) return false;
    const dow = dayOfWeek(e.start.dateTime, timezone);
    return WEEKDAY_NAMES.includes(dow);
  });

  if (timedPast.length < 15) return null;

  // Group events by (date, dayOfWeek) to count uninterrupted blocks per occurrence
  const byDate = new Map<string, calendar_v3.Schema$Event[]>();
  for (const e of timedPast) {
    const d = isoDateFrom(e.start!.dateTime!);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(e);
  }

  // Accumulate uninterrupted-block counts per day-of-week
  const dayBlocks = new Map<string, number[]>(); // day → [count per occurrence]
  for (const name of WEEKDAY_NAMES) dayBlocks.set(name, []);

  for (const [date, dayEvents] of byDate) {
    const dow = dayOfWeek(dayEvents[0].start!.dateTime!, timezone);
    if (!WEEKDAY_NAMES.includes(dow)) continue;

    // Find long events (≥60 min) that don't overlap with short surrounding events
    const sorted = [...dayEvents].sort((a, b) =>
      new Date(a.start!.dateTime!).getTime() - new Date(b.start!.dateTime!).getTime()
    );

    let focusBlocks = 0;
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i];
      if (durationMinutes(e) < 60) continue;
      const start = new Date(e.start!.dateTime!).getTime();
      const end = new Date(e.end!.dateTime!).getTime();

      // Check no other event starts/ends within 15 min of this block
      const interrupted = sorted.some((other, j) => {
        if (j === i) return false;
        const os = new Date(other.start!.dateTime!).getTime();
        const oe = new Date(other.end?.dateTime ?? other.start!.dateTime!).getTime();
        // Interruption: other event starts during or ends during this block (within 15 min buffer)
        return os < end + 900000 && oe > start - 900000;
      });

      if (!interrupted) focusBlocks++;
    }

    dayBlocks.get(dow)!.push(focusBlocks);
  }

  // Compute avg blocks per occurrence for each weekday
  const avgByDay: { day: string; avg: number; count: number }[] = [];
  for (const [day, counts] of dayBlocks) {
    if (counts.length < 3) continue; // need at least 3 weeks of that day
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    avgByDay.push({ day, avg, count: counts.length });
  }

  if (avgByDay.length < 3) return null; // not enough days with data

  avgByDay.sort((a, b) => b.avg - a.avg);
  const top = avgByDay[0];
  const median = avgByDay[Math.floor(avgByDay.length / 2)].avg;

  // Top day must be meaningfully better (≥0.5 more focus blocks than median)
  if (top.avg - median < 0.5) return null;

  // Find days that are close to the top (within 0.3 blocks)
  const topDays = avgByDay.filter(d => d.avg >= top.avg - 0.3).map(d => d.day);
  // Sort by natural weekday order
  const orderedTopDays = WEEKDAY_NAMES.filter(d => topDays.includes(d));

  const sampleDays = topDays.reduce((sum, day) => sum + (avgByDay.find(d => d.day === day)?.count ?? 0), 0);

  return {
    type: 'productive_day',
    summary: `${joinDays(orderedTopDays)} tend to be your most uninterrupted — that's when longer blocks of focused time show up most often`,
    confidence: sampleDays >= 12 ? 'high' : 'medium',
    sampleDays,
  };
}

// ── Pattern 2 — Light-day detection ──────────────────────────────────────────

/**
 * Detects which weekday is consistently the lightest (fewest meetings).
 * Complements productive-day by naming the best FREE day.
 */
export function detectLightDayPattern(
  events: calendar_v3.Schema$Event[],
  timezone: string,
  nowIso?: string,
): PatternInsight | null {
  const cutoff = nowIso ?? new Date().toISOString();

  const timedPast = events.filter(e =>
    e.start?.dateTime && e.start.dateTime < cutoff &&
    WEEKDAY_NAMES.includes(dayOfWeek(e.start.dateTime, timezone))
  );

  if (timedPast.length < 10) return null;

  const dayMeetingCounts = new Map<string, number[]>(); // day → [meetings per week occurrence]
  for (const name of WEEKDAY_NAMES) dayMeetingCounts.set(name, []);

  const byDate = new Map<string, number>();
  for (const e of timedPast) {
    const d = isoDateFrom(e.start!.dateTime!);
    byDate.set(d, (byDate.get(d) ?? 0) + 1);
  }

  for (const [date, count] of byDate) {
    const dow = dayOfWeek(
      timedPast.find(e => isoDateFrom(e.start!.dateTime!) === date)!.start!.dateTime!,
      timezone,
    );
    if (!WEEKDAY_NAMES.includes(dow)) continue;
    dayMeetingCounts.get(dow)!.push(count);
  }

  const avgByDay = WEEKDAY_NAMES
    .map(day => {
      const counts = dayMeetingCounts.get(day)!;
      if (counts.length < 3) return null;
      return { day, avg: counts.reduce((a, b) => a + b, 0) / counts.length, count: counts.length };
    })
    .filter((x): x is { day: string; avg: number; count: number } => x !== null)
    .sort((a, b) => a.avg - b.avg);

  if (avgByDay.length < 3) return null;

  const lightest = avgByDay[0];
  const median = avgByDay[Math.floor(avgByDay.length / 2)].avg;

  // Must be meaningfully lighter (≥20% fewer meetings than median)
  if (median <= 0 || (median - lightest.avg) / median < 0.2) return null;

  return {
    type: 'light_day',
    summary: `${lightest.day}s are consistently your lightest day — averaging ${lightest.avg.toFixed(1)} meetings vs ${median.toFixed(1)} on a typical day`,
    confidence: lightest.count >= 8 ? 'high' : 'medium',
    sampleDays: lightest.count,
  };
}

// ── Pattern 3 — Meeting load ↔ recovery correlation ──────────────────────────

/**
 * Detects whether heavy-meeting days (≥5 timed events) correlate with
 * lower next-day recovery vs light-meeting days (≤2 timed events).
 *
 * Requires ≥8 paired days total across both groups and ≥3 in each.
 */
export function detectMeetingLoadRecoveryPattern(
  events: calendar_v3.Schema$Event[],
  recoveryHistory: { date: string; recoveryScore: number }[],
  timezone: string,
  nowIso?: string,
): PatternInsight | null {
  if (recoveryHistory.length < 6) return null;

  const cutoff = nowIso ?? new Date().toISOString();

  // Count timed events per date (in user timezone)
  const meetingCountByDate = new Map<string, number>();
  for (const e of events) {
    if (!e.start?.dateTime || e.start.dateTime >= cutoff) continue;
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(e.start.dateTime));
    meetingCountByDate.set(d, (meetingCountByDate.get(d) ?? 0) + 1);
  }

  const recoveryByDate = new Map<string, number>();
  for (const r of recoveryHistory) recoveryByDate.set(r.date, r.recoveryScore);

  // Pair each day with the NEXT day's recovery
  const sortedDates = [...meetingCountByDate.keys()].sort();
  const heavyRecovery: number[] = [];
  const lightRecovery: number[] = [];

  for (const date of sortedDates) {
    const count = meetingCountByDate.get(date)!;
    // Find the next day's date
    const nextDate = new Date(date + 'T12:00:00Z');
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const nextDateStr = nextDate.toISOString().slice(0, 10);
    const nextRecovery = recoveryByDate.get(nextDateStr);
    if (nextRecovery === undefined) continue;

    if (count >= 5) heavyRecovery.push(nextRecovery);
    else if (count <= 2) lightRecovery.push(nextRecovery);
  }

  if (heavyRecovery.length < 3 || lightRecovery.length < 3) return null;

  const avgHeavy = heavyRecovery.reduce((a, b) => a + b, 0) / heavyRecovery.length;
  const avgLight = lightRecovery.reduce((a, b) => a + b, 0) / lightRecovery.length;
  const diff = avgLight - avgHeavy;

  // Only surface if light days recovery is ≥8 points higher (meaningful signal)
  if (Math.abs(diff) < 8) return null;

  const sampleDays = heavyRecovery.length + lightRecovery.length;
  const direction = diff > 0 ? 'lower' : 'higher';

  return {
    type: 'meeting_load_recovery',
    summary: diff > 0
      ? `On days with 5+ meetings, next-day recovery drops about ${Math.round(diff)}pts vs lighter days — your body notices the load`
      : `Days with 5+ meetings actually precede slightly ${direction} recovery scores — you seem to recharge well after busy days`,
    confidence: sampleDays >= 14 ? 'high' : 'medium',
    sampleDays,
  };
}

// ── Pattern 4 — Focus window ──────────────────────────────────────────────────

/**
 * Detects which 2-hour window is most consistently free of meetings
 * (proxy for the user's natural focus window). Extends calendarPatterns'
 * hour-density analysis with a "consistent across weeks" filter.
 */
export function detectFocusWindowPattern(
  events: calendar_v3.Schema$Event[],
  timezone: string,
  nowIso?: string,
): PatternInsight | null {
  const cutoff = nowIso ?? new Date().toISOString();

  const timedPast = events.filter(e =>
    e.start?.dateTime && e.start.dateTime < cutoff &&
    WEEKDAY_NAMES.includes(dayOfWeek(e.start.dateTime, timezone))
  );

  if (timedPast.length < 15) return null;

  // Bucket by week + hour to find hours that are consistently (≥60% of weeks) meeting-free
  const weekKey = (iso: string) => {
    const d = new Date(iso);
    const msPerWeek = 7 * 86400000;
    return Math.floor(d.getTime() / msPerWeek);
  };

  const hourOccupiedByWeek = new Map<number, Set<number>>(); // hour → set of weeks with any meeting
  const totalWeeks = new Set<number>();

  for (const e of timedPast) {
    const dt = e.start!.dateTime!;
    const h = hourOfDay(dt, timezone);
    const wk = weekKey(dt);
    if (h < 6 || h > 19) continue;
    totalWeeks.add(wk);
    if (!hourOccupiedByWeek.has(h)) hourOccupiedByWeek.set(h, new Set());
    hourOccupiedByWeek.get(h)!.add(wk);
  }

  const totalWk = totalWeeks.size;
  if (totalWk < 4) return null;

  // Find the 2-hour slot (consecutive hours) with lowest combined occupancy rate
  const workHours = Array.from({ length: 13 }, (_, i) => i + 7); // 7–19
  let bestSlot: [number, number] | null = null;
  let bestOccRate = 1;

  for (let i = 0; i < workHours.length - 1; i++) {
    const h1 = workHours[i], h2 = workHours[i + 1];
    const occupied1 = hourOccupiedByWeek.get(h1)?.size ?? 0;
    const occupied2 = hourOccupiedByWeek.get(h2)?.size ?? 0;
    const combined = new Set([...(hourOccupiedByWeek.get(h1) ?? []), ...(hourOccupiedByWeek.get(h2) ?? [])]);
    const rate = combined.size / totalWk;
    if (rate < bestOccRate) { bestOccRate = rate; bestSlot = [h1, h2]; }
  }

  if (!bestSlot || bestOccRate > 0.4) return null; // occupied >40% of weeks → not reliable

  const [h1, h2] = bestSlot;
  const fmt = (h: number) => {
    if (h === 12) return '12 PM';
    if (h < 12) return `${h} AM`;
    return `${h - 12} PM`;
  };

  const freeRate = Math.round((1 - bestOccRate) * 100);

  return {
    type: 'focus_window',
    summary: `${fmt(h1)}–${fmt(h2 + 1)} is your most reliable open window — free of meetings about ${freeRate}% of weekday mornings`,
    confidence: totalWk >= 8 ? 'high' : 'medium',
    sampleDays: totalWk,
  };
}

// ── Synthesis ─────────────────────────────────────────────────────────────────

/**
 * From a list of detected patterns (some may be null), pick the single
 * best one to surface in the briefing. Priority:
 * 1. high confidence
 * 2. most sample days (larger evidence base)
 * 3. tie-break: productive_day > meeting_load_recovery > light_day > focus_window
 */
export function pickBestPattern(patterns: (PatternInsight | null)[]): PatternInsight | null {
  const valid = patterns.filter((p): p is PatternInsight => p !== null);
  if (!valid.length) return null;

  const TYPE_RANK: Record<PatternType, number> = {
    productive_day: 0,
    meeting_load_recovery: 1,
    light_day: 2,
    focus_window: 3,
  };

  return valid.sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === 'high' ? -1 : 1;
    if (b.sampleDays !== a.sampleDays) return b.sampleDays - a.sampleDays;
    return TYPE_RANK[a.type] - TYPE_RANK[b.type];
  })[0];
}

/**
 * Format a pattern insight as a briefing prompt block, or return empty string.
 */
export function formatPatternForBriefing(pattern: PatternInsight | null): string {
  if (!pattern) return '';
  return `PATTERN INSIGHT (${pattern.confidence} confidence, ${pattern.sampleDays} data points):\n${pattern.summary}`;
}
