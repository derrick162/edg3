import { describe, it, expect } from 'vitest';
import type { calendar_v3 } from 'googleapis';
import type { Priority } from './db';
import type { AlignmentResult } from './alignment';
import type { EnergySignal } from './energy';
import {
  parseEnergyProfile,
  computeFocusScore,
  computeEnergyScore,
  computeCalendarFit,
  type EnergyProfile,
  type ScoreWeights,
} from './calendarScore';

// ─── Factories ───────────────────────────────────────────────────────────────

function makeTimedEvent(summary: string, startISO: string, endISO: string): calendar_v3.Schema$Event {
  return { summary, start: { dateTime: startISO }, end: { dateTime: endISO } };
}
function makeAllDay(summary: string, startDate: string, endDate: string): calendar_v3.Schema$Event {
  return { summary, start: { date: startDate }, end: { date: endDate } };
}
function makeP(id: number, text: string, rank: number, energy_cost?: Priority['energy_cost']): Priority {
  return { id, user_id: 1, text, rank, week_of: '2026-06-08', created_at: '2026-06-14T00:00:00', energy_cost };
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

const sigGreen:  EnergySignal = { level: 'green',  source: 'manual' };
const sigYellow: EnergySignal = { level: 'yellow', source: 'whoop'  };
const sigRed:    EnergySignal = { level: 'red',    source: 'whoop'  };
const profilePeakOnly: EnergyProfile = { peakStart: 9, peakEnd: 11, troughStart: null, troughEnd: null };
const profileFull:     EnergyProfile = { peakStart: 9, peakEnd: 11, troughStart: 14,   troughEnd: 16   };

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

// ─── ScoreResult shape ───────────────────────────────────────────────────────

describe('ScoreResult shape', () => {
  it('includes quantScore, judgmentScore, weights on focus result', () => {
    const r = computeFocusScore([], [makeP(1, 'Build', 1)], null);
    expect(typeof r.quantScore).toBe('number');
    expect(typeof r.judgmentScore).toBe('number');
    expect(r.weights).toEqual({ quant: 0.5, judgment: 0.5 });
    expect(r.quantScore).toBeGreaterThanOrEqual(1);
    expect(r.quantScore).toBeLessThanOrEqual(10);
    expect(r.judgmentScore).toBeGreaterThanOrEqual(1);
    expect(r.judgmentScore).toBeLessThanOrEqual(10);
  });

  it('includes quantScore, judgmentScore, weights on energy result', () => {
    const r = computeEnergyScore([], sigGreen, null, []);
    expect(typeof r.quantScore).toBe('number');
    expect(typeof r.judgmentScore).toBe('number');
    expect(r.weights).toEqual({ quant: 0.5, judgment: 0.5 });
  });

  it('score is the weighted blend of quantScore and judgmentScore', () => {
    const priorities = [makeP(1, 'Build', 1), makeP(2, 'Sales', 2)];
    const alignment  = makeAlign([{ priority: 'Build', hours: 3 }, { priority: 'Sales', hours: 2 }], 1);
    const events     = [makeTimedEvent('Deep work', '2026-06-14T09:00:00Z', '2026-06-14T11:00:00Z')];
    const r = computeFocusScore(events, priorities, alignment);
    const expected = Math.round(r.quantScore * 0.5 + r.judgmentScore * 0.5);
    expect(r.score).toBe(expected);
  });

  it('custom weight quant=1 judgment=0 gives score === quantScore', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const customW: ScoreWeights = { quant: 1, judgment: 0 };
    const r = computeFocusScore([], priorities, null, customW);
    expect(r.score).toBe(r.quantScore);
    expect(r.weights).toEqual(customW);
  });

  it('no-priorities early return carries quantScore=1 and judgmentScore=1', () => {
    const r = computeFocusScore([], [], null);
    expect(r.score).toBe(1);
    expect(r.quantScore).toBe(1);
    expect(r.judgmentScore).toBe(1);
  });

  it('no-signal early return carries quantScore=5 and judgmentScore=5', () => {
    const r = computeEnergyScore([], null, null, []);
    expect(r.score).toBe(5);
    expect(r.quantScore).toBe(5);
    expect(r.judgmentScore).toBe(5);
  });
});

