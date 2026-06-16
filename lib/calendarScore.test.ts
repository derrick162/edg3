import { describe, it, expect } from 'vitest';
import type { Priority } from './db';
import type { AlignmentResult } from './alignment';
import type { EnergySignal } from './energy';
import type { WhoopRecoveryDay, WhoopSleep } from './whoop';
import {
  parseEnergyProfile,
  computeFocusScore,
  computeEnergyScore,
  computeCalendarFit,
  colorByEnergy,
  type EventDemand,
} from './calendarScore';

// ─── Factories ───────────────────────────────────────────────────────────────

function makeP(id: number, text: string, rank: number): Priority {
  return { id, user_id: 1, text, rank, week_of: '2026-06-08', created_at: '2026-06-14T00:00:00', energy_cost: undefined };
}
function makeAlign(
  perPriority: { priority: string; hours: number }[],
  unalignedHours = 0,
  topUnaligned: { title: string; hours: number }[] = [],
): AlignmentResult {
  return {
    perPriority: perPriority.map(p => ({ ...p, blocked: p.hours > 0 })),
    unalignedHours,
    topUnaligned,
  };
}
function makeRecovDay(date: string, score: number): WhoopRecoveryDay {
  return { date, recoveryScore: score };
}
function makeSleep(performancePct: number): WhoopSleep {
  return { durationMs: 28800000, performancePct, efficiencyPct: 85 };
}

const sigGreen:  EnergySignal = { level: 'green',  source: 'manual' };
const sigYellow: EnergySignal = { level: 'yellow', source: 'whoop'  };
const sigRed:    EnergySignal = { level: 'red',    source: 'whoop'  };

// ─── parseEnergyProfile ──────────────────────────────────────────────────────

describe('parseEnergyProfile', () => {
  it('returns all nulls for empty input', () => {
    expect(parseEnergyProfile([])).toEqual({ peakStart: null, peakEnd: null, troughStart: null, troughEnd: null });
  });

  it('parses "my peak is 9 to 11"', () => {
    const p = parseEnergyProfile(['my peak is 9 to 11']);
    expect(p.peakStart).toBe(9);
    expect(p.peakEnd).toBe(11);
  });

  it('parses "peak 9am to 11am"', () => {
    const p = parseEnergyProfile(['peak 9am to 11am']);
    expect(p.peakStart).toBe(9);
    expect(p.peakEnd).toBe(11);
  });

  it('parses trough range "trough from 2pm to 4pm"', () => {
    const p = parseEnergyProfile(['trough from 2pm to 4pm']);
    expect(p.troughStart).toBe(14);
    expect(p.troughEnd).toBe(16);
  });

  it('parses single-hour trough with "at": "afternoon dip at 2pm"', () => {
    const p = parseEnergyProfile(['afternoon dip at 2pm']);
    expect(p.troughStart).toBe(14);
    expect(p.troughEnd).toBe(15);
  });

  it('parses combined peak and trough from two separate statements', () => {
    const p = parseEnergyProfile(['my peak is 9 to 11', 'trough 2pm to 4pm']);
    expect(p.peakStart).toBe(9);
    expect(p.peakEnd).toBe(11);
    expect(p.troughStart).toBe(14);
    expect(p.troughEnd).toBe(16);
  });

  it('ignores statements with no peak/trough keyword', () => {
    const p = parseEnergyProfile(['I like to exercise in the morning', '9 to 11']);
    expect(p.peakStart).toBeNull();
  });
});

// ─── ScoreResult shape (MVP) ──────────────────────────────────────────────────

describe('ScoreResult shape (MVP)', () => {
  it('focus result has score 0-100, drivers array, topFix', () => {
    const r = computeFocusScore(null, [makeP(1, 'Build', 1)]);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(Array.isArray(r.drivers)).toBe(true);
    expect(r.topFix === null || typeof r.topFix === 'object').toBe(true);
  });

  it('energy result has score 0-100, drivers array, topFix', () => {
    const r = computeEnergyScore([makeRecovDay('2026-06-14', 70)], makeSleep(80));
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(Array.isArray(r.drivers)).toBe(true);
  });

  it('does NOT have quantScore, judgmentScore, or weights', () => {
    const r = computeFocusScore(null, [makeP(1, 'Build', 1)]);
    expect((r as any).quantScore).toBeUndefined();
    expect((r as any).judgmentScore).toBeUndefined();
    expect((r as any).weights).toBeUndefined();
  });
});

