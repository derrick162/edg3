// Calendar Pattern Detection — Core-owned.
//
// Analyzes ~6 months of past calendar events to surface:
// - Recurring routines (events that happen ≥3x/week on average)
// - Meeting-density windows (when meetings are clustered)
// - Inferred focus windows (consistently meeting-free periods)
// - Busy vs light days by day-of-week
// - Meeting-load trend (last 4 weeks vs prior 4 weeks)
//
// Pure — no I/O. Input = past calendar events from getPastCalendarEvents(userId, 180).
// Output feeds into energy recommendations, briefing context, and energy profile inference.

import type { calendar_v3 } from 'googleapis';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CalendarPatterns {
  routines: string[];                            // titles of recurring anchors (≥3/week avg)
  meetingPeakHours: number[];                    // hours (0-23) with most meeting density
  inferencedFocusHours: number[];               // hours (0-23) consistently meeting-free during workday
  busyDaysOfWeek: string[];                      // day names with heaviest meeting load, sorted desc
  avgMeetingsPerDay: number;                     // across the analysis window (working days only)
  meetingTrend: 'increasing' | 'stable' | 'decreasing'; // last 4w vs prior 4w
  periodWeeks: number;                           // how many weeks of data analyzed
}

// Normalize event title for grouping: lowercase, strip punctuation, trim
function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, ' ');
}

// ── Core analysis ─────────────────────────────────────────────────────────────

/**
 * Analyze past calendar events and return pattern insights.
 * Pure — no I/O.
 *
 * @param events - Past calendar events (typically 180 days).
 * @param opts.minWeeks - Minimum weeks to return a result; default 4.
 * @param opts.timezone - User's IANA timezone (affects hour-of-day bucketing).
 */
