// Pure Whoop ↔ calendar correlation analysis — Core-owned.
// Finds plain-English behavioural patterns by comparing Whoop recovery history
// against past calendar data (e.g. "recovery lower the day after late meetings").
//
// Pure: no I/O, no DB access, no side effects. Degrades to null on thin data.
// Confidence / sample-size gate: requires ≥10 days overlap + ≥3 in each group.

import { prevDay } from './time';

export interface CalendarDay {
  date: string;              // 'YYYY-MM-DD'
  latestEndHour: number | null; // decimal hours in user tz of last timed event (null = no events)
}

export interface CorrelationInsight {
  pattern: string;      // one plain-English sentence + action prompt
  sampleDays: number;
}

const LATE_HOUR         = 19;   // 7 PM — any timed event ending at or after this is "late"
const MIN_GROUP_SIZE    = 3;    // minimum data points in each group (late vs. not-late)
const MIN_OVERLAP_DAYS  = 10;   // total paired days required before we trust the result
const MIN_RECOVERY_DIFF = 5;    // minimum point difference to call a pattern meaningful

/**
 * Look for the most actionable Whoop↔calendar pattern over the supplied history.
 *
 * Currently checks one correlation:
 *   "meetings running past 7 PM" → lower next-day recovery?
 *
 * Returns null when:
 *   - fewer than MIN_OVERLAP_DAYS of paired data exist, OR
 *   - either group (late evenings / clean evenings) has fewer than MIN_GROUP_SIZE days, OR
 *   - the recovery difference is less than MIN_RECOVERY_DIFF points (no meaningful signal).
 *
 * @param recoveryHistory  {date, value} where value = recovery score (0–100), prior days only
 * @param calendarHistory  one entry per calendar day — latestEndHour null means no timed events
 */
export function computeWhoopCorrelations(
  recoveryHistory: { date: string; value: number }[],
  calendarHistory: CalendarDay[],
): CorrelationInsight | null {
  if (recoveryHistory.length < MIN_OVERLAP_DAYS) return null;
  if (calendarHistory.length < MIN_OVERLAP_DAYS) return null;

  // Build O(1) lookups
  const calByDate = new Map<string, number | null>();
  for (const d of calendarHistory) calByDate.set(d.date, d.latestEndHour);

  // For each recovery day look at the PREVIOUS calendar day
  const withLate:    number[] = [];
  const withoutLate: number[] = [];

  for (const { date, value } of recoveryHistory) {
    const prev = prevDay(date);
    if (!calByDate.has(prev)) continue; // no calendar data for that day — skip
    const prevLatest = calByDate.get(prev) ?? null;
    const hadLate = prevLatest !== null && prevLatest >= LATE_HOUR;
    if (hadLate) {
      withLate.push(value);
    } else {
      withoutLate.push(value);
    }
  }

  const totalDays = withLate.length + withoutLate.length;
  if (totalDays < MIN_OVERLAP_DAYS) return null;
  if (withLate.length < MIN_GROUP_SIZE || withoutLate.length < MIN_GROUP_SIZE) return null;

  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const avgWithLate    = avg(withLate);
  const avgWithoutLate = avg(withoutLate);
  const diff = Math.round(avgWithoutLate - avgWithLate); // positive = worse after late nights

  if (diff < MIN_RECOVERY_DIFF) return null;

  return {
    pattern: `Recovery tends to run about ${diff}% lower the day after meetings past 7 PM`
      + ` — clearing your evenings would likely pay off the next morning.`,
    sampleDays: totalDays,
  };
}
