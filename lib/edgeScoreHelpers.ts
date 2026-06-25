// Pure helpers for the Edge Score display — extracted for testability.

export function scoreColor(s: number): string {
  if (s >= 85) return 'var(--gauge-peak)';
  if (s >= 65) return 'var(--gauge-high)';
  if (s >= 35) return 'var(--gauge-mid)';
  return 'var(--gauge-low)';
}

export function scoreSummary(s: number): string {
  if (s >= 85) return "You're set up well today — keep going.";
  if (s >= 65) return 'Good shape. A couple of small things to shift.';
  if (s >= 35) return 'A few changes could make today stronger.';
  return 'Today needs some work — Edg3 can help fix it.';
}

export function scoreGlow(s: number): string {
  if (s >= 85) return 'var(--gauge-glow-peak)';
  if (s >= 65) return 'var(--gauge-glow-high)';
  return 'var(--gauge-glow-low)';
}

export function scoreCardBorder(s: number): string {
  if (s >= 85) return 'var(--score-card-border-peak)';
  if (s >= 65) return 'var(--score-card-border-high)';
  if (s >= 35) return 'var(--score-card-border-mid)';
  return 'var(--score-card-border-low)';
}

export function scoreCardBg(s: number): string {
  if (s >= 85) return 'var(--score-card-bg-peak)';
  if (s >= 65) return 'transparent';
  if (s >= 35) return 'var(--score-card-bg-mid)';
  return 'var(--score-card-bg-low)';
}

/**
 * Prepare sparkline data: extend the last slot to today's live score,
 * compute the delta, and return null when there are fewer than 2 history points.
 */
export function prepareSparklineData(
  history: { date: string; score: number }[],
  todayScore: number | null,
): { extended: { date: string; score: number }[]; delta: number; stroke: string } | null {
  if (history.length < 2) return null;

  const extended = [...history];
  if (todayScore !== null && todayScore !== undefined) {
    extended[extended.length - 1] = { ...extended[extended.length - 1], score: todayScore };
  }

  const scores = extended.map(h => h.score);
  const delta = scores[scores.length - 1] - scores[0];
  const stroke =
    delta > 0 ? 'var(--gauge-peak)' :
    delta < 0 ? 'var(--gauge-low)' :
    'var(--text-muted)';

  return { extended, delta, stroke };
}