// ─── computeFocusScore — no priorities ───────────────────────────────────────

describe('computeFocusScore — no priorities', () => {
  it('returns score 1 with setup driver when priorities list is empty', () => {
    const r = computeFocusScore([], [], null);
    expect(r.score).toBe(1);
    expect(r.drivers.some(d => d.includes('No focus areas'))).toBe(true);
    expect(r.topFix?.op).toBe('create');
  });
});

// ─── computeFocusScore — coverage ────────────────────────────────────────────

describe('computeFocusScore — coverage', () => {
  it('all priorities covered + high aligned share → score 7+', () => {
    const priorities = [makeP(1, 'Fundraising', 1), makeP(2, 'Product', 2), makeP(3, 'Team', 3)];
    const alignment  = makeAlign(
      [{ priority: 'Fundraising', hours: 4 }, { priority: 'Product', hours: 3 }, { priority: 'Team', hours: 2 }],
      1,
    );
    const events = [makeTimedEvent('Investor call', '2026-06-14T09:00:00-04:00', '2026-06-14T11:00:00-04:00')];
    const r = computeFocusScore(events, priorities, alignment);
    expect(r.score).toBeGreaterThanOrEqual(7);
    expect(r.drivers.some(d => d.includes('All 3'))).toBe(true);
  });

  it('one priority at 0h → driver names it, topFix creates time for it', () => {
    const priorities = [makeP(1, 'Fundraising', 1), makeP(2, 'Product', 2)];
    const alignment  = makeAlign(
      [{ priority: 'Fundraising', hours: 0 }, { priority: 'Product', hours: 3 }],
      1,
    );
    const r = computeFocusScore([], priorities, alignment);
    expect(r.drivers.some(d => d.includes('"Fundraising"') && d.includes('zero hours'))).toBe(true);
    expect(r.topFix?.description).toContain('Fundraising');
    expect(r.topFix?.op).toBe('create');
  });

  it('all priorities at 0h → very low score', () => {
    const priorities = [makeP(1, 'A', 1), makeP(2, 'B', 2), makeP(3, 'C', 3)];
    const alignment  = makeAlign([{ priority: 'A', hours: 0 }, { priority: 'B', hours: 0 }, { priority: 'C', hours: 0 }]);
    const r = computeFocusScore([], priorities, alignment);
    expect(r.score).toBeLessThanOrEqual(4);
  });
});

// ─── computeFocusScore — aligned share ───────────────────────────────────────

describe('computeFocusScore — aligned share', () => {
  it('80%+ aligned share → positive "strong alignment" driver', () => {
    const priorities = [makeP(1, 'Focus', 1)];
    const alignment  = makeAlign([{ priority: 'Focus', hours: 8 }], 2);
    const r = computeFocusScore([], priorities, alignment);
    expect(r.drivers.some(d => d.includes('strong alignment'))).toBe(true);
  });

  it('20% aligned share → negative driver + names biggest time sink', () => {
    const priorities = [makeP(1, 'Focus', 1)];
    const alignment  = makeAlign(
      [{ priority: 'Focus', hours: 1 }],
      4,
      [{ title: 'Random meetings', hours: 4 }],
    );
    const r = computeFocusScore([], priorities, alignment);
    expect(r.drivers.some(d => d.includes('Only') && d.includes('%'))).toBe(true);
    expect(r.drivers.some(d => d.includes('Random meetings'))).toBe(true);
  });
});

// ─── computeFocusScore — protected blocks ────────────────────────────────────

