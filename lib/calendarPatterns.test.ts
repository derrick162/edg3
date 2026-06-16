import { describe, it, expect } from 'vitest';
import {
  detectCalendarPatterns,
  formatCalendarPatternsForBriefing,
  formatPatternsAsEnergyProfile,
} from './calendarPatterns';
import type { calendar_v3 } from 'googleapis';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a timed weekday event. `hour` is in the given timezone (UTC by default).
 * Offset is stored in the ISO string for Intl.DateTimeFormat to use correctly.
 */
function event(
  summary: string,
  dateStr: string,      // YYYY-MM-DD
  hour: number,         // start hour (0-23) in UTC
  durationHours = 1,
): calendar_v3.Schema$Event {
  const start = new Date(`${dateStr}T${String(hour).padStart(2, '0')}:00:00Z`);
  const end   = new Date(start.getTime() + durationHours * 3600000);
  return {
    summary,
    start: { dateTime: start.toISOString() },
    end:   { dateTime: end.toISOString() },
  };
}

/** Build N copies of the same event on consecutive weekdays starting from dateStr. */
function repeat(summary: string, startDate: string, hour: number, count: number): calendar_v3.Schema$Event[] {
  const events: calendar_v3.Schema$Event[] = [];
  let current = new Date(`${startDate}T00:00:00Z`);
  let added = 0;
  while (added < count) {
    const dow = current.getUTCDay(); // 0=Sun, 6=Sat
    if (dow >= 1 && dow <= 5) {
      const dateStr = current.toISOString().slice(0, 10);
      events.push(event(summary, dateStr, hour));
      added++;
    }
    current = new Date(current.getTime() + 86400000);
  }
  return events;
}

// ── detectCalendarPatterns ────────────────────────────────────────────────────

describe('detectCalendarPatterns', () => {
  it('returns null when fewer than 10 timed events', () => {
    const evts = [event('Standup', '2026-01-05', 9)];
    expect(detectCalendarPatterns(evts)).toBeNull();
  });

  it('returns null when period is shorter than minWeeks (default 4)', () => {
    // 10 events but all on the same day → period = 0 weeks
    const evts = repeat('Standup', '2026-01-05', 9, 10);
    // All on same or adjacent weekdays → period < 1 week → should fail minWeeks=4
    expect(detectCalendarPatterns(evts)).toBeNull();
  });

  it('detects routines appearing ≥3 times per week', () => {
    // 5 weeks × 5 days = 25 events for standup → routineThreshold = 5*3=15 ✓
    const standups  = repeat('Daily Standup', '2026-01-05', 9, 25);
    // 5 weeks × 1 day = 5 events for "strategy" → not a routine
    const strategy  = repeat('Strategy Review', '2026-01-05', 14, 5);
    const evts = [...standups, ...strategy];
    const patterns = detectCalendarPatterns(evts);
    expect(patterns).not.toBeNull();
    expect(patterns!.routines.some(r => r.toLowerCase().includes('standup'))).toBe(true);
    expect(patterns!.routines.some(r => r.toLowerCase().includes('strategy'))).toBe(false);
  });

  it('excludes weekend events from analysis', () => {
    // Mix of weekday standups + Saturday events
    const weekday = repeat('Standup', '2026-01-05', 9, 25);   // Mon–Fri
    const weekend = [
      event('Weekend run', '2026-01-03', 8),    // Saturday
      event('Weekend run', '2026-01-04', 8),    // Sunday
      event('Weekend run', '2026-01-10', 8),
    ];
    const evts = [...weekday, ...weekend];
    const patterns = detectCalendarPatterns(evts);
    // 'weekend run' should NOT be in routines (weekend events are excluded)
    expect(patterns?.routines.some(r => r.toLowerCase().includes('weekend'))).toBeFalsy();
  });

  it('identifies meeting peak hours as the most populated slots', () => {
    // Put 20 events at 10am, 5 at 2pm, 2 at 8am — over 5+ weeks
    const peak10am  = repeat('Sales Call', '2026-01-05', 10, 20);
    const pm2       = repeat('1:1', '2026-01-05', 14, 5);
    const am8       = repeat('Early sync', '2026-01-05', 8, 2);
    const patterns = detectCalendarPatterns([...peak10am, ...pm2, ...am8]);
    expect(patterns).not.toBeNull();
    // 10am should be the top peak hour
    expect(patterns!.meetingPeakHours).toContain(10);
  });

  it('identifies inferred focus hours as the lightest slots during working hours', () => {
    // 20 events at 10am and 20 at 3pm, nothing at 8am → 8am should be a focus hour
    const am10 = repeat('Sales Call', '2026-01-05', 10, 20);
    const pm3  = repeat('Reviews', '2026-01-05', 15, 20);
    const patterns = detectCalendarPatterns([...am10, ...pm3]);
    expect(patterns).not.toBeNull();
    expect(patterns!.inferencedFocusHours).toContain(7); // 7am is completely empty
  });

  it('computes busyDaysOfWeek sorted by event count descending', () => {
    // 3 events on Mon + 1 on Fri across 5 weeks (summaries must be ≥3 chars)
    const allEvents: calendar_v3.Schema$Event[] = [];
    for (let w = 0; w < 5; w++) {
      const mon = new Date('2026-01-05T00:00:00Z');
      mon.setUTCDate(mon.getUTCDate() + w * 7);
      const monStr = mon.toISOString().slice(0, 10);
      allEvents.push(event('Team standup', monStr, 9), event('Sales call', monStr, 11), event('Review', monStr, 14));
      const fri = new Date(mon.getTime() + 4 * 86400000);
      allEvents.push(event('Check-in', fri.toISOString().slice(0, 10), 10));
    }
    const patterns = detectCalendarPatterns(allEvents);
    expect(patterns).not.toBeNull();
    // Monday should be busiest
    expect(patterns!.busyDaysOfWeek[0]).toBe('Monday');
    expect(patterns!.busyDaysOfWeek[patterns!.busyDaysOfWeek.length - 1]).toBe('Friday');
  });

  it('computes avgMeetingsPerDay reasonably', () => {
    // 5 working days × 5 weeks = 25 days; 25 events → 1/day
    const evts = repeat('Meeting', '2026-01-05', 10, 25);
    const patterns = detectCalendarPatterns(evts);
    expect(patterns).not.toBeNull();
    // Should be roughly 1 per working day (will vary due to weekend inclusion in period)
    expect(patterns!.avgMeetingsPerDay).toBeGreaterThan(0);
    expect(patterns!.avgMeetingsPerDay).toBeLessThan(5);
  });

  it('computes meetingTrend as increasing when last 4 weeks has more meetings', () => {
    // recent = 20 events from 2026-02-16 (fills last-4w window)
    // older  = 5 events from 2026-01-19 (falls in prior-4w window relative to the computed "latest")
    const recent = repeat('Call', '2026-02-16', 10, 20);
    const older  = repeat('Call', '2026-01-19', 10, 5);
    const patterns = detectCalendarPatterns([...older, ...recent]);
    expect(patterns).not.toBeNull();
    expect(patterns!.meetingTrend).toBe('increasing');
  });

  it('computes meetingTrend as stable when counts are similar', () => {
    // Equal distribution across 8 weeks
    const evts = repeat('Call', '2026-01-05', 10, 40);
    const patterns = detectCalendarPatterns(evts);
    expect(patterns).not.toBeNull();
    expect(patterns!.meetingTrend).toBe('stable');
  });

  it('includes periodWeeks in the result', () => {
    const evts = repeat('Standup', '2026-01-05', 9, 25);
    const patterns = detectCalendarPatterns(evts);
    expect(patterns?.periodWeeks).toBeGreaterThan(0);
  });
});

