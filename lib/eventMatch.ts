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

/** Minimal event shape needed for exact resolution — satisfied by both real Google events and test objects. */
export interface EventLike {
  summary?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
}

/**
 * Resolve a specific event by title + EXACT start datetime (within 1-minute tolerance).
 * Used by cleanupEvents to avoid the fuzzy-title collision that hits during consolidation,
 * where the newly-created merged event (e.g. "Tax and expenses") has "tax" in its title
 * and would otherwise be matched when trying to delete the original "Tax" event.
 *
 * Resolution rules:
 * - Filter to title matches (any score > 0).
 * - If only one title match: return it directly.
 * - If multiple title matches and startDateTime is provided: pick the one whose UTC instant
 *   is within 60 seconds of startDateTime. The merged event at a different time is excluded.
 * - If multiple title matches and only startDate: pick any that has that date (first wins).
 * - If still ambiguous (no time provided, or nothing within tolerance): return null.
 */
export function resolveEventExact<T extends { event: EventLike; calId: string }>(
  matches: T[],
  title: string,
  startDateTime?: string,
  startDate?: string,
): T | null {
  const candidates = matches.filter(m => titleMatchScore(m.event.summary ?? '', title) > 0);
  if (!candidates.length) return null;

  // When startDateTime is given, ALWAYS apply the 60-second tolerance check — even for a
  // single candidate. This is the whole point: prevents returning an event that shares the
  // title but sits at a clearly different time (e.g. the newly-created merged event).
  if (startDateTime) {
    const targetMs = new Date(startDateTime).getTime();
    const byTime = candidates.filter(m => {
      if (!m.event.start?.dateTime) return false;
      return Math.abs(new Date(m.event.start.dateTime).getTime() - targetMs) <= 60_000;
    });
    if (byTime.length >= 1) {
      byTime.sort((a, b) =>
        Math.abs(new Date(a.event.start!.dateTime!).getTime() - targetMs) -
        Math.abs(new Date(b.event.start!.dateTime!).getTime() - targetMs)
      );
      return byTime[0];
    }
    return null;
  }

  // No startDateTime: a single title match is unambiguous.
  if (candidates.length === 1) return candidates[0];

  if (startDate) {
    const byDate = candidates.filter(m => m.event.start?.date === startDate);
    if (byDate.length >= 1) return byDate[0];
  }

  // Multiple title matches and no time to distinguish — refuse to guess
  return null;
}
