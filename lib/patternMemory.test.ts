import { describe, it, expect } from 'vitest';
import {
  detectProductiveDayPattern,
  detectLightDayPattern,
  detectMeetingLoadRecoveryPattern,
  detectFocusWindowPattern,
  detectPriorityDriftPattern,
  pickBestPattern,
  formatPatternForBriefing,
  type PatternInsight,
  type PriorityWeek,
} from './patternMemory';
import type { calendar_v3 } from 'googleapis';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TZ = 'UTC';
const NOW = '2026-06-17T20:00:00.000Z';

/** Make a timed event on a given UTC datetime */
function ev(
  startIso: string,
  durationMin: number,
  summary = 'Meeting',
): calendar_v3.Schema$Event {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + durationMin * 60000);
  return {
    id: Math.random().toString(36).slice(2),
    summary,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };
}

/**
 * Build a set of events for N weeks, placing long focus blocks on specified days.
 * weeks: number of weeks to generate (going back from NOW)
 * focusDays: 0=Mon,1=Tue,...4=Fri — which days get a long uninterrupted block
 */
function buildCalendarHistory(
  weeks: number,
  focusDays: number[], // 0=Mon ... 4=Fri
): calendar_v3.Schema$Event[] {
  const events: calendar_v3.Schema$Event[] = [];
  const base = new Date('2026-06-15T00:00:00Z'); // Monday 2026-06-15 (Jun 17 2026 = Wednesday)

  for (let w = 0; w < weeks; w++) {
    // For each weekday...
    for (let d = 0; d < 5; d++) {
      const dayMs = base.getTime() - w * 7 * 86400000 + d * 86400000;
      const dayDate = new Date(dayMs);
      if (dayDate.toISOString() >= NOW) continue;

      const dayIso = dayDate.toISOString().slice(0, 10);

      if (focusDays.includes(d)) {
        // One 90-min focus block at 9 AM — uninterrupted
        events.push(ev(`${dayIso}T09:00:00Z`, 90, 'Deep Work'));
      } else {
        // Three 30-min meetings — fragmented
        events.push(ev(`${dayIso}T09:00:00Z`, 30, 'Standup'));
        events.push(ev(`${dayIso}T10:00:00Z`, 30, 'Sync'));
        events.push(ev(`${dayIso}T11:00:00Z`, 30, 'Review'));
      }
    }
  }
  return events;
}

// ── detectProductiveDayPattern ────────────────────────────────────────────────

describe('detectProductiveDayPattern', () => {
  it('returns null when fewer than 15 events', () => {
    const events = [ev('2026-06-09T09:00:00Z', 90), ev('2026-06-09T11:00:00Z', 30)];
    expect(detectProductiveDayPattern(events, TZ, NOW)).toBeNull();
  });

  it('detects Tuesday as most productive when it consistently has focus blocks', () => {
    // Tuesdays (d=1) have 90-min uninterrupted blocks; others have short fragmented meetings
    const events = buildCalendarHistory(8, [1]); // 8 weeks, only Tuesdays are productive
    const result = detectProductiveDayPattern(events, TZ, NOW);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('productive_day');
    expect(result?.summary).toContain('Tuesday');
  });

  it('returns null when all days are equally productive (no standout)', () => {
    // All 5 days have uninterrupted blocks — no single day stands out
    const events = buildCalendarHistory(6, [0, 1, 2, 3, 4]);
    const result = detectProductiveDayPattern(events, TZ, NOW);
    // No meaningful difference between days → should return null
    expect(result).toBeNull();
  });

  it('result has sampleDays >= 3', () => {
    const events = buildCalendarHistory(8, [2]); // Wednesdays
    const result = detectProductiveDayPattern(events, TZ, NOW);
    if (result) expect(result.sampleDays).toBeGreaterThanOrEqual(3);
  });
});

// ── detectLightDayPattern ────────────────────────────────────────────────────

describe('detectLightDayPattern', () => {
  it('returns null when fewer than 10 events', () => {
    expect(detectLightDayPattern([], TZ, NOW)).toBeNull();
  });

  it('detects Friday as lightest when it has significantly fewer meetings', () => {
    const events: calendar_v3.Schema$Event[] = [];
    const base = new Date('2026-06-15T00:00:00Z'); // Monday 2026-06-15
    for (let w = 0; w < 8; w++) {
      for (let d = 0; d < 5; d++) {
        const dayMs = base.getTime() - w * 7 * 86400000 + d * 86400000;
        const dayIso = new Date(dayMs).toISOString().slice(0, 10);
        if (new Date(dayMs).toISOString() >= NOW) continue;
        const count = d === 4 ? 1 : 5; // Fridays (d=4) have 1 meeting; others have 5
        for (let m = 0; m < count; m++) {
          const hour = (8 + m).toString().padStart(2, '0');
          events.push(ev(`${dayIso}T${hour}:00:00Z`, 30, `Meeting ${m}`));
        }
      }
    }
    const result = detectLightDayPattern(events, TZ, NOW);
    expect(result).not.toBeNull();
    expect(result?.summary).toContain('Friday');
  });

  it('returns null when all days have similar meeting counts', () => {
    // All days have exactly 3 meetings
    const events = buildCalendarHistory(6, []); // no focus days — all days get 3 short meetings
    const result = detectLightDayPattern(events, TZ, NOW);
    // 3 meetings on all days → no significant difference → null
    expect(result).toBeNull();
  });
});

