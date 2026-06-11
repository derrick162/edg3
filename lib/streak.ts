// Call-streak computation for EDG3 briefings and dashboard (Core-owned, client-safe).
//
// A "streak" is the count of consecutive days ending today (or yesterday, if today's
// call hasn't happened yet) that have at least one completed briefing call.

function prevDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Returns the number of consecutive days with a completed briefing, counting back
 * from today (or yesterday if today's call hasn't happened yet).
 * Pass `now` to fix time in tests.
 */
export function computeCallStreak(
  briefings: { status: string; scheduled_for: string }[],
  tz: string,
  now: Date = new Date(),
): number {
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: tz });

  const completed = new Set(
    briefings
      .filter(b => b.status === 'completed')
      .map(b => new Date(b.scheduled_for).toLocaleDateString('en-CA', { timeZone: tz }))
  );
  if (!completed.size) return 0;

  // Prefer starting from today; fall back to yesterday if today's call hasn't happened.
  const startDate = completed.has(todayStr) ? todayStr : prevDay(todayStr);
  if (!completed.has(startDate)) return 0;

  let streak = 0;
  let check = startDate;
  while (completed.has(check)) {
    streak++;
    check = prevDay(check);
  }
  return streak;
}
