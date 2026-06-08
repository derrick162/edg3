import { describe, it, expect } from 'vitest';
import { findFreeSlots } from './calendar';
import type { calendar_v3 } from 'googleapis';

// Use a far-future date so the "don't suggest past slots today" clamp never affects results.
const ev = (s: string, e: string): calendar_v3.Schema$Event => ({ start: { dateTime: s }, end: { dateTime: e } });
const NY = 'America/New_York';
const events = [
  ev('2027-06-15T10:00:00-04:00', '2027-06-15T11:00:00-04:00'),
  ev('2027-06-15T14:00:00-04:00', '2027-06-15T15:00:00-04:00'),
];

describe('findFreeSlots', () => {
  it('finds the gaps around events within the 8am–8pm window', () => {
    const r = findFreeSlots(events, NY, '2027-06-15', '2027-06-15', 30);
    expect(r).toContain('8:00 AM');         // 8–10am gap
    expect(r).toContain('(120 min free)');
    expect(r).toContain('11:00 AM');        // 11am–2pm gap
    expect(r).toContain('(180 min free)');
    expect(r).toContain('3:00 PM');         // 3–8pm gap
    expect(r).toContain('(300 min free)');
  });

  it('respects the minimum duration', () => {
    const r = findFreeSlots(events, NY, '2027-06-15', '2027-06-15', 180);
    expect(r).not.toContain('(120 min free)'); // 8–10am is too short now
    expect(r).toContain('(180 min free)');
    expect(r).toContain('(300 min free)');
  });

  it('reports when nothing is open', () => {
    const full = [ev('2027-06-15T08:00:00-04:00', '2027-06-15T20:00:00-04:00')];
    expect(findFreeSlots(full, NY, '2027-06-15', '2027-06-15', 30)).toMatch(/No open blocks/);
  });

  it('ignores all-day events (they are not "busy" time)', () => {
    const withAllDay: calendar_v3.Schema$Event[] = [...events, { start: { date: '2027-06-15' }, end: { date: '2027-06-16' } }];
    const r = findFreeSlots(withAllDay, NY, '2027-06-15', '2027-06-15', 30);
    expect(r).toContain('(120 min free)'); // still finds the same gaps
  });

  it('ignores a day-spanning timed event (a broken 00:00–23:59 "all-day" block)', () => {
    const withSpanning: calendar_v3.Schema$Event[] = [...events, ev('2027-06-15T00:00:00-04:00', '2027-06-15T23:59:00-04:00')];
    const r = findFreeSlots(withSpanning, NY, '2027-06-15', '2027-06-15', 30);
    expect(r).toContain('(120 min free)'); // still finds the gaps despite the day-long block
  });
});
