/**
 * R20 follow-up (#3) — NANP area-code → timezone inference + effectiveTimezone fallback ordering.
 * The code-level defense for users who connect via Vapi before ever setting a dashboard timezone.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { timezoneFromPhone } from './phoneTimezone';

process.env.DB_PATH = ':memory:';
const { effectiveTimezone } = await import('./db');
afterAll(() => { delete process.env.DB_PATH; });

describe('timezoneFromPhone', () => {
  it('maps a Toronto 416 number to America/Toronto (Derrick)', () => {
    expect(timezoneFromPhone('+14165551234')).toBe('America/Toronto');
    expect(timezoneFromPhone('416-555-1234')).toBe('America/Toronto');
    expect(timezoneFromPhone('+1 (416) 555-1234')).toBe('America/Toronto');
  });

  it('maps representative US zones', () => {
    expect(timezoneFromPhone('+12125550000')).toBe('America/New_York');  // NYC 212
    expect(timezoneFromPhone('+13125550000')).toBe('America/Chicago');   // Chicago 312
    expect(timezoneFromPhone('+13035550000')).toBe('America/Denver');    // Denver 303
    expect(timezoneFromPhone('+16025550000')).toBe('America/Phoenix');   // Phoenix 602
    expect(timezoneFromPhone('+14155550000')).toBe('America/Los_Angeles'); // SF 415
    expect(timezoneFromPhone('+18085550000')).toBe('Pacific/Honolulu');  // Hawaii 808
    expect(timezoneFromPhone('+19075550000')).toBe('America/Anchorage'); // Alaska 907
  });

  it('maps representative Canadian zones', () => {
    expect(timezoneFromPhone('+16045550000')).toBe('America/Vancouver'); // BC 604
    expect(timezoneFromPhone('+14035550000')).toBe('America/Edmonton');  // Alberta 403
    expect(timezoneFromPhone('+15145550000')).toBe('America/Toronto');   // Montreal 514
  });

  it('accepts bare 10-digit and 1-prefixed 11-digit forms', () => {
    expect(timezoneFromPhone('2125550000')).toBe('America/New_York');
    expect(timezoneFromPhone('12125550000')).toBe('America/New_York');
  });

  it('returns null for unusable / non-NANP / unmapped numbers', () => {
    expect(timezoneFromPhone(null)).toBeNull();
    expect(timezoneFromPhone('')).toBeNull();
    expect(timezoneFromPhone('+44 20 7946 0958')).toBeNull(); // UK, not NANP length
    expect(timezoneFromPhone('123')).toBeNull();              // too short
    expect(timezoneFromPhone('+19995550000')).toBeNull();     // 999 area code unmapped
  });
});

describe('effectiveTimezone fallback ordering', () => {
  it('prefers current_timezone, then timezone, then phone, then LA default', () => {
    expect(effectiveTimezone({ current_timezone: 'America/Toronto', timezone: 'America/Denver', phone_number: '+14155550000' })).toBe('America/Toronto');
    expect(effectiveTimezone({ current_timezone: null, timezone: 'America/Denver', phone_number: '+14155550000' })).toBe('America/Denver');
    expect(effectiveTimezone({ current_timezone: null, timezone: null, phone_number: '+14165551234' })).toBe('America/Toronto');
    expect(effectiveTimezone({ current_timezone: null, timezone: 'garbage/zone', phone_number: '+19995550000' })).toBe('America/Los_Angeles');
    expect(effectiveTimezone({})).toBe('America/Los_Angeles');
  });

  it('phone inference fixes the "7:37 PM Eastern → Good afternoon" case', () => {
    // No stored tz, Toronto number → America/Toronto (not LA). hour computed in Eastern = evening.
    const tz = effectiveTimezone({ phone_number: '+14165551234' });
    const d = new Date('2026-06-24T23:37:00Z'); // 7:37 PM Eastern
    const hour = parseInt(d.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }));
    expect(hour).toBe(19); // evening, not 16 (afternoon) under LA
  });
});