// ── detectMeetingLoadRecoveryPattern ─────────────────────────────────────────

describe('detectMeetingLoadRecoveryPattern', () => {
  it('returns null when recovery history has fewer than 6 points', () => {
    const events = buildCalendarHistory(8, [1]);
    expect(detectMeetingLoadRecoveryPattern(events, [{ date: '2026-06-10', recoveryScore: 80 }], TZ, NOW)).toBeNull();
  });

  it('returns null when no paired heavy+light days with enough samples', () => {
    const events = buildCalendarHistory(4, [1, 2, 3]); // not enough days with ≥5 meetings
    const recovery = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-0${Math.floor(i / 5) + 5}-${String(i % 28 + 1).padStart(2, '0')}`,
      recoveryScore: 70,
    }));
    const result = detectMeetingLoadRecoveryPattern(events, recovery, TZ, NOW);
    expect(result).toBeNull();
  });

  it('detects pattern when heavy meeting days precede lower recovery', () => {
    // Heavy days (Mon = 5 meetings) precede low recovery; light days (Fri = 1 meeting) precede high recovery
    const events: calendar_v3.Schema$Event[] = [];
    const recovery: { date: string; recoveryScore: number }[] = [];

    for (let w = 0; w < 10; w++) {
      const monDate = new Date(new Date('2026-06-09T00:00:00Z').getTime() - w * 7 * 86400000); // June 9 = Monday
      if (monDate.toISOString() >= NOW) continue;
      const monIso = monDate.toISOString().slice(0, 10);

      // Monday: 5 meetings → heavy day
      for (let m = 0; m < 5; m++) {
        const hour = (8 + m).toString().padStart(2, '0');
        events.push(ev(`${monIso}T${hour}:00:00Z`, 30, `Meeting ${m}`));
      }
      // Tuesday: low recovery
      const tueDate = new Date(monDate.getTime() + 86400000);
      recovery.push({ date: tueDate.toISOString().slice(0, 10), recoveryScore: 35 });

      // Friday: 1 meeting → light day
      const friDate = new Date(monDate.getTime() + 4 * 86400000);
      const friIso = friDate.toISOString().slice(0, 10);
      events.push(ev(`${friIso}T09:00:00Z`, 30, 'Light call'));
      // Saturday: high recovery
      const satDate = new Date(friDate.getTime() + 86400000);
      recovery.push({ date: satDate.toISOString().slice(0, 10), recoveryScore: 75 });
    }

    const result = detectMeetingLoadRecoveryPattern(events, recovery, TZ, NOW);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('meeting_load_recovery');
    expect(result?.summary).toContain('meetings');
  });
});

// ── detectFocusWindowPattern ──────────────────────────────────────────────────

describe('detectFocusWindowPattern', () => {
  it('returns null when fewer than 15 events', () => {
    expect(detectFocusWindowPattern([], TZ, NOW)).toBeNull();
  });

  it('detects 9–11 AM as focus window when consistently meeting-free', () => {
    const events: calendar_v3.Schema$Event[] = [];
    // 10 weeks: meetings always at 1PM and 3PM, never 9-10AM
    for (let w = 0; w < 10; w++) {
      for (let d = 0; d < 5; d++) {
        const dayMs = new Date('2026-06-15T00:00:00Z').getTime() - w * 7 * 86400000 + d * 86400000;
        const dayIso = new Date(dayMs).toISOString().slice(0, 10);
        if (new Date(dayMs).toISOString() >= NOW) continue;
        events.push(ev(`${dayIso}T13:00:00Z`, 60, 'Afternoon sync'));
        events.push(ev(`${dayIso}T15:00:00Z`, 60, 'Review'));
      }
    }
    const result = detectFocusWindowPattern(events, TZ, NOW);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('focus_window');
    expect(result?.summary).toMatch(/AM|PM/);
  });
});

// ── pickBestPattern ───────────────────────────────────────────────────────────

describe('pickBestPattern', () => {
  it('returns null when all inputs are null', () => {
    expect(pickBestPattern([null, null, null])).toBeNull();
  });

  it('prefers high confidence over medium', () => {
    const med: PatternInsight = { type: 'focus_window', summary: 'medium', confidence: 'medium', sampleDays: 30 };
    const high: PatternInsight = { type: 'productive_day', summary: 'high', confidence: 'high', sampleDays: 10 };
    expect(pickBestPattern([med, high])).toBe(high);
  });

  it('prefers more sampleDays when confidence is equal', () => {
    const a: PatternInsight = { type: 'productive_day', summary: 'a', confidence: 'high', sampleDays: 20 };
    const b: PatternInsight = { type: 'light_day', summary: 'b', confidence: 'high', sampleDays: 8 };
    expect(pickBestPattern([a, b])).toBe(a);
  });

  it('filters out nulls and returns the only valid pattern', () => {
    const p: PatternInsight = { type: 'light_day', summary: 'light', confidence: 'medium', sampleDays: 5 };
    expect(pickBestPattern([null, p, null])).toBe(p);
  });
});

// ── formatPatternForBriefing ──────────────────────────────────────────────────

describe('formatPatternForBriefing', () => {
  it('returns empty string for null', () => {
    expect(formatPatternForBriefing(null)).toBe('');
  });

  it('includes the summary and confidence', () => {
    const p: PatternInsight = {
      type: 'productive_day',
      summary: 'Tuesdays are clearest',
      confidence: 'high',
      sampleDays: 12,
    };
    const result = formatPatternForBriefing(p);
    expect(result).toContain('Tuesdays are clearest');
    expect(result).toContain('high confidence');
    expect(result).toContain('12 data points');
  });
});


// ── detectPriorityDriftPattern (M2-3 #5) ─────────────────────────────────────

describe('detectPriorityDriftPattern', () => {
  function wk(weekOf: string, ...priorities: string[]): PriorityWeek {
    return { weekOf, priorities };
  }

  it('returns null with fewer than 3 weeks of data', () => {
    expect(detectPriorityDriftPattern([
      wk('2026-06-01', 'Fundraising'),
      wk('2026-06-08', 'Fundraising'),
    ])).toBeNull();
  });

  it('returns null when weeks have no priorities', () => {
    expect(detectPriorityDriftPattern([
      wk('2026-06-01'),
      wk('2026-06-08'),
      wk('2026-06-15'),
    ])).toBeNull();
  });

  it('reinforces a stable top priority held across most weeks', () => {
    const r = detectPriorityDriftPattern([
      wk('2026-06-01', 'Fundraising', 'Hiring'),
      wk('2026-06-08', 'Fundraising', 'Product'),
      wk('2026-06-15', 'Fundraising', 'Hiring'),
      wk('2026-06-22', 'Fundraising', 'Hiring'),
    ]);
    expect(r).not.toBeNull();
    expect(r?.type).toBe('priority_drift');
    expect(r?.summary).toContain('Fundraising');
    expect(r?.summary.toLowerCase()).toContain('consistency');
  });

  it('surfaces churn as an opportunity (never critical) when priorities shift every week', () => {
    const r = detectPriorityDriftPattern([
      wk('2026-06-01', 'Fundraising'),
      wk('2026-06-08', 'Hiring'),
      wk('2026-06-15', 'Marketing'),
      wk('2026-06-22', 'Product'),
    ]);
    expect(r).not.toBeNull();
    expect(r?.type).toBe('priority_drift');
    expect(r?.summary.toLowerCase()).toContain('anchor');
    // TONE: never blame the user
    expect(r?.summary.toLowerCase()).not.toContain('you keep');
    expect(r?.summary.toLowerCase()).not.toContain('failing');
  });

  it('returns null on moderate stability (no strong signal)', () => {
    // Half overlap each week — neither stable nor churning
    const r = detectPriorityDriftPattern([
      wk('2026-06-01', 'Fundraising', 'Hiring'),
      wk('2026-06-08', 'Fundraising', 'Marketing'),
      wk('2026-06-15', 'Product', 'Marketing'),
    ]);
    expect(r).toBeNull();
  });

  it('confidence is high with 5+ weeks of data', () => {
    const r = detectPriorityDriftPattern([
      wk('2026-05-25', 'Fundraising'),
      wk('2026-06-01', 'Fundraising'),
      wk('2026-06-08', 'Fundraising'),
      wk('2026-06-15', 'Fundraising'),
      wk('2026-06-22', 'Fundraising'),
    ]);
    expect(r?.confidence).toBe('high');
    expect(r?.sampleDays).toBe(5);
  });

  it('is order-independent (sorts by weekOf)', () => {
    const r = detectPriorityDriftPattern([
      wk('2026-06-22', 'Fundraising', 'Hiring'),
      wk('2026-06-01', 'Fundraising', 'Hiring'),
      wk('2026-06-15', 'Fundraising', 'Hiring'),
    ]);
    expect(r).not.toBeNull();
    expect(r?.summary).toContain('Fundraising');
  });
});
