import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: h.create };
  },
}));

vi.mock('./calendar', () => ({ getPastCalendarEvents: vi.fn() }));
vi.mock('./db', () => ({
  factQueries: { getAll: vi.fn() },
  memoryQueries: { getWeighted: vi.fn() },
}));

import { recommendFocusAreas, aggregateEventThemes, isUrgentEmail, formatEmailSignalForPrompt, type EnergySignal } from './focusRecommendation';
import type { EmailSignal, EmailSignalItem } from './gmail';
import { getPastCalendarEvents } from './calendar';
import { factQueries, memoryQueries, type Priority } from './db';
import type { calendar_v3 } from 'googleapis';

const mockCalendar = getPastCalendarEvents as ReturnType<typeof vi.fn>;
const mockFacts = (factQueries.getAll as ReturnType<typeof vi.fn>);
const mockMemories = (memoryQueries.getWeighted as ReturnType<typeof vi.fn>);

// ── Helpers ───────────────────────────────────────────────────────────────────

function timedEvent(title: string, hours: number): calendar_v3.Schema$Event {
  const start = new Date('2026-01-01T09:00:00Z');
  const end = new Date(start.getTime() + hours * 3600000);
  return { summary: title, start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } };
}

function fact(category: string, statement: string) {
  return { id: 1, user_id: 1, category, statement, entity: null, confidence: 'high', source_briefing_id: null, learned_at: '2026-01-01' };
}

function memory(content: string) {
  return { id: 1, user_id: 1, type: 'insight', content, metadata: null, created_at: '2026-01-01' };
}

function anchor(rank: number, text: string): Priority {
  return { id: rank, user_id: 1, text, week_of: '2026-01-01', rank, energy_cost: null, created_at: '2026-01-01' };
}

const GREEN_ENERGY: EnergySignal = { tier: 'green', recoveryScore: 80, source: 'whoop' };
const RED_ENERGY: EnergySignal = { tier: 'red', recoveryScore: 20, source: 'whoop' };

function sonnetOk(areas: { title: string; rationale: string; confidence: string }[]) {
  return { content: [{ type: 'text', text: JSON.stringify({ areas }) }] };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCalendar.mockResolvedValue([]);
  mockFacts.mockReturnValue([]);
  mockMemories.mockReturnValue([]);
});

// ── aggregateEventThemes ──────────────────────────────────────────────────────

describe('aggregateEventThemes', () => {
  it('returns empty when no events', () => {
    expect(aggregateEventThemes([])).toEqual([]);
  });

  it('skips events with title shorter than 3 chars', () => {
    expect(aggregateEventThemes([timedEvent('A', 1), timedEvent('ab', 1)])).toEqual([]);
  });

  it('skips events with zero or missing duration', () => {
    const allDay = { summary: 'Conference', start: { date: '2026-01-01' }, end: { date: '2026-01-02' } };
    expect(aggregateEventThemes([allDay])).toEqual([]);
  });

  it('groups same-title events and sums hours', () => {
    const themes = aggregateEventThemes([
      timedEvent('Investor call', 1),
      timedEvent('Investor call', 2),
      timedEvent('Investor Call', 0.5), // different case → same group
    ]);
    expect(themes).toHaveLength(1);
    expect(themes[0].totalHours).toBe(3.5);
    expect(themes[0].occurrences).toBe(3);
  });

  it('preserves the first-seen casing for the title', () => {
    const themes = aggregateEventThemes([
      timedEvent('Fundraising', 1),
      timedEvent('fundraising', 1),
    ]);
    expect(themes[0].title).toBe('Fundraising');
  });

  it('sorts by total hours descending', () => {
    const themes = aggregateEventThemes([
      timedEvent('Admin work', 0.5),
      timedEvent('Deep work', 5),
      timedEvent('Meetings', 2),
    ]);
    expect(themes[0].title).toBe('Deep work');
    expect(themes[1].title).toBe('Meetings');
    expect(themes[2].title).toBe('Admin work');
  });

  it('caps at topN (default 25)', () => {
    const events = Array.from({ length: 30 }, (_, i) => timedEvent(`Event ${i}`, 1));
    expect(aggregateEventThemes(events)).toHaveLength(25);
  });

  it('respects custom topN', () => {
    const events = Array.from({ length: 10 }, (_, i) => timedEvent(`Event ${i}`, 1));
    expect(aggregateEventThemes(events, 5)).toHaveLength(5);
  });

  it('rounds totalHours to 1 decimal', () => {
    const themes = aggregateEventThemes([timedEvent('Work', 1.333333)]);
    expect(themes[0].totalHours).toBe(1.3);
  });
});

// ── recommendFocusAreas ──────────────────────────────────────────────────────

