// Robust event resolution: decide which calendar event the user means, by title AND time,
// instead of fuzzily grabbing the first loose title match. Pure logic so it can be unit-tested;
// the calendar reads live in the tool-call route.

/** Normalize a title for comparison: drop the ⚡ prefix, lowercase, strip whitespace. */
export function normalizeTitle(s: string): string {
  return (s || '').replace(/^⚡\s*/, '').toLowerCase().replace(/\s+/g, '').trim();
}

/** 3 = exact title, 2 = one contains the other (min length 3 to avoid tiny false matches), 0 = no match. */
export function titleMatchScore(eventTitle: string, query: string): number {
  const a = normalizeTitle(eventTitle);
  const b = normalizeTitle(query);
  if (!a || !b) return 0;
  if (a === b) return 3;
  if ((a.includes(b) && b.length >= 3) || (b.includes(a) && a.length >= 3)) return 2;
  return 0;
}

export type EventCandidate = { title: string; startMinutes: number | null };
export type EventSelection =
  | { kind: 'one'; index: number }
  | { kind: 'ambiguous'; indexes: number[] }
  | { kind: 'none' };

const TIME_TOLERANCE_MIN = 90;

/**
 * Choose the intended event from `candidates`.
 * - Keeps only the best title-score matches (exact beats partial).
 * - One match → that one.
 * - Several matches + a `targetMinutes` hint → the one closest in time (if unambiguously closest).
 * - Otherwise → ambiguous (caller should ask the user which one).
 * - No title match → none.
 */
export function selectEvent(candidates: EventCandidate[], query: string, targetMinutes?: number | null): EventSelection {
  const scored = candidates
    .map((c, i) => ({ i, score: titleMatchScore(c.title, query), start: c.startMinutes }))
    .filter(c => c.score > 0);
  if (!scored.length) return { kind: 'none' };

  const maxScore = Math.max(...scored.map(s => s.score));
  const pool = scored.filter(s => s.score === maxScore);

  if (pool.length === 1) return { kind: 'one', index: pool[0].i };

  if (targetMinutes != null) {
    const ranked = pool
      .map(p => ({ i: p.i, dist: p.start == null ? Infinity : Math.abs(p.start - targetMinutes) }))
      .filter(x => x.dist <= TIME_TOLERANCE_MIN)
      .sort((a, b) => a.dist - b.dist);
    if (ranked.length === 1) return { kind: 'one', index: ranked[0].i };
    if (ranked.length > 1 && ranked[0].dist < ranked[1].dist) return { kind: 'one', index: ranked[0].i };
  }

  return { kind: 'ambiguous', indexes: pool.map(p => p.i) };
}
