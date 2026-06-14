// Pure Whoop trend analysis — Core-owned.
// Computes 7-day averages, trend direction, and notable health flags from the
// history arrays Security's history-fetch functions provide (lib/whoop.ts).
//
// Pure: no I/O, no DB access, no side effects. Always degrades to null.
// All callers (.catch(() => null)) so a DB/network blip never blocks the briefing.

export interface WhoopHistoryPoint {
  date:  string; // 'YYYY-MM-DD' — any order; sorted internally
  value: number; // unit is series-specific (see computeWhoopTrends params)
}

export type WhoopTrendFlag =
  | 'RECOVERY_DECLINING_3D'  // last 3 days are monotonically declining
  | 'RECOVERY_LOW_STREAK'    // last 3 days all have recovery < 40%
  | 'SLEEP_DEBT'             // 7-day avg sleep < 6.5 h (< 23_400_000 ms)
  | 'HIGH_STRAIN_STREAK';    // last 3 days all have strain > 14 (Whoop 0–21)

export interface WhoopTrendSummary {
  recoveryAvg7d:     number | null;                  // mean of ≤7 recovery scores
  recoveryDirection: 'up' | 'down' | 'flat' | null; // recent 3d vs prior 3d
  flags:             WhoopTrendFlag[];
}

export interface RecoveryAlert {
  reason:        'red' | 'sharp_drop';
  todayScore:    number;
  trailing7dAvg: number | null;
  dropMagnitude: number | null; // pts below trailing avg (sharp_drop only)
}

// --- Constants -----------------------------------------------------------------

const RECOVERY_LOW_THRESHOLD  = 40;                      // below = low-recovery day
const STRAIN_HIGH_THRESHOLD   = 14;                      // above = high-strain day
const SLEEP_DEBT_THRESHOLD_MS = 6.5 * 60 * 60 * 1000;   // 6.5 h in ms
const DIRECTION_MIN_DELTA     = 5;                        // points to count as up/down

// --- Internal helpers ----------------------------------------------------------

function sortAsc(points: WhoopHistoryPoint[]): number[] {
  return [...points]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(p => p.value);
}

