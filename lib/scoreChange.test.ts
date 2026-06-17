import { describe, it, expect } from 'vitest';
import { summarizeScoreChange } from './scoreChange';
import type { CalendarScore } from './db';

const makeSnap = (overrides: Partial<CalendarScore> = {}): CalendarScore => ({
  id: 1,
  user_id: 1,
  date: '2026-06-16',
  focus_score: 60,
  energy_score: 70,
  edge_score: 65,
  focus_drivers: null,
  energy_drivers: null,
  created_at: '2026-06-16T08:00:00Z',
  ...overrides,
});

const components = {
  focusScore:  { score: 75, drivers: ['Fundraising has 4h scheduled this week.'], topFix: { description: 'Block time for fundraising.', op: 'create' as const } },
  energyScore: { score: 72, drivers: ['Recovery at 72% — good energy today.'],   topFix: null },
};

describe('summarizeScoreChange', () => {
  it('returns null when no prior snapshot', () => {
    expect(summarizeScoreChange(80, components, null, '2026-06-17')).toBeNull();
    expect(summarizeScoreChange(80, components, undefined, '2026-06-17')).toBeNull();
  });

  it('returns null when prior snapshot is same date as today', () => {
    const snap = makeSnap({ date: '2026-06-17' });
    expect(summarizeScoreChange(80, components, snap, '2026-06-17')).toBeNull();
  });

  it('returns null when prior snapshot has no edge_score', () => {
    const snap = makeSnap({ edge_score: null });
    expect(summarizeScoreChange(80, components, snap, '2026-06-17')).toBeNull();
  });

  it('returns up direction when score rose by >= 2', () => {
    const snap = makeSnap({ edge_score: 65, date: '2026-06-16' });
    const result = summarizeScoreChange(80, components, snap, '2026-06-17');
    expect(result).not.toBeNull();
    expect(result!.direction).toBe('up');
    expect(result!.delta).toBe(15);
  });

  it('returns down direction when score fell by >= 2', () => {
    const snap = makeSnap({ edge_score: 80, date: '2026-06-16' });
    const result = summarizeScoreChange(65, components, snap, '2026-06-17');
    expect(result).not.toBeNull();
    expect(result!.direction).toBe('down');
    expect(result!.delta).toBe(-15);
  });

  it('returns flat when delta is less than 2', () => {
    const snap = makeSnap({ edge_score: 65, date: '2026-06-16' });
    const result = summarizeScoreChange(66, components, snap, '2026-06-17');
    expect(result).not.toBeNull();
    expect(result!.direction).toBe('flat');
  });

  it('picks focus as dominant when focus delta is larger', () => {
    const snap = makeSnap({ focus_score: 50, energy_score: 70, edge_score: 60, date: '2026-06-16' });
    // focus moved 25pt, energy moved 2pt
    const comps = {
      focusScore:  { score: 75, drivers: ['Focus driver'], topFix: null },
      energyScore: { score: 72, drivers: ['Energy driver'], topFix: null },
    };
    const result = summarizeScoreChange(80, comps, snap, '2026-06-17');
    expect(result!.reason).toBe('Focus driver');
  });

  it('picks energy as dominant when energy delta is larger', () => {
    const snap = makeSnap({ focus_score: 72, energy_score: 40, edge_score: 60, date: '2026-06-16' });
    // focus moved 3pt, energy moved 32pt
    const comps = {
      focusScore:  { score: 75, drivers: ['Focus driver'], topFix: null },
      energyScore: { score: 72, drivers: ['Energy driver'], topFix: null },
    };
    const result = summarizeScoreChange(80, comps, snap, '2026-06-17');
    expect(result!.reason).toBe('Energy driver');
  });

  it('uses topFix for reason when direction is down', () => {
    const snap = makeSnap({ focus_score: 80, energy_score: 70, edge_score: 80, date: '2026-06-16' });
    const comps = {
      focusScore:  { score: 60, drivers: ['Focus driver'], topFix: { description: 'Block time for fundraising.', op: 'create' as const } },
      energyScore: { score: 68, drivers: ['Energy driver'], topFix: null },
    };
    const result = summarizeScoreChange(65, comps, snap, '2026-06-17');
    expect(result!.direction).toBe('down');
    expect(result!.reason).toBe('Block time for fundraising.');
  });

  it('uses first driver for reason when direction is up', () => {
    const snap = makeSnap({ edge_score: 60, date: '2026-06-16' });
    const result = summarizeScoreChange(80, components, snap, '2026-06-17');
    expect(result!.reason).toBe('Fundraising has 4h scheduled this week.');
  });

  it('sinceLabel: "since yesterday" for 1-day gap', () => {
    const snap = makeSnap({ date: '2026-06-16', edge_score: 60 });
    const result = summarizeScoreChange(80, components, snap, '2026-06-17');
    expect(result!.sinceLabel).toBe('since yesterday');
  });

  it('sinceLabel: "since N days ago" for 2–7-day gap', () => {
    const snap = makeSnap({ date: '2026-06-14', edge_score: 60 });
    const result = summarizeScoreChange(80, components, snap, '2026-06-17');
    expect(result!.sinceLabel).toBe('since 3 days ago');
  });

  it('sinceLabel: month+day for > 7-day gap', () => {
    const snap = makeSnap({ date: '2026-06-01', edge_score: 60 });
    const result = summarizeScoreChange(80, components, snap, '2026-06-17');
    expect(result!.sinceLabel).toMatch(/since Jun \d/);
  });

  it('asOf is the prior snapshot date', () => {
    const snap = makeSnap({ date: '2026-06-16', edge_score: 60 });
    const result = summarizeScoreChange(80, components, snap, '2026-06-17');
    expect(result!.asOf).toBe('2026-06-16');
  });

  it('falls back gracefully when component drivers are empty', () => {
    const snap = makeSnap({ edge_score: 60, date: '2026-06-16' });
    const comps = {
      focusScore:  { score: 80, drivers: [], topFix: null },
      energyScore: { score: 70, drivers: [], topFix: null },
    };
    const result = summarizeScoreChange(80, comps, snap, '2026-06-17');
    expect(result).not.toBeNull();
    expect(typeof result!.reason).toBe('string');
    expect(result!.reason.length).toBeGreaterThan(0);
  });
});
