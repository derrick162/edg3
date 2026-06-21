import { describe, it, expect } from 'vitest';
import { zoneOffsetMinutes, wallTimeToUtc, todayInTz, nowParts, dayRangeUtc, formatInTz, rruleUntilUtc, nextDay, prevDay, isValidTimeZone, bookEventTimes, timedEventDateMove, recurringSeriesTimeShift, applyRruleUntil, computeFreeSlots, buildRrule } from './time';

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

describe('isValidTimeZone — rejects garbage that would crash a call', () => {
  it('accepts real IANA zones', () => {
    expect(isValidTimeZone('America/Toronto')).toBe(true);
    expect(isValidTimeZone('America/Los_Angeles')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
  });
  it('rejects null, empty, and non-zones', () => {
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('Eastern')).toBe(false);
  });
  it('rejects a verbose LLM reply that happens to contain a slash', () => {
    // The exact failure: a "none" answer mentioning "city/location/timezone" got saved.
    expect(isValidTimeZone('Based on the transcript, the user does not mention a different city/location/timezone. Answer: none')).toBe(false);
  });
});

describe('nextDay', () => {
  it('advances one day, incl. month and year rollovers', () => {
    expect(nextDay('2026-06-15')).toBe('2026-06-16');
    expect(nextDay('2026-06-30')).toBe('2026-07-01');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
  });
});

describe('prevDay', () => {
  it('subtracts one day, incl. month and year rollovers', () => {
    expect(prevDay('2026-06-16')).toBe('2026-06-15');
    expect(prevDay('2026-07-01')).toBe('2026-06-30');
    expect(prevDay('2027-01-01')).toBe('2026-12-31');
  });
  it('prevDay and nextDay are exact inverses', () => {
    const d = '2026-06-25';
    expect(prevDay(nextDay(d))).toBe(d);
    expect(nextDay(prevDay(d))).toBe(d);
  });
  it('converts Google exclusive all-day end to the last inclusive day', () => {
    // Google stores June 25–28 as end.date = "2026-06-29" (exclusive).
    expect(prevDay('2026-06-29')).toBe('2026-06-28');
  });
});

describe('formatInTz', () => {
  it('formats an instant in the target zone', () => {
    const flight = new Date('2026-06-08T15:10:00Z');
    expect(formatInTz(flight, LA, { hour: 'numeric', minute: '2-digit' })).toBe('8:10 AM');
    expect(formatInTz(flight, TOR, { hour: 'numeric', minute: '2-digit' })).toBe('11:10 AM');
  });
});

describe('bookEventTimes', () => {
  it('produces correct start and end for a normal midday booking', () => {
    const { start, end } = bookEventTimes('2026-06-15', '14:00', 60);
    expect(start).toBe('2026-06-15T14:00:00');
    expect(end).toBe('2026-06-15T15:00:00');
  });

  it('handles 30-minute default when durationMins is 0 or negative', () => {
    expect(bookEventTimes('2026-06-15', '09:30', 0).end).toBe('2026-06-15T10:00:00');
    expect(bookEventTimes('2026-06-15', '09:30', -5).end).toBe('2026-06-15T10:00:00');
  });

  it('rolls end into the next day when duration overflows midnight', () => {
    // 23:30 + 60 min = 00:30 next day — not silently truncated to 23:59
    const { start, end } = bookEventTimes('2026-06-15', '23:30', 60);
    expect(start).toBe('2026-06-15T23:30:00');
    expect(end).toBe('2026-06-16T00:30:00');
  });

  it('rolls correctly for a very long duration starting at midnight', () => {
    // 00:00 + 25h (1500 min) → 01:00 the next day
    const { end } = bookEventTimes('2026-06-15', '00:00', 1500);
    expect(end).toBe('2026-06-16T01:00:00');
  });

  it('pads single-digit hours and minutes', () => {
    const { start, end } = bookEventTimes('2026-06-15', '09:05', 25);
    expect(start).toBe('2026-06-15T09:05:00');
    expect(end).toBe('2026-06-15T09:30:00');
  });
});

