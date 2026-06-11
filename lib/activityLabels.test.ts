import { describe, it, expect } from 'vitest';
import { buildLabel, buildDetail, buildActivityItems, type ActivityItem } from './activityLabels';

// ── helpers ───────────────────────────────────────────────────────────────────

function audit(id: number, action: string, argsJson: string, created_at = '2026-06-10T08:00:00.000Z', snapshot_before: string | null = null, snapshot_after: string | null = null) {
  return { id, action, args_json: argsJson, result_text: null, ok: 1, snapshot_before, snapshot_after, created_at };
}

function undo(id: number, label: string, undone = 0, created_at = '2026-06-10T08:00:00.000Z') {
  return { id, label, undone, created_at };
}

// ── buildLabel ────────────────────────────────────────────────────────────────

describe('buildLabel — createEvent', () => {
  it('timed event includes date and time', () => {
    const label = buildLabel('createEvent', JSON.stringify({ title: 'Team sync', startDateTime: '2026-06-12T14:00:00-07:00' }), null);
    expect(label).toContain("Created 'Team sync'");
    expect(label).toContain('Jun 12');
    expect(label).toContain('2 PM');
  });

  it('all-day single-day event', () => {
    const label = buildLabel('createEvent', JSON.stringify({ title: 'Las Vegas', allDay: true, startDateTime: '2026-06-12' }), null);
    expect(label).toContain("Created 'Las Vegas'");
    expect(label).toContain('all-day');
    expect(label).toContain('Jun 12');
    expect(label).not.toContain('AM');
    expect(label).not.toContain('PM');
  });

  it('all-day multi-day shows date range', () => {
    const label = buildLabel('createEvent', JSON.stringify({ title: 'Las Vegas', allDay: true, startDateTime: '2026-06-12', endDate: '2026-06-15' }), null);
    expect(label).toContain('Jun 12–Jun 15');
  });

  it('missing title falls back to generic', () => {
    const label = buildLabel('createEvent', '{}', null);
    expect(label).toBe('Created event');
  });
});

describe('buildLabel — moveEvent', () => {
  it('shows from → to when both dates present', () => {
    const label = buildLabel('moveEvent', JSON.stringify({ title: 'Gym', date: '2026-06-08', newStartDateTime: '2026-06-09T10:00:00' }), null);
    expect(label).toContain("Moved 'Gym'");
    expect(label).toContain('Jun 8');
    expect(label).toContain('→');
    expect(label).toContain('Jun 9');
  });

  it('uses newStartDate for all-day moves', () => {
    const label = buildLabel('moveEvent', JSON.stringify({ title: 'Holiday', date: '2026-06-08', newStartDate: '2026-06-10' }), null);
    expect(label).toContain('Jun 10');
  });
});

describe('buildLabel — deleteEvent', () => {
  it('shows title and date', () => {
    const label = buildLabel('deleteEvent', JSON.stringify({ title: 'Las Vegas', date: '2026-06-12' }), null);
    expect(label).toBe("Deleted 'Las Vegas' · Jun 12");
  });

  it('handles natural-language date as-is', () => {
    const label = buildLabel('deleteEvent', JSON.stringify({ title: 'Board call', date: 'Tuesday' }), null);
    expect(label).toContain('Tuesday');
  });
});

describe('buildLabel — editEvent', () => {
  it('surfaces which fields changed', () => {
    const label = buildLabel('editEvent', JSON.stringify({ title: 'Board meeting', description: 'Agenda...' }), null);
    expect(label).toContain("Edited 'Board meeting'");
    expect(label).toContain('notes');
  });

  it('shows both notes and location when both updated', () => {
    const label = buildLabel('editEvent', JSON.stringify({ title: 'Offsite', description: 'Day 1', location: 'Whistler' }), null);
    expect(label).toContain('notes');
    expect(label).toContain('location');
  });
});

describe('buildLabel — researchToEvent', () => {
  it('includes event title and query', () => {
    const label = buildLabel('researchToEvent', JSON.stringify({ title: 'Investor meeting', query: 'who is John Smith' }), null);
    expect(label).toContain("Researched 'Investor meeting'");
    expect(label).toContain('who is John Smith');
  });
});

describe('buildLabel — draftEmail', () => {
  it('single recipient uses their name', () => {
    const label = buildLabel('draftEmail', JSON.stringify({ recipients: [{ name: 'Sarah Kim', email: 'sarah@vc.com' }] }), null);
    expect(label).toBe('Drafted email to Sarah Kim');
  });

  it('multiple recipients shows count', () => {
    const label = buildLabel('draftEmail', JSON.stringify({ recipients: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] }), null);
    expect(label).toBe('Drafted email to 3 contacts');
  });

  it('falls back to email when no name', () => {
    const label = buildLabel('draftEmail', JSON.stringify({ recipients: [{ email: 'foo@bar.com' }] }), null);
    expect(label).toContain('foo@bar.com');
  });
});

describe('buildLabel — misc', () => {
  it('createRecurringEvent', () => {
    const label = buildLabel('createRecurringEvent', JSON.stringify({ title: 'Standup', startDate: '2026-06-12' }), null);
    expect(label).toContain("Created recurring 'Standup'");
    expect(label).toContain('Jun 12');
  });

  it('setMyTimezone', () => {
    const label = buildLabel('setMyTimezone', JSON.stringify({ timezone: 'America/Toronto' }), null);
    expect(label).toBe('Updated timezone to America/Toronto');
  });

  it('falls back to resultText for unknown action', () => {
    expect(buildLabel('someNewTool', '{}', 'Did something useful')).toBe('Did something useful');
  });

  it('falls back to spaced action name when no resultText', () => {
    const label = buildLabel('someNewTool', '{}', null);
    expect(label).toContain('some');
  });
});