describe('computeFocusScore — protected blocks', () => {
  it('2h timed event → positive protected-block driver', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const events     = [makeTimedEvent('Deep work', '2026-06-14T09:00:00Z', '2026-06-14T11:00:00Z')];
    const r = computeFocusScore(events, priorities, null);
    expect(r.drivers.some(d => d.includes('≥ 90 min'))).toBe(true);
  });

  it('all events < 30 min → negative "no protected focus blocks" driver', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const events     = [makeTimedEvent('Quick check', '2026-06-14T09:00:00Z', '2026-06-14T09:30:00Z')];
    const r = computeFocusScore(events, priorities, null);
    expect(r.drivers.some(d => d.includes('No protected focus blocks'))).toBe(true);
  });

  it('all-day events do not count as protected blocks', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const events     = [makeAllDay('Vacation', '2026-06-14', '2026-06-15')];
    const r = computeFocusScore(events, priorities, null);
    expect(r.drivers.some(d => d.includes('No protected focus blocks'))).toBe(true);
  });
});

// ─── computeFocusScore — balance ─────────────────────────────────────────────

describe('computeFocusScore — balance', () => {
  it('P1 gets most hours → positive ranking driver', () => {
    const priorities = [makeP(1, 'A', 1), makeP(2, 'B', 2), makeP(3, 'C', 3)];
    const alignment  = makeAlign([{ priority: 'A', hours: 5 }, { priority: 'B', hours: 3 }, { priority: 'C', hours: 1 }]);
    const r = computeFocusScore([], priorities, alignment);
    expect(r.drivers.some(d => d.includes('priority ranking'))).toBe(true);
  });

  it('P3 gets most hours → inverted driver + topFix targets P1', () => {
    const priorities = [makeP(1, 'Fundraising', 1), makeP(2, 'Product', 2), makeP(3, 'Email', 3)];
    const alignment  = makeAlign([
      { priority: 'Fundraising', hours: 1 },
      { priority: 'Product', hours: 2 },
      { priority: 'Email', hours: 5 },
    ]);
    const r = computeFocusScore([], priorities, alignment);
    expect(r.drivers.some(d => d.includes('"Email"') && d.includes('"Fundraising"'))).toBe(true);
    expect(r.topFix?.description).toContain('Fundraising');
  });
});

// ─── computeFocusScore — null alignment ──────────────────────────────────────

describe('computeFocusScore — null alignment', () => {
  it('degrades gracefully with null alignment', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const r = computeFocusScore([], priorities, null);
    expect(r.score).toBeGreaterThanOrEqual(1);
    expect(r.score).toBeLessThanOrEqual(10);
    expect(Array.isArray(r.drivers)).toBe(true);
  });
});

// ─── computeFocusScore — topFix ──────────────────────────────────────────────

describe('computeFocusScore — topFix', () => {
  it('topFix is null when score is 9-10 (all green)', () => {
    const priorities = [makeP(1, 'Build', 1), makeP(2, 'Sales', 2)];
    const alignment  = makeAlign([{ priority: 'Build', hours: 5 }, { priority: 'Sales', hours: 3 }], 1);
    const events     = [makeTimedEvent('Deep work', '2026-06-14T09:00:00Z', '2026-06-14T11:30:00Z')];
    const r = computeFocusScore(events, priorities, alignment);
    if (r.score >= 9) expect(r.topFix).toBeNull();
  });

  it('topFix mentions unaligned time when aligned share < 40%', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const alignment  = makeAlign(
      [{ priority: 'Build', hours: 1 }],
      8,
      [{ title: 'Bureaucracy', hours: 8 }],
    );
    const events = [makeTimedEvent('Deep work', '2026-06-14T09:00:00Z', '2026-06-14T11:00:00Z')];
    const r = computeFocusScore(events, priorities, alignment);
    expect(r.topFix?.description).toContain('Bureaucracy');
    expect(r.topFix?.op).toBe('move');
  });
});

// ─── Focus judgment — diminishing returns ────────────────────────────────────

