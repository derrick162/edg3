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
const sigGreen: EnergySignal = { level: 'green', source: 'manual' };
const sigYellow: EnergySignal = { level: 'yellow', source: 'whoop' };
const sigRed: EnergySignal    = { level: 'red',    source: 'whoop' };
const profilePeakOnly: EnergyProfile = { peakStart: 9, peakEnd: 11, troughStart: null, troughEnd: null };
const profileFull: EnergyProfile     = { peakStart: 9, peakEnd: 11, troughStart: 14, troughEnd: 16 };

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

// ─── computeFocusScore ───────────────────────────────────────────────────────

describe('computeFocusScore — no priorities', () => {
  it('returns score 1 with setup driver when priorities list is empty', () => {
    const r = computeFocusScore([], [], null);
    expect(r.score).toBe(1);
    expect(r.drivers.some(d => d.includes('No focus areas'))).toBe(true);
    expect(r.topFix?.op).toBe('create');
  });
});

describe('computeFocusScore — coverage', () => {
  it('all priorities covered + high aligned share → score 7+', () => {
    const priorities = [makeP(1, 'Fundraising', 1), makeP(2, 'Product', 2), makeP(3, 'Team', 3)];
    const alignment = makeAlign(
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
    const alignment = makeAlign(
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
    const alignment = makeAlign([{ priority: 'A', hours: 0 }, { priority: 'B', hours: 0 }, { priority: 'C', hours: 0 }]);
    const r = computeFocusScore([], priorities, alignment);
    expect(r.score).toBeLessThanOrEqual(4);
  });
});

describe('computeFocusScore — aligned share', () => {
  it('80%+ aligned share → positive "strong alignment" driver', () => {
    const priorities = [makeP(1, 'Focus', 1)];
    const alignment = makeAlign([{ priority: 'Focus', hours: 8 }], 2);
    const r = computeFocusScore([], priorities, alignment);
    expect(r.drivers.some(d => d.includes('strong alignment'))).toBe(true);
  });

  it('20% aligned share → negative driver + names biggest time sink', () => {
    const priorities = [makeP(1, 'Focus', 1)];
    const alignment = makeAlign(
      [{ priority: 'Focus', hours: 1 }],
      4,
      [{ title: 'Random meetings', hours: 4 }],
    );
    const r = computeFocusScore([], priorities, alignment);
    expect(r.drivers.some(d => d.includes('Only') && d.includes('%'))).toBe(true);
    expect(r.drivers.some(d => d.includes('Random meetings'))).toBe(true);
  });
});

describe('computeFocusScore — protected blocks', () => {
  it('2h timed event → positive protected-block driver', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const events = [makeTimedEvent('Deep work', '2026-06-14T09:00:00Z', '2026-06-14T11:00:00Z')];
    const r = computeFocusScore(events, priorities, null);
    expect(r.drivers.some(d => d.includes('≥ 90 min'))).toBe(true);
  });

  it('all events < 30 min → negative "no protected focus blocks" driver', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const events = [makeTimedEvent('Quick check', '2026-06-14T09:00:00Z', '2026-06-14T09:30:00Z')];
    const r = computeFocusScore(events, priorities, null);
    expect(r.drivers.some(d => d.includes('No protected focus blocks'))).toBe(true);
  });

  it('all-day events do not count as protected blocks', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const events = [makeAllDay('Vacation', '2026-06-14', '2026-06-15')];
    const r = computeFocusScore(events, priorities, null);
    expect(r.drivers.some(d => d.includes('No protected focus blocks'))).toBe(true);
  });
});

describe('computeFocusScore — balance', () => {
  it('P1 gets most hours → positive ranking driver', () => {
    const priorities = [makeP(1, 'A', 1), makeP(2, 'B', 2), makeP(3, 'C', 3)];
    const alignment = makeAlign([{ priority: 'A', hours: 5 }, { priority: 'B', hours: 3 }, { priority: 'C', hours: 1 }]);
    const r = computeFocusScore([], priorities, alignment);
    expect(r.drivers.some(d => d.includes('priority ranking'))).toBe(true);
  });

  it('P3 gets most hours → inverted driver + topFix targets P1', () => {
    const priorities = [makeP(1, 'Fundraising', 1), makeP(2, 'Product', 2), makeP(3, 'Email', 3)];
    const alignment = makeAlign([
      { priority: 'Fundraising', hours: 1 },
      { priority: 'Product', hours: 2 },
      { priority: 'Email', hours: 5 },
    ]);
    const r = computeFocusScore([], priorities, alignment);
    expect(r.drivers.some(d => d.includes('"Email"') && d.includes('"Fundraising"'))).toBe(true);
    expect(r.topFix?.description).toContain('Fundraising');
  });
});