// ─── computeFocusScore — no priorities ───────────────────────────────────────

describe('computeFocusScore — no priorities', () => {
  it('returns score 0 with setup driver when priorities list is empty', () => {
    const r = computeFocusScore(null, []);
    expect(r.score).toBe(0);
    expect(r.drivers.some(d => d.includes('No focus areas'))).toBe(true);
    expect(r.topFix?.op).toBe('create');
  });
});

// ─── computeFocusScore — percentage formula ───────────────────────────────────

describe('computeFocusScore — percentage formula', () => {
  it('45h focused out of 45h → score 100', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const alignment  = makeAlign([{ priority: 'Build', hours: 45 }], 0);
    const r = computeFocusScore(alignment, priorities, 45);
    expect(r.score).toBe(100);
  });

  it('22.5h focused out of 45h → score 50', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const alignment  = makeAlign([{ priority: 'Build', hours: 22.5 }], 22.5);
    const r = computeFocusScore(alignment, priorities, 45);
    expect(r.score).toBe(50);
  });

  it('0h focused → score 0', () => {
    const priorities = [makeP(1, 'Build', 1), makeP(2, 'Sales', 2)];
    const alignment  = makeAlign([{ priority: 'Build', hours: 0 }, { priority: 'Sales', hours: 0 }]);
    const r = computeFocusScore(alignment, priorities, 45);
    expect(r.score).toBe(0);
  });

  it('null alignment → score 0 (no hours)', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const r = computeFocusScore(null, priorities, 45);
    expect(r.score).toBe(0);
  });

  it('9h focused out of 45h (default) → score 20', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const alignment  = makeAlign([{ priority: 'Build', hours: 9 }], 5);
    const r = computeFocusScore(alignment, priorities);
    expect(r.score).toBe(20);
  });

  it('caps at 100 even if aligned hours exceed totalWorkingHours', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const alignment  = makeAlign([{ priority: 'Build', hours: 60 }]);
    const r = computeFocusScore(alignment, priorities, 45);
    expect(r.score).toBe(100);
  });

  it('multiple priorities: hours are summed for the score', () => {
    const priorities = [makeP(1, 'Build', 1), makeP(2, 'Sales', 2)];
    const alignment  = makeAlign(
      [{ priority: 'Build', hours: 10 }, { priority: 'Sales', hours: 10 }],
    );
    const r = computeFocusScore(alignment, priorities, 40);
    // 20/40 = 50%
    expect(r.score).toBe(50);
  });
});

// ─── computeFocusScore — drivers ─────────────────────────────────────────────

describe('computeFocusScore — drivers', () => {
  it('zero-hours priority named in drivers', () => {
    const priorities = [makeP(1, 'Fundraising', 1), makeP(2, 'Product', 2)];
    const alignment  = makeAlign(
      [{ priority: 'Fundraising', hours: 0 }, { priority: 'Product', hours: 3 }],
      1,
    );
    const r = computeFocusScore(alignment, priorities);
    expect(r.drivers.some(d => d.includes('"Fundraising"') && d.includes('zero hours'))).toBe(true);
  });

  it('nonzero-hours priority shows hours in drivers', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const alignment  = makeAlign([{ priority: 'Build', hours: 5 }], 0);
    const r = computeFocusScore(alignment, priorities);
    expect(r.drivers.some(d => d.includes('"Build"') && d.includes('5.0h'))).toBe(true);
  });

  it('biggest time sink appears in drivers when unaligned > focus', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const alignment  = makeAlign(
      [{ priority: 'Build', hours: 2 }],
      10,
      [{ title: 'Random meetings', hours: 10 }],
    );
    const r = computeFocusScore(alignment, priorities);
    expect(r.drivers.some(d => d.includes('Random meetings'))).toBe(true);
  });

  it('time-sink driver absent when focus > unaligned', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const alignment  = makeAlign(
      [{ priority: 'Build', hours: 8 }],
      2,
      [{ title: 'Meetings', hours: 2 }],
    );
    const r = computeFocusScore(alignment, priorities);
    expect(r.drivers.some(d => d.includes('Meetings'))).toBe(false);
  });
});

