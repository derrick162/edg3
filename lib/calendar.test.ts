import { describe, it, expect } from 'vitest';
import { findFreeSlots, buildBriefingReminderBody, BRIEFING_REMINDER_TITLE, findNextFreeSlot, type FreeSlotEvent } from './calendar';
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

describe('buildBriefingReminderBody', () => {
  const TOR = 'America/Toronto';

  it('produces the correct summary, color, and recurrence', () => {
    const now = new Date('2026-06-13T12:00:00Z'); // 8am Toronto (EDT -4)
    const body = buildBriefingReminderBody('09:00', TOR, now);
    expect(body.summary).toBe(BRIEFING_REMINDER_TITLE);
    expect(body.colorId).toBe('9');
    expect(body.recurrence).toEqual(['RRULE:FREQ=DAILY']);
    expect(body.reminders.useDefault).toBe(false);
  });

  it('schedules at the requested call time when it is still in the future today', () => {
    // now = 8am Toronto; callTime = 9am → event starts today at 9am
    const now = new Date('2026-06-13T12:00:00Z'); // 8am EDT
    const body = buildBriefingReminderBody('09:00', TOR, now);
    expect(body.start.dateTime).toBe('2026-06-13T09:00:00');
    expect(body.start.timeZone).toBe(TOR);
  });

  it('rolls to tomorrow when call time has already passed today', () => {
    // now = 10am Toronto; callTime = 7am → already passed → next occurrence is tomorrow
    const now = new Date('2026-06-13T14:00:00Z'); // 10am EDT
    const body = buildBriefingReminderBody('07:00', TOR, now);
    expect(body.start.dateTime).toMatch(/^2026-06-14T07:00:00/);
  });

  it('sets end time exactly 15 minutes after start', () => {
    const now = new Date('2026-06-13T12:00:00Z'); // 8am EDT
    const body = buildBriefingReminderBody('09:00', TOR, now);
    expect(body.start.dateTime).toBe('2026-06-13T09:00:00');
    expect(body.end.dateTime).toBe('2026-06-13T09:15:00');
  });
});

describe('findNextFreeSlot (R18 T1)', () => {
  // UTC tz keeps wall-clock == Z; 2027-06-14 Mon, 15 Tue, 16 Wed, 19 Sat, 21 Mon.
  const MON = '2027-06-14', TUE = '2027-06-15', SAT = '2027-06-19', MON2 = '2027-06-21';
  const ue = (date: string, sh: number, eh: number): FreeSlotEvent => ({
    start: { dateTime: `${date}T${String(sh).padStart(2, '0')}:00:00Z` },
    end: { dateTime: `${date}T${String(eh).padStart(2, '0')}:00:00Z` },
  });
  const o = { today: MON, tz: 'UTC' };

  it('empty calendar → first morning slot at the window start', () => {
    expect(findNextFreeSlot([], 60, undefined, o)).toEqual({ date: MON, startTime: '09:00', endTime: '10:00' });
  });

  it('today fully packed 9–6 → falls back to the next weekday morning', () => {
    expect(findNextFreeSlot([ue(MON, 9, 18)], 60, undefined, o)).toEqual({ date: TUE, startTime: '09:00', endTime: '10:00' });
  });

  it('respects the preferred hour when it fits a gap', () => {
    expect(findNextFreeSlot([], 60, 14, o)).toEqual({ date: MON, startTime: '14:00', endTime: '15:00' });
  });

  it('skips the weekend when today is Saturday', () => {
    expect(findNextFreeSlot([], 60, undefined, { today: SAT, tz: 'UTC' })).toEqual({ date: MON2, startTime: '09:00', endTime: '10:00' });
  });

  it('returns null when all scanned weekdays are fully packed', () => {
    const packed = [ue(MON, 9, 18), ue(TUE, 9, 18), ue('2027-06-16', 9, 18)];
    expect(findNextFreeSlot(packed, 60, undefined, { ...o, daysToScan: 3 })).toBeNull();
  });

  it('finds the post-noon gap when the morning is blocked', () => {
    // 9–12 booked; the 60-min block lands in the 12:00 gap (preferred hour absent).
    expect(findNextFreeSlot([ue(MON, 9, 12)], 60, undefined, o)).toEqual({ date: MON, startTime: '12:00', endTime: '13:00' });
  });
});