describe('timedEventDateMove — timed event + date-only input preserves wall-clock time', () => {
  it('preserves 3pm ET start time when moved to a new date', () => {
    // "move my 3pm meeting to the 26th" — must stay timed at 3pm, NOT collapse to all-day
    const r = timedEventDateMove(
      '2026-06-15T15:00:00-04:00', // 3:00pm EDT
      '2026-06-15T16:00:00-04:00', // 4:00pm EDT (1h)
      '2026-06-26',
      'America/New_York',
    );
    expect(r.start.dateTime).toBe('2026-06-26T15:00:00');
    expect(r.end.dateTime).toBe('2026-06-26T16:00:00');
    expect(r.start.timeZone).toBe('America/New_York');
    // No date-only field — event remains timed
    expect(r.start).not.toHaveProperty('date');
  });

  it('preserves duration (90-minute meeting)', () => {
    const r = timedEventDateMove(
      '2026-06-15T13:00:00-07:00', // 1:00pm PDT
      '2026-06-15T14:30:00-07:00', // 2:30pm PDT (90 min)
      '2026-06-26',
      'America/Vancouver',
    );
    expect(r.start.dateTime).toBe('2026-06-26T13:00:00');
    expect(r.end.dateTime).toBe('2026-06-26T14:30:00');
  });

  it('rolls end into next day when meeting crosses midnight', () => {
    const r = timedEventDateMove(
      '2026-06-15T23:00:00-04:00', // 11pm EDT
      '2026-06-16T01:00:00-04:00', // 1am next day (2h)
      '2026-06-26',
      'America/New_York',
    );
    expect(r.start.dateTime).toBe('2026-06-26T23:00:00');
    expect(r.end.dateTime).toBe('2026-06-27T01:00:00');
  });

  it('defaults to 1-hour duration when origEndDateTime is missing', () => {
    const r = timedEventDateMove('2026-06-15T10:00:00Z', '', '2026-06-26', 'UTC');
    expect(r.start.dateTime).toBe('2026-06-26T10:00:00');
    expect(r.end.dateTime).toBe('2026-06-26T11:00:00');
  });
});

describe('recurringSeriesTimeShift — move a whole recurring series to a new time, keep the anchor date', () => {
  it('shifts gym 11am→2pm on the master anchor date (the gym-move bug)', () => {
    // Master anchored 2026-06-08 (a Monday) 11:00–12:00; move all to 2–3pm.
    const r = recurringSeriesTimeShift(
      '2026-06-08T11:00:00-04:00', '2026-06-08T12:00:00-04:00',
      '14:00', '15:00', 'America/Toronto',
    );
    expect(r.start.dateTime).toBe('2026-06-08T14:00:00'); // anchor DATE unchanged
    expect(r.end.dateTime).toBe('2026-06-08T15:00:00');
    expect(r.start.timeZone).toBe('America/Toronto');
    expect(r.start).not.toHaveProperty('date');
  });

  it('accepts "HH:MM" times and pads seconds', () => {
    const r = recurringSeriesTimeShift(
      '2026-06-08T09:00:00Z', '2026-06-08T09:30:00Z', '13:45', '14:15', 'UTC',
    );
    expect(r.start.dateTime).toBe('2026-06-08T13:45:00');
    expect(r.end.dateTime).toBe('2026-06-08T14:15:00');
  });

  it('rolls the end date forward when the new time crosses midnight', () => {
    const r = recurringSeriesTimeShift(
      '2026-06-08T20:00:00Z', '2026-06-08T21:00:00Z', '23:30', '00:30', 'UTC',
    );
    expect(r.start.dateTime).toBe('2026-06-08T23:30:00');
    expect(r.end.dateTime).toBe('2026-06-09T00:30:00'); // next day
  });

  it('preserves the original duration when no end time is supplied', () => {
    // 90-minute master, move start to 14:00, no explicit end → 15:30.
    const r = recurringSeriesTimeShift(
      '2026-06-08T11:00:00Z', '2026-06-08T12:30:00Z', '14:00', '', 'UTC',
    );
    expect(r.start.dateTime).toBe('2026-06-08T14:00:00');
    expect(r.end.dateTime).toBe('2026-06-08T15:30:00');
  });
});

describe('applyRruleUntil — cap a recurring series (R13 T2)', () => {
  it('appends UNTIL to a bare weekly RRULE', () => {
    const until = rruleUntilUtc('2026-06-30', 'America/Toronto');
    expect(applyRruleUntil(['RRULE:FREQ=WEEKLY;BYDAY=MO'], until)).toEqual([`RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=${until}`]);
  });

  it('replaces an existing UNTIL rather than duplicating it', () => {
    const out = applyRruleUntil(['RRULE:FREQ=DAILY;UNTIL=20260101T000000Z'], '20260630T235959Z');
    expect(out).toEqual(['RRULE:FREQ=DAILY;UNTIL=20260630T235959Z']);
    expect(out[0].match(/UNTIL=/g)).toHaveLength(1);
  });

  it('strips a COUNT (mutually exclusive with UNTIL)', () => {
    expect(applyRruleUntil(['RRULE:FREQ=WEEKLY;COUNT=10'], '20260630T235959Z'))
      .toEqual(['RRULE:FREQ=WEEKLY;UNTIL=20260630T235959Z']);
  });

  it('leaves non-RRULE lines (EXDATE/RDATE) untouched', () => {
    const out = applyRruleUntil(['RRULE:FREQ=WEEKLY', 'EXDATE:20260615T140000Z'], '20260630T235959Z');
    expect(out[1]).toBe('EXDATE:20260615T140000Z');
  });

  it('returns [] for empty recurrence', () => {
    expect(applyRruleUntil([], '20260630T235959Z')).toEqual([]);
  });
});