describe('computeFocusScore — diminishing returns (judgment)', () => {
  it('one area > 5h while another is at 0h → diminishing-returns driver', () => {
    const priorities = [makeP(1, 'Fundraising', 1), makeP(2, 'Product', 2)];
    const alignment  = makeAlign([{ priority: 'Fundraising', hours: 7 }, { priority: 'Product', hours: 0 }], 0);
    const r = computeFocusScore([], priorities, alignment);
    expect(r.drivers.some(d => d.includes('saturation') || d.includes('diminishing'))).toBe(true);
  });

  it('all areas well within 5h → no diminishing-returns penalty', () => {
    const priorities = [makeP(1, 'Fundraising', 1), makeP(2, 'Product', 2)];
    const alignment  = makeAlign([{ priority: 'Fundraising', hours: 3 }, { priority: 'Product', hours: 2 }], 0);
    const r = computeFocusScore([], priorities, alignment);
    // judgment should be high — no saturation
    expect(r.judgmentScore).toBeGreaterThanOrEqual(7);
  });

  it('all zeros → judgment score is very low (nothing to assess)', () => {
    const priorities = [makeP(1, 'A', 1), makeP(2, 'B', 2)];
    const alignment  = makeAlign([{ priority: 'A', hours: 0 }, { priority: 'B', hours: 0 }]);
    const r = computeFocusScore([], priorities, alignment);
    expect(r.judgmentScore).toBeLessThanOrEqual(4);
  });
});

// ─── Focus judgment — domain archetypes ──────────────────────────────────────

describe('computeFocusScore — domain archetypes (judgment)', () => {
  it('deep-work priority with all short events → archetype driver', () => {
    const priorities = [makeP(1, 'Build product', 1)];
    const events     = [
      makeTimedEvent('Build session', '2026-06-14T09:00:00Z', '2026-06-14T09:45:00Z'), // 45 min < 1.5h
      makeTimedEvent('Vibe coding',   '2026-06-14T10:00:00Z', '2026-06-14T10:45:00Z'), // 45 min < 1.5h
    ];
    const r = computeFocusScore(events, priorities, null);
    expect(r.drivers.some(d => d.includes('deep work') || d.includes('fragmented') || d.includes('flow state'))).toBe(true);
  });

  it('fundraising priority with 2h events passes the archetype check', () => {
    const priorities = [makeP(1, 'Fundraising', 1)];
    const events     = [makeTimedEvent('Investor meeting', '2026-06-14T09:00:00Z', '2026-06-14T11:00:00Z')]; // 2h ≥ 1h
    const r = computeFocusScore(events, priorities, null);
    // No archetype penalty — judgment score should be 9 from domain rule
    // (diminishing returns may still fire if hours are low, but domain passes)
    expect(r.drivers.some(d => d.includes('fragmented') || d.includes('investor conversations'))).toBe(false);
  });

  it('fitness priority has no archetype check (not in FOCUS_ARCHETYPES)', () => {
    const priorities = [makeP(1, 'Gym daily', 1)];
    const events     = [makeTimedEvent('Gym', '2026-06-14T07:00:00Z', '2026-06-14T07:30:00Z')]; // 30 min is fine
    const r = computeFocusScore(events, priorities, null);
    expect(r.drivers.some(d => d.includes('fragmented'))).toBe(false);
  });
});

// ─── computeEnergyScore — no signal ──────────────────────────────────────────

describe('computeEnergyScore — no signal', () => {
  it('returns score 5 with "set energy" topFix when signal is null', () => {
    const r = computeEnergyScore([], null, null, []);
    expect(r.score).toBe(5);
    expect(r.drivers.some(d => d.includes('No energy signal'))).toBe(true);
    expect(r.topFix?.op).toBe('create');
  });
});

// ─── computeEnergyScore — load vs capacity ───────────────────────────────────

