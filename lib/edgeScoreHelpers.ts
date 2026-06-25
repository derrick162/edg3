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
 * Prepare sparkline data: fill consecutive days from the oldest history entry
 * through today (carrying forward the last known score for gaps), then override
 * today's slot with todayScore. Returns null when fewer than 2 points would result.
 *
 * @param referenceDate - YYYY-MM-DD date to treat as "today"; defaults to actual today.
 *   Pass explicitly in tests to avoid clock dependency.
 */
export function prepareSparklineData(
  history: { date: string; score: number }[],
  todayScore: number | null,
  referenceDate?: string,
): { extended: { date: string; score: number }[]; delta: number; stroke: string } | null {
  if (history.length < 2) return null;

  const todayStr = referenceDate ?? new Date().toISOString().slice(0, 10);
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const scoreByDate = new Map(sorted.map(h => [h.date, h.score]));

  // Build a consecutive-day array from the oldest history date through today,
  // carrying the last known score forward for any missing days.
  const extended: { date: string; score: number }[] = [];
  let cursor = new Date(sorted[0].date + 'T12:00:00Z');
  const endMs = new Date(todayStr + 'T12:00:00Z').getTime();
  let lastKnownScore = sorted[0].score;

  while (cursor.getTime() <= endMs) {
    const dateStr = cursor.toISOString().slice(0, 10);
    if (scoreByDate.has(dateStr)) lastKnownScore = scoreByDate.get(dateStr)!;
    extended.push({ date: dateStr, score: lastKnownScore });
    cursor = new Date(cursor.getTime() + 86400000);
  }

  if (extended.length < 2) return null;

  // Override today's slot with the live score when provided.
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