describe('recommendFocusAreas', () => {
  it('returns empty areas on thin data (< 3 calendar themes, < 2 facts, < 2 memories)', async () => {
    // Zero data across all sources
    const result = await recommendFocusAreas(1);
    expect(result.areas).toEqual([]);
    expect(h.create).not.toHaveBeenCalled();
  });

  it('degrades gracefully when calendar has only 2 themes and no other data', async () => {
    mockCalendar.mockResolvedValue([timedEvent('Work', 2), timedEvent('Gym', 1)]);
    const result = await recommendFocusAreas(1);
    expect(result.areas).toEqual([]);
    expect(h.create).not.toHaveBeenCalled();
  });

  it('calls Sonnet when there are enough calendar themes', async () => {
    mockCalendar.mockResolvedValue([
      timedEvent('Investor calls', 4),
      timedEvent('Product build', 10),
      timedEvent('Team 1-on-1s', 3),
    ]);
    h.create.mockResolvedValue(sonnetOk([
      { title: 'Product build', rationale: 'You have 10h of product work.', confidence: 'high' },
    ]));

    const result = await recommendFocusAreas(1);
    expect(h.create).toHaveBeenCalledOnce();
    expect(result.areas).toHaveLength(1);
    expect(result.areas[0].title).toBe('Product build');
    expect(result.areas[0].confidence).toBe('high');
  });

  it('calls Sonnet when there are enough facts even with thin calendar data', async () => {
    mockFacts.mockReturnValue([
      fact('goal', 'Launch product by September'),
      fact('project', 'Edg3 MVP'),
    ]);
    h.create.mockResolvedValue(sonnetOk([
      { title: 'Edg3 launch', rationale: 'Core stated goal.', confidence: 'high' },
    ]));

    const result = await recommendFocusAreas(1);
    expect(h.create).toHaveBeenCalledOnce();
    expect(result.areas[0].title).toBe('Edg3 launch');
  });

  it('populates basedOn from available sources', async () => {
    mockCalendar.mockResolvedValue([
      timedEvent('Work A', 5), timedEvent('Work B', 3), timedEvent('Work C', 2),
    ]);
    mockFacts.mockReturnValue([fact('goal', 'Launch product')]);
    mockMemories.mockReturnValue([memory('discussed fundraising'), memory('mentioned hiring')]);
    h.create.mockResolvedValue(sonnetOk([]));

    const result = await recommendFocusAreas(1);
    expect(result.basedOn.some(s => s.includes('calendar'))).toBe(true);
    expect(result.basedOn.some(s => s.includes('facts'))).toBe(true);
    expect(result.basedOn.some(s => s.includes('call notes'))).toBe(true);
  });

  it('caps areas at 3 even if Sonnet returns more', async () => {
    mockCalendar.mockResolvedValue([
      timedEvent('Investor calls', 5), timedEvent('Product work', 4), timedEvent('Team syncs', 3),
    ]);
    h.create.mockResolvedValue(sonnetOk([
      { title: 'Area 1', rationale: 'r1', confidence: 'high' },
      { title: 'Area 2', rationale: 'r2', confidence: 'high' },
      { title: 'Area 3', rationale: 'r3', confidence: 'high' },
      { title: 'Area 4', rationale: 'r4', confidence: 'high' }, // should be dropped
    ]));

    const result = await recommendFocusAreas(1);
    expect(result.areas).toHaveLength(3);
  });

  it('defaults unknown confidence to "medium"', async () => {
    mockCalendar.mockResolvedValue([
      timedEvent('Investor calls', 5), timedEvent('Product work', 4), timedEvent('Team syncs', 3),
    ]);
    h.create.mockResolvedValue(sonnetOk([
      { title: 'Focus area', rationale: 'some reason', confidence: 'unknown_value' },
    ]));

    const result = await recommendFocusAreas(1);
    expect(result.areas[0].confidence).toBe('medium');
  });

  it('degrades to empty when Sonnet throws', async () => {
    mockCalendar.mockResolvedValue([
      timedEvent('Investor calls', 5), timedEvent('Product work', 4), timedEvent('Team syncs', 3),
    ]);
    h.create.mockRejectedValue(new Error('network failure'));

    const result = await recommendFocusAreas(1);
    expect(result.areas).toEqual([]);
  });

  it('degrades to empty when Sonnet returns non-JSON', async () => {
    mockCalendar.mockResolvedValue([
      timedEvent('Investor calls', 5), timedEvent('Product work', 4), timedEvent('Team syncs', 3),
    ]);
    h.create.mockResolvedValue({ content: [{ type: 'text', text: 'I cannot determine focus areas.' }] });

    const result = await recommendFocusAreas(1);
    expect(result.areas).toEqual([]);
  });

  it('includes generatedAt ISO timestamp', async () => {
    const result = await recommendFocusAreas(1);
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('includes date field — defaults to today if not passed', async () => {
    const result = await recommendFocusAreas(1);
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('uses opts.date when provided', async () => {
    mockCalendar.mockResolvedValue([
      timedEvent('Investor calls', 5), timedEvent('Product work', 4), timedEvent('Team syncs', 3),
    ]);
    h.create.mockResolvedValue(sonnetOk([{ title: 'Focus', rationale: 'r', confidence: 'high' }]));
    const result = await recommendFocusAreas(1, { date: '2026-06-14' });
    expect(result.date).toBe('2026-06-14');
  });

  it('includes anchor in output when Sonnet returns it', async () => {
    mockCalendar.mockResolvedValue([
      timedEvent('Investor calls', 5), timedEvent('Product work', 4), timedEvent('Team syncs', 3),
    ]);
    h.create.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({
        areas: [{ title: 'Fundraise', rationale: 'Core goal.', confidence: 'high', anchor: 'Raise seed round' }],
      })}],
    });
    const result = await recommendFocusAreas(1, { anchors: [anchor(1, 'Raise seed round')] });
    expect(result.areas[0].anchor).toBe('Raise seed round');
  });

  it('adds energy signal to basedOn when provided', async () => {
    mockCalendar.mockResolvedValue([
      timedEvent('Investor calls', 5), timedEvent('Product work', 4), timedEvent('Team syncs', 3),
    ]);
    h.create.mockResolvedValue(sonnetOk([]));
    const result = await recommendFocusAreas(1, { energySignal: GREEN_ENERGY });
    expect(result.basedOn.some(s => s.includes('Whoop'))).toBe(true);
  });

  it('includes energy tier context in Sonnet prompt for red energy', async () => {
    mockCalendar.mockResolvedValue([
      timedEvent('Investor calls', 5), timedEvent('Product work', 4), timedEvent('Team syncs', 3),
    ]);
    h.create.mockResolvedValue(sonnetOk([]));
    await recommendFocusAreas(1, { energySignal: RED_ENERGY });
    const promptArg = h.create.mock.calls[0][0].messages[0].content as string;
    expect(promptArg).toContain('Low energy today');
  });

  it('adds anchors section to Sonnet prompt', async () => {
    mockCalendar.mockResolvedValue([
      timedEvent('Investor calls', 5), timedEvent('Product work', 4), timedEvent('Team syncs', 3),
    ]);
    h.create.mockResolvedValue(sonnetOk([]));
    await recommendFocusAreas(1, { anchors: [anchor(1, 'Ship the product'), anchor(2, 'Raise seed')] });
    const promptArg = h.create.mock.calls[0][0].messages[0].content as string;
    expect(promptArg).toContain('Ship the product');
    expect(promptArg).toContain('Raise seed');
  });

  it('filters out Sonnet areas with empty title or rationale', async () => {
    mockCalendar.mockResolvedValue([
      timedEvent('Investor calls', 5), timedEvent('Product work', 4), timedEvent('Team syncs', 3),
    ]);
    h.create.mockResolvedValue(sonnetOk([
      { title: '', rationale: 'some reason', confidence: 'high' },      // empty title
      { title: 'Valid area', rationale: '', confidence: 'medium' },       // empty rationale
      { title: 'Good one', rationale: 'solid reason', confidence: 'low' }, // valid
    ]));

    const result = await recommendFocusAreas(1);
    expect(result.areas).toHaveLength(1);
    expect(result.areas[0].title).toBe('Good one');
  });
});

