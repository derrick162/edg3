import { describe, it, expect } from 'vitest';
import type { calendar_v3 } from 'googleapis';
import type { Fact, Priority, OpenLoop } from './db';
import {
  normalizeThemeTitle,
  extractCalendarThemes,
  calendarSpanDays,
  buildDerivePrompt,
} from './priorityDerivation';

// ── Factories ─────────────────────────────────────────────────────────────────

function timedEvent(title: string, startISO: string, durationHours: number): calendar_v3.Schema$Event {
  const start = new Date(startISO);
  const end = new Date(start.getTime() + durationHours * 3600000);
  return {
    summary: title,
    start: { dateTime: start.toISOString() },
    end:   { dateTime: end.toISOString() },
  };
}

function allDayEvent(title: string, date: string, days = 1): calendar_v3.Schema$Event {
  const end = new Date(new Date(date).getTime() + days * 86400000);
  return {
    summary: title,
    start: { date },
    end:   { date: end.toISOString().slice(0, 10) },
  };
}

function makeFact(category: Fact['category'], statement: string): Fact {
  return {
    id: 1, user_id: 1, category, statement, entity: null,
    learned_at: '2026-06-01T00:00:00', confidence: 'high', source_briefing_id: null,
  };
}

function makePriority(text: string, rank = 1): Priority {
  return { id: rank, user_id: 1, text, rank, week_of: '2026-06-16', created_at: '2026-06-16T00:00:00', energy_cost: undefined };
}

function makeOpenLoop(description: string, type: OpenLoop['type'] = 'commitment_made'): OpenLoop {
  return {
    id: 1, userId: 1, description, type, source: 'email', dueDate: null,
    status: 'open', createdAt: '2026-06-16T00:00:00', resolvedAt: null, snoozedUntil: null,
  };
}

// ── normalizeThemeTitle ───────────────────────────────────────────────────────

describe('normalizeThemeTitle', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeThemeTitle('Investor Call!')).toBe('investor');
  });

  it('filters stop words', () => {
    // "meeting" is a stop word; "investor" is not
    expect(normalizeThemeTitle('Investor Meeting')).toBe('investor');
  });

  it('caps at 4 meaningful words', () => {
    const result = normalizeThemeTitle('Product Launch Strategy Planning Session Review');
    expect(result.split(' ').length).toBeLessThanOrEqual(4);
  });

  it('returns empty string for all-stop-word titles', () => {
    expect(normalizeThemeTitle('Meeting Call Sync')).toBe('');
  });

  it('ignores short words (< 3 chars)', () => {
    expect(normalizeThemeTitle('1:1 with PM')).toBe('');
  });

  it('handles ⚡ prefix (stripped via punctuation removal)', () => {
    const result = normalizeThemeTitle('⚡ Focus block');
    expect(result).not.toContain('⚡');
  });
});

// ── extractCalendarThemes ─────────────────────────────────────────────────────

describe('extractCalendarThemes', () => {
  it('returns empty array for no events', () => {
    expect(extractCalendarThemes([])).toEqual([]);
  });

  it('skips events with 0 duration or no title', () => {
    const noTitle: calendar_v3.Schema$Event = { start: { dateTime: '2026-06-01T09:00:00Z' }, end: { dateTime: '2026-06-01T10:00:00Z' } };
    const noDuration: calendar_v3.Schema$Event = { summary: 'Quick ping', start: { dateTime: '2026-06-01T09:00:00Z' }, end: { dateTime: '2026-06-01T09:00:00Z' } };
    expect(extractCalendarThemes([noTitle, noDuration])).toEqual([]);
  });

  it('groups events with the same normalized title', () => {
    const events = [
      timedEvent('Investor call', '2026-06-01T09:00:00Z', 1),
      timedEvent('Investor call', '2026-06-08T09:00:00Z', 1),
      timedEvent('Investor Call', '2026-06-15T09:00:00Z', 1), // same when normalized
    ];
    const themes = extractCalendarThemes(events);
    expect(themes).toHaveLength(1);
    expect(themes[0].count).toBe(3);
    expect(themes[0].totalHours).toBe(3);
  });

  it('sorts by totalHours descending', () => {
    const events = [
      timedEvent('Quick chat', '2026-06-01T09:00:00Z', 0.5),
      timedEvent('Deep work session', '2026-06-01T10:00:00Z', 3),
      timedEvent('Deep work session', '2026-06-02T10:00:00Z', 3),
    ];
    const themes = extractCalendarThemes(events);
    expect(themes[0].totalHours).toBeGreaterThan(themes[themes.length - 1].totalHours);
  });

  it('respects topN cap', () => {
    const events = Array.from({ length: 30 }, (_, i) =>
      timedEvent(`Unique event ${i}`, `2026-06-0${(i % 9) + 1}T09:00:00Z`, 1)
    );
    expect(extractCalendarThemes(events, 10).length).toBeLessThanOrEqual(10);
  });

  it('caps all-day event hours at 8 per day', () => {
    const e = allDayEvent('Las Vegas Conference', '2026-06-10', 5); // 5-day trip
    const themes = extractCalendarThemes([e]);
    expect(themes[0].totalHours).toBeLessThanOrEqual(8);
  });
});

