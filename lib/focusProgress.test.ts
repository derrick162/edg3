import { describe, it, expect } from 'vitest';
import type { Priority, FocusMilestone } from './db';
import type { AlignmentResult } from './alignment';
import { buildFocusProgress, formatFocusScoreboardForBriefing } from './focusProgress';

const makeP = (id: number, text: string): Priority => ({
  id, user_id: 1, text, week_of: '2026-06-08', rank: id, created_at: '2026-06-14T00:00:00',
});

const makeM = (id: number, priorityId: number, text: string, done = 0): FocusMilestone => ({
  id, user_id: 1, priority_id: priorityId, text, done, done_at: done ? '2026-06-14T10:00:00' : null,
  created_at: '2026-06-14T00:00:00',
});

const makeAlignment = (entries: { priority: string; hours: number }[]): AlignmentResult => ({
  perPriority: entries.map(e => ({ priority: e.priority, hours: e.hours, blocked: e.hours > 0 })),
  unalignedHours: 0,
  topUnaligned: [],
});

describe('buildFocusProgress', () => {
  it('returns empty array for empty priorities', () => {
    expect(buildFocusProgress([], null, [])).toEqual([]);
  });

  it('maps hours from alignment by priority text (case-insensitive trim)', () => {
    const priorities = [makeP(1, 'Fundraising')];
    const alignment = makeAlignment([{ priority: ' fundraising ', hours: 3.5 }]);
    const result = buildFocusProgress(priorities, alignment, []);
    expect(result[0].hoursThisWeek).toBeCloseTo(3.5);
  });

  it('defaults hours to 0 when priority not in alignment', () => {
    const priorities = [makeP(1, 'Build Edg3')];
    const result = buildFocusProgress(priorities, null, []);
    expect(result[0].hoursThisWeek).toBe(0);
  });

  it('marks area as neglected when hours < 0.5', () => {
    const result = buildFocusProgress([makeP(1, 'Gym')], makeAlignment([{ priority: 'Gym', hours: 0 }]), []);
    expect(result[0].neglected).toBe(true);
  });

  it('does NOT mark neglected when hours >= 0.5', () => {
    const result = buildFocusProgress([makeP(1, 'Gym')], makeAlignment([{ priority: 'Gym', hours: 0.5 }]), []);
    expect(result[0].neglected).toBe(false);
  });

  it('counts milestones done vs total correctly', () => {
    const priorities = [makeP(1, 'Fundraising')];
    const milestones = [makeM(1, 1, 'Write deck', 1), makeM(2, 1, 'Cold outreach', 0), makeM(3, 1, 'Close first check', 0)];
    const result = buildFocusProgress(priorities, null, milestones);
    expect(result[0].milestonesDone).toBe(1);
    expect(result[0].milestonesTotal).toBe(3);
  });

  it('isComplete is true only when all milestones are done and there is at least one', () => {
    const priorities = [makeP(1, 'Goal')];
    const allDone = [makeM(1, 1, 'A', 1), makeM(2, 1, 'B', 1)];
    const someDone = [makeM(1, 1, 'A', 1), makeM(2, 1, 'B', 0)];
    const noMilestones: FocusMilestone[] = [];

    expect(buildFocusProgress(priorities, null, allDone)[0].isComplete).toBe(true);
    expect(buildFocusProgress(priorities, null, someDone)[0].isComplete).toBe(false);
    expect(buildFocusProgress(priorities, null, noMilestones)[0].isComplete).toBe(false);
  });

  it('only counts milestones for the correct priority', () => {
    const priorities = [makeP(1, 'P1'), makeP(2, 'P2')];
    const milestones = [makeM(1, 1, 'M for P1', 1), makeM(2, 2, 'M for P2', 0)];
    const result = buildFocusProgress(priorities, null, milestones);
    expect(result[0].milestonesDone).toBe(1);
    expect(result[1].milestonesDone).toBe(0);
  });

  it('returns one entry per priority in rank order', () => {
    const priorities = [makeP(3, 'C'), makeP(1, 'A'), makeP(2, 'B')];
    const result = buildFocusProgress(priorities, null, []);
    expect(result.map(r => r.title)).toEqual(['C', 'A', 'B']);
  });
});

describe('formatFocusScoreboardForBriefing', () => {
  it('returns empty string when no priorities', () => {
    expect(formatFocusScoreboardForBriefing([], [])).toBe('');
  });

  it('includes FOCUS SCOREBOARD header and each priority', () => {
    const progress = [
      { priorityId: 1, title: 'Fundraising', hoursThisWeek: 2.5, milestonesDone: 1, milestonesTotal: 3, isComplete: false, neglected: false },
    ];
    const out = formatFocusScoreboardForBriefing(progress, []);
    expect(out).toContain('FOCUS SCOREBOARD');
    expect(out).toContain('Fundraising');
    expect(out).toContain('2.5 h');
    expect(out).toContain('milestones: 1/3');
  });

  it('tags neglected area with NEGLECTED and adds instruction block', () => {
    const progress = [
      { priorityId: 1, title: 'Daily gym', hoursThisWeek: 0, milestonesDone: 0, milestonesTotal: 0, isComplete: false, neglected: true },
    ];
    const out = formatFocusScoreboardForBriefing(progress, []);
    expect(out).toContain('NEGLECTED');
    expect(out).toContain('Daily gym');
  });

  it('celebrates recently completed milestones', () => {
    const progress = [
      { priorityId: 1, title: 'Build', hoursThisWeek: 5, milestonesDone: 1, milestonesTotal: 1, isComplete: true, neglected: false },
    ];
    const recent = [makeM(1, 1, 'Launch the MVP', 1)];
    const out = formatFocusScoreboardForBriefing(progress, recent);
    expect(out).toContain('CELEBRATE');
    expect(out).toContain('Launch the MVP');
  });

  it('tags complete area with DONE marker', () => {
    const progress = [
      { priorityId: 1, title: 'Done thing', hoursThisWeek: 3, milestonesDone: 2, milestonesTotal: 2, isComplete: true, neglected: false },
    ];
    const out = formatFocusScoreboardForBriefing(progress, []);
    expect(out).toContain('DONE');
  });

  it('shows zero hours as "zero hours"', () => {
    const progress = [
      { priorityId: 1, title: 'Thing', hoursThisWeek: 0, milestonesDone: 0, milestonesTotal: 0, isComplete: false, neglected: true },
    ];
    const out = formatFocusScoreboardForBriefing(progress, []);
    expect(out).toContain('zero hours');
  });
});