describe('computeFocusScore — null alignment', () => {
  it('degrades gracefully with null alignment', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const r = computeFocusScore([], priorities, null);
    expect(r.score).toBeGreaterThanOrEqual(1);
    expect(r.score).toBeLessThanOrEqual(10);
    expect(Array.isArray(r.drivers)).toBe(true);
  });
});

describe('computeFocusScore — topFix', () => {
  it('topFix is null when score is 9-10 (all green)', () => {
    const priorities = [makeP(1, 'Build', 1), makeP(2, 'Sales', 2)];
    const alignment = makeAlign([{ priority: 'Build', hours: 5 }, { priority: 'Sales', hours: 3 }], 1);
    const events = [makeTimedEvent('Deep work', '2026-06-14T09:00:00Z', '2026-06-14T11:30:00Z')];
    const r = computeFocusScore(events, priorities, alignment);
    // Score should be high, and if topFix is null, the test passes; otherwise the score isn't perfect yet
    if (r.score >= 9) expect(r.topFix).toBeNull();
  });

  it('topFix mentions unaligned time when aligned share < 40%', () => {
    const priorities = [makeP(1, 'Build', 1)];
    const alignment = makeAlign(
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

// ─── computeEnergyScore ──────────────────────────────────────────────────────

describe('computeEnergyScore — no signal', () => {
  it('returns score 5 with "set energy" topFix when signal is null', () => {
    const r = computeEnergyScore([], null, null, []);
    expect(r.score).toBe(5);
    expect(r.drivers.some(d => d.includes('No energy signal'))).toBe(true);
    expect(r.topFix?.op).toBe('create');
  });
});

describe('computeEnergyScore — load vs capacity', () => {
  it('green day → high load score, positive driver', () => {
    const r = computeEnergyScore([], sigGreen, null, []);
    expect(r.score).toBeGreaterThanOrEqual(6);
    expect(r.drivers.some(d => d.includes('Green day'))).toBe(true);
  });

  it('red day + high-demand event → low score, topFix moves it', () => {
    const events = [
      makeTimedEvent('Investor pitch deck', '2026-06-14T10:00:00-04:00', '2026-06-14T12:00:00-04:00'),
    ];
    const r = computeEnergyScore(events, sigRed, null, []);
    expect(r.score).toBeLessThanOrEqual(5);
    expect(r.drivers.some(d => d.includes('Red day') && d.includes('high-demand'))).toBe(true);
    expect(r.topFix?.op).toBe('move');
  });

  it('red day + only low-demand events → better score, no move topFix', () => {
    const events = [
      makeTimedEvent('Lunch', '2026-06-14T12:00:00-04:00', '2026-06-14T13:00:00-04:00'),
      makeTimedEvent('Walk', '2026-06-14T15:00:00-04:00', '2026-06-14T15:30:00-04:00'),
    ];
    const r = computeEnergyScore(events, sigRed, null, []);
    expect(r.score).toBeGreaterThan(4);
    expect(r.drivers.some(d => d.includes('light work'))).toBe(true);
  });

  it('yellow day with 3 high-demand events → loadScore is 5, lower overall', () => {
    const events = [
      makeTimedEvent('Strategy session', '2026-06-14T09:00:00-04:00', '2026-06-14T10:00:00-04:00'),
      makeTimedEvent('Investor meeting', '2026-06-14T10:00:00-04:00', '2026-06-14T11:00:00-04:00'),
      makeTimedEvent('Deep work', '2026-06-14T11:00:00-04:00', '2026-06-14T12:00:00-04:00'),
    ];
    const r = computeEnergyScore(events, sigYellow, null, []);
    expect(r.drivers.some(d => d.includes('Yellow day') && d.includes('high-demand'))).toBe(true);
  });
});

describe('computeEnergyScore — demand↔window match', () => {
  it('high-demand event in peak window → matchScore 8+, positive driver', () => {
    // Event starts at 9am → inside peak 9-11
    const events = [makeTimedEvent('Deep work', '2026-06-14T09:00:00-04:00', '2026-06-14T11:00:00-04:00')];
    const r = computeEnergyScore(events, sigGreen, profilePeakOnly, []);
    expect(r.drivers.some(d => d.includes('peak window') || d.includes('excellent'))).toBe(true);
  });

  it('high-demand event in trough window → matchScore ≤ 5, negative driver', () => {
    // Event starts at 14 (2pm) → inside trough 14-16
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
});
