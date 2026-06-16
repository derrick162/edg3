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
const MIN_GROUP_SIZE    = 3;    // minimum data points in each group
const MIN_OVERLAP_DAYS  = 10;   // total paired days required before we trust the result
const MIN_RECOVERY_DIFF = 5;    // minimum point difference to call a pattern meaningful
const STRAIN_HIGH       = 14;   // above = high-strain day (mirrors whoopTrends constant)

const avgArr = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;

/** Pattern 1: late calendar meetings → lower next-day recovery. */
function checkLateMeetingCorrelation(
  recoveryHistory: { date: string; value: number }[],
  calendarHistory: CalendarDay[],
): CorrelationInsight | null {
  if (recoveryHistory.length < MIN_OVERLAP_DAYS) return null;
  if (calendarHistory.length < MIN_OVERLAP_DAYS) return null;

  const calByDate = new Map<string, number | null>();
  for (const d of calendarHistory) calByDate.set(d.date, d.latestEndHour);

  const withLate:    number[] = [];
  const withoutLate: number[] = [];

  for (const { date, value } of recoveryHistory) {
    const prev = prevDay(date);
    if (!calByDate.has(prev)) continue;
    const prevLatest = calByDate.get(prev) ?? null;
    const hadLate = prevLatest !== null && prevLatest >= LATE_HOUR;
    if (hadLate) { withLate.push(value); } else { withoutLate.push(value); }
  }

  const totalDays = withLate.length + withoutLate.length;
  if (totalDays < MIN_OVERLAP_DAYS) return null;
  if (withLate.length < MIN_GROUP_SIZE || withoutLate.length < MIN_GROUP_SIZE) return null;

  const diff = Math.round(avgArr(withoutLate) - avgArr(withLate));
  if (diff < MIN_RECOVERY_DIFF) return null;

  return {
    pattern: `Recovery tends to run about ${diff}% lower the day after meetings past 7 PM`
      + ` — clearing your evenings would likely pay off the next morning.`,
    sampleDays: totalDays,
  };
}

/** Pattern 2: high-strain day (>14) → lower next-day recovery. */
function checkHighStrainCorrelation(
  recoveryHistory: { date: string; value: number }[],
  strainHistory:   { date: string; value: number }[],
): CorrelationInsight | null {
  const strainByDate = new Map<string, number>();
  for (const d of strainHistory) strainByDate.set(d.date, d.value);

  const afterHigh:   number[] = [];
  const afterNormal: number[] = [];

  for (const { date, value } of recoveryHistory) {
    const prev = prevDay(date);
    if (!strainByDate.has(prev)) continue;
    const prevStrain = strainByDate.get(prev)!;
    if (prevStrain > STRAIN_HIGH) { afterHigh.push(value); } else { afterNormal.push(value); }
  }

  const total = afterHigh.length + afterNormal.length;
  if (total < MIN_OVERLAP_DAYS) return null;
  if (afterHigh.length < MIN_GROUP_SIZE || afterNormal.length < MIN_GROUP_SIZE) return null;

  const diff = Math.round(avgArr(afterNormal) - avgArr(afterHigh));
  if (diff < MIN_RECOVERY_DIFF) return null;

  return {
    pattern: `Recovery runs about ${diff}% lower the day after high-strain sessions`
      + ` — building in a lighter day after hard pushes would likely pay off.`,
    sampleDays: total,
  };
}

/**
 * Look for the most actionable Whoop↔calendar pattern over the supplied history.
 * Checks two correlations (in priority order):
 *   1. Late calendar meetings (≥7 PM) → lower next-day recovery
 *   2. High-strain day (>14) → lower next-day recovery
 *
 * Returns null when no pattern meets the confidence gate (≥10 days, ≥3 per group,
 * ≥5 pt recovery difference).
 *
 * @param recoveryHistory  {date, value} where value = recovery score (0–100), prior days only
 * @param calendarHistory  one entry per calendar day — latestEndHour null means no timed events
 * @param strainHistory    optional {date, value} where value = Whoop day strain (0–21)
 */
export function computeWhoopCorrelations(
  recoveryHistory: { date: string; value: number }[],
  calendarHistory: CalendarDay[],
  strainHistory?:  { date: string; value: number }[],
): CorrelationInsight | null {
  const p1 = checkLateMeetingCorrelation(recoveryHistory, calendarHistory);
  if (p1) return p1;

  if (strainHistory && strainHistory.length >= MIN_OVERLAP_DAYS) {
    const p2 = checkHighStrainCorrelation(recoveryHistory, strainHistory);
    if (p2) return p2;
  }

  return null;
}

/**
 * When today's strain is high relative to the personal baseline, return a plain-
 * English hint so the user can protect tomorrow's recovery.
 * Returns null when today's strain is unremarkable or data is unavailable.
 */
export function predictTomorrowRecoveryHint(
  todayStrain:       number | null,
  strainBaseline30d: number | null,
): string | null {
  if (todayStrain === null) return null;
  if (todayStrain <= STRAIN_HIGH) return null;
  // Only hint when meaningfully above the personal baseline (or no baseline set)
  if (strainBaseline30d !== null && todayStrain < strainBaseline30d + 2) return null;
  return `Today's strain is tracking high (${todayStrain.toFixed(1)}) — protect your wind-down tonight to set up a stronger recovery tomorrow.`;
}