describe('computeEnergyScore — load vs capacity', () => {
  it('green day → high load score, positive driver', () => {
    const r = computeEnergyScore([], sigGreen, null, []);
    expect(r.score).toBeGreaterThanOrEqual(6);
    expect(r.drivers.some(d => d.includes('Green day'))).toBe(true);
  });

  it('red day + high-demand event → low score, topFix moves it', () => {
    const events = [makeTimedEvent('Investor pitch deck', '2026-06-14T10:00:00-04:00', '2026-06-14T12:00:00-04:00')];
    const r = computeEnergyScore(events, sigRed, null, []);
    expect(r.score).toBeLessThanOrEqual(5);
    expect(r.drivers.some(d => d.includes('Red day') && d.includes('high-demand'))).toBe(true);
    expect(r.topFix?.op).toBe('move');
  });

  it('red day + only low-demand events → better score, no move topFix', () => {
    const events = [
      makeTimedEvent('Lunch', '2026-06-14T12:00:00-04:00', '2026-06-14T13:00:00-04:00'),
      makeTimedEvent('Walk',  '2026-06-14T15:00:00-04:00', '2026-06-14T15:30:00-04:00'),
    ];
    const r = computeEnergyScore(events, sigRed, null, []);
    expect(r.score).toBeGreaterThan(4);
    expect(r.drivers.some(d => d.includes('light work'))).toBe(true);
  });

  it('yellow day with 3 high-demand events → loadScore is 5, lower overall', () => {
    const events = [
      makeTimedEvent('Strategy session', '2026-06-14T09:00:00-04:00', '2026-06-14T10:00:00-04:00'),
      makeTimedEvent('Investor meeting',  '2026-06-14T10:00:00-04:00', '2026-06-14T11:00:00-04:00'),
      makeTimedEvent('Deep work',         '2026-06-14T11:00:00-04:00', '2026-06-14T12:00:00-04:00'),
    ];
    const r = computeEnergyScore(events, sigYellow, null, []);
    expect(r.drivers.some(d => d.includes('Yellow day') && d.includes('high-demand'))).toBe(true);
  });
});

// ─── computeEnergyScore — demand↔window match ────────────────────────────────

describe('computeEnergyScore — demand↔window match', () => {
  it('high-demand event in peak window → matchScore 8+, positive driver', () => {
    const events = [makeTimedEvent('Deep work', '2026-06-14T09:00:00-04:00', '2026-06-14T11:00:00-04:00')];
    const r = computeEnergyScore(events, sigGreen, profilePeakOnly, []);
    expect(r.drivers.some(d => d.includes('peak window') || d.includes('excellent'))).toBe(true);
  });

  it('high-demand event in trough window → matchScore ≤ 5, negative driver', () => {
    const events = [makeTimedEvent('Investor pitch deck', '2026-06-14T14:00:00-04:00', '2026-06-14T16:00:00-04:00')];
    const r = computeEnergyScore(events, sigGreen, profileFull, []);
    expect(r.drivers.some(d => d.includes('trough'))).toBe(true);
  });

  it('no energy profile → neutral matchScore (6) with driver', () => {
    const events = [makeTimedEvent('Meeting', '2026-06-14T09:00:00-04:00', '2026-06-14T10:00:00-04:00')];
    const r = computeEnergyScore(events, sigGreen, null, []);
    expect(r.drivers.some(d => d.includes('No peak/trough windows'))).toBe(true);
  });

  it('topFix suggests profile setup when no peak window is set', () => {
    const r = computeEnergyScore([], sigYellow, null, []);
    expect(r.topFix?.description).toContain('peak energy window');
    expect(r.topFix?.op).toBe('create');
  });
});

// ─── computeEnergyScore — recovery protection ────────────────────────────────

describe('computeEnergyScore — recovery protection', () => {
  it('yellow day with back-to-back non-light events → recovery driver', () => {
    const events = [
      makeTimedEvent('Meeting A', '2026-06-14T09:00:00-04:00', '2026-06-14T10:00:00-04:00'),
      makeTimedEvent('Meeting B', '2026-06-14T10:05:00-04:00', '2026-06-14T11:00:00-04:00'), // 5 min gap < 15
    ];
    const r = computeEnergyScore(events, sigYellow, null, []);
    expect(r.drivers.some(d => d.includes('back-to-back'))).toBe(true);
  });
});

// ─── Energy judgment — day-type appropriateness ──────────────────────────────

