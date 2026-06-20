import { describe, it, expect } from 'vitest';
import { isTimedEventInWindow, formatBatchPreview, nearbyTimedEvents, buildConflictWarning, type BatchEventLike } from './batchSchedule';

// Toronto = UTC-4 in June. 2pm/3pm/4pm local = 18:00/19:00/20:00Z.
const ev = (summary: string, dt: string | null, status?: string): BatchEventLike => ({
  summary,
  status,
  start: dt ? { dateTime: dt } : { date: '2026-06-20' },
});

describe('isTimedEventInWindow', () => {
  const start = Date.parse('2026-06-20T16:00:00Z'); // noon Toronto
  const end = Date.parse('2026-06-20T22:00:00Z');   // 6pm Toronto

  it('includes a timed event inside the window', () => {
    expect(isTimedEventInWindow(ev('Gym', '2026-06-20T18:00:00Z'), start, end)).toBe(true);
  });

  it('excludes events before/after the window', () => {
    expect(isTimedEventInWindow(ev('Early', '2026-06-20T14:00:00Z'), start, end)).toBe(false);
    expect(isTimedEventInWindow(ev('Late', '2026-06-20T23:00:00Z'), start, end)).toBe(false);
  });

  it('excludes all-day events', () => {
    expect(isTimedEventInWindow(ev('Holiday', null), start, end)).toBe(false);
  });

  it('excludes cancelled events', () => {
    expect(isTimedEventInWindow(ev('Gym', '2026-06-20T18:00:00Z', 'cancelled'), start, end)).toBe(false);
  });

  it('treats ±Infinity bounds as an unbounded window', () => {
    expect(isTimedEventInWindow(ev('Anything', '2026-06-20T09:00:00Z'), -Infinity, Infinity)).toBe(true);
  });
});

describe('formatBatchPreview', () => {
  it('lists events with local times and strips the ⚡ marker', () => {
    const events = [
      ev('⚡ Gym', '2026-06-20T18:00:00Z'),
      ev('Focus block', '2026-06-20T19:00:00Z'),
      ev('Call', '2026-06-20T20:00:00Z'),
    ];
    expect(formatBatchPreview(events, 'America/Toronto')).toBe(
      'Gym at 2:00 PM, Focus block at 3:00 PM, Call at 4:00 PM',
    );
  });

  it('falls back to Untitled / all day', () => {
    expect(formatBatchPreview([ev('', null)], 'America/Toronto')).toBe('Untitled at all day');
  });
});

describe('nearbyTimedEvents (R13 T3)', () => {
  const anchor = Date.parse('2026-06-20T13:00:00Z'); // departure anchor

  it('returns events within ±90 min of the anchor', () => {
    const events = [
      ev('Call', '2026-06-20T12:15:00Z'),  // 45 min before → in
      ev('Standup', '2026-06-20T14:20:00Z'), // 80 min after → in
      ev('Lunch', '2026-06-20T11:00:00Z'),  // 120 min before → out
    ];
    const near = nearbyTimedEvents(events, anchor, 90);
    expect(near.map(e => e.summary)).toEqual(['Call', 'Standup']);
  });

  it('ignores all-day events near the anchor', () => {
    expect(nearbyTimedEvents([ev('Holiday', null)], anchor, 90)).toEqual([]);
  });
});

describe('buildConflictWarning (R13 T4)', () => {
  it('names the conflicting event(s) and offers both paths', () => {
    const msg = buildConflictWarning(['Investor call at 2:00 PM'], 'Dentist');
    expect(msg).toContain('Investor call at 2:00 PM');
    expect(msg).toContain('Dentist');
    expect(msg).toContain('overrideConflicts');
    expect(msg).toContain('findTime');
  });

  it('lists multiple conflicts comma-separated', () => {
    expect(buildConflictWarning(['A at 1:00 PM', 'B at 1:30 PM'], 'C')).toContain('A at 1:00 PM, B at 1:30 PM');
  });
});
