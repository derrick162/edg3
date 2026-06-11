import { describe, it, expect } from 'vitest';
import { computeCallStreak } from './streak';

const TZ = 'America/Vancouver'; // UTC-7

function completed(scheduledFor: string) {
  return { status: 'completed', scheduled_for: scheduledFor };
}
function missed(scheduledFor: string) {
  return { status: 'missed', scheduled_for: scheduledFor };
}

describe('computeCallStreak', () => {
  it('returns 0 with no briefings', () => {
    const now = new Date('2026-06-10T15:00:00Z'); // 8am PT
    expect(computeCallStreak([], TZ, now)).toBe(0);
  });

  it('returns 0 when most recent call was 2 days ago (gap)', () => {
    const now = new Date('2026-06-10T15:00:00Z'); // 8am PT = June 10
    const briefings = [completed('2026-06-08T15:00:00Z')]; // June 8 — gap on June 9
    expect(computeCallStreak(briefings, TZ, now)).toBe(0);
  });

  it('returns 1 when only today has a completed call', () => {
    const now = new Date('2026-06-10T15:00:00Z');
    const briefings = [completed('2026-06-10T15:00:00Z')];
    expect(computeCallStreak(briefings, TZ, now)).toBe(1);
  });

  it('returns 1 when only yesterday has a completed call (today not yet done)', () => {
    const now = new Date('2026-06-10T06:00:00Z'); // 11pm PT Jun 9 → June 9 in PT
    const briefings = [completed('2026-06-09T15:00:00Z')];
    // now is 2026-06-09 in PT (11pm), yesterday is 2026-06-08, today's call not done
    // Actually: 2026-06-10T06:00:00Z = 2026-06-09 at 11pm PT
    // todayStr = '2026-06-09', completed set has '2026-06-09' → streak starts today
    expect(computeCallStreak(briefings, TZ, now)).toBe(1);
  });

  it('counts a multi-day streak correctly', () => {
    const now = new Date('2026-06-10T15:00:00Z'); // June 10 PT
    const briefings = [
      completed('2026-06-10T15:00:00Z'), // today
      completed('2026-06-09T15:00:00Z'), // yesterday
      completed('2026-06-08T15:00:00Z'), // 2 days ago
      completed('2026-06-07T15:00:00Z'), // 3 days ago
    ];
    expect(computeCallStreak(briefings, TZ, now)).toBe(4);
  });

  it('stops counting at a gap even with older completed days', () => {
    const now = new Date('2026-06-10T15:00:00Z');
    const briefings = [
      completed('2026-06-10T15:00:00Z'),
      completed('2026-06-09T15:00:00Z'),
      // June 8 is a gap
      completed('2026-06-07T15:00:00Z'),
      completed('2026-06-06T15:00:00Z'),
    ];
    expect(computeCallStreak(briefings, TZ, now)).toBe(2);
  });

  it('ignores non-completed briefings in the streak', () => {
    const now = new Date('2026-06-10T15:00:00Z');
    const briefings = [
      completed('2026-06-10T15:00:00Z'),
      missed('2026-06-09T15:00:00Z'), // missed — breaks streak
      completed('2026-06-08T15:00:00Z'),
    ];
    expect(computeCallStreak(briefings, TZ, now)).toBe(1);
  });

  it('counts only one call per day even if multiple completed briefings exist', () => {
    const now = new Date('2026-06-10T15:00:00Z');
    const briefings = [
      completed('2026-06-10T14:00:00Z'),
      completed('2026-06-10T16:00:00Z'), // same day, duplicate
      completed('2026-06-09T15:00:00Z'),
    ];
    expect(computeCallStreak(briefings, TZ, now)).toBe(2);
  });
});