// ─── computeFocusScore — topFix ──────────────────────────────────────────────

describe('computeFocusScore — topFix', () => {
  it('topFix targets uncovered priority first', () => {
    const priorities = [makeP(1, 'Fundraising', 1), makeP(2, 'Product', 2)];
    const alignment  = makeAlign(
      [{ priority: 'Fundraising', hours: 0 }, { priority: 'Product', hours: 3 }],
      1,
    );
    const r = computeFocusScore(alignment, priorities);
    expect(r.topFix?.description).toContain('Fundraising');
    expect(r.topFix?.op).toBe('create');
  });

  it('topFix is null when score is 70+', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const alignment  = makeAlign([{ priority: 'Build', hours: 45 }]);
    const r = computeFocusScore(alignment, priorities, 45);
    expect(r.topFix).toBeNull();
  });

  it('topFix mentions unaligned time when score < 40 and top unaligned exists', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const alignment  = makeAlign(
      [{ priority: 'Build', hours: 1 }],
      10,
      [{ title: 'Bureaucracy', hours: 10 }],
    );
    const r = computeFocusScore(alignment, priorities, 45);
    expect(r.topFix?.description).toContain('Bureaucracy');
    expect(r.topFix?.op).toBe('move');
  });

  it('topFix suggests adding focus time when score 40-69 and all covered', () => {
    const priorities = [makeP(1, 'Build', 1), makeP(2, 'Sales', 2)];
    const alignment  = makeAlign(
      [{ priority: 'Build', hours: 10 }, { priority: 'Sales', hours: 10 }],
      5,
    );
    const r = computeFocusScore(alignment, priorities, 45);
    // score = 20/45 ≈ 44% → topFix should suggest adding time
    expect(r.topFix?.op).toBe('create');
  });
});

// --- computeEnergyScore -- no data ---

describe('computeEnergyScore -- no data', () => {
  it('calibrating:true, score 50, topFix op create when no whoop data', () => {
    const r = computeEnergyScore([], null);
    expect(r.calibrating).toBe(true);
    expect(r.score).toBe(50);
    expect(r.topFix?.op).toBe('create');
  });

  it('driver mentions connecting Whoop', () => {
    const r = computeEnergyScore([], null);
    expect(r.drivers.some(d => d.toLowerCase().includes('whoop'))).toBe(true);
  });
});

// --- computeEnergyScore -- sleep only ---

describe('computeEnergyScore -- sleep only', () => {
  it('uses sleepScore directly when no recovery history', () => {
    const r = computeEnergyScore([], makeSleep(80));
    expect(r.calibrating).toBeFalsy();
    expect(r.score).toBe(80);
    expect(r.drivers.some(d => d.includes('80%'))).toBe(true);
  });

  it('sleep score 50 -> score 50 with no recovery', () => {
    expect(computeEnergyScore([], makeSleep(50)).score).toBe(50);
  });
});

// --- computeEnergyScore -- recovery only ---

describe('computeEnergyScore -- recovery only', () => {
  it('uses avg recovery when no sleep data', () => {
    const history = [
      makeRecovDay('2026-06-09', 80),
      makeRecovDay('2026-06-10', 60),
      makeRecovDay('2026-06-11', 70),
    ];
    const r = computeEnergyScore(history, null);
    expect(r.score).toBe(70); // (80+60+70)/3 = 70
    expect(r.calibrating).toBeFalsy();
    expect(r.drivers.some(d => d.includes('70%'))).toBe(true);
  });
});

// --- computeEnergyScore -- weighted blend ---