// ── isUrgentEmail ─────────────────────────────────────────────────────────────

function emailItem(overrides: Partial<EmailSignalItem> = {}): EmailSignalItem {
  return {
    threadId: 'thread1',
    sender: 'someone@example.com',
    subject: 'Hello',
    snippet: 'Just checking in.',
    date: 'Mon, 15 Jun 2026 09:00:00 -0400',
    isUnread: false,
    isImportant: false,
    ...overrides,
  };
}

describe('isUrgentEmail', () => {
  it('returns true when isImportant', () => {
    expect(isUrgentEmail(emailItem({ isImportant: true }))).toBe(true);
  });

  it('returns true on urgent subject keyword', () => {
    expect(isUrgentEmail(emailItem({ subject: 'FINAL NOTICE: Payment overdue' }))).toBe(true);
  });

  it('returns true on urgent sender keyword (CIBC)', () => {
    expect(isUrgentEmail(emailItem({ sender: 'collections@cibc.com' }))).toBe(true);
  });

  it('returns true on collector in subject', () => {
    expect(isUrgentEmail(emailItem({ subject: 'Collections department notice' }))).toBe(true);
  });

  it('returns false for normal email', () => {
    expect(isUrgentEmail(emailItem({ sender: 'friend@gmail.com', subject: 'Weekend plans' }))).toBe(false);
  });
});

