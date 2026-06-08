import { describe, it, expect } from 'vitest';
import { zoneOffsetMinutes, wallTimeToUtc, todayInTz, nowParts, dayRangeUtc, formatInTz, rruleUntilUtc } from './time';

const LA = 'America/Los_Angeles';
const TOR = 'America/Toronto';

describe('zoneOffsetMinutes', () => {
  it('summer (DST) offsets', () => {
    const summer = new Date('2026-07-15T16:00:00Z');
    expect(zoneOffsetMinutes(TOR, summer)).toBe(-240); // EDT
    expect(zoneOffsetMinutes(LA, summer)).toBe(-420);  // PDT
  });
  it('winter (standard) offsets', () => {
    const winter = new Date('2026-01-15T17:00:00Z');
    expect(zoneOffsetMinutes(TOR, winter)).toBe(-300); // EST
    expect(zoneOffsetMinutes(LA, winter)).toBe(-480);  // PST
  });
  it('UTC is zero', () => {
    expect(zoneOffsetMinutes('UTC', new Date('2026-06-08T00:00:00Z'))).toBe(0);
  });
});

describe('wallTimeToUtc', () => {
  it('PDT: the YVR→YYZ flight at 8:10am Pacific', () => {
    expect(wallTimeToUtc('2026-06-08T08:10:00', LA).toISOString()).toBe('2026-06-08T15:10:00.000Z');
  });
  it('EDT: 7pm Eastern dinner — the conflict-window regression', () => {
    // The old code appended "Z" and checked 19:00 UTC, false-matching an all-day event.
    expect(wallTimeToUtc('2026-06-09T19:00:00', TOR).toISOString()).toBe('2026-06-09T23:00:00.000Z');
  });
  it('handles DST: same wall time, different offset summer vs winter', () => {
    expect(wallTimeToUtc('2026-07-15T12:00:00', TOR).toISOString()).toBe('2026-07-15T16:00:00.000Z'); // EDT -4
    expect(wallTimeToUtc('2026-01-15T12:00:00', TOR).toISOString()).toBe('2026-01-15T17:00:00.000Z'); // EST -5
  });
  it('round-trips against zoneOffsetMinutes', () => {
    const utc = wallTimeToUtc('2026-03-10T09:30:00', LA);
    const off = zoneOffsetMinutes(LA, utc);
    // wall = utc + offset → re-deriving the wall hour should give 09:30
    const wall = new Date(utc.getTime() + off * 60000);
    expect(wall.toISOString().slice(11, 16)).toBe('09:30');
  });
});

describe('todayInTz — the flight-date boundary bug', () => {
  it('late-evening Pacific does NOT roll forward to the UTC date', () => {
    // 00:46 UTC on Jun 8 is still 5:46pm on Jun 7 in Los Angeles.
    const at = new Date('2026-06-08T00:46:00Z');
    expect(todayInTz(LA, at)).toBe('2026-06-07'); // not 2026-06-08
    expect(todayInTz('UTC', at)).toBe('2026-06-08');
  });
  it('after local midnight it advances', () => {
    const at = new Date('2026-06-08T08:00:00Z'); // 1am PT
    expect(todayInTz(LA, at)).toBe('2026-06-08');
  });
});

describe('nowParts', () => {
  it('extracts user-local parts incl. weekday', () => {
    const at = new Date('2026-06-08T00:46:00Z'); // Sun Jun 7, 5:46pm PT
    const p = nowParts(LA, at);
    expect(p.date).toBe('2026-06-07');
    expect(p.weekday).toBe(0); // Sunday
    expect(p.hour).toBe(17);
    expect(p.minute).toBe(46);
  });
});

describe('dayRangeUtc', () => {
  it('a Pacific day maps to the correct UTC window', () => {
    const { start, end } = dayRangeUtc(LA, '2026-06-07');
    expect(start.toISOString()).toBe('2026-06-07T07:00:00.000Z'); // 00:00 PDT
    expect(end.toISOString()).toBe('2026-06-08T06:59:59.000Z');   // 23:59 PDT
  });
  it('defaults to today in the zone (the flight evening → Jun 7, not Jun 8)', () => {
    const at = new Date('2026-06-08T00:46:00Z');
    const { start } = dayRangeUtc(LA, undefined, at);
    expect(start.toISOString()).toBe('2026-06-07T07:00:00.000Z');
  });
});

describe('rruleUntilUtc — "Tuesday to Thursday" must include Thursday', () => {
  it('uses end-of-day so a 10am event on the end date is not dropped', () => {
    // endDate Thu Jun 11, Eastern. UNTIL must be after 10am Jun 11 (= 14:00 UTC) to keep it.
    const until = rruleUntilUtc('2026-06-11', TOR); // 23:59:59 EDT = 2026-06-12T03:59:59Z
    expect(until).toBe('20260612T035959Z');
    // The old bug used "20260611" (midnight), which is before the 10am occurrence.
    const tenAmThu = wallTimeToUtc('2026-06-11T10:00:00', TOR).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    expect(until > tenAmThu).toBe(true);
    expect('20260611' < tenAmThu.slice(0, 8)).toBe(false); // old bare-date cutoff fell on/before the day
  });
  it('Pacific end date', () => {
    expect(rruleUntilUtc('2026-06-11', LA)).toBe('20260612T065959Z'); // 23:59:59 PDT
  });
});

describe('formatInTz', () => {
  it('formats an instant in the target zone', () => {
    const flight = new Date('2026-06-08T15:10:00Z');
    expect(formatInTz(flight, LA, { hour: 'numeric', minute: '2-digit' })).toBe('8:10 AM');
    expect(formatInTz(flight, TOR, { hour: 'numeric', minute: '2-digit' })).toBe('11:10 AM');
  });
});