describe('computeEnergyScore -- weighted blend', () => {
  it('blends sleep 60% + recovery 40%', () => {
    const r = computeEnergyScore([makeRecovDay('2026-06-14', 50)], makeSleep(100));
    // 100x0.6 + 50x0.4 = 80
    expect(r.score).toBe(80);
    expect(r.calibrating).toBeFalsy();
  });

  it('uses only last 7 of recovery history', () => {
    const history = [
      makeRecovDay('2026-06-07', 0), // 8th oldest -- excluded
      ...Array.from({ length: 7 }, (_, i) => makeRecovDay(`2026-06-${8 + i}`, 100)),
    ];
    // All 7 in-window = avg 100; sleep 100 -> score 100
    expect(computeEnergyScore(history, makeSleep(100)).score).toBe(100);
  });

  it('score rounds to integer', () => {
    // sleep 70, recovery 55 -> 70x0.6 + 55x0.4 = 42+22 = 64
    const r = computeEnergyScore([makeRecovDay('2026-06-14', 55)], makeSleep(70));
    expect(Number.isInteger(r.score)).toBe(true);
    expect(r.score).toBe(64);
  });

  it('clamps score to 0-100', () => {
    const r = computeEnergyScore([makeRecovDay('2026-06-14', 100)], makeSleep(100));
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBeGreaterThanOrEqual(0);
  });

  it('low score -> topFix protect sleep/recovery', () => {
    const r = computeEnergyScore([makeRecovDay('2026-06-14', 20)], makeSleep(20));
    expect(r.score).toBeLessThan(40);
    expect(r.topFix).not.toBeNull();
  });
});

// --- computeEnergyScore -- drivers ---

describe('computeEnergyScore -- drivers', () => {
  it('includes sleep score in drivers', () => {
    const r = computeEnergyScore([], makeSleep(80));
    expect(r.drivers.some(d => d.includes('80%'))).toBe(true);
  });

  it('includes 7-day recovery avg in drivers when history present', () => {
    const r = computeEnergyScore([makeRecovDay('2026-06-14', 75)], null);
    expect(r.drivers.some(d => d.includes('75%'))).toBe(true);
  });

  it('marks excellent tier when sleep >= 75', () => {
    const r = computeEnergyScore([], makeSleep(90));
    expect(r.drivers.some(d => d.includes('excellent'))).toBe(true);
  });

  it('marks low tier when sleep < 50', () => {
    const r = computeEnergyScore([], makeSleep(40));
    expect(r.drivers.some(d => d.includes('low'))).toBe(true);
  });
});

// --- computeCalendarFit ---

describe('computeCalendarFit', () => {
  it('returns CalendarFit with both scores (0-100) and computedAt', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const fit = computeCalendarFit(null, priorities, [], null);
    expect(fit.focusScore.score).toBeGreaterThanOrEqual(0);
    expect(fit.focusScore.score).toBeLessThanOrEqual(100);
    expect(fit.energyScore.score).toBeGreaterThanOrEqual(0);
    expect(fit.energyScore.score).toBeLessThanOrEqual(100);
    expect(fit.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('calibrating:true and energy score 50 when no whoop data', () => {
    const fit = computeCalendarFit(null, [], [], null);
    expect(fit.energyScore.calibrating).toBe(true);
    expect(fit.energyScore.score).toBe(50);
    expect(fit.calibrating).toBe(true);
  });

  it('focus score is 0 when no priorities', () => {
    const fit = computeCalendarFit(null, [], [makeRecovDay('2026-06-14', 80)], makeSleep(80));
    expect(fit.focusScore.score).toBe(0);
  });
});

// --- computeCalendarFit -- edgeScore ---

describe('computeCalendarFit -- edgeScore', () => {
  it('includes edgeScore and calibrating fields', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const fit = computeCalendarFit(null, priorities, [], null);
    expect(typeof fit.edgeScore).toBe('number');
    expect(fit.edgeScore).toBeGreaterThanOrEqual(0);
    expect(fit.edgeScore).toBeLessThanOrEqual(100);
    expect(typeof fit.calibrating).toBe('boolean');
  });

  it('calibrating:true when no whoop data -- edgeScore equals focusScore', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const alignment  = makeAlign([{ priority: 'Build', hours: 22.5 }], 22.5);
    const fit = computeCalendarFit(alignment, priorities, [], null, 45);
    expect(fit.calibrating).toBe(true);
    expect(fit.edgeScore).toBe(fit.focusScore.score);
  });

  it('edgeScore rounds to integer', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const alignment  = makeAlign([{ priority: 'Build', hours: 20 }], 25);
    const fit = computeCalendarFit(alignment, priorities, [], null, 45);
    expect(Number.isInteger(fit.edgeScore)).toBe(true);
  });

  it('edgeScore is blend of focus + energy when whoop data present', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const alignment  = makeAlign([{ priority: 'Build', hours: 45 }]);
    // focusScore = 100, energyScore = 80x0.6 + 80x0.4 = 80 -> edgeScore = 90
    const fit = computeCalendarFit(
      alignment, priorities,
      [makeRecovDay('2026-06-14', 80)], makeSleep(80),
      45,
    );
    expect(fit.calibrating).toBe(false);
    expect(fit.focusScore.score).toBe(100);
    expect(fit.energyScore.score).toBe(80);
    expect(fit.edgeScore).toBe(90);
  });

  it('full scenario: 50% focus + high energy -> edgeScore is average', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const alignment  = makeAlign([{ priority: 'Build', hours: 22.5 }], 22.5);
    const fit = computeCalendarFit(
      alignment, priorities,
      [makeRecovDay('2026-06-14', 80)], makeSleep(80),
      45,
    );
    // focusScore=50, energyScore=80 -> edgeScore=65
    expect(fit.focusScore.score).toBe(50);
    expect(fit.energyScore.score).toBe(80);
    expect(fit.edgeScore).toBe(65);
    expect(fit.calibrating).toBe(false);
  });
});

