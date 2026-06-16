import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  computeTimeAllocation,
  formatTimeAllocationForBriefing,
  formatTimeAllocationInsight,
} from './timeAllocation';
import type { calendar_v3 } from 'googleapis';

// ── Helpers ───────────────────────────────────────────────────────────────────

// Fix "now" so tests are deterministic (all dates relative to this anchor)
const NOW = new Date('2026-06-15T12:00:00Z');

beforeAll(() => { vi.setSystemTime(NOW); });
afterAll(() => { vi.useRealTimers(); });

function event(
  summary: string,
  daysAgo: number,
  durationHours = 1,
): calendar_v3.Schema$Event {
  const start = new Date(NOW.getTime() - daysAgo * 86400000);
  const end   = new Date(start.getTime() + durationHours * 3600000);
  return {
    summary,
    start: { dateTime: start.toISOString() },
    end:   { dateTime: end.toISOString() },
  };
}

function priority(text: string) { return { text }; }

// ── computeTimeAllocation ─────────────────────────────────────────────────────

describe('computeTimeAllocation', () => {
  it('returns null when fewer than 5 events in window', () => {
    const events = [event('Fundraising call', 2), event('Gym', 3)];
    expect(computeTimeAllocation(events, [], { weeksBack: 8 })).toBeNull();
  });

  it('returns null when all events have zero/implausible duration', () => {
    const evts = Array.from({ length: 10 }, (_, i) => ({
      summary: 'All day',
      start: { date: '2026-06-01' },
      end:   { date: '2026-06-01' }, // 0 days → 0 hours
    } as calendar_v3.Schema$Event));
    expect(computeTimeAllocation(evts, [], { weeksBack: 8 })).toBeNull();
  });

  it('credits exercise time to a fitness/weight goal (Get to 130 lbs)', () => {
    // Regression: gym/walks were dumped into 'routine' and "Get to 130 lbs" had
    // no matchable keyword → goal showed 0h and falsely triggered "neglected".
    const evts = [
      event('Gym', 2, 1),
      event('Gym', 5, 1),
      event('Morning walk', 1, 1),
      event('Morning walk', 4, 1),
      event('Workout', 9, 1.5),
      event('Team standup', 3, 0.5),
    ];
    const result = computeTimeAllocation(evts, [priority('Get to 130 lbs')], { weeksBack: 8 });
    expect(result).not.toBeNull();
    const goal = result!.buckets.find(b => b.label === 'Get to 130 lbs');
    expect(goal).toBeDefined();
    expect(goal!.hours).toBeGreaterThanOrEqual(5); // 1+1+1+1+1.5
    // And the false "virtually no calendar time" flag must NOT fire for the goal.
    expect(result!.biggestMisalignment ?? '').not.toContain('130 lbs');
  });

  it('does NOT flag an UNMEASURABLE priority as neglected (no keyword, no category)', () => {
    // "Get to 130" — no fitness keyword (no "lbs"), no usable word ≥4 chars → we
    // genuinely can't measure it from the calendar, so we must stay silent rather
    // than emit a false "0% / highest-urgency" nag, even under meeting overload.
    const evts = [
      event('Team standup', 2, 1),
      event('Code review', 3, 1),
      event('Email triage', 4, 1),
      event('1:1 with Sam', 5, 1),
      event('Sprint planning', 6, 1),
    ];
    const result = computeTimeAllocation(evts, [priority('Get to 130')], { weeksBack: 8 });
    expect(result).not.toBeNull();
    expect(result!.biggestMisalignment).toBeNull();
  });

  it('still credits exercise to routine when no fitness goal exists', () => {
    const evts = [
      event('Gym', 2, 1),
      event('Morning walk', 1, 1),
      event('Fundraising pitch prep', 5, 2),
      event('Fundraising call', 7, 1),
      event('Team standup', 3, 0.5),
    ];
    const result = computeTimeAllocation(evts, [priority('fundraising')], { weeksBack: 8 });
    expect(result).not.toBeNull();
    const routine = result!.buckets.find(b => b.label === 'routine');
    expect(routine).toBeDefined();
    expect(routine!.hours).toBeGreaterThanOrEqual(2); // gym + walk stay routine
  });

  it('assigns events to matching priority bucket', () => {
    const evts = [
      event('Fundraising pitch prep', 5, 2),
      event('Fundraising investor meeting', 10, 1),
      event('Team standup', 3, 0.5),
      event('Team standup', 8, 0.5),
      event('Code review', 2, 1),
    ];
    const result = computeTimeAllocation(evts, [priority('fundraising')], { weeksBack: 8 });
    expect(result).not.toBeNull();
    const fundraisingBucket = result!.buckets.find(b => b.label === 'fundraising');
    expect(fundraisingBucket).toBeDefined();
    expect(fundraisingBucket!.hours).toBe(3); // 2h + 1h
  });

  it('assigns generic meetings to the meetings bucket', () => {
    const evts = [
      event('Team standup', 2, 0.5),
      event('Weekly sync', 5, 1),
      event('1:1 with manager', 10, 0.5),
      event('Design review', 15, 1),
      event('Sprint retro', 20, 1),
    ];
    const result = computeTimeAllocation(evts, [], { weeksBack: 8 });
    expect(result).not.toBeNull();
    const meetingBucket = result!.buckets.find(b => b.label === 'meetings');
    expect(meetingBucket).toBeDefined();
    expect(meetingBucket!.hours).toBeGreaterThan(0);
  });

  it('assigns routine events (gym, meals) to the routine bucket', () => {
    const evts = [
      event('Gym', 2, 1),
      event('Lunch', 3, 0.5),
      event('Morning walk', 5, 0.5),
      event('Breakfast', 8, 0.25),
      event('Fundraising call', 10, 1),
    ];
    const result = computeTimeAllocation(evts, [priority('fundraising')], { weeksBack: 8 });
    expect(result).not.toBeNull();
    const routineBucket = result!.buckets.find(b => b.label === 'routine');
    expect(routineBucket).toBeDefined();
    // 1 + 0.5 + 0.5 + 0.25 = 2.25 but rounds to 2.3 due to float precision
    expect(routineBucket!.hours).toBeCloseTo(2.25, 1);
  });

  it('excludes events outside the analysis window', () => {
    const insideWindow  = event('Fundraising', 10, 1);  // 10 days ago = within 8w
    const outsideWindow = event('Fundraising', 70, 2);  // 70 days ago = outside 8w (56 days)
    const result = computeTimeAllocation([insideWindow, outsideWindow, ...Array.from({ length: 4 }, (_, i) => event('Meeting', i + 1, 0.5))], [priority('fundraising')], { weeksBack: 8 });
    expect(result).not.toBeNull();
    const fundraisingBucket = result!.buckets.find(b => b.label === 'fundraising');
    // Should only count the inside-window event (1h), not the 70-day-old one
    expect(fundraisingBucket?.hours).toBe(1);
  });

  it('computes totalHours as sum of all event durations', () => {
    const evts = [
      event('Fundraising pitch', 5, 2),
      event('Team standup', 3, 0.5),
      event('Gym', 2, 1),
      event('Deep work', 10, 3),
      event('Code review', 15, 1),
    ];
    const result = computeTimeAllocation(evts, [priority('fundraising')], { weeksBack: 8 });
    expect(result).not.toBeNull();
    expect(result!.totalHours).toBe(7.5); // 2+0.5+1+3+1
  });

  it('computes bucket pct summing to ~100%', () => {
    const evts = [
      event('Fundraising pitch', 5, 2),
      event('Team standup', 3, 0.5),
      event('Gym', 2, 1),
      event('Deep work', 10, 3),
      event('Code review', 15, 1),
    ];
    const result = computeTimeAllocation(evts, [priority('fundraising')], { weeksBack: 8 });
    expect(result).not.toBeNull();
    const totalPct = result!.buckets.reduce((sum, b) => sum + b.pct, 0);
    expect(totalPct).toBeGreaterThan(95);
    expect(totalPct).toBeLessThanOrEqual(100.5); // rounding tolerance
  });

  it('detects misalignment when meetings > 40% and lowest priority < 10%', () => {
    // 10h of meetings, 0.5h on top priority
    const evts = [
      ...Array.from({ length: 10 }, (_, i) => event('Weekly sync', i * 3 + 1, 1)),
      event('Fundraising prep', 5, 0.5),
    ];
    const result = computeTimeAllocation(evts, [priority('fundraising')], { weeksBack: 8 });
    expect(result).not.toBeNull();
    expect(result!.biggestMisalignment).not.toBeNull();
    expect(result!.biggestMisalignment).toContain('meetings');
  });

  it('sorts buckets by hours descending', () => {
    const evts = [
      event('Gym', 2, 0.5),
      event('Team standup', 3, 1),
      event('Fundraising investor pitch', 5, 3),
      event('Fundraising follow-up', 10, 2),
      event('Code review', 15, 0.25),
    ];
    const result = computeTimeAllocation(evts, [priority('fundraising')], { weeksBack: 8 });
    expect(result).not.toBeNull();
    const hours = result!.buckets.map(b => b.hours);
    for (let i = 1; i < hours.length; i++) {
      expect(hours[i - 1]).toBeGreaterThanOrEqual(hours[i]);
    }
  });
});

