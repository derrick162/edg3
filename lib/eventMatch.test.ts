import { describe, it, expect } from 'vitest';
import { normalizeTitle, titleMatchScore, selectEvent } from './eventMatch';

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