// ─── colorByEnergy ───────────────────────────────────────────────────────────

describe('colorByEnergy', () => {
  const green: EnergySignal = { level: 'green', source: 'manual' };
  const yellow: EnergySignal = { level: 'yellow', source: 'manual' };
  const red: EnergySignal = { level: 'red', source: 'manual' };

  it('returns empty array for empty input', () => {
    expect(colorByEnergy([], green)).toEqual([]);
  });

  it('low demand → sage (2) regardless of energy level', () => {
    expect(colorByEnergy([{ eventId: 'e1', demand: 'low' }], red)).toEqual([{ eventId: 'e1', colorId: '2' }]);
  });

  it('medium demand → banana (5) on green day', () => {
    expect(colorByEnergy([{ eventId: 'e1', demand: 'medium' }], green)).toEqual([{ eventId: 'e1', colorId: '5' }]);
  });

  it('medium demand → tangerine (6) on red day', () => {
    expect(colorByEnergy([{ eventId: 'e1', demand: 'medium' }], red)).toEqual([{ eventId: 'e1', colorId: '6' }]);
  });

  it('high demand → blueberry (9) on green day', () => {
    expect(colorByEnergy([{ eventId: 'e1', demand: 'high' }], green)).toEqual([{ eventId: 'e1', colorId: '9' }]);
  });

  it('high demand → tangerine (6) on yellow day', () => {
    expect(colorByEnergy([{ eventId: 'e1', demand: 'high' }], yellow)).toEqual([{ eventId: 'e1', colorId: '6' }]);
  });

  it('high demand → tomato (11) on red day', () => {
    expect(colorByEnergy([{ eventId: 'e1', demand: 'high' }], red)).toEqual([{ eventId: 'e1', colorId: '11' }]);
  });

  it('high demand → peacock (8) when signal is null', () => {
    expect(colorByEnergy([{ eventId: 'e1', demand: 'high' }], null)).toEqual([{ eventId: 'e1', colorId: '8' }]);
  });

  it('maps multiple events preserving event IDs', () => {
    const tags: { eventId: string; demand: EventDemand }[] = [
      { eventId: 'a', demand: 'high' },
      { eventId: 'b', demand: 'medium' },
      { eventId: 'c', demand: 'low' },
    ];
    const result = colorByEnergy(tags, green);
    expect(result.map(r => r.eventId)).toEqual(['a', 'b', 'c']);
    expect(result[0].colorId).toBe('9');
    expect(result[1].colorId).toBe('5');
    expect(result[2].colorId).toBe('2');
  });
});
