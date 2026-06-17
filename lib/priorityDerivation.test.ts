import { describe, it, expect } from 'vitest';
import type { calendar_v3 } from 'googleapis';
import type { Fact, Priority, OpenLoop } from './db';
import {
  normalizeThemeTitle,
  extractCalendarThemes,
  calendarSpanDays,
  buildDerivePrompt,
} from './priorityDerivation';

// ─── Factories ────────────────────────────────────────────────────────────────

function timedEvent(summary: string, startISO: string, endISO: string): calendar_v3.Schema$Event {
  return { summary, start: { dateTime: startISO }, end: { dateTime: endISO } };
}

function allDayEvent(summary: string, startDate: string, endDate: string): calendar_v3.Schema$Event {
  return { summary, start: { date: startDate }, end: { date: endDate } };
}

function makeP(text: string, rank = 1): Priority {
  return { id: rank, user_id: 1, text, rank, week_of: '2026-06-15', created_at: '2026-06-15T00:00:00', energy_cost: undefined };
}

function makeFact(category: Fact['category'], statement: string, entity: string | null = null): Fact {
  return { id: 1, user_id: 1, category, entity, statement, learned_at: '2026-06-01', confidence: 'high', source_briefing_id: null };
}

function makeLoop(description: string): OpenLoop {
  return {
    id: 1, userId: 1, description, type: 'commitment_made', source: 'call',
    dueDate: null, status: 'open', createdAt: '2026-06-01', resolvedAt: null, snoozedUntil: null,
  };
}

type EmailThread = Parameters<typeof buildDerivePrompt>[0]['emailThreads'][number];
function makeThread(subject: string, sender: string): EmailThread {
  return { subject, sender, snippet: 'snippet', date: '2026-06-01', threadId: 'abc', isUnread: false, isImportant: false };
}

// ─── normalizeThemeTitle ──────────────────────────────────────────────────────

describe('normalizeThemeTitle', () => {
  it('strips stop words and lowercases', () => {
    expect(normalizeThemeTitle('Meeting with Investor')).toBe('investor');
  });

  it('takes up to 4 meaningful words', () => {
    expect(normalizeThemeTitle('Fundraising Pitch Deck Review Call')).toBe('fundraising pitch deck');
  });

  it('strips punctuation', () => {
    const result = normalizeThemeTitle('Series A — Q&A');
    expect(result).toContain('series');
    expect(result).not.toContain('—');
  });

  it('returns empty string for pure stop-word titles', () => {
    // All words are in THEME_STOP_WORDS: meeting, with, the, sync
    expect(normalizeThemeTitle('Meeting with the Sync')).toBe('');
  });

  it('handles empty string', () => {
    expect(normalizeThemeTitle('')).toBe('');
  });

  it('keeps words ≥3 chars and filters 1-2 char tokens', () => {
    // "To" (2), "Do" (2), "a" (1) filtered by length; "Product" and "Launch" pass
    expect(normalizeThemeTitle('To Do a Product Launch')).toBe('product launch');
  });
});

// ─── extractCalendarThemes ────────────────────────────────────────────────────