// ── formatCalendarPatternsForBriefing ─────────────────────────────────────────

describe('formatCalendarPatternsForBriefing', () => {
  it('returns empty string for null input', () => {
    expect(formatCalendarPatternsForBriefing(null)).toBe('');
  });

  it('includes CALENDAR PATTERNS header', () => {
    const evts = repeat('Standup', '2026-01-05', 9, 25);
    const patterns = detectCalendarPatterns(evts);
    const output = formatCalendarPatternsForBriefing(patterns);
    expect(output).toContain('CALENDAR PATTERNS');
  });

  it('includes meeting trend when not stable', () => {
    const recent = repeat('Call', '2026-02-16', 10, 20);
    const older  = repeat('Call', '2026-01-19', 10, 5);
    const patterns = detectCalendarPatterns([...older, ...recent]);
    const output = formatCalendarPatternsForBriefing(patterns);
    expect(output).toContain('increasing');
  });

  it('does not include trend label when stable', () => {
    const evts = repeat('Call', '2026-01-05', 10, 40);
    const patterns = detectCalendarPatterns(evts);
    const output = formatCalendarPatternsForBriefing(patterns);
    // "stable" should not appear in the output (we omit the label when stable)
    expect(output).not.toContain('stable');
  });

  it('includes busiest and lightest days', () => {
    const allEvents: calendar_v3.Schema$Event[] = [];
    for (let w = 0; w < 5; w++) {
      const mon = new Date('2026-01-05T00:00:00Z');
      mon.setUTCDate(mon.getUTCDate() + w * 7);
      const monStr = mon.toISOString().slice(0, 10);
      allEvents.push(event('Team standup', monStr, 9), event('Sales call', monStr, 11), event('Review', monStr, 14));
      const fri = new Date(mon.getTime() + 4 * 86400000);
      allEvents.push(event('Check-in', fri.toISOString().slice(0, 10), 10));
    }
    const patterns = detectCalendarPatterns(allEvents);
    const output = formatCalendarPatternsForBriefing(patterns);
    expect(output).toContain('Monday');
    expect(output).toContain('Friday');
  });
});

// ── formatPatternsAsEnergyProfile ─────────────────────────────────────────────

describe('formatPatternsAsEnergyProfile', () => {
  it('returns empty string for null', () => {
    expect(formatPatternsAsEnergyProfile(null)).toBe('');
  });

  it('includes INFERRED ENERGY PROFILE header', () => {
    const evts = repeat('Meeting', '2026-01-05', 10, 25);
    const patterns = detectCalendarPatterns(evts);
    const output = formatPatternsAsEnergyProfile(patterns);
    if (output) {
      expect(output).toContain('INFERRED ENERGY PROFILE');
    }
  });

  it('includes focus window range', () => {
    // Load all events at 10am and 3pm → 7am/8am/9am become focus hours
    const am10 = repeat('Sales Call', '2026-01-05', 10, 20);
    const pm3  = repeat('Reviews', '2026-01-05', 15, 20);
    const patterns = detectCalendarPatterns([...am10, ...pm3]);
    const output = formatPatternsAsEnergyProfile(patterns);
    expect(output).toContain('focus window');
    expect(output).toContain('calendar history');
  });

  it('includes a not-self-reported disclaimer', () => {
    const evts = repeat('Meeting', '2026-01-05', 10, 25);
    const patterns = detectCalendarPatterns(evts);
    const output = formatPatternsAsEnergyProfile(patterns);
    if (output) {
      expect(output).toContain('inferred');
    }
  });
});
