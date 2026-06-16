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
  computeClarityScore,
  computeMomentumScore,
  colorByEnergy,
  type EventDemand,
  type ClarityInputs,
  type MomentumInputs,
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

  it('no whoop data + priorities set → calibrating:false, edgeScore equals focusScore', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const alignment  = makeAlign([{ priority: 'Build', hours: 22.5 }], 22.5);
    const fit = computeCalendarFit(alignment, priorities, [], null, 45);
    // Priorities are set → top-level calibrating=false even with no Whoop.
    // Energy is excluded from blend (calibrating) → edgeScore = focusScore (only component).
    expect(fit.calibrating).toBe(false);
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

// ─── computeClarityScore ──────────────────────────────────────────────────────

function makeClarity(overrides: Partial<ClarityInputs> = {}): ClarityInputs {
  return {
    calendarConnected: true,
    gmailReadGranted: true,
    whoopConnected: true,
    factsCount: 20,
    memoriesCount: 15,
    briefingCallsCount: 10,
    prioritiesCount: 3,
    ...overrides,
  };
}

describe('computeClarityScore', () => {
  it('returns 100 when all sources connected and context full', () => {
    const result = computeClarityScore(makeClarity());
    expect(result.score).toBe(100);
    expect(result.calibrating).toBeFalsy();
  });

  it('returns 0 when nothing connected and no context', () => {
    const result = computeClarityScore(makeClarity({
      calendarConnected: false, gmailReadGranted: false, whoopConnected: false,
      factsCount: 0, memoriesCount: 0, briefingCallsCount: 0, prioritiesCount: 0,
    }));
    expect(result.score).toBe(0);
  });

  it('connected sources only — no context — scores 60', () => {
    const result = computeClarityScore(makeClarity({
      factsCount: 0, memoriesCount: 0, briefingCallsCount: 0, prioritiesCount: 0,
    }));
    expect(result.score).toBe(60); // 20+20+20
  });

  it('no sources but max context — scores 40', () => {
    const result = computeClarityScore(makeClarity({
      calendarConnected: false, gmailReadGranted: false, whoopConnected: false,
    }));
    expect(result.score).toBe(40); // 15+10+10+5
  });

  it('calendar only + priorities = 25', () => {
    const result = computeClarityScore(makeClarity({
      calendarConnected: true, gmailReadGranted: false, whoopConnected: false,
      factsCount: 0, memoriesCount: 0, briefingCallsCount: 0, prioritiesCount: 1,
    }));
    expect(result.score).toBe(25); // 20 + 5
  });

  it('caps facts at 20 (no extra credit)', () => {
    const r1 = computeClarityScore(makeClarity({ factsCount: 20 }));
    const r2 = computeClarityScore(makeClarity({ factsCount: 100 }));
    expect(r1.score).toBe(r2.score);
    expect(r1.score).toBe(100);
  });

  it('caps briefing calls at 10', () => {
    const r1 = computeClarityScore(makeClarity({ briefingCallsCount: 10 }));
    const r2 = computeClarityScore(makeClarity({ briefingCallsCount: 50 }));
    expect(r1.score).toBe(r2.score);
  });

  it('topFix is calendar when not connected', () => {
    const result = computeClarityScore(makeClarity({ calendarConnected: false }));
    expect(result.topFix?.description).toMatch(/calendar/i);
  });

  it('topFix is gmail when calendar ok but no gmail', () => {
    const result = computeClarityScore(makeClarity({ gmailReadGranted: false }));
    expect(result.topFix?.description).toMatch(/gmail/i);
  });

  it('topFix is whoop when calendar+gmail ok but no whoop', () => {
    const result = computeClarityScore(makeClarity({ whoopConnected: false }));
    expect(result.topFix?.description).toMatch(/whoop/i);
  });

  it('topFix is priorities when all connected but no priorities', () => {
    const result = computeClarityScore(makeClarity({ prioritiesCount: 0 }));
    expect(result.topFix?.description).toMatch(/priorit/i);
  });

  it('topFix is null when all sources connected and context full', () => {
    const result = computeClarityScore(makeClarity());
    expect(result.topFix).toBeNull();
  });

  it('score is always 0-100', () => {
    [-10, 0, 5, 50, 100, 200].forEach(factsCount => {
      const result = computeClarityScore(makeClarity({ factsCount }));
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });
  });
});

// ─── computeMomentumScore ─────────────────────────────────────────────────────

function makeMomentum(overrides: Partial<MomentumInputs> = {}): MomentumInputs {
  return {
    completedCallDays14d: 10,
    completedCallDays7d: 5,
    confirmedFocusDays14d: 7,
    streakDays: 5,
    ...overrides,
  };
}

describe('computeMomentumScore', () => {
  it('calibrating when no calls and no confirmed focus', () => {
    const result = computeMomentumScore(makeMomentum({
      completedCallDays14d: 0, completedCallDays7d: 0, confirmedFocusDays14d: 0, streakDays: 0,
    }));
    expect(result.calibrating).toBe(true);
    expect(result.score).toBe(0);
  });

  it('not calibrating when at least one completed call', () => {
    const result = computeMomentumScore(makeMomentum({ completedCallDays14d: 1 }));
    expect(result.calibrating).toBeFalsy();
  });

  it('not calibrating when confirmed focus but no calls', () => {
    const result = computeMomentumScore(makeMomentum({
      completedCallDays14d: 0, confirmedFocusDays14d: 1,
    }));
    expect(result.calibrating).toBeFalsy();
  });

  it('perfect show-up (14d) + engagement (14d) = 100', () => {
    const result = computeMomentumScore(makeMomentum({
      completedCallDays14d: 14, confirmedFocusDays14d: 14,
    }));
    expect(result.score).toBe(100); // 70 + 30
  });

  it('show-up only (14/14), no engagement = 70', () => {
    const result = computeMomentumScore(makeMomentum({
      completedCallDays14d: 14, confirmedFocusDays14d: 0,
    }));
    expect(result.score).toBe(70);
  });

  it('half show-up (7/14) + half engagement (7/14) = 50', () => {
    const result = computeMomentumScore(makeMomentum({
      completedCallDays14d: 7, confirmedFocusDays14d: 7,
    }));
    expect(result.score).toBe(50); // round(7/14*70)=35 + round(7/14*30)=15
  });

  it('streak >= 2 appears in drivers', () => {
    const result = computeMomentumScore(makeMomentum({ streakDays: 3 }));
    expect(result.drivers.some(d => /streak/i.test(d))).toBe(true);
  });

  it('streak < 2 not in drivers', () => {
    const result = computeMomentumScore(makeMomentum({ streakDays: 1 }));
    expect(result.drivers.some(d => /streak/i.test(d))).toBe(false);
  });

  it('score is always 0-100', () => {
    [0, 5, 7, 14, 20].forEach(n => {
      const result = computeMomentumScore(makeMomentum({ completedCallDays14d: n }));
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });
  });

  it('topFix nudges call frequency when calls < 5', () => {
    const result = computeMomentumScore(makeMomentum({ completedCallDays14d: 3 }));
    expect(result.topFix?.description).toMatch(/morning calls/i);
  });
});

// ─── computeCalendarFit -- clarity + momentum blend ───────────────────────────

describe('computeCalendarFit -- clarity blend', () => {
  it('clarityScore present in result when inputs provided', () => {
    const p = [makeP(1, 'Build', 1)];
    const fit = computeCalendarFit(
      makeAlign([{ priority: 'Build', hours: 45 }]), p,
      [makeRecovDay('2026-06-14', 80)], makeSleep(80),
      45, makeClarity(),
    );
    expect(fit.clarityScore).toBeDefined();
    expect(fit.clarityScore!.score).toBe(100);
    expect(fit.momentumScore).toBeUndefined();
  });

  it('clarity-only blend (no momentum): renormalises 30/30/20 → focus 100, energy 80, clarity 20 → edgeScore=73', () => {
    const p = [makeP(1, 'Build', 1)];
    const clarityInputs: ClarityInputs = {
      calendarConnected: true, gmailReadGranted: false, whoopConnected: false,
      factsCount: 0, memoriesCount: 0, briefingCallsCount: 0, prioritiesCount: 0,
    }; // score = 20
    const fit = computeCalendarFit(
      makeAlign([{ priority: 'Build', hours: 45 }]), p,
      [makeRecovDay('2026-06-14', 80)], makeSleep(80),
      45, clarityInputs,
    );
    expect(fit.focusScore.score).toBe(100);
    expect(fit.energyScore.score).toBe(80);
    expect(fit.clarityScore!.score).toBe(20);
    // Weights 30/30/20 renorm to 80 total → 100*(30/80) + 80*(30/80) + 20*(20/80) = 37.5+30+5 = 72.5 → 73
    expect(fit.edgeScore).toBe(73);
  });

  it('4-way 30/30/20/20 blend when both clarity and momentum present', () => {
    const p = [makeP(1, 'Build', 1)];
    // focus=100, energy=80, clarity=20, momentum≈50 (7/14*70=35 + 7/14*30=15)
    const fit = computeCalendarFit(
      makeAlign([{ priority: 'Build', hours: 45 }]), p,
      [makeRecovDay('2026-06-14', 80)], makeSleep(80),
      45,
      { calendarConnected: true, gmailReadGranted: false, whoopConnected: false, factsCount: 0, memoriesCount: 0, briefingCallsCount: 0, prioritiesCount: 0 },
      { completedCallDays14d: 7, completedCallDays7d: 4, confirmedFocusDays14d: 7, streakDays: 4 },
    );
    expect(fit.clarityScore).toBeDefined();
    expect(fit.momentumScore).toBeDefined();
    // 100*0.3 + 80*0.3 + 20*0.2 + 50*0.2 = 30+24+4+10 = 68
    expect(fit.edgeScore).toBe(68);
  });

  it('energy calibrating + 4-way: renormalises 30/20/20 → focus 100, clarity 20, momentum 50 → edgeScore=63', () => {
    const p = [makeP(1, 'Build', 1)];
    // focus=100, no whoop→energy calibrating (excluded), clarity=20, momentum=50
    const fit = computeCalendarFit(
      makeAlign([{ priority: 'Build', hours: 45 }]), p,
      [], null, // no Whoop → energy excluded from blend
      45,
      { calendarConnected: true, gmailReadGranted: false, whoopConnected: false, factsCount: 0, memoriesCount: 0, briefingCallsCount: 0, prioritiesCount: 0 },
      { completedCallDays14d: 7, completedCallDays7d: 4, confirmedFocusDays14d: 7, streakDays: 4 },
    );
    // priorities.length=1 → top-level calibrating=false (per-component energy calibrating stays true in breakdown)
    expect(fit.calibrating).toBe(false);
    expect(fit.energyScore.calibrating).toBe(true); // breakdown still shows calibrating
    // Weights 30/20/20 renorm to 70 total → (100*30 + 20*20 + 50*20)/70 = 4400/70 ≈ 63
    expect(fit.edgeScore).toBe(63);
  });

  it('without any optional inputs -- keeps legacy 50/50 blend', () => {
    const p = [makeP(1, 'Build', 1)];
    const fit = computeCalendarFit(
      makeAlign([{ priority: 'Build', hours: 45 }]), p,
      [makeRecovDay('2026-06-14', 80)], makeSleep(80),
    );
    expect(fit.clarityScore).toBeUndefined();
    expect(fit.momentumScore).toBeUndefined();
    expect(fit.edgeScore).toBe(Math.round((100 + 80) / 2)); // 90
  });
});