// ── formatEmailSignalForPrompt ────────────────────────────────────────────────

function signal(items: EmailSignalItem[], scopeMissing = false): EmailSignal {
  return { items, fetchedAt: '2026-06-15T10:00:00Z', scopeMissing };
}

describe('formatEmailSignalForPrompt', () => {
  it('returns empty string when scopeMissing', () => {
    expect(formatEmailSignalForPrompt(signal([], true))).toBe('');
  });

  it('returns empty string when no items', () => {
    expect(formatEmailSignalForPrompt(signal([]))).toBe('');
  });

  it('tags urgent emails with [URGENT/FINANCIAL]', () => {
    const result = formatEmailSignalForPrompt(signal([
      emailItem({ sender: 'collections@cibc.com', subject: 'Past due balance' }),
    ]));
    expect(result).toContain('[URGENT/FINANCIAL]');
  });

  it('tags unread non-urgent emails with [unread]', () => {
    const result = formatEmailSignalForPrompt(signal([
      emailItem({ isUnread: true, subject: 'Lunch tomorrow?' }),
    ]));
    expect(result).toContain('[unread]');
    expect(result).not.toContain('[URGENT/FINANCIAL]');
  });

  it('truncates snippet to 120 chars', () => {
    const longSnippet = 'A'.repeat(200);
    const result = formatEmailSignalForPrompt(signal([emailItem({ snippet: longSnippet })]));
    expect(result).toContain('A'.repeat(120));
    expect(result).not.toContain('A'.repeat(121));
  });
});

// ── recommendFocusAreas — email signal integration ───────────────────────────

describe('recommendFocusAreas with emailSignal', () => {
  it('adds email to basedOn when signal has items', async () => {
    mockCalendar.mockResolvedValue([
      timedEvent('Investor calls', 5), timedEvent('Product work', 4), timedEvent('Team syncs', 3),
    ]);
    h.create.mockResolvedValue(sonnetOk([]));
    const es = signal([emailItem({ subject: 'Weekend plans' })]);
    const result = await recommendFocusAreas(1, { emailSignal: es });
    expect(result.basedOn.some(s => s.includes('email inbox'))).toBe(true);
  });

  it('includes urgent count in basedOn', async () => {
    mockCalendar.mockResolvedValue([
      timedEvent('Investor calls', 5), timedEvent('Product work', 4), timedEvent('Team syncs', 3),
    ]);
    h.create.mockResolvedValue(sonnetOk([]));
    const es = signal([emailItem({ sender: 'collections@cibc.com', subject: 'Past due' })]);
    const result = await recommendFocusAreas(1, { emailSignal: es });
    expect(result.basedOn.some(s => s.includes('1 urgent'))).toBe(true);
  });

  it('does NOT add email to basedOn when scopeMissing', async () => {
    mockCalendar.mockResolvedValue([
      timedEvent('Investor calls', 5), timedEvent('Product work', 4), timedEvent('Team syncs', 3),
    ]);
    h.create.mockResolvedValue(sonnetOk([]));
    const result = await recommendFocusAreas(1, { emailSignal: signal([], true) });
    expect(result.basedOn.some(s => s.includes('email'))).toBe(false);
  });

  it('injects URGENT priority weighting into Sonnet prompt when urgent emails present', async () => {
    mockCalendar.mockResolvedValue([
      timedEvent('Investor calls', 5), timedEvent('Product work', 4), timedEvent('Team syncs', 3),
    ]);
    h.create.mockResolvedValue(sonnetOk([]));
    const es = signal([emailItem({ sender: 'collections@cibc.com', subject: 'Past due balance' })]);
    await recommendFocusAreas(1, { emailSignal: es });
    const promptArg = h.create.mock.calls[0][0].messages[0].content as string;
    expect(promptArg).toContain('URGENT/FINANCIAL');
    expect(promptArg).toContain('HIGHEST-PRIORITY');
  });

  it('degrades gracefully when emailSignal is null', async () => {
    mockCalendar.mockResolvedValue([
      timedEvent('Investor calls', 5), timedEvent('Product work', 4), timedEvent('Team syncs', 3),
    ]);
    h.create.mockResolvedValue(sonnetOk([{ title: 'Product work', rationale: 'Core theme.', confidence: 'high' }]));
    const result = await recommendFocusAreas(1, { emailSignal: null });
    expect(result.areas).toHaveLength(1);
    expect(result.basedOn.some(s => s.includes('email'))).toBe(false);
  });
});