describe('extractCalendarThemes', () => {
  it('returns empty array for no events', () => {
    expect(extractCalendarThemes([])).toEqual([]);
  });

  it('groups events with the same normalized title and sums hours', () => {
    const events = [
      timedEvent('Investor call', '2026-06-01T09:00:00Z', '2026-06-01T10:00:00Z'), // 1h
      timedEvent('Call with investor', '2026-06-02T09:00:00Z', '2026-06-02T10:00:00Z'), // 1h — same key
    ];
    const themes = extractCalendarThemes(events);
    const t = themes.find(t => t.title.toLowerCase().includes('investor'));
    expect(t).toBeDefined();
    expect(t!.count).toBe(2);
    expect(t!.totalHours).toBeCloseTo(2, 1);
  });

  it('skips events with zero duration', () => {
    const event = timedEvent('Bogus', '2026-06-01T09:00:00Z', '2026-06-01T09:00:00Z');
    expect(extractCalendarThemes([event])).toHaveLength(0);
  });

  it('handles all-day events with 8h cap per day', () => {
    const event = allDayEvent('Conference', '2026-06-01', '2026-06-02'); // 1 day
    const themes = extractCalendarThemes([event]);
    expect(themes).toHaveLength(1);
    expect(themes[0].totalHours).toBe(8);
  });

  it('caps multi-day all-day events at 8h (not N×8)', () => {
    const event = allDayEvent('Retreat', '2026-06-01', '2026-06-04'); // 3 days → min(3,1)*8 = 8
    const themes = extractCalendarThemes([event]);
    expect(themes[0].totalHours).toBe(8);
  });

  it('skips events with empty or whitespace-only summary', () => {
    const event: calendar_v3.Schema$Event = {
      summary: '   ',
      start: { dateTime: '2026-06-01T09:00:00Z' },
      end:   { dateTime: '2026-06-01T10:00:00Z' },
    };
    expect(extractCalendarThemes([event])).toHaveLength(0);
  });

  it('sorts by totalHours descending', () => {
    const events = [
      timedEvent('Short task', '2026-06-01T09:00:00Z', '2026-06-01T09:30:00Z'), // 0.5h
      timedEvent('Long project work', '2026-06-01T10:00:00Z', '2026-06-01T14:00:00Z'), // 4h
    ];
    const themes = extractCalendarThemes(events);
    expect(themes[0].totalHours).toBeGreaterThan(themes[themes.length - 1].totalHours);
  });

  it('respects topN limit', () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      timedEvent(`Unique item ${i} project`, '2026-06-01T09:00:00Z', '2026-06-01T10:00:00Z'),
    );
    const themes = extractCalendarThemes(events, 5);
    expect(themes.length).toBeLessThanOrEqual(5);
  });

  it('skips events whose normalized title is empty (pure stop words)', () => {
    // "lunch" is in THEME_STOP_WORDS → key = '' → skipped
    const events = [
      timedEvent('Lunch', '2026-06-01T12:00:00Z', '2026-06-01T13:00:00Z'),
    ];
    expect(extractCalendarThemes(events)).toHaveLength(0);
  });
});

// ─── calendarSpanDays ─────────────────────────────────────────────────────────

describe('calendarSpanDays', () => {
  it('returns 0 for empty events', () => {
    expect(calendarSpanDays([])).toBe(0);
  });

  it('returns 0 for a single event', () => {
    const events = [timedEvent('Solo', '2026-06-01T09:00:00Z', '2026-06-01T10:00:00Z')];
    expect(calendarSpanDays(events)).toBe(0);
  });

  it('returns correct span for events on different days', () => {
    const events = [
      timedEvent('A', '2026-06-01T09:00:00Z', '2026-06-01T10:00:00Z'),
      timedEvent('B', '2026-06-08T09:00:00Z', '2026-06-08T10:00:00Z'),
    ];
    expect(calendarSpanDays(events)).toBe(7);
  });

  it('works with all-day events (date strings)', () => {
    const events = [
      allDayEvent('X', '2026-06-01', '2026-06-02'),
      allDayEvent('Y', '2026-06-15', '2026-06-16'),
    ];
    expect(calendarSpanDays(events)).toBe(14);
  });

  it('handles events out of chronological order', () => {
    const events = [
      timedEvent('B', '2026-06-15T09:00:00Z', '2026-06-15T10:00:00Z'),
      timedEvent('A', '2026-06-01T09:00:00Z', '2026-06-01T10:00:00Z'),
    ];
    expect(calendarSpanDays(events)).toBe(14);
  });

  it('ignores events with no start date', () => {
    const events: calendar_v3.Schema$Event[] = [
      { summary: 'No date' }, // no start
      timedEvent('Has date', '2026-06-01T09:00:00Z', '2026-06-01T10:00:00Z'),
    ];
    expect(calendarSpanDays(events)).toBe(0); // only 1 valid date → span = 0
  });
});

// ─── buildDerivePrompt ────────────────────────────────────────────────────────