describe('computeFreeSlots (R14 T1)', () => {
  // Window 9:00–18:00 America/Toronto (UTC-4 in June) → 13:00Z–22:00Z.
  const tz = 'America/Toronto';
  const at = (date: string, hhmm: string) => wallTimeToUtc(`${date}T${hhmm}:00`, tz).getTime();
  const base = { windowStartMin: 9 * 60, windowEndMin: 18 * 60, tz };

  it('returns one slot for a fully-free day', () => {
    const slots = computeFreeSlots({ ...base, busy: [], durationMs: 90 * 60000, dates: ['2026-06-22'] });
    expect(slots).toHaveLength(1);
    expect(slots[0]).toEqual({ date: '2026-06-22', startMs: at('2026-06-22', '09:00'), endMs: at('2026-06-22', '10:30') });
  });

  it('finds the gap between two meetings', () => {
    const busy = [
      { start: at('2026-06-22', '09:00'), end: at('2026-06-22', '11:00') },
      { start: at('2026-06-22', '12:30'), end: at('2026-06-22', '18:00') },
    ];
    const slots = computeFreeSlots({ ...base, busy, durationMs: 90 * 60000, dates: ['2026-06-22'], maxResults: 5 });
    expect(slots).toEqual([{ date: '2026-06-22', startMs: at('2026-06-22', '11:00'), endMs: at('2026-06-22', '12:30') }]);
  });

  it('skips gaps shorter than the duration', () => {
    const busy = [
      { start: at('2026-06-22', '09:00'), end: at('2026-06-22', '10:00') },
      { start: at('2026-06-22', '11:00'), end: at('2026-06-22', '18:00') }, // only a 60-min gap
    ];
    expect(computeFreeSlots({ ...base, busy, durationMs: 90 * 60000, dates: ['2026-06-22'] })).toEqual([]);
  });

  it('accepts a gap exactly equal to the duration', () => {
    const busy = [
      { start: at('2026-06-22', '09:00'), end: at('2026-06-22', '10:00') },
      { start: at('2026-06-22', '11:30'), end: at('2026-06-22', '18:00') }, // exactly 90 min
    ];
    const slots = computeFreeSlots({ ...base, busy, durationMs: 90 * 60000, dates: ['2026-06-22'] });
    expect(slots).toHaveLength(1);
    expect(slots[0].startMs).toBe(at('2026-06-22', '10:00'));
  });

  it('clips busy intervals to the window (ignores out-of-window busy)', () => {
    const busy = [{ start: at('2026-06-22', '06:00'), end: at('2026-06-22', '08:00') }]; // before window
    const slots = computeFreeSlots({ ...base, busy, durationMs: 60 * 60000, dates: ['2026-06-22'] });
    expect(slots[0].startMs).toBe(at('2026-06-22', '09:00')); // window start, not 8am
  });

  it('spans multiple days and caps at maxResults', () => {
    const slots = computeFreeSlots({ ...base, busy: [], durationMs: 60 * 60000, dates: ['2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25'], maxResults: 3 });
    expect(slots).toHaveLength(3);
    expect(slots.map(s => s.date)).toEqual(['2026-06-22', '2026-06-23', '2026-06-24']);
  });
});

describe('buildRrule (R14 T2)', () => {
  it('daily', () => expect(buildRrule({ freq: 'daily' })).toBe('RRULE:FREQ=DAILY'));
  it('weekdays', () => expect(buildRrule({ freq: 'weekly', days: ['MO', 'TU', 'WE', 'TH', 'FR'] })).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'));
  it('weekly single day', () => expect(buildRrule({ freq: 'weekly', days: ['MO'] })).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO'));
  it('with UNTIL (YYYY-MM-DD → YYYYMMDD)', () => expect(buildRrule({ freq: 'weekly', days: ['TU'], until: '2026-12-31' })).toBe('RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261231'));
  it('with COUNT', () => expect(buildRrule({ freq: 'daily', count: 10 })).toBe('RRULE:FREQ=DAILY;COUNT=10'));
  it('monthly', () => expect(buildRrule({ freq: 'monthly' })).toBe('RRULE:FREQ=MONTHLY'));
  it('until beats count when both supplied', () => expect(buildRrule({ freq: 'daily', until: '2026-12-31', count: 5 })).toBe('RRULE:FREQ=DAILY;UNTIL=20261231'));
});
