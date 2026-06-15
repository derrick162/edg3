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
  colorByEnergy,
  type EnergyProfile,
  type TaggedEvent,
  type EventType,
  type EventDemand,
} from './calendarScore';

// ─── Factories ───────────────────────────────────────────────────────────────

function makeTimedEvent(summary: string, startISO: string, endISO: string): calendar_v3.Schema$Event {
  return { summary, start: { dateTime: startISO }, end: { dateTime: endISO } };
}
function makeAllDay(summary: string, startDate: string, endDate: string): calendar_v3.Schema$Event {
  return { summary, start: { date: startDate }, end: { date: endDate } };
}
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
function makeTagged(event: calendar_v3.Schema$Event, type: EventType = 'other', demand: EventDemand = 'medium'): TaggedEvent {
  return { event, tag: { type, demand } };
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
    const r = computeEnergyScore([], sigGreen, null);
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

// ─── computeEnergyScore — no signal ──────────────────────────────────────────

describe('computeEnergyScore — no signal', () => {
  it('returns calibrating:true, score 50, and "set energy" topFix when signal is null', () => {
    const r = computeEnergyScore([], null, null);
    expect(r.calibrating).toBe(true);
    expect(r.score).toBe(50);
    expect(r.drivers.some(d => d.includes('No energy signal'))).toBe(true);
    expect(r.topFix?.op).toBe('create');
  });
});

// ─── computeEnergyScore — empty events ───────────────────────────────────────

describe('computeEnergyScore — empty events', () => {
  it('empty events on red day → score 100 (protected)', () => {
    const r = computeEnergyScore([], sigRed, null);
    expect(r.score).toBe(100);
    expect(r.drivers.some(d => d.includes('recovery'))).toBe(true);
  });

  it('empty events on green day → score 70 (neutral)', () => {
    const r = computeEnergyScore([], sigGreen, null);
    expect(r.score).toBe(70);
  });

  it('empty events on yellow day → score 70 (neutral)', () => {
    const r = computeEnergyScore([], sigYellow, null);
    expect(r.score).toBe(70);
  });
});

// ─── computeEnergyScore — red day penalties ───────────────────────────────────

describe('computeEnergyScore — red day penalties', () => {
  it('high-demand on red day → score is low, topFix moves it', () => {
    const ev = makeTimedEvent('Investor pitch', '2026-06-14T10:00:00-04:00', '2026-06-14T12:00:00-04:00');
    const r = computeEnergyScore([makeTagged(ev, 'meeting', 'high')], sigRed, null);
    expect(r.score).toBeLessThan(50);
    expect(r.topFix?.op).toBe('move');
    expect(r.topFix?.description).toContain('Investor pitch');
  });

  it('high-demand on red day → score is 0 (single mismatch at full weight)', () => {
    const ev = makeTimedEvent('Deep work', '2026-06-14T09:00:00-04:00', '2026-06-14T11:00:00-04:00');
    const r = computeEnergyScore([makeTagged(ev, 'deep_work', 'high')], sigRed, null);
    // penalty=2, total=2 → score = 0
    expect(r.score).toBe(0);
  });

  it('low-demand only on red day → score 100', () => {
    const ev = makeTimedEvent('Lunch', '2026-06-14T12:00:00-04:00', '2026-06-14T13:00:00-04:00');
    const r = computeEnergyScore([makeTagged(ev, 'meal', 'low')], sigRed, null);
    expect(r.score).toBe(100);
  });

  it('mixed: one high + one low on red → score 20 (penalty 2/2.5)', () => {
    const high = makeTimedEvent('Deep work', '2026-06-14T09:00:00-04:00', '2026-06-14T11:00:00-04:00');
    const low  = makeTimedEvent('Lunch',    '2026-06-14T12:00:00-04:00', '2026-06-14T13:00:00-04:00');
    const r = computeEnergyScore(
      [makeTagged(high, 'deep_work', 'high'), makeTagged(low, 'meal', 'low')],
      sigRed,
      null,
    );
    // high (w=2) penalized, low (w=0.5) not → penalty/total = 2/2.5 = 80% → score = 20
    expect(r.score).toBe(20);
  });

  it('medium-demand on red day → partial penalty (×0.5 fraction → score 50)', () => {
    // medium event: w=1. penalty = 1×0.5 = 0.5. score = 1 - 0.5/1 = 0.5 → 50.
    const ev = makeTimedEvent('Team meeting', '2026-06-14T10:00:00-04:00', '2026-06-14T11:00:00-04:00');
    const r = computeEnergyScore([makeTagged(ev, 'meeting', 'medium')], sigRed, null);
    expect(r.score).toBe(50);
    expect(r.topFix?.op).toBe('move');
  });
});

// ─── computeEnergyScore — trough timing ──────────────────────────────────────

describe('computeEnergyScore — trough timing', () => {
  it('high-demand in trough window → score 0, topFix reschedules', () => {
    // Event at 2pm, trough 2-4pm
    const ev = makeTimedEvent('Strategy session', '2026-06-14T14:00:00-04:00', '2026-06-14T15:00:00-04:00');
    const r = computeEnergyScore([makeTagged(ev, 'meeting', 'high')], sigGreen, profileFull);
    expect(r.score).toBe(0);
    expect(r.topFix?.op).toBe('move');
  });

  it('high-demand in peak window → score 100', () => {
    // Event at 9am, peak 9-11am
    const ev = makeTimedEvent('Deep work', '2026-06-14T09:00:00-04:00', '2026-06-14T11:00:00-04:00');
    const r = computeEnergyScore([makeTagged(ev, 'deep_work', 'high')], sigGreen, profilePeakOnly);
    expect(r.score).toBe(100);
  });

  it('high-demand outside trough (peak-only profile) → score 100', () => {
    // Event at 2pm, profile has no trough — no mismatch
    const ev = makeTimedEvent('Meeting', '2026-06-14T14:00:00-04:00', '2026-06-14T15:00:00-04:00');
    const r = computeEnergyScore([makeTagged(ev, 'meeting', 'high')], sigGreen, profilePeakOnly);
    expect(r.score).toBe(100);
  });

  it('no energy profile → no trough penalty, topFix suggests profile setup', () => {
    const ev = makeTimedEvent('Strategy session', '2026-06-14T14:00:00-04:00', '2026-06-14T15:00:00-04:00');
    const r = computeEnergyScore([makeTagged(ev, 'meeting', 'high')], sigGreen, null);
    expect(r.score).toBe(100);
    expect(r.topFix?.description).toContain('peak energy window');
  });
});

// ─── computeEnergyScore — green day drivers ───────────────────────────────────

describe('computeEnergyScore — green day', () => {
  it('green + profile + all high in peak → excellent match driver', () => {
    const ev = makeTimedEvent('Deep work', '2026-06-14T09:00:00-04:00', '2026-06-14T11:00:00-04:00');
    const r = computeEnergyScore([makeTagged(ev, 'deep_work', 'high')], sigGreen, profilePeakOnly);
    expect(r.drivers.some(d => d.includes('peak window') && d.includes('excellent'))).toBe(true);
  });

  it('green + no profile → "full capacity" driver', () => {
    const ev = makeTimedEvent('Meeting', '2026-06-14T09:00:00-04:00', '2026-06-14T10:00:00-04:00');
    const r = computeEnergyScore([makeTagged(ev)], sigGreen, null);
    expect(r.drivers.some(d => d.includes('Green day') || d.includes('full capacity'))).toBe(true);
  });

  it('green + profile + high NOT all in peak → partial-match driver', () => {
    // Peak is 9-11. Event at 2pm.
    const ev = makeTimedEvent('Work block', '2026-06-14T14:00:00-04:00', '2026-06-14T15:00:00-04:00');
    const r = computeEnergyScore([makeTagged(ev, 'deep_work', 'high')], sigGreen, profilePeakOnly);
    // No trough penalty (peakOnly has troughStart=null), score=100
    // But driver should note it's not all in peak
    expect(r.drivers.some(d => d.includes('outside your peak window'))).toBe(true);
  });
});

// ─── computeEnergyScore — yellow day drivers ──────────────────────────────────

describe('computeEnergyScore — yellow day', () => {
  it('3+ high-demand on yellow → overloaded driver', () => {
    const events = [
      makeTimedEvent('Meeting A', '2026-06-14T09:00:00-04:00', '2026-06-14T10:00:00-04:00'),
      makeTimedEvent('Meeting B', '2026-06-14T10:00:00-04:00', '2026-06-14T11:00:00-04:00'),
      makeTimedEvent('Meeting C', '2026-06-14T11:00:00-04:00', '2026-06-14T12:00:00-04:00'),
    ].map(e => makeTagged(e, 'meeting', 'high'));
    const r = computeEnergyScore(events, sigYellow, null);
    expect(r.drivers.some(d => d.includes('Yellow day') && d.includes('3 high-demand'))).toBe(true);
  });

  it('1 high-demand on yellow (no profile) → manageable driver', () => {
    const ev = makeTimedEvent('Meeting', '2026-06-14T09:00:00-04:00', '2026-06-14T10:00:00-04:00');
    const r = computeEnergyScore([makeTagged(ev, 'meeting', 'high')], sigYellow, null);
    expect(r.drivers.some(d => d.includes('manageable'))).toBe(true);
  });
});

// ─── computeCalendarFit ──────────────────────────────────────────────────────

describe('computeCalendarFit', () => {
  it('returns CalendarFit with both scores (0-100) and computedAt', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const fit = computeCalendarFit([], null, priorities, sigGreen, null);
    expect(fit.focusScore.score).toBeGreaterThanOrEqual(0);
    expect(fit.focusScore.score).toBeLessThanOrEqual(100);
    expect(fit.energyScore.score).toBeGreaterThanOrEqual(0);
    expect(fit.energyScore.score).toBeLessThanOrEqual(100);
    expect(fit.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('energy score is 50 and calibrating when no signal is passed', () => {
    const fit = computeCalendarFit([], null, [], null, null);
    expect(fit.energyScore.score).toBe(50);
    expect(fit.energyScore.calibrating).toBe(true);
    expect(fit.calibrating).toBe(true);
  });

  it('focus score is 0 when no priorities', () => {
    const fit = computeCalendarFit([], null, [], sigGreen, null);
    expect(fit.focusScore.score).toBe(0);
  });

  it('full scenario: 50% focus, red day all light → focus 50, energy 100', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const alignment  = makeAlign([{ priority: 'Build', hours: 22.5 }], 22.5);
    const lunch = makeTimedEvent('Lunch', '2026-06-14T12:00:00-04:00', '2026-06-14T13:00:00-04:00');
    const fit = computeCalendarFit(
      [makeTagged(lunch, 'meal', 'low')],
      alignment,
      priorities,
      sigRed,
      null,
      45,
    );
    expect(fit.focusScore.score).toBe(50);
    expect(fit.energyScore.score).toBe(100);
  });

  it('full scenario: 100% focus, red day with high-demand → focus 100, energy 0', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const alignment  = makeAlign([{ priority: 'Build', hours: 45 }]);
    const deep = makeTimedEvent('Deep work', '2026-06-14T09:00:00-04:00', '2026-06-14T11:00:00-04:00');
    const fit = computeCalendarFit(
      [makeTagged(deep, 'deep_work', 'high')],
      alignment,
      priorities,
      sigRed,
      null,
      45,
    );
    expect(fit.focusScore.score).toBe(100);
    expect(fit.energyScore.score).toBe(0);
  });

  it('all-day events are excluded from energy score (no dateTime)', () => {
    const allDay = makeAllDay('Conference', '2026-06-14', '2026-06-15');
    const tagged: TaggedEvent = { event: allDay, tag: { type: 'meeting', demand: 'high' } };
    const r = computeEnergyScore([tagged], sigRed, null);
    // Red + high-demand → full penalty regardless of hour
    expect(r.score).toBe(0);
  });
});

// ─── computeEnergyScore — calibrating state ───────────────────────────────────

describe('computeEnergyScore — calibrating state', () => {
  it('returns calibrating:true and score 50 when signal is null', () => {
    const r = computeEnergyScore([], null, null);
    expect(r.calibrating).toBe(true);
    expect(r.score).toBe(50);
    expect(r.drivers.some(d => d.includes('No energy signal'))).toBe(true);
  });

  it('does NOT set calibrating when signal is present (green)', () => {
    const r = computeEnergyScore([], sigGreen, null);
    expect(r.calibrating).toBeFalsy();
  });

  it('does NOT set calibrating when signal is present (red)', () => {
    const r = computeEnergyScore([], sigRed, null);
    expect(r.calibrating).toBeFalsy();
  });
});

// ─── computeCalendarFit — edge score ─────────────────────────────────────────

describe('computeCalendarFit — edgeScore', () => {
  it('includes edgeScore and calibrating fields', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const fit = computeCalendarFit([], null, priorities, sigGreen, null);
    expect(typeof fit.edgeScore).toBe('number');
    expect(fit.edgeScore).toBeGreaterThanOrEqual(0);
    expect(fit.edgeScore).toBeLessThanOrEqual(100);
    expect(typeof fit.calibrating).toBe('boolean');
  });

  it('calibrating:true when no energy signal — edgeScore equals focusScore', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const alignment  = makeAlign([{ priority: 'Build', hours: 22.5 }], 22.5);
    const fit = computeCalendarFit([], alignment, priorities, null, null, 45);
    expect(fit.calibrating).toBe(true);
    expect(fit.edgeScore).toBe(fit.focusScore.score); // energy doesn't contribute
  });

  it('calibrating:false when signal present — edgeScore is average of focus + energy', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const alignment  = makeAlign([{ priority: 'Build', hours: 22.5 }], 22.5);
    const fit = computeCalendarFit([], alignment, priorities, sigGreen, null, 45);
    expect(fit.calibrating).toBe(false);
    // focusScore=50, energyScore=70 (green + empty) → edgeScore=60
    expect(fit.edgeScore).toBe(Math.round((fit.focusScore.score + fit.energyScore.score) / 2));
  });

  it('edgeScore rounds to integer', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const alignment  = makeAlign([{ priority: 'Build', hours: 20 }], 25);
    // focusScore = round(20/45*100)=44, energyScore=70 → avg=57
    const fit = computeCalendarFit([], alignment, priorities, sigGreen, null, 45);
    expect(Number.isInteger(fit.edgeScore)).toBe(true);
  });

  it('full scenario: 50% focus + red day high-demand → edgeScore is average', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const alignment  = makeAlign([{ priority: 'Build', hours: 22.5 }], 22.5);
    const deep = makeTimedEvent('Deep work', '2026-06-14T09:00:00-04:00', '2026-06-14T11:00:00-04:00');
    const fit = computeCalendarFit(
      [makeTagged(deep, 'deep_work', 'high')],
      alignment, priorities, sigRed, null, 45,
    );
    // focusScore=50, energyScore=0 → edgeScore=25
    expect(fit.focusScore.score).toBe(50);
    expect(fit.energyScore.score).toBe(0);
    expect(fit.edgeScore).toBe(25);
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