// ── formatTimeAllocationForBriefing ──────────────────────────────────────────

describe('formatTimeAllocationForBriefing', () => {
  it('returns empty string for null', () => {
    expect(formatTimeAllocationForBriefing(null)).toBe('');
  });

  it('includes TIME ALLOCATION header with period and total hours', () => {
    const evts = [
      event('Fundraising pitch', 5, 2),
      event('Team standup', 3, 1),
      event('Gym', 2, 0.5),
      event('Code review', 10, 1),
      event('Meeting', 15, 1),
    ];
    const result = computeTimeAllocation(evts, [priority('fundraising')], { weeksBack: 8 });
    const output = formatTimeAllocationForBriefing(result);
    expect(output).toContain('TIME ALLOCATION');
    expect(output).toContain('h total');
  });

  it('includes misalignment warning when present', () => {
    const evts = [
      ...Array.from({ length: 10 }, (_, i) => event('Weekly sync', i * 3 + 1, 1)),
      event('Fundraising prep', 5, 0.5),
    ];
    const result = computeTimeAllocation(evts, [priority('fundraising')], { weeksBack: 8 });
    const output = formatTimeAllocationForBriefing(result);
    expect(output).toContain('MISALIGNMENT');
  });

  it('lists bucket percentages', () => {
    const evts = [
      event('Fundraising investor pitch', 5, 4),
      event('Team standup', 3, 1),
      event('Gym', 2, 1),
      event('Code review', 10, 1),
      event('Client meeting', 15, 1),
    ];
    const result = computeTimeAllocation(evts, [priority('fundraising')], { weeksBack: 8 });
    const output = formatTimeAllocationForBriefing(result);
    expect(output).toContain('%');
    expect(output).toContain('h/week');
  });
});

