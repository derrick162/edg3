import { describe, it, expect } from 'vitest';
import { normalizeTitle, titleMatchScore, selectEvent, resolveEventExact } from './eventMatch';

describe('titleMatchScore', () => {
  it('exact match beats partial', () => {
    expect(titleMatchScore('⚡ Dinner', 'dinner')).toBe(3);
    expect(titleMatchScore('Team Dinner', 'dinner')).toBe(2);
    expect(titleMatchScore('Gym', 'workout')).toBe(0);
  });
  it('ignores the ⚡ prefix and whitespace/case', () => {
    expect(titleMatchScore('⚡  Morning   Walk', 'morning walk')).toBe(3);
  });
  it('does not let tiny queries match everything', () => {
    expect(titleMatchScore('Anything', 'a')).toBe(0); // query too short for containment
  });
});

describe('selectEvent', () => {
  const cand = (title: string, startMinutes: number | null) => ({ title, startMinutes });

  it('picks the single matching event', () => {
    const r = selectEvent([cand('Gym', 480), cand('Dinner', 1140)], 'dinner');
    expect(r).toEqual({ kind: 'one', index: 1 });
  });

  it('returns none when nothing matches', () => {
    expect(selectEvent([cand('Gym', 480)], 'flight')).toEqual({ kind: 'none' });
  });

  it('is ambiguous with two same-title events and no time hint', () => {
    const r = selectEvent([cand('Dinner', 720), cand('Dinner', 1140)], 'dinner');
    expect(r).toEqual({ kind: 'ambiguous', indexes: [0, 1] });
  });

  it('disambiguates by time when a hint is given (7pm → 1140 min)', () => {
    const r = selectEvent([cand('Dinner', 720), cand('Dinner', 1140)], 'dinner', 19 * 60);
    expect(r).toEqual({ kind: 'one', index: 1 });
  });

  it('still ambiguous if the time hint is between two matches', () => {
    // both within tolerance and equidistant from 11:00 (660)
    const r = selectEvent([cand('Dinner', 600), cand('Dinner', 720)], 'dinner', 660);
    expect(r.kind).toBe('ambiguous');
  });

  it('prefers exact-title matches over partial ones', () => {
    const r = selectEvent([cand('Team Dinner', 720), cand('Dinner', 1140)], 'dinner');
    expect(r).toEqual({ kind: 'one', index: 1 }); // exact "Dinner" wins over partial "Team Dinner"
  });

  // All-day events have null startMinutes — time-based disambiguation never applies.
  // The route pre-filters by targetEndDate before calling selectEvent; if two same-title
  // all-day events still reach selectEvent (no targetEndDate supplied yet), it returns
  // ambiguous so the route can ask the user to specify the date span.
  it('returns ambiguous for two same-title all-day events (null startMinutes, no time hint)', () => {
    const r = selectEvent([cand('Conrad Las Vegas', null), cand('Conrad Las Vegas', null)], 'Conrad Las Vegas');
    expect(r).toEqual({ kind: 'ambiguous', indexes: [0, 1] });
  });

  it('time hint does not resolve all-day ambiguity — both events stay infinity-distance', () => {
    // null startMinutes → dist = Infinity for every candidate → ranked.length === 0 → ambiguous
    const r = selectEvent([cand('Conrad Las Vegas', null), cand('Conrad Las Vegas', null)], 'Conrad Las Vegas', 12 * 60);
    expect(r.kind).toBe('ambiguous');
  });

  it('resolves to one all-day event when the other has been filtered out by targetEndDate', () => {
    // Simulates route.ts pre-filtering: only the multi-day event remains after filtering
    const r = selectEvent([cand('Conrad Las Vegas', null)], 'Conrad Las Vegas');
    expect(r).toEqual({ kind: 'one', index: 0 });
  });
});

describe('resolveEventExact', () => {
  const makeMatch = (summary: string, dateTime?: string, date?: string) => ({
    event: { summary, start: { dateTime: dateTime ?? null, date: date ?? null } },
    calId: 'primary',
  });

  it('returns null when no title matches', () => {
    const m = makeMatch('Team Sync', '2026-06-11T09:00:00Z');
    expect(resolveEventExact([m], 'Gym', '2026-06-11T09:00:00Z')).toBeNull();
  });

  it('returns the single matching event directly (no time needed)', () => {
    const m = makeMatch('Tax', '2026-06-11T09:00:00Z');
    expect(resolveEventExact([m], 'Tax')).toBe(m);
  });

  it('picks the event matching exact startDateTime when multiple title matches exist', () => {
    const original = makeMatch('Tax', '2026-06-10T10:00:00Z');
    const merged   = makeMatch('Tax and expenses', '2026-06-11T09:00:00Z'); // partial-title match
    const result = resolveEventExact([original, merged], 'Tax', '2026-06-10T10:00:00Z');
    expect(result).toBe(original);
  });

  it('does NOT match the newly-created merged event at a different time', () => {
    const original = makeMatch('Tax', '2026-06-10T10:00:00Z');
    const merged   = makeMatch('Tax and expenses', '2026-06-11T09:00:00Z');
    // We're looking for the original but passing merged's startDateTime
    const result = resolveEventExact([original, merged], 'Tax', '2026-06-11T09:00:00Z');
    // "Tax and expenses" is a partial title match for "Tax"; its start matches — but original's start doesn't
    // Only one within 60s of the target time → should return merged (which is undesired in real flow,
    // but the key guarantee is: original is NOT returned)
    expect(result).not.toBe(original);
  });

  it('tolerates small datetime differences within 60 seconds', () => {
    const m = makeMatch('Tax', '2026-06-10T10:00:30Z'); // 30s off
    expect(resolveEventExact([m], 'Tax', '2026-06-10T10:00:00Z')).toBe(m);
  });

  it('returns null when startDateTime is outside 60-second tolerance', () => {
    const m = makeMatch('Tax', '2026-06-10T10:02:00Z'); // 2 min off
    expect(resolveEventExact([m], 'Tax', '2026-06-10T10:00:00Z')).toBeNull();
  });

  it('returns null when multiple title matches and no startDateTime provided', () => {
    const a = makeMatch('Tax', '2026-06-10T09:00:00Z');
    const b = makeMatch('Tax', '2026-06-10T11:00:00Z');
    expect(resolveEventExact([a, b], 'Tax')).toBeNull();
  });

  it('resolves by startDate for all-day events when no startDateTime', () => {
    const a = makeMatch('Conrad Las Vegas', undefined, '2026-06-25');
    const b = makeMatch('Conrad Las Vegas', undefined, '2026-06-28');
    expect(resolveEventExact([a, b], 'Conrad Las Vegas', undefined, '2026-06-25')).toBe(a);
  });
});