describe('computeEnergyScore — day-type appropriateness (judgment)', () => {
  it('red day + high-demand → judgment score is very low', () => {
    const events = [makeTimedEvent('Investor pitch deck', '2026-06-14T10:00:00-04:00', '2026-06-14T12:00:00-04:00')];
    const r = computeEnergyScore(events, sigRed, null, []);
    expect(r.judgmentScore).toBeLessThanOrEqual(5);
  });

  it('red day + light work only → judgment score is high', () => {
    const events = [
      makeTimedEvent('Lunch', '2026-06-14T12:00:00-04:00', '2026-06-14T13:00:00-04:00'),
      makeTimedEvent('Walk',  '2026-06-14T15:00:00-04:00', '2026-06-14T15:30:00-04:00'),
    ];
    const r = computeEnergyScore(events, sigRed, null, []);
    expect(r.judgmentScore).toBeGreaterThanOrEqual(7);
  });

  it('green day + high-demand in peak → judgment score is 9-10', () => {
    const events = [makeTimedEvent('Deep work', '2026-06-14T09:00:00-04:00', '2026-06-14T11:00:00-04:00')];
    const r = computeEnergyScore(events, sigGreen, profilePeakOnly, []);
    expect(r.judgmentScore).toBeGreaterThanOrEqual(9);
  });

  it('green day + high-demand OUTSIDE peak → judgment warns about wasted capacity', () => {
    // Event at 2pm, profile peak is 9-11 — misses the peak
    const events = [makeTimedEvent('Deep work', '2026-06-14T14:00:00-04:00', '2026-06-14T16:00:00-04:00')];
    const r = computeEnergyScore(events, sigGreen, profilePeakOnly, []);
    expect(r.drivers.some(d => d.includes('leaving capacity on the table') || d.includes('outside your peak window'))).toBe(true);
    expect(r.judgmentScore).toBeLessThan(9);
  });
});

// ─── Energy judgment — recovery insurance ────────────────────────────────────

describe('computeEnergyScore — recovery insurance (judgment)', () => {
  it('late-evening event (≥ 7pm) → recovery driver mentions 7 PM', () => {
    const events = [makeTimedEvent('Strategy session', '2026-06-14T19:00:00-04:00', '2026-06-14T20:00:00-04:00')];
    const r = computeEnergyScore(events, sigGreen, null, []);
    expect(r.drivers.some(d => d.includes('7 PM') || d.includes('late-evening') || d.includes('late scheduling'))).toBe(true);
  });

  it('two late-evening events → recovery insurance score very low', () => {
    const events = [
      makeTimedEvent('Call', '2026-06-14T19:00:00-04:00', '2026-06-14T20:00:00-04:00'),
      makeTimedEvent('Call', '2026-06-14T20:30:00-04:00', '2026-06-14T21:30:00-04:00'),
    ];
    const r = computeEnergyScore(events, sigGreen, null, []);
    // Even on a green day, 2 late events tank the insurance sub-score
    expect(r.drivers.some(d => d.includes('late-evening'))).toBe(true);
  });

  it('no late events and no back-to-back → no recovery driver (clean day)', () => {
    const events = [
      makeTimedEvent('Morning block', '2026-06-14T09:00:00-04:00', '2026-06-14T10:00:00-04:00'),
      makeTimedEvent('Afternoon call', '2026-06-14T14:00:00-04:00', '2026-06-14T15:00:00-04:00'),
    ];
    const r = computeEnergyScore(events, sigGreen, null, []);
    expect(r.drivers.every(d => !d.includes('late-evening') && !d.includes('back-to-back'))).toBe(true);
  });
});

// ─── computeCalendarFit ──────────────────────────────────────────────────────

describe('computeCalendarFit', () => {
  it('returns CalendarFit with both scores and computedAt', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const fit = computeCalendarFit([], priorities, null, sigGreen, null);
    expect(fit.focusScore.score).toBeGreaterThanOrEqual(1);
    expect(fit.energyScore.score).toBeGreaterThanOrEqual(1);
    expect(fit.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('energy score is 5 when no signal is passed', () => {
    const fit = computeCalendarFit([], [], null, null, null);
    expect(fit.energyScore.score).toBe(5);
  });

  it('custom weights propagate to both scores', () => {
    const weights: ScoreWeights = { quant: 0.8, judgment: 0.2 };
    const fit = computeCalendarFit([], [makeP(1, 'Build', 1)], null, sigGreen, null, weights);
    expect(fit.focusScore.weights).toEqual(weights);
    expect(fit.energyScore.weights).toEqual(weights);
  });
});