// ── calendarSpanDays ──────────────────────────────────────────────────────────

describe('calendarSpanDays', () => {
  it('returns 0 for empty or single event', () => {
    expect(calendarSpanDays([])).toBe(0);
    expect(calendarSpanDays([timedEvent('A', '2026-06-01T09:00:00Z', 1)])).toBe(0);
  });

  it('computes correct span between two events', () => {
    const events = [
      timedEvent('First', '2026-06-01T09:00:00Z', 1),
      timedEvent('Last',  '2026-06-29T09:00:00Z', 1),
    ];
    expect(calendarSpanDays(events)).toBe(28);
  });

  it('handles mixed timed and all-day events', () => {
    const events = [
      timedEvent('Meeting', '2026-06-01T09:00:00Z', 1),
      allDayEvent('Conference', '2026-06-15'),
    ];
    expect(calendarSpanDays(events)).toBe(14);
  });
});

// ── buildDerivePrompt ─────────────────────────────────────────────────────────

describe('buildDerivePrompt', () => {
  const baseOpts = {
    themes: [] as ReturnType<typeof extractCalendarThemes>,
    facts: [] as Fact[],
    openLoops: [] as OpenLoop[],
    emailThreads: [] as { threadId: string; sender: string; subject: string; snippet: string; date: string; isUnread: boolean; isImportant: boolean }[],
    currentPriorities: [] as Priority[],
    calendarDaysSpanned: 0,
  };

  it('includes calendar themes when provided', () => {
    const themes = [{ title: 'Investor call', count: 8, totalHours: 8 }];
    const prompt = buildDerivePrompt({ ...baseOpts, themes, calendarDaysSpanned: 56 });
    expect(prompt).toContain('Investor call');
    expect(prompt).toContain('8×');
  });

  it('includes goal facts', () => {
    const facts = [makeFact('goal', 'Close seed round by July 15')];
    const prompt = buildDerivePrompt({ ...baseOpts, facts });
    expect(prompt).toContain('Close seed round');
  });

  it('includes open commitments', () => {
    const openLoops = [makeOpenLoop('Follow up with Ansi re: term sheet')];
    const prompt = buildDerivePrompt({ ...baseOpts, openLoops });
    expect(prompt).toContain('Follow up with Ansi');
  });

  it('includes current priorities', () => {
    const currentPriorities = [makePriority('Launch beta by June 30')];
    const prompt = buildDerivePrompt({ ...baseOpts, currentPriorities });
    expect(prompt).toContain('Launch beta by June 30');
    expect(prompt).toContain('CURRENT STATED PRIORITIES');
  });

  it('includes email threads', () => {
    const emailThreads = [
      { threadId: 't1', sender: 'ansi@vc.com', subject: 'Term sheet follow-up', snippet: '...', date: '2026-06-17', isUnread: true, isImportant: true },
    ];
    const prompt = buildDerivePrompt({ ...baseOpts, emailThreads });
    expect(prompt).toContain('Term sheet follow-up');
  });

  it('instructs the model to respond with JSON only', () => {
    const prompt = buildDerivePrompt(baseOpts);
    expect(prompt).toContain('Respond ONLY with a JSON object');
    expect(prompt).toContain('"priorities"');
  });

  it('omits sections with no data', () => {
    const prompt = buildDerivePrompt(baseOpts); // all empty
    expect(prompt).not.toContain('CALENDAR THEMES');
    expect(prompt).not.toContain('STATED GOALS');
    expect(prompt).not.toContain('OPEN COMMITMENTS');
  });

  it('sanitizes multiline content', () => {
    const facts = [makeFact('goal', 'Close\nthe\ndeal')];
    const prompt = buildDerivePrompt({ ...baseOpts, facts });
    expect(prompt).not.toContain('\n\nClose'); // newlines stripped within fact
  });
});