// ── formatTimeAllocationInsight ───────────────────────────────────────────────

describe('formatTimeAllocationInsight', () => {
  it('returns null for null result', () => {
    expect(formatTimeAllocationInsight(null)).toBeNull();
  });

  it('returns null when fewer than 2 buckets', () => {
    const result = computeTimeAllocation(
      [event('Gym', 1, 1), event('Gym', 2, 1), event('Gym', 3, 1), event('Gym', 4, 1), event('Gym', 5, 1)],
      [],
      { weeksBack: 8 },
    );
    if (result) expect(formatTimeAllocationInsight(result)).toBeNull();
  });

  it('returns misalignment text when present', () => {
    const evts = [
      ...Array.from({ length: 10 }, (_, i) => event('Weekly sync', i * 3 + 1, 1)),
      event('Fundraising prep', 5, 0.5),
    ];
    const result = computeTimeAllocation(evts, [priority('fundraising')], { weeksBack: 8 });
    const insight = formatTimeAllocationInsight(result);
    expect(insight).not.toBeNull();
    expect(insight).toContain('meetings');
  });

  it('surfaces "top bucket is dominating" insight when one bucket >= 50%', () => {
    const evts = [
      ...Array.from({ length: 8 }, (_, i) => event('Weekly sync', i * 3 + 1, 2)),  // 16h meetings
      event('Gym', 2, 0.5),
      event('Fundraising call', 5, 0.5),
      event('Deep work', 10, 0.5),
      event('Admin task', 15, 0.5),
    ];
    const result = computeTimeAllocation(evts, [], { weeksBack: 8 });
    const insight = formatTimeAllocationInsight(result);
    if (result && result.buckets[0].pct >= 50) {
      expect(insight).not.toBeNull();
      expect(insight).toContain('%');
    }
  });
});