describe('buildDerivePrompt', () => {
  const base = {
    themes: [] as ReturnType<typeof extractCalendarThemes>,
    facts: [] as Fact[],
    openLoops: [] as OpenLoop[],
    emailThreads: [] as EmailThread[],
    currentPriorities: [] as Priority[],
    calendarDaysSpanned: 0,
  };

  it('returns a non-empty string with JSON instruction', () => {
    const p = buildDerivePrompt(base);
    expect(p.length).toBeGreaterThan(100);
    expect(p).toContain('JSON');
  });

  it('includes current priorities when set', () => {
    const p = buildDerivePrompt({ ...base, currentPriorities: [makeP('Raise Series A')] });
    expect(p).toContain('Raise Series A');
    expect(p).toContain('CURRENT STATED PRIORITIES');
  });

  it('includes calendar themes with hours and window description', () => {
    const themes = [{ title: 'Investor pitch', count: 5, totalHours: 10 }];
    const p = buildDerivePrompt({ ...base, themes, calendarDaysSpanned: 30 });
    expect(p).toContain('Investor pitch');
    expect(p).toContain('10h total');
    expect(p).toContain('CALENDAR THEMES');
  });

  it('uses "past N weeks" for ≥7 day spans', () => {
    const themes = [{ title: 'Planning work', count: 1, totalHours: 1 }];
    const p = buildDerivePrompt({ ...base, themes, calendarDaysSpanned: 14 });
    expect(p).toContain('past 2 weeks');
  });

  it('uses "past N days" for <7 day spans', () => {
    const themes = [{ title: 'Planning work', count: 1, totalHours: 1 }];
    const p = buildDerivePrompt({ ...base, themes, calendarDaysSpanned: 5 });
    expect(p).toContain('past 5 days');
  });

  it('includes goal and project facts under STATED GOALS', () => {
    const facts = [makeFact('goal', 'Close Series A by Q4'), makeFact('project', 'Launch MVP')];
    const p = buildDerivePrompt({ ...base, facts });
    expect(p).toContain('STATED GOALS');
    expect(p).toContain('Close Series A by Q4');
    expect(p).toContain('Launch MVP');
  });

  it('includes preference facts under PREFERENCES', () => {
    const facts = [makeFact('preference', 'Peak work at 9-11am')];
    const p = buildDerivePrompt({ ...base, facts });
    expect(p).toContain('PREFERENCES');
    expect(p).toContain('Peak work at 9-11am');
  });

  it('includes open commitments', () => {
    const loops = [makeLoop('Send pitch deck to Faiza')];
    const p = buildDerivePrompt({ ...base, openLoops: loops });
    expect(p).toContain('OPEN COMMITMENTS');
    expect(p).toContain('Send pitch deck to Faiza');
  });

  it('excludes done loops from open commitments', () => {
    const loops: OpenLoop[] = [{ ...makeLoop('Done task'), status: 'done' }];
    const p = buildDerivePrompt({ ...base, openLoops: loops });
    expect(p).not.toContain('OPEN COMMITMENTS');
  });

  it('includes email threads', () => {
    const emailThreads = [makeThread('Follow up on term sheet', 'investor@vc.com')];
    const p = buildDerivePrompt({ ...base, emailThreads });
    expect(p).toContain('RECENT EMAIL THREADS');
    expect(p).toContain('Follow up on term sheet');
  });

  it('omits empty sections when no data provided', () => {
    const p = buildDerivePrompt(base);
    expect(p).not.toContain('CURRENT STATED PRIORITIES');
    expect(p).not.toContain('CALENDAR THEMES');
    expect(p).not.toContain('OPEN COMMITMENTS');
    expect(p).not.toContain('PREFERENCES');
  });

  it('sanitizes newlines within priority text (replaces with space)', () => {
    const p = buildDerivePrompt({ ...base, currentPriorities: [makeP('Line1\nLine2')] });
    // The sanitize fn replaces \n with ' ' inside the text itself
    expect(p).toContain('Line1 Line2');
  });
});