function avg(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function lastNAll(values: number[], n: number, predicate: (v: number) => boolean): boolean {
  if (values.length < n) return false;
  return values.slice(-n).every(predicate);
}

function decliningLast3(values: number[]): boolean {
  if (values.length < 3) return false;
  const [a, b, c] = values.slice(-3);
  return b < a && c < b;
}

// --- Public API ----------------------------------------------------------------

/**
 * Compute trend summary from up to 14 days of Whoop history.
 *
 * @param recoveryHistory  {date, value} where value = recovery score (0–100)
 * @param sleepHistory     {date, value} where value = total sleep in ms
 * @param strainHistory    {date, value} where value = day strain (0–21)
 *
 * Returns null when all three inputs are empty (not connected / no history yet).
 */
export function computeWhoopTrends(
  recoveryHistory: WhoopHistoryPoint[],
  sleepHistory:    WhoopHistoryPoint[],
  strainHistory:   WhoopHistoryPoint[],
): WhoopTrendSummary | null {
  if (!recoveryHistory.length && !sleepHistory.length && !strainHistory.length) return null;

  const recoveries = sortAsc(recoveryHistory);
  const sleeps     = sortAsc(sleepHistory);
  const strains    = sortAsc(strainHistory);

  // 7-day recovery average
  const last7Recovery = recoveries.slice(-7);
  const recoveryAvg7d = avg(last7Recovery);

  // Direction: compare last 3d avg vs prior 3d avg (needs ≥4 points)
  let recoveryDirection: WhoopTrendSummary['recoveryDirection'] = null;
  if (recoveries.length >= 4) {
    const recentAvg = avg(recoveries.slice(-3));
    const priorSlice = recoveries.slice(-6, -3);
    const priorAvg  = avg(priorSlice.length ? priorSlice : recoveries.slice(0, -3));
    if (recentAvg !== null && priorAvg !== null) {
      const delta = recentAvg - priorAvg;
      recoveryDirection = delta > DIRECTION_MIN_DELTA
        ? 'up'
        : delta < -DIRECTION_MIN_DELTA
        ? 'down'
        : 'flat';
    }
  }

  // Flags (all check the most recent window — current streak, not historical)
  const flags: WhoopTrendFlag[] = [];

  if (decliningLast3(recoveries)) {
    flags.push('RECOVERY_DECLINING_3D');
  }
  if (lastNAll(recoveries, 3, v => v < RECOVERY_LOW_THRESHOLD)) {
    flags.push('RECOVERY_LOW_STREAK');
  }
  const sleepAvg = avg(sleeps.slice(-7));
  if (sleepAvg !== null && sleepAvg < SLEEP_DEBT_THRESHOLD_MS) {
    flags.push('SLEEP_DEBT');
  }
  if (lastNAll(strains, 3, v => v > STRAIN_HIGH_THRESHOLD)) {
    flags.push('HIGH_STRAIN_STREAK');
  }

  return { recoveryAvg7d, recoveryDirection, flags };
}

/**
 * Fire a RECOVERY ALERT when today's score is in the red tier (≤33%) OR when
 * it has dropped sharply (≥20 points) below the trailing 7-day average.
 *
 * Requires ≥3 history points to compute a reliable trailing average — returns
 * null on thin history even if today is red (avoids first-day false alarms).
 * History should NOT include today — pass only prior days.
 */
export function detectRecoveryDrop(
  todayScore: number,
  history: WhoopHistoryPoint[], // prior days only (value = recovery score 0–100)
): RecoveryAlert | null {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const last7 = sorted.slice(-7).map(p => p.value);
  const trailing7dAvg = last7.length >= 3
    ? Math.round(last7.reduce((s, v) => s + v, 0) / last7.length)
    : null;

  if (todayScore <= 33) {
    return {
      reason: 'red',
      todayScore,
      trailing7dAvg,
      dropMagnitude: trailing7dAvg !== null ? trailing7dAvg - todayScore : null,
    };
  }
  if (trailing7dAvg !== null && trailing7dAvg - todayScore >= 20) {
    return {
      reason: 'sharp_drop',
      todayScore,
      trailing7dAvg,
      dropMagnitude: trailing7dAvg - todayScore,
    };
  }
  return null;
}

/** Format a RecoveryAlert into a RECOVERY ALERT block for the briefing prompt. */
export function formatRecoveryAlertForBriefing(alert: RecoveryAlert): string {
  const vsAvg = alert.trailing7dAvg !== null
    ? ` (week average has been ${alert.trailing7dAvg}%)`
    : '';
  if (alert.reason === 'red') {
    return `RECOVERY ALERT — Today's Whoop recovery is ${alert.todayScore}%${vsAvg}: red tier.`
      + ` Proactively offer to lighten the day: identify the heaviest or most-deferrable block`
      + ` in TODAY'S CALENDAR and name it — then offer to move or shrink it.`
      + ` When the user says yes, call moveEvent immediately. Never fabricate a recovery number.`;
  }
  return `RECOVERY ALERT — Today's recovery is ${alert.todayScore}%${vsAvg},`
    + ` a ${alert.dropMagnitude}-point drop from the trailing average — sharper than usual.`
    + ` Proactively offer to lighten the day: name the heaviest or most-deferrable block`
    + ` in TODAY'S CALENDAR and offer to move or shrink it. Act immediately when the user says yes.`;
}

/**
 * Format a WhoopTrendSummary into a single honest briefing sentence.
 * Returns null when there's nothing noteworthy (no flags, no notable direction).
 * Priority: DECLINING_3D > LOW_STREAK > SLEEP_DEBT > HIGH_STRAIN > direction.
 * Pure function — used by lib/briefing.ts for injection.
 */
export function formatTrendForBriefing(trend: WhoopTrendSummary): string | null {
  if (trend.flags.includes('RECOVERY_DECLINING_3D')) {
    return "Recovery's trended down three days running — something's off; protect your sleep tonight.";
  }
  if (trend.flags.includes('RECOVERY_LOW_STREAK')) {
    return "Recovery's been low three or more days straight — keep today lighter and prioritise rest.";
  }
  if (trend.flags.includes('SLEEP_DEBT') && trend.flags.includes('HIGH_STRAIN_STREAK')) {
    return "Sleep's been running short and strain's been high — a genuine rest day is overdue.";
  }
  if (trend.flags.includes('SLEEP_DEBT')) {
    return "Sleep's been running short this week — prioritise an earlier wind-down tonight.";
  }
  if (trend.flags.includes('HIGH_STRAIN_STREAK')) {
    return "Three or more high-strain days in a row — consider building in a real recovery window.";
  }
  // Direction-only summary (no flags) — only surface if meaningfully notable
  if (trend.recoveryDirection === 'down' && trend.recoveryAvg7d !== null) {
    return `Seven-day recovery average is ${Math.round(trend.recoveryAvg7d)}% and trending down — factor that into today's intensity.`;
  }
  if (trend.recoveryDirection === 'up' && trend.recoveryAvg7d !== null) {
    return `Recovery's been trending up — seven-day average ${Math.round(trend.recoveryAvg7d)}%; good time to push on the top priority.`;
  }
  return null;
}