// ── buildDetail ───────────────────────────────────────────────────────────────

describe('buildDetail — researchToEvent', () => {
  it('returns research text from snapshot_after.description', () => {
    const afterSnap = JSON.stringify({ description: 'John Smith is a serial entrepreneur who founded three startups.' });
    const detail = buildDetail('researchToEvent', JSON.stringify({ title: 'Investor meeting', query: 'who is John Smith' }), null, null, afterSnap);
    expect(detail).not.toBeNull();
    const research = detail!.sections.find(s => s.label === 'Research saved');
    expect(research?.value).toContain('John Smith');
  });

  it('falls back to resultText when no snapshot', () => {
    const detail = buildDetail('researchToEvent', JSON.stringify({ title: 'Meeting', query: 'test' }), 'Fallback result', null, null);
    expect(detail?.sections.find(s => s.label === 'Research saved')?.value).toBe('Fallback result');
  });
});

describe('buildDetail — editEvent', () => {
  it('returns before/after changes when snapshots present', () => {
    const before = JSON.stringify({ description: 'Old notes' });
    const after = JSON.stringify({ description: 'Updated notes with more detail' });
    const detail = buildDetail('editEvent', JSON.stringify({ title: 'Board meeting' }), null, before, after);
    expect(detail?.changes).toHaveLength(1);
    expect(detail?.changes![0].label).toBe('Notes');
    expect(detail?.changes![0].before).toBe('Old notes');
    expect(detail?.changes![0].after).toBe('Updated notes with more detail');
  });

  it('falls back to args fields when no snapshots', () => {
    const detail = buildDetail('editEvent', JSON.stringify({ title: 'Standup', description: 'New agenda' }), null, null, null);
    expect(detail?.sections.find(s => s.label === 'New notes')?.value).toBe('New agenda');
  });
});

describe('buildDetail — deleteEvent', () => {
  it('includes snapshot_before notes and location', () => {
    const before = JSON.stringify({ description: 'Bring laptop', location: 'Las Vegas' });
    const detail = buildDetail('deleteEvent', JSON.stringify({ title: 'Vegas trip', date: '2026-06-12' }), null, before, null);
    expect(detail?.sections.find(s => s.label === 'Notes')?.value).toBe('Bring laptop');
    expect(detail?.sections.find(s => s.label === 'Location')?.value).toBe('Las Vegas');
  });
});

describe('buildDetail — returns null', () => {
  it('returns null for createEvent with no data', () => {
    expect(buildDetail('createEvent', '{}', null, null, null)).toBeNull();
  });

  it('returns null for deleteEvent with empty args and no snapshot', () => {
    expect(buildDetail('deleteEvent', '{}', null, null, null)).toBeNull();
  });
});

// ── buildActivityItems ────────────────────────────────────────────────────────

describe('buildActivityItems', () => {
  it('filters out read-only actions', () => {
    const rows = [audit(1, 'readCalendar', '{}'), audit(2, 'createEvent', JSON.stringify({ title: 'Gym' }))];
    const result = buildActivityItems(rows, []);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe('createEvent');
  });

  it('matches undo row within 2 seconds', () => {
    const ts = '2026-06-10T08:00:00.000Z';
    const undoTs = '2026-06-10T08:00:01.000Z';
    const result = buildActivityItems([audit(1, 'createEvent', '{"title":"Gym"}', ts)], [undo(10, 'created Gym', 0, undoTs)]);
    expect(result[0].undoId).toBe(10);
    expect(result[0].undone).toBe(0);
  });

  it('does not match undo row more than 2 seconds away', () => {
    const ts = '2026-06-10T08:00:00.000Z';
    const undoTs = '2026-06-10T08:00:03.000Z';
    const result = buildActivityItems([audit(1, 'createEvent', '{"title":"Gym"}', ts)], [undo(10, 'created Gym', 0, undoTs)]);
    expect(result[0].undoId).toBeNull();
  });

  it('does not reuse the same undo row for two audit rows', () => {
    const ts = '2026-06-10T08:00:00.000Z';
    const rows = [audit(1, 'createEvent', '{"title":"A"}', ts), audit(2, 'createEvent', '{"title":"B"}', ts)];
    const result = buildActivityItems(rows, [undo(10, 'created A', 0, ts)]);
    const matched = result.filter((r: ActivityItem) => r.undoId !== null);
    expect(matched).toHaveLength(1);
  });

  it('preserves undone=1 from undo row', () => {
    const ts = '2026-06-10T08:00:00.000Z';
    const result = buildActivityItems([audit(1, 'deleteEvent', '{"title":"X"}', ts)], [undo(5, 'deleted X', 1, ts)]);
    expect(result[0].undone).toBe(1);
  });

  it('respects limit', () => {
    const rows = Array.from({ length: 60 }, (_, i) => audit(i + 1, 'createEvent', '{}'));
    expect(buildActivityItems(rows, [], 10)).toHaveLength(10);
  });
});
