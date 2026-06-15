import { describe, it, expect } from 'vitest';
import type { calendar_v3 } from 'googleapis';
import type { Priority } from './db';
import type { CalendarFit, ScoreResult } from './calendarScore';
import { findFreeSlot, buildCalendarPlan } from './calendarPlan';

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

  it('creates a move action when energyScore.topFix.op === move and worstMismatchEventId set', () => {
    const fit = makeFit({
      energyTopFix: { description: 'Move "Deep work sprint" to your next green day.', op: 'move' },
      worstId:    'evt-deep-work',
      worstTitle: 'Deep work sprint',
    });
    const plan = buildCalendarPlan([], fit, PRIORITIES, DATE, TZ);
    expect(plan.actions).toHaveLength(1);
    const a = plan.actions[0];
    expect(a.type).toBe('move');
    expect(a.addresses).toBe('energy');
    expect(a.eventId).toBe('evt-deep-work');
    expect(a.eventTitle).toBe('Deep work sprint');
    expect(a.newDate).toBe('2026-06-16');
  });

  it('omits move action when worstMismatchEventId is null even if topFix op === move', () => {
    const fit = makeFit({
      energyTopFix: { description: 'Move high-demand event.', op: 'move' },
      worstId: null,
    });
    const plan = buildCalendarPlan([], fit, PRIORITIES, DATE, TZ);
    expect(plan.actions).toHaveLength(0);
  });

  it('combines focus create + energy move into a two-action plan', () => {
    const fit = makeFit({
      focusTopFix:  { description: 'Block time for "Fundraising"', op: 'create' },
      energyTopFix: { description: 'Move "Deep work sprint"',      op: 'move'   },
      worstId:    'evt-dws',
      worstTitle: 'Deep work sprint',
      edgeScore:  55,
    });
    const plan = buildCalendarPlan([], fit, PRIORITIES, DATE, TZ);
    expect(plan.actions).toHaveLength(2);
    expect(plan.actions[0].type).toBe('create');
    expect(plan.actions[1].type).toBe('move');
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
