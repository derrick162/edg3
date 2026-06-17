import { describe, it, expect } from 'vitest';
import type { calendar_v3 } from 'googleapis';
import type { Priority } from './db';
import type { CalendarFit, ScoreResult } from './calendarScore';
import type { AlignmentResult } from './alignment';
import type { WhoopRecoveryDay } from './whoop';
import { findFreeSlot, buildCalendarPlan, buildDiagnoses, findHeaviestDeferrableEvent, patchAlignmentForPlan, findFirstTightGap } from './calendarPlan';

// ─── Factories ───────────────────────────────────────────────────────────────

const TZ = 'America/Toronto'; // UTC-4 in summer; events below use -04:00 offset.

function timedEvent(title: string, startH: number, endH: number, id?: string): calendar_v3.Schema$Event {
  const pad = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}:00`;
  return {
    id: id ?? `evt-${title.toLowerCase().replace(/\s/g, '-')}`,
    summary: title,
    start: { dateTime: `2026-06-15T${pad(startH)}-04:00` },
    end:   { dateTime: `2026-06-15T${pad(endH)}-04:00` },
  };
}

function allDayEvent(title: string): calendar_v3.Schema$Event {
  return { id: `all-${title}`, summary: title, start: { date: '2026-06-15' }, end: { date: '2026-06-16' } };
}

function makeP(text: string, rank = 1): Priority {
  return { id: rank, user_id: 1, text, rank, week_of: '2026-06-15', created_at: '2026-06-15T00:00:00', energy_cost: undefined };
}

function scoreResult(opts: Partial<ScoreResult> = {}): ScoreResult {
  return {
    score: 80,
    drivers: [],
    topFix: null,
    ...opts,
  };
}

function makeFit(opts: { focusTopFix?: ScoreResult['topFix']; energyTopFix?: ScoreResult['topFix']; worstId?: string | null; worstTitle?: string | null; edgeScore?: number } = {}): CalendarFit {
  return {
    edgeScore:    opts.edgeScore ?? 65,
    calibrating:  false,
    focusScore:   scoreResult({ topFix: opts.focusTopFix ?? null }),
    energyScore:  scoreResult({
      topFix: opts.energyTopFix ?? null,
      worstMismatchEventId:    opts.worstId    ?? null,
      worstMismatchEventTitle: opts.worstTitle ?? null,
    }),
    computedAt: '2026-06-15T08:00:00.000Z',
  };
}

// ─── findFreeSlot ────────────────────────────────────────────────────────────

describe('findFreeSlot', () => {
  it('returns the start of the workday when there are no events', () => {
    const slot = findFreeSlot([], '2026-06-15', 1.5, TZ);
    expect(slot).not.toBeNull();
    expect(slot!.startDateTime).toBe('2026-06-15T09:00:00');
    expect(slot!.endDateTime).toBe('2026-06-15T10:30:00');
  });

  it('skips past an early morning event and finds the first gap', () => {
    const events = [timedEvent('Standup', 9, 9.5)];
    const slot = findFreeSlot(events, '2026-06-15', 1.5, TZ);
    expect(slot!.startDateTime).toBe('2026-06-15T09:30:00');
    expect(slot!.endDateTime).toBe('2026-06-15T11:00:00');
  });

  it('finds a gap between two events', () => {
    const events = [
      timedEvent('Morning sync',     9, 10),
      timedEvent('Client call',     12, 13),
    ];
    // Gap from 10–12 = 2h, plenty for 1.5h slot
    const slot = findFreeSlot(events, '2026-06-15', 1.5, TZ);
    expect(slot!.startDateTime).toBe('2026-06-15T10:00:00');
    expect(slot!.endDateTime).toBe('2026-06-15T11:30:00');
  });

  it('finds slot after all events if there is enough time', () => {
    const events = [timedEvent('All-morning', 9, 16)];
    const slot = findFreeSlot(events, '2026-06-15', 1.5, TZ);
    expect(slot!.startDateTime).toBe('2026-06-15T16:00:00');
    expect(slot!.endDateTime).toBe('2026-06-15T17:30:00');
  });

  it('returns null when the calendar is fully packed', () => {
    const events = [timedEvent('All day block', 9, 18)];
    const slot = findFreeSlot(events, '2026-06-15', 1.5, TZ);
    expect(slot).toBeNull();
  });

  it('returns null when only tiny gaps exist (< durationHours)', () => {
    const events = [
      timedEvent('Block A', 9, 10),
      timedEvent('Block B', 10.25, 18), // only 15-min gap
    ];
    const slot = findFreeSlot(events, '2026-06-15', 1.5, TZ);
    expect(slot).toBeNull();
  });

  it('respects custom workStartHour and workEndHour', () => {
    const slot = findFreeSlot([], '2026-06-15', 1, TZ, 7, 9);
    expect(slot!.startDateTime).toBe('2026-06-15T07:00:00');
    expect(slot!.endDateTime).toBe('2026-06-15T08:00:00');
  });

  it('ignores all-day events (they have no dateTime)', () => {
    const events = [allDayEvent('Birthday'), timedEvent('Meeting', 10, 11)];
    const slot = findFreeSlot(events, '2026-06-15', 1, TZ);
    expect(slot!.startDateTime).toBe('2026-06-15T09:00:00');
  });
});

// ─── buildCalendarPlan ────────────────────────────────────────────────────────

describe('buildCalendarPlan', () => {
  const DATE = '2026-06-15';
  const PRIORITIES = [makeP('Fundraising'), makeP('Product roadmap', 2)];

  it('returns empty plan with score summary when no topFix on either score', () => {
    const fit = makeFit({ edgeScore: 85 });
    const plan = buildCalendarPlan([], fit, PRIORITIES, DATE, TZ);
    expect(plan.actions).toHaveLength(0);
    expect(plan.summary).toContain('85');
    expect(plan.summary).toContain('Nothing to reshape');
  });

  it('creates a focus block when focusScore.topFix.op === create', () => {
    const fit = makeFit({
      focusTopFix: { description: 'Block time for "Fundraising" — it has zero hours this week.', op: 'create' },
    });
    const plan = buildCalendarPlan([], fit, PRIORITIES, DATE, TZ);
    expect(plan.actions).toHaveLength(1);
    const a = plan.actions[0];
    expect(a.type).toBe('create');
    expect(a.addresses).toBe('focus');
    expect(a.title).toContain('Fundraising');
    expect(a.startDateTime).toBe('2026-06-15T09:00:00');
    expect(a.endDateTime).toBe('2026-06-15T10:30:00');
    expect(plan.summary).toContain('Fundraising');
  });

  it('uses priorities[0] as fallback name when topFix description has no quoted name', () => {
    const fit = makeFit({
      focusTopFix: { description: 'Add more time for focus work.', op: 'create' },
    });
    const plan = buildCalendarPlan([], fit, [makeP('Product roadmap')], DATE, TZ);
    const a = plan.actions[0];
    expect(a.title).toContain('Product roadmap');
  });

  it('skips create action when no free slot exists', () => {
    const fit = makeFit({
      focusTopFix: { description: 'Block time for "Fundraising"', op: 'create' },
    });
    const packed = [timedEvent('Block all day', 9, 18)];
    const plan = buildCalendarPlan(packed, fit, PRIORITIES, DATE, TZ);
    // No slot → no create action → empty plan
    expect(plan.actions).toHaveLength(0);
  });

  it('does NOT fire a move from energyScore.worstMismatchEventId (that path is intentionally dead — use recovery-based move instead)', () => {
    const fit = makeFit({
      energyTopFix: { description: 'Move "Deep work sprint" to your next green day.', op: 'move' },
      worstId:    'evt-deep-work',
      worstTitle: 'Deep work sprint',
    });
    // Without recoveryHistory ≤33, no move action should fire even with worstMismatchEventId set
    const plan = buildCalendarPlan([], fit, PRIORITIES, DATE, TZ);
    expect(plan.actions.every(a => a.eventId !== 'evt-deep-work')).toBe(true);
  });

  it('combines focus create + recovery move into a two-action plan', () => {
    const focusEvents = [timedEvent('Client call', 14, 16, 'evt-client')];
    const fit = makeFit({
      focusTopFix: { description: 'Block time for "Fundraising"', op: 'create' },
      edgeScore:   55,
    });
    const recoveryHistory = [recovDay('2026-06-15', 20)]; // low recovery → triggers move
    const plan = buildCalendarPlan(focusEvents, fit, PRIORITIES, DATE, TZ, null, recoveryHistory);
    expect(plan.actions).toHaveLength(2);
    expect(plan.actions[0].type).toBe('create');
    expect(plan.actions[1].type).toBe('move');
    expect(plan.actions[1].addresses).toBe('energy');
    expect(plan.summary).toContain('2 moves');
    expect(plan.summary).toContain('55');
  });

  it('single-action summary uses singular wording', () => {
    const fit = makeFit({
      focusTopFix: { description: 'Block time for "Fundraising"', op: 'create' },
    });
    const plan = buildCalendarPlan([], fit, PRIORITIES, DATE, TZ);
    expect(plan.summary).toMatch(/one move/i);
  });

  it('generatedAt is a valid ISO string', () => {
    const fit = makeFit();
    const plan = buildCalendarPlan([], fit, PRIORITIES, DATE, TZ);
    expect(() => new Date(plan.generatedAt)).not.toThrow();
    expect(new Date(plan.generatedAt).toISOString()).toBe(plan.generatedAt);
  });
});

// ─── buildDiagnoses ───────────────────────────────────────────────────────────

function makeAlignment(perPriority: { priority: string; hours: number }[]): AlignmentResult {
  return {
    perPriority: perPriority.map(p => ({ ...p, blocked: p.hours > 0 })),
    unalignedHours: 0,
    routineHours: 0,
    topUnaligned: [],
  };
}

function recovDay(date: string, score: number): WhoopRecoveryDay {
  return { date, recoveryScore: score };
}

describe('buildDiagnoses', () => {
  it('returns empty array when alignment is null and no events or recovery', () => {
    const result = buildDiagnoses(null, [], [], TZ);
    expect(result).toEqual([]);
  });

  it('surfaces a zero-hour priority', () => {
    const alignment = makeAlignment([
      { priority: 'Fundraising', hours: 0 },
      { priority: 'Product', hours: 3 },
    ]);
    const result = buildDiagnoses(alignment, [], [], TZ);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('Fundraising');
    expect(result[0]).toContain('No time blocked');
  });

  it('surfaces hygiene flag from back-to-back meetings', () => {
    // 3 meetings with < 15 min gap each
    const events = [
      timedEvent('Meeting A', 9, 10),
      timedEvent('Meeting B', 10.1, 11),
      timedEvent('Meeting C', 11.1, 12),
    ];
    const result = buildDiagnoses(null, events, [], TZ);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/back-to-back/i);
  });

  it('surfaces low recovery when score ≤ 33', () => {
    const result = buildDiagnoses(null, [], [recovDay('2026-06-15', 28)], TZ);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('28%');
    expect(result[0]).toMatch(/recovery/i);
  });

  it('does NOT surface recovery when score > 33', () => {
    const result = buildDiagnoses(null, [], [recovDay('2026-06-15', 50)], TZ);
    expect(result).toHaveLength(0);
  });

  it('picks the most recent recovery day when multiple exist', () => {
    const history = [
      recovDay('2026-06-14', 25), // older — low
      recovDay('2026-06-15', 70), // newest — fine
    ];
    const result = buildDiagnoses(null, [], history, TZ);
    expect(result).toHaveLength(0);
  });

  it('combines zero-hour priority + hygiene flag — caps at 3', () => {
    const alignment = makeAlignment([
      { priority: 'Fundraising', hours: 0 },
    ]);
    const events = [
      timedEvent('Meeting A', 9, 10),
      timedEvent('Meeting B', 10.1, 11),
      timedEvent('Meeting C', 11.1, 12),
    ];
    const recovery = [recovDay('2026-06-15', 20)];
    const result = buildDiagnoses(alignment, events, recovery, TZ);
    expect(result.length).toBeLessThanOrEqual(3);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('only picks the first zero-hour priority (rank order)', () => {
    const alignment = makeAlignment([
      { priority: 'Fundraising', hours: 0 },
      { priority: 'Product', hours: 0 },
    ]);
    const result = buildDiagnoses(alignment, [], [], TZ);
    // Only one zero-priority diagnosis (the first one)
    expect(result.filter(d => d.includes('No time blocked'))).toHaveLength(1);
    expect(result[0]).toContain('Fundraising');
  });
});

// ─── findHeaviestDeferrableEvent ─────────────────────────────────────────────

describe('findHeaviestDeferrableEvent', () => {
  it('returns null for empty list', () => {
    expect(findHeaviestDeferrableEvent([])).toBeNull();
  });

  it('returns the longest timed event', () => {
    const events = [
      timedEvent('Short meeting', 9, 10),
      timedEvent('Long deep work', 10, 13),
    ];
    const result = findHeaviestDeferrableEvent(events);
    expect(result?.summary).toBe('Long deep work');
  });

  it('skips all-day events', () => {
    const events = [allDayEvent('Conference'), timedEvent('Call', 9, 10)];
    const result = findHeaviestDeferrableEvent(events);
    expect(result?.summary).toBe('Call');
  });

  it('skips routine events (gym, lunch, etc.)', () => {
    const events = [
      timedEvent('Gym', 7, 8),
      timedEvent('Lunch', 12, 13),
      timedEvent('Client call', 14, 15),
    ];
    const result = findHeaviestDeferrableEvent(events);
    expect(result?.summary).toBe('Client call');
  });

  it('returns null when only routine events exist', () => {
    const events = [timedEvent('Gym', 7, 8), timedEvent('Breakfast', 8, 9)];
    expect(findHeaviestDeferrableEvent(events)).toBeNull();
  });
});

// ─── patchAlignmentForPlan ───────────────────────────────────────────────────

describe('patchAlignmentForPlan', () => {
  it('adds hours to matched priority for create action', () => {
    const alignment = makeAlignment([{ priority: 'Fundraising', hours: 0 }]);
    const action: import('./calendarPlan').PlanAction = {
      type: 'create',
      description: 'Block 90 minutes for Fundraising',
      addresses: 'focus',
      title: 'Focus — Fundraising',
      startDateTime: '2026-06-15T09:00:00',
      endDateTime:   '2026-06-15T10:30:00',
    };
    const patched = patchAlignmentForPlan(alignment, [action]);
    expect(patched.perPriority[0].hours).toBeCloseTo(1.5, 1);
    expect(patched.perPriority[0].blocked).toBe(true);
  });

  it('removes event from topUnaligned for move action', () => {
    const alignment: AlignmentResult = {
      perPriority: [{ priority: 'Fundraising', hours: 2, blocked: true }],
      unalignedHours: 3,
      routineHours: 0,
      topUnaligned: [{ title: 'Team sync', hours: 3 }],
    };
    const action: import('./calendarPlan').PlanAction = {
      type: 'move',
      description: 'Move Team sync to tomorrow',
      addresses: 'focus',
      eventId: 'evt-1',
      eventTitle: 'Team sync',
      newDate: '2026-06-16',
    };
    const patched = patchAlignmentForPlan(alignment, [action]);
    expect(patched.topUnaligned).toHaveLength(0);
    expect(patched.unalignedHours).toBe(0);
  });

  it('does not mutate the original alignment', () => {
    const alignment = makeAlignment([{ priority: 'Fundraising', hours: 0 }]);
    const action: import('./calendarPlan').PlanAction = {
      type: 'create', description: '', addresses: 'focus',
      title: 'Focus — Fundraising',
      startDateTime: '2026-06-15T09:00:00', endDateTime: '2026-06-15T10:30:00',
    };
    patchAlignmentForPlan(alignment, [action]);
    expect(alignment.perPriority[0].hours).toBe(0); // original unchanged
  });
});

// ─── buildCalendarPlan — new H1 branches ────────────────────────────────────

describe('buildCalendarPlan — H1 new action sources', () => {
  const DATE = '2026-06-15';
  const PRIORITIES = [makeP('Fundraising'), makeP('Product roadmap', 2)];

  it('creates a focus block from hygiene flag when focusScore has no topFix', () => {
    // 3 back-to-back meetings → hygiene flag fires → focus block + buffer
    const events = [
      timedEvent('Meeting A', 9, 10),
      timedEvent('Meeting B', 10.1, 11),
      timedEvent('Meeting C', 11.1, 12),
    ];
    const fit = makeFit({ edgeScore: 75 }); // no topFix
    const plan = buildCalendarPlan(events, fit, PRIORITIES, DATE, TZ);
    const focusAction = plan.actions.find(a => a.type === 'create' && a.title?.includes('Focus'));
    expect(focusAction).toBeDefined();
    expect(focusAction!.description).toMatch(/Fundraising/);
    expect(focusAction!.description).toMatch(/deep-work time/i);
  });

  it('creates a recovery move when recovery ≤ 33 and deferrable events exist', () => {
    const events = [timedEvent('Client call', 10, 12)];
    const fit = makeFit({ edgeScore: 70 });
    const recoveryHistory = [recovDay('2026-06-15', 25)];
    const plan = buildCalendarPlan(events, fit, PRIORITIES, DATE, TZ, null, recoveryHistory);
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0].type).toBe('move');
    expect(plan.actions[0].addresses).toBe('energy');
    expect(plan.actions[0].description).toContain('25%');
    expect(plan.actions[0].eventTitle).toBe('Client call');
    expect(plan.actions[0].newDate).toBe('2026-06-16');
  });

  it('does NOT create a recovery move when recovery > 33', () => {
    const events = [timedEvent('Client call', 10, 12)];
    const fit = makeFit({ edgeScore: 70 });
    const recoveryHistory = [recovDay('2026-06-15', 50)];
    const plan = buildCalendarPlan(events, fit, PRIORITIES, DATE, TZ, null, recoveryHistory);
    expect(plan.actions).toHaveLength(0);
  });

  it('moves biggest unaligned sink when it matches a today event', () => {
    const events = [timedEvent('Team sync', 9, 12)]; // 3h unaligned event
    const alignment = makeAlignment([{ priority: 'Fundraising', hours: 2 }]);
    alignment.topUnaligned = [{ title: 'Team sync', hours: 3 }];
    alignment.unalignedHours = 3;
    const fit = makeFit({ edgeScore: 70 });
    const plan = buildCalendarPlan(events, fit, PRIORITIES, DATE, TZ, alignment);
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0].type).toBe('move');
    expect(plan.actions[0].addresses).toBe('focus');
    expect(plan.actions[0].description).toContain('Team sync');
    expect(plan.actions[0].newDate).toBe('2026-06-16');
  });

  it('does not add alignment gap move when unaligned sink < 1h', () => {
    const events = [timedEvent('Quick chat', 9, 9.5)]; // 0.5h
    const alignment = makeAlignment([{ priority: 'Fundraising', hours: 2 }]);
    alignment.topUnaligned = [{ title: 'Quick chat', hours: 0.5 }];
    alignment.unalignedHours = 0.5;
    const fit = makeFit({ edgeScore: 70 });
    const plan = buildCalendarPlan(events, fit, PRIORITIES, DATE, TZ, alignment);
    expect(plan.actions).toHaveLength(0);
  });

  it('combines focus block + recovery move (two-action plan)', () => {
    const events = [
      timedEvent('Meeting A', 9, 10),
      timedEvent('Meeting B', 10.1, 11),
      timedEvent('Meeting C', 11.1, 12),
      timedEvent('Client call', 14, 16, 'evt-client'),
    ];
    const fit = makeFit({ edgeScore: 60 });
    const recoveryHistory = [recovDay('2026-06-15', 20)];
    const plan = buildCalendarPlan(events, fit, PRIORITIES, DATE, TZ, null, recoveryHistory);
    expect(plan.actions.length).toBeGreaterThanOrEqual(2);
    expect(plan.actions.some(a => a.type === 'create')).toBe(true);
    expect(plan.actions.some(a => a.type === 'move' && a.addresses === 'energy')).toBe(true);
  });

  // ── Path C: open loops ──────────────────────────────────────────────────────
  it('creates a 60-min focus block when open loops are due today and no other path fires', () => {
    const fit = makeFit({ edgeScore: 80 }); // no topFix, no hygiene flag
    const plan = buildCalendarPlan([], fit, PRIORITIES, DATE, TZ, null, undefined, ['Reply to Ansi', 'Send pitch deck']);
    expect(plan.actions).toHaveLength(1);
    const a = plan.actions[0];
    expect(a.type).toBe('create');
    expect(a.addresses).toBe('focus');
    expect(a.title).toBe('Commitments — clear open loops');
    expect(a.description).toContain('2 open commitments');
    expect(a.reason).toContain('2 commitment');
  });

  it('Path C: singular wording when exactly 1 open loop', () => {
    const fit = makeFit({ edgeScore: 80 });
    const plan = buildCalendarPlan([], fit, PRIORITIES, DATE, TZ, null, undefined, ['Reply to Ansi']);
    const a = plan.actions[0];
    expect(a.description).toContain('1 open commitment due today');
    expect(a.reason).toContain('1 commitment due today');
  });

  it('Path C: does not fire when hygiene flag path already produced a block', () => {
    // Hygiene flag fires first (3 back-to-back meetings) → Path C skipped
    const events = [
      timedEvent('Meeting A', 9, 10),
      timedEvent('Meeting B', 10.1, 11),
      timedEvent('Meeting C', 11.1, 12),
    ];
    const fit = makeFit({ edgeScore: 80 });
    const plan = buildCalendarPlan(events, fit, PRIORITIES, DATE, TZ, null, undefined, ['Reply to Ansi']);
    // No open-loops block should appear — hygiene path ran instead
    expect(plan.actions.every(a => a.title !== 'Commitments — clear open loops')).toBe(true);
    // The focus block from hygiene IS there
    expect(plan.actions.some(a => a.type === 'create' && a.title?.includes('Focus'))).toBe(true);
  });

  it('Path C: does not fire when openLoopsDueToday is empty', () => {
    const fit = makeFit({ edgeScore: 80 });
    const plan = buildCalendarPlan([], fit, PRIORITIES, DATE, TZ, null, undefined, []);
    expect(plan.actions).toHaveLength(0);
  });
});

// ─── findFirstTightGap ───────────────────────────────────────────────────────

describe('findFirstTightGap', () => {
  const DATE = '2026-06-15';

  it('returns null when no events', () => {
    expect(findFirstTightGap([], DATE, TZ)).toBeNull();
  });

  it('returns null when no gap is tight (gap ≥ 15 min)', () => {
    const events = [
      timedEvent('Meeting A', 9, 10),
      timedEvent('Meeting B', 10.5, 11.5), // 30-min gap — not tight
    ];
    expect(findFirstTightGap(events, DATE, TZ)).toBeNull();
  });

  it('returns null when events are butted end-to-end with 0-min gap', () => {
    const events = [
      timedEvent('Meeting A', 9, 10),
      timedEvent('Meeting B', 10, 11), // exactly 0 gap
    ];
    expect(findFirstTightGap(events, DATE, TZ)).toBeNull();
  });

  it('returns the tight gap (5-min) between two meetings', () => {
    const events = [
      timedEvent('Standup', 9, 10),
      timedEvent('Client call', 10 + 5/60, 11 + 5/60), // 5-min gap
    ];
    const result = findFirstTightGap(events, DATE, TZ);
    expect(result).not.toBeNull();
    expect(result!.beforeTitle).toBe('Standup');
    expect(result!.afterTitle).toBe('Client call');
    expect(result!.startDateTime).toContain('10:00');
    expect(result!.endDateTime).toContain('10:05');
  });

  it('returns the first tight gap when multiple exist', () => {
    const events = [
      timedEvent('A', 9, 10),
      timedEvent('B', 10 + 5/60, 11 + 5/60),  // tight gap after A
      timedEvent('C', 11 + 10/60, 12 + 10/60), // tight gap after B
    ];
    const result = findFirstTightGap(events, DATE, TZ);
    expect(result!.beforeTitle).toBe('A');
    expect(result!.afterTitle).toBe('B');
  });

  it('ignores all-day events', () => {
    const events = [
      allDayEvent('Conference'),
      timedEvent('Meeting A', 9, 10),
      timedEvent('Meeting B', 10.5, 11.5),
    ];
    expect(findFirstTightGap(events, DATE, TZ)).toBeNull();
  });
});

// ─── buildCalendarPlan — buffer action ───────────────────────────────────────

describe('buildCalendarPlan — buffer action (Action 4)', () => {
  const DATE = '2026-06-15';
  const PRIORITIES = [makeP('Fundraising')];

  it('adds a buffer when a tight gap exists and no focus block was created', () => {
    // No topFix, no hygiene flag, no recovery, no open loops — but a tight gap
    const events = [
      timedEvent('Standup', 9, 10),
      timedEvent('Client call', 10 + 5/60, 11 + 5/60), // 5-min gap
    ];
    const fit = makeFit({ edgeScore: 80 });
    const plan = buildCalendarPlan(events, fit, PRIORITIES, DATE, TZ);
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0].type).toBe('create');
    expect(plan.actions[0].reason).toContain('Back-to-back meetings');
    expect(plan.actions[0].title).toBe('Buffer');
  });

  it('does not add buffer when there are already 3 actions', () => {
    // Set up 3 actions first (topFix create + recovery move + alignment move)
    const events = [
      timedEvent('Client call', 14, 16, 'evt-client'),
      timedEvent('Team sync', 10, 12, 'evt-sync'),
      // tight gap somewhere
      timedEvent('Standup', 9, 10),
    ];
    const alignment = makeAlignment([{ priority: 'Fundraising', hours: 0 }]);
    alignment.topUnaligned = [{ title: 'Team sync', hours: 2 }];
    alignment.unalignedHours = 2;
    const fit = makeFit({
      edgeScore: 50,
      focusTopFix: { description: 'Block time for "Fundraising"', op: 'create' },
    });
    const recoveryHistory = [recovDay(DATE, 20)];
    const plan = buildCalendarPlan(events, fit, PRIORITIES, DATE, TZ, alignment, recoveryHistory);
    expect(plan.actions.length).toBeLessThanOrEqual(3);
  });
});
