import { describe, it, expect } from 'vitest';
import { summarizeUserFacingActions, ToolAction } from './actionSummary';

describe('summarizeUserFacingActions', () => {
  it('filters out all read-only internal calls', () => {
    const actions: ToolAction[] = [
      { fn: 'readCalendar', ok: true, result: 'Found 10 event(s): …' },
      { fn: 'findTime', ok: true },
      { fn: 'getDayEvents', ok: true },
      { fn: 'verifyPromises', ok: true },
      { fn: 'checkReplies', ok: true },
    ];
    expect(summarizeUserFacingActions(actions)).toEqual([]);
  });

  it('filters out failed (ok:false) actions', () => {
    const actions: ToolAction[] = [
      { fn: 'createEvent', ok: false, args: { title: 'Team sync' } },
      { fn: 'moveEvent', ok: false, args: { title: 'Dentist' } },
    ];
    expect(summarizeUserFacingActions(actions)).toEqual([]);
  });

  it('produces plain-English labels for mutating ok:true actions', () => {
    const actions: ToolAction[] = [
      { fn: 'createEvent', ok: true, args: { title: 'Team sync' } },
      { fn: 'moveEvent', ok: true, args: { title: 'Dentist' } },
      { fn: 'deleteEvent', ok: true, args: { title: 'Old lunch' } },
      { fn: 'editEvent', ok: true, args: { title: 'Weekly check-in' } },
    ];
    expect(summarizeUserFacingActions(actions)).toEqual([
      "Added 'Team sync' to your calendar",
      "Moved 'Dentist'",
      "Removed 'Old lunch'",
      "Updated 'Weekly check-in'",
    ]);
  });

  it('labels draftEmail with recipient name for a single recipient', () => {
    const actions: ToolAction[] = [
      { fn: 'draftEmail', ok: true, args: { recipients: [{ name: 'Bob' }] } },
    ];
    expect(summarizeUserFacingActions(actions)).toEqual(['Drafted an email to Bob']);
  });

  it('labels draftEmail with count for multiple recipients', () => {
    const actions: ToolAction[] = [
      { fn: 'draftEmail', ok: true, args: { recipients: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] } },
    ];
    expect(summarizeUserFacingActions(actions)).toEqual(['Drafted 3 emails']);
  });

  it('labels setMyTimezone and undoLastAction', () => {
    const actions: ToolAction[] = [
      { fn: 'setMyTimezone', ok: true },
      { fn: 'undoLastAction', ok: true },
    ];
    expect(summarizeUserFacingActions(actions)).toEqual([
      'Updated your timezone',
      'Undid the last change',
    ]);
  });

  it('returns [] when only read-only calls appear (no silent "internal reads" label)', () => {
    const actions: ToolAction[] = [
      { fn: 'readCalendar', ok: true },
      { fn: 'findTime', ok: true },
    ];
    expect(summarizeUserFacingActions(actions)).toEqual([]);
  });

  it('handles empty input', () => {
    expect(summarizeUserFacingActions([])).toEqual([]);
  });
});