export function detectCalendarPatterns(
  events: calendar_v3.Schema$Event[],
  opts: { minWeeks?: number; timezone?: string } = {},
): CalendarPatterns | null {
  const tz = opts.timezone ?? 'UTC';
  const minWeeks = opts.minWeeks ?? 4;

  // Only look at timed events during working hours (7am–8pm) on weekdays
  const timedEvents = events.filter(e => {
    if (!e.start?.dateTime) return false;
    const start = new Date(e.start.dateTime);
    const dayOfWeek = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: tz }).format(start);
    if (dayOfWeek === 'Saturday' || dayOfWeek === 'Sunday') return false;
    const hour = parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(start), 10);
    return hour >= 7 && hour <= 20 && (e.summary ?? '').trim().length >= 3;
  });

  if (timedEvents.length < 10) return null;  // not enough data

  // Determine analysis window
  const dates = timedEvents.map(e => new Date(e.start!.dateTime!));
  const earliest = new Date(Math.min(...dates.map(d => d.getTime())));
  const latest = new Date(Math.max(...dates.map(d => d.getTime())));
  const periodWeeks = Math.max(1, Math.round((latest.getTime() - earliest.getTime()) / (7 * 86400000)));

  if (periodWeeks < minWeeks) return null;

  // ── 1. Recurring routines ────────────────────────────────────────────────

  const titleCounts = new Map<string, number>();
  for (const e of timedEvents) {
    const key = normalizeTitle(e.summary ?? '');
    if (key.length >= 3) titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
  }

  const weeksInPeriod = Math.max(1, periodWeeks);
  // "Routine" = appears on average ≥3 times per week
  const routineThreshold = weeksInPeriod * 3;
  const routines = [...titleCounts.entries()]
    .filter(([, count]) => count >= routineThreshold)
    .sort((a, b) => b[1] - a[1])
    .map(([title]) => title.replace(/\b\w/g, c => c.toUpperCase()))  // title-case
    .slice(0, 8);

  // ── 2. Meeting density by hour-of-day ────────────────────────────────────

  const hourCounts = new Array(24).fill(0) as number[];
  for (const e of timedEvents) {
    const start = new Date(e.start!.dateTime!);
    const hour = parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(start), 10);
    hourCounts[hour] += 1;
  }

  // Peak: top 3 working hours by event count
  const workingHours = Array.from({ length: 12 }, (_, i) => i + 7); // 7–18
  const sortedByDensity = [...workingHours].sort((a, b) => hourCounts[b] - hourCounts[a]);
  const meetingPeakHours = sortedByDensity.slice(0, 3).sort((a, b) => a - b);

  // Inferred focus hours: working hours with consistently low meeting density
  // Select the 2 contiguous blocks of 2 hours that are meeting-lightest
  const lightHours = [...workingHours].sort((a, b) => hourCounts[a] - hourCounts[b]);
  const inferencedFocusHours = lightHours
    .slice(0, 4)
    .sort((a, b) => a - b);

  // ── 3. Busy days by day-of-week ──────────────────────────────────────────

  const dayEventCounts = new Map<string, number>();
  for (const e of timedEvents) {
    const day = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: tz }).format(new Date(e.start!.dateTime!));
    dayEventCounts.set(day, (dayEventCounts.get(day) ?? 0) + 1);
  }

  const busyDaysOfWeek = [...dayEventCounts.entries()]
    .filter(([day]) => day !== 'Saturday' && day !== 'Sunday')
    .sort((a, b) => b[1] - a[1])
    .map(([day]) => day);

  // ── 4. Avg meetings per working day ──────────────────────────────────────

  // Count working days in the period (Mon–Fri)
  let workingDays = 0;
  const d = new Date(earliest);
  while (d <= latest) {
    const dow = d.getUTCDay();
    if (dow >= 1 && dow <= 5) workingDays++;
    d.setUTCDate(d.getUTCDate() + 1);
  }

  const avgMeetingsPerDay = workingDays > 0
    ? Math.round((timedEvents.length / workingDays) * 10) / 10
    : 0;

  // ── 5. Meeting trend ─────────────────────────────────────────────────────

  const fourWeeksAgo = new Date(latest.getTime() - 28 * 86400000);
  const eightWeeksAgo = new Date(latest.getTime() - 56 * 86400000);

  const last4w = timedEvents.filter(e => new Date(e.start!.dateTime!) >= fourWeeksAgo).length;
  const prior4w = timedEvents.filter(e => {
    const t = new Date(e.start!.dateTime!);
    return t >= eightWeeksAgo && t < fourWeeksAgo;
  }).length;

  const trendDelta = prior4w > 0 ? (last4w - prior4w) / prior4w : 0;
  const meetingTrend: CalendarPatterns['meetingTrend'] =
    trendDelta > 0.15 ? 'increasing'
    : trendDelta < -0.15 ? 'decreasing'
    : 'stable';

  return {
    routines,
    meetingPeakHours,
    inferencedFocusHours,
    busyDaysOfWeek,
    avgMeetingsPerDay,
    meetingTrend,
    periodWeeks,
  };
}

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtHour(h: number): string {
  if (h === 0) return '12am';
  if (h < 12) return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

/**
 * Format calendar patterns as a compact block for briefing prompt injection.
 * Returns '' when patterns is null.
 */
export function formatCalendarPatternsForBriefing(patterns: CalendarPatterns | null): string {
  if (!patterns) return '';

  const lines: string[] = [`CALENDAR PATTERNS (from ${patterns.periodWeeks}w history):`];

  if (patterns.routines.length > 0) {
    lines.push(`Recurring anchors: ${patterns.routines.slice(0, 5).join(', ')}`);
  }

  if (patterns.meetingPeakHours.length > 0) {
    const peak = patterns.meetingPeakHours.map(fmtHour).join('–');
    lines.push(`Heaviest meeting window: ${peak} (historically packed — avoid scheduling deep work here)`);
  }

  if (patterns.inferencedFocusHours.length > 0) {
    const focus = patterns.inferencedFocusHours.map(fmtHour).join('–');
    lines.push(`Inferred focus window: ${focus} (consistently lighter — good for deep work blocks)`);
  }

  if (patterns.busyDaysOfWeek.length >= 2) {
    const busiest = patterns.busyDaysOfWeek[0];
    const lightest = patterns.busyDaysOfWeek[patterns.busyDaysOfWeek.length - 1];
    lines.push(`Busiest day: ${busiest} · Lightest: ${lightest}`);
  }

  lines.push(`Avg meetings/day: ${patterns.avgMeetingsPerDay}${patterns.meetingTrend !== 'stable' ? ` (${patterns.meetingTrend} recently)` : ''}`);

  return lines.join('\n');
}

/**
 * Format patterns as a stored fact for Edge's energy profile.
 * Returns '' when patterns is null.
 */
export function formatPatternsAsEnergyProfile(patterns: CalendarPatterns | null): string {
  if (!patterns || patterns.inferencedFocusHours.length === 0) return '';

  const focusStart = fmtHour(patterns.inferencedFocusHours[0]);
  const focusEnd = fmtHour(patterns.inferencedFocusHours[patterns.inferencedFocusHours.length - 1] + 1);

  let profile = `INFERRED ENERGY PROFILE (from ${patterns.periodWeeks}w calendar history):`;
  profile += `\n- Likely focus window: ${focusStart}–${focusEnd} (meetings light here historically)`;

  if (patterns.meetingPeakHours.length > 0) {
    const peakStart = fmtHour(patterns.meetingPeakHours[0]);
    const peakEnd = fmtHour(patterns.meetingPeakHours[patterns.meetingPeakHours.length - 1] + 1);
    profile += `\n- Meeting-heavy window: ${peakStart}–${peakEnd} (historically busy — protect focus time here)`;
  }

  profile += '\nNote: this is inferred from calendar patterns, not self-reported. May not reflect actual energy peaks.';
  return profile;
}
