// Robust event resolution: decide which calendar event the user means, by title AND time,
// instead of fuzzily grabbing the first loose title match. Pure logic so it can be unit-tested;
// the calendar reads live in the tool-call route.

// ── Event classification (Round 8 Bug 2) ─────────────────────────────────────
// Classify a calendar event by title (+ optional description) so Edge stops treating personal/
// health appointments (e.g. "PRP" — a hair treatment) like work meetings and suggesting prep.
export type EventClass =
  | 'work-meeting'
  | 'health'
  | 'fitness'
  | 'meal'
  | 'personal'
  | 'travel'
  | 'focus-block'
  | 'reminder'
  | 'unknown';

// Keyword lists in the dispatch's priority order: health > fitness > travel > work-meeting >
// meal > personal > focus-block > reminder. First class with any keyword match wins.
// NOTE: bare "call" is intentionally NOT a work-meeting keyword — it over-matches personal/
// family calls; ambiguous "X call" stays `unknown` (the safe default — Edge asks, doesn't assume).
const EVENT_CLASS_KEYWORDS: ReadonlyArray<{ cls: EventClass; words: readonly string[] }> = [
  { cls: 'health', words: ['doctor', 'dentist', 'dental', 'therapy', 'therapist', 'treatment', 'prp', 'injection', 'physio', 'physical therapy', 'massage', 'chiro', 'appointment', 'clinic', 'medical', 'checkup', 'check-up', 'bloodwork', 'lab work', 'surgery', 'vaccine', 'optometr', 'derm'] },
  { cls: 'fitness', words: ['gym', 'workout', 'work out', 'run', 'jog', 'yoga', 'pilates', 'training', 'swim', 'crossfit', 'tennis', 'golf', 'cycling', 'spin class', 'cardio', 'hike', 'peloton'] },
  { cls: 'travel', words: ['flight', 'airport', 'drive to', 'uber', 'lyft', 'transit', 'commute', 'train to', 'boarding', 'layover', 'road trip', 'departs'] },
  { cls: 'work-meeting', words: ['investor', 'team sync', 'sync', '1:1', 'one on one', 'standup', 'stand-up', 'interview', 'client', 'demo', 'review', 'meeting', 'kickoff', 'kick-off', 'sprint', 'retro', 'planning', 'board meeting', 'pitch', 'sales call', 'client call', 'check-in', 'sync-up', 'all-hands', 'all hands', 'stakeholder', 'sales sync'] },
  { cls: 'meal', words: ['lunch', 'dinner', 'breakfast', 'coffee', 'drinks', 'brunch', 'happy hour'] },
  { cls: 'personal', words: ['birthday', 'family', 'date night', 'anniversary', 'wedding', 'party', 'social', 'date with', 'reunion', 'celebration', 'graduation', 'baby shower', 'haircut'] },
  { cls: 'focus-block', words: ['deep work', 'focus time', 'focus block', 'blocked', 'writing', 'coding', 'no meetings', 'maker', 'heads down', 'heads-down', 'work block', 'vibe-coding', 'vibe coding'] },
  { cls: 'reminder', words: ['reminder', 'rsvp', 'deadline', 'due', 'follow up', 'follow-up', "don't forget", 'dont forget', 'remember to'] },
];

/**
 * Classify a calendar event by title (+ optional description). Lowercase keyword match in the
 * dispatch's priority order; `unknown` when nothing matches (never assume work-meeting).
 */
export function classifyEvent(title: string, description?: string): EventClass {
  const hay = `${title ?? ''} ${description ?? ''}`.toLowerCase();
  if (!hay.trim()) return 'unknown';
  for (const { cls, words } of EVENT_CLASS_KEYWORDS) {
    if (words.some(w => hay.includes(w))) return cls;
  }
  return 'unknown';
}

/** Prep suggestions only make sense for work meetings. Everything else: no prep. */
export function needsPrepSuggestion(cls: EventClass): boolean {
  return cls === 'work-meeting';
}

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

/** EventLike extended with the fields needed for duplicate detection. */
export interface DuplicateEventLike extends EventLike {
  id?: string | null;
  created?: string | null;
}

// Event types you normally have at most ONCE per day. For these, two on the same day
// (even at different times) count as duplicates — e.g. two "dinner" entries. For every
// other title we only treat exact same-time copies as duplicates, so two real meetings
// at 10am and 2pm are never wrongly merged.
const DAILY_SINGLETON_KEYWORDS = [
  'breakfast', 'brunch', 'lunch', 'dinner', 'supper',
  'gym', 'workout', 'work out', 'walk', 'run', 'jog', 'meditat', 'yoga',
  'morning routine', 'wind down', 'wind-down', 'bedtime',
];

function isDailySingleton(normTitle: string): boolean {
  return DAILY_SINGLETON_KEYWORDS.some(k => normTitle.includes(k));
}

/** Local calendar day (YYYY-MM-DD) for an event, in the given tz when timed. */
function eventLocalDay(event: DuplicateEventLike, timezone?: string): string | null {
  if (event.start?.date) return event.start.date;
  if (event.start?.dateTime) {
    if (timezone) {
      try { return new Date(event.start.dateTime).toLocaleDateString('en-CA', { timeZone: timezone }); } catch { /* fall through */ }
    }
    return event.start.dateTime.slice(0, 10);
  }
  return null;
}

/**
 * Group events into duplicate sets. Two grouping rules:
 *  - DAILY-SINGLETON titles (meals, gym, walk, …): grouped by normalized title + local
 *    DAY, so two "dinner" entries on the same day at different times are caught.
 *  - Every other title: grouped by normalized title + exact start time (to-the-minute UTC,
 *    or `allday:YYYY-MM-DD`), so only genuine same-time copies count.
 * Returns only groups with >1 member; each keeps the earliest-created event and marks the
 * rest as `remove`. Pure (uses Intl for the local-day calc when a timezone is supplied).
 */
export function findDuplicateGroups<T extends { event: DuplicateEventLike; calId: string }>(
  events: T[],
  opts?: { timezone?: string },
): Array<{ key: string; keep: T; remove: T[] }> {
  const groups = new Map<string, T[]>();
  for (const item of events) {
    const normTitle = normalizeTitle(item.event.summary ?? '');
    if (!normTitle) continue;
    let key: string;
    if (isDailySingleton(normTitle)) {
      const day = eventLocalDay(item.event, opts?.timezone);
      if (!day) continue;
      key = `${normTitle}|day:${day}`;
    } else if (item.event.start?.dateTime) {
      key = `${normTitle}|${new Date(item.event.start.dateTime).toISOString().slice(0, 16)}`;
    } else if (item.event.start?.date) {
      key = `${normTitle}|allday:${item.event.start.date}`;
    } else {
      continue;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  const result: Array<{ key: string; keep: T; remove: T[] }> = [];
  for (const [key, items] of groups) {
    if (items.length <= 1) continue;
    const sorted = [...items].sort((a, b) => {
      const ca = a.event.created ?? '';
      const cb = b.event.created ?? '';
      if (ca && cb) return ca.localeCompare(cb);
      if (ca) return -1;
      if (cb) return 1;
      return (a.event.id ?? '').localeCompare(b.event.id ?? '');
    });
    const [keep, ...remove] = sorted;
    result.push({ key, keep, remove });
  }
  return result;
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
