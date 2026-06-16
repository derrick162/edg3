import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: h.create };
  },
}));

// Stub getDb so no real SQLite needed
const mockRun  = vi.fn().mockReturnValue({ changes: 1 });
const mockGet  = vi.fn().mockReturnValue(undefined);
const mockAll  = vi.fn().mockReturnValue([]);
const mockExec = vi.fn();
const mockPrepare = vi.fn(() => ({ run: mockRun, get: mockGet, all: mockAll }));

vi.mock('./db', () => ({
  getDb: () => ({ prepare: mockPrepare, exec: mockExec }),
}));

import {
  extractOpenLoopsFromText,
  extractOpenLoopsFromCalendar,
  extractAndUpsertOpenLoops,
  getUrgentOpenLoops,
  formatOpenLoopsForBriefing,
  openLoopStubQueries,
  type OpenLoop,
  type ExtractedOpenLoop,
} from './openLoops';

function textResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

function makeLoop(overrides: Partial<OpenLoop> = {}): OpenLoop {
  return {
    id: 1, user_id: 1,
    description: 'Send CIBC proposal',
    type: 'commitment_made',
    source: 'call',
    due_date: null,
    status: 'open',
    created_at: '2026-06-15',
    resolved_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRun.mockReturnValue({ changes: 1 });
  mockGet.mockReturnValue(undefined);
  mockAll.mockReturnValue([]);
});

// ── extractOpenLoopsFromText ──────────────────────────────────────────────────

describe('extractOpenLoopsFromText', () => {
  it('parses a valid JSON array from the model response', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { description: 'Send CIBC proposal', type: 'commitment_made', due_date: '2026-06-18' },
      { description: 'Reply to Faiza re partnership', type: 'awaiting_you', due_date: null },
    ])));
    const loops = await extractOpenLoopsFromText('transcript', 'call', '2026-06-15');
    expect(loops).toHaveLength(2);
    expect(loops[0].type).toBe('commitment_made');
    expect(loops[0].due_date).toBe('2026-06-18');
    expect(loops[0].source).toBe('call');
    expect(loops[1].due_date).toBeNull();
  });

  it('returns [] when model returns no JSON array', async () => {
    h.create.mockResolvedValue(textResponse('Nothing found.'));
    expect(await extractOpenLoopsFromText('text', 'email', '2026-06-15')).toEqual([]);
  });

  it('returns [] on API error', async () => {
    h.create.mockRejectedValue(new Error('network'));
    expect(await extractOpenLoopsFromText('text', 'call', '2026-06-15')).toEqual([]);
  });

  it('filters items with invalid type', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { description: 'Invalid type item', type: 'unknown', due_date: null },
      { description: 'Send the invoice', type: 'commitment_made', due_date: null },
    ])));
    const loops = await extractOpenLoopsFromText('text', 'call', '2026-06-15');
    expect(loops).toHaveLength(1);
    expect(loops[0].type).toBe('commitment_made');
  });

  it('rejects malformed due_date (non-ISO)', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { description: 'Call back Mike', type: 'awaiting_you', due_date: 'Friday' },
    ])));
    const loops = await extractOpenLoopsFromText('text', 'call', '2026-06-15');
    expect(loops[0].due_date).toBeNull();
  });

  it('caps at 8 items', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      description: `Commitment ${i}`,
      type: 'commitment_made',
      due_date: null,
    }));
    h.create.mockResolvedValue(textResponse(JSON.stringify(many)));
    expect(await extractOpenLoopsFromText('text', 'call', '2026-06-15')).toHaveLength(8);
  });

  it('sets source to "email" when extracting from email', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { description: 'Reply to CIBC collection notice', type: 'awaiting_you', due_date: '2026-06-20' },
    ])));
    const loops = await extractOpenLoopsFromText('email digest', 'email', '2026-06-15');
    expect(loops[0].source).toBe('email');
  });
});

// ── extractOpenLoopsFromCalendar ──────────────────────────────────────────────

describe('extractOpenLoopsFromCalendar', () => {
  it('returns empty when no events match deadline keywords', () => {
    const events = [
      { summary: 'Team standup', start: { dateTime: '2026-06-16T09:00:00' } },
      { summary: 'Lunch with Sarah', start: { date: '2026-06-17' } },
    ];
    expect(extractOpenLoopsFromCalendar(events)).toEqual([]);
  });

  it('matches "deadline" keyword and extracts dateTime', () => {
    const events = [
      { summary: 'Submit report deadline', start: { dateTime: '2026-06-20T17:00:00' } },
    ];
    const loops = extractOpenLoopsFromCalendar(events);
    expect(loops).toHaveLength(1);
    expect(loops[0].type).toBe('deadline');
    expect(loops[0].source).toBe('calendar');
    expect(loops[0].due_date).toBe('2026-06-20');
  });

  it('matches "due" keyword with all-day event date', () => {
    const events = [
      { summary: 'Tax filing due', start: { date: '2026-06-30' } },
    ];
    const loops = extractOpenLoopsFromCalendar(events);
    expect(loops[0].due_date).toBe('2026-06-30');
    expect(loops[0].description).toContain('"Tax filing due"');
  });

  it('matches "send", "pay", "file", "sign", "review" keywords', () => {
    const keywords = ['send deck', 'pay rent', 'file taxes', 'sign contract', 'review proposal'];
    for (const kw of keywords) {
      const events = [{ summary: kw, start: { date: '2026-06-20' } }];
      expect(extractOpenLoopsFromCalendar(events)).toHaveLength(1);
    }
  });

  it('caps at 5 calendar loops', () => {
    const events = Array.from({ length: 10 }, (_, i) => ({
      summary: `Submit item ${i}`,
      start: { date: `2026-06-${String(i + 1).padStart(2, '0')}` },
    }));
    expect(extractOpenLoopsFromCalendar(events)).toHaveLength(5);
  });

  it('returns empty for events with no summary', () => {
    expect(extractOpenLoopsFromCalendar([{ summary: '', start: { date: '2026-06-20' } }])).toEqual([]);
  });
});

// ── getUrgentOpenLoops ────────────────────────────────────────────────────────

describe('getUrgentOpenLoops', () => {
  it('returns loops due today or overdue', () => {
    mockAll.mockReturnValue([
      makeLoop({ due_date: '2026-06-14', type: 'deadline' }),  // overdue
      makeLoop({ id: 2, due_date: '2026-06-15', type: 'deadline' }), // today
      makeLoop({ id: 3, due_date: '2026-06-20', type: 'deadline' }), // future — skip
    ]);
    const urgent = getUrgentOpenLoops(1, '2026-06-15');
    expect(urgent).toHaveLength(2);
    expect(urgent.every(l => l.due_date! <= '2026-06-15')).toBe(true);
  });

  it('always includes commitment_made and awaiting_you without due dates', () => {
    mockAll.mockReturnValue([
      makeLoop({ type: 'commitment_made', due_date: null }),
      makeLoop({ id: 2, type: 'awaiting_you', due_date: null }),
      makeLoop({ id: 3, type: 'deadline', due_date: null }),  // no due date → skip
    ]);
    const urgent = getUrgentOpenLoops(1, '2026-06-15');
    expect(urgent).toHaveLength(2);
    expect(urgent.map(l => l.type)).toEqual(['commitment_made', 'awaiting_you']);
  });

  it('caps at 5 urgent loops', () => {
    const loops = Array.from({ length: 8 }, (_, i) => makeLoop({ id: i, due_date: '2026-06-10' }));
    mockAll.mockReturnValue(loops);
    expect(getUrgentOpenLoops(1, '2026-06-15')).toHaveLength(5);
  });

  it('returns empty when no open loops exist', () => {
    mockAll.mockReturnValue([]);
    expect(getUrgentOpenLoops(1, '2026-06-15')).toEqual([]);
  });
});

// ── formatOpenLoopsForBriefing ────────────────────────────────────────────────

describe('formatOpenLoopsForBriefing', () => {
  it('returns empty string for no loops', () => {
    expect(formatOpenLoopsForBriefing([])).toBe('');
  });

  it('formats commitment_made with YOU COMMITTED tag', () => {
    const result = formatOpenLoopsForBriefing([makeLoop({ type: 'commitment_made', due_date: '2026-06-18' })]);
    expect(result).toContain('[YOU COMMITTED]');
    expect(result).toContain('2026-06-18');
    expect(result).toContain('Send CIBC proposal');
  });

  it('formats awaiting_you with AWAITING YOUR RESPONSE tag', () => {
    const result = formatOpenLoopsForBriefing([makeLoop({ type: 'awaiting_you' })]);
    expect(result).toContain('[AWAITING YOUR RESPONSE]');
  });

  it('formats deadline with DEADLINE tag', () => {
    const result = formatOpenLoopsForBriefing([makeLoop({ type: 'deadline' })]);
    expect(result).toContain('[DEADLINE]');
  });

  it('includes the OPEN LOOPS header', () => {
    const result = formatOpenLoopsForBriefing([makeLoop()]);
    expect(result).toContain('OPEN LOOPS');
  });

  it('omits due date part when due_date is null', () => {
    const result = formatOpenLoopsForBriefing([makeLoop({ due_date: null })]);
    expect(result).not.toContain('due');
    expect(result).not.toContain('null');
  });
});

// ── extractAndUpsertOpenLoops ─────────────────────────────────────────────────

describe('extractAndUpsertOpenLoops', () => {
  it('does not throw on API error', async () => {
    h.create.mockRejectedValue(new Error('API down'));
    await expect(extractAndUpsertOpenLoops(1, { transcript: 'short text for testing only' })).resolves.toBeUndefined();
  });

  it('skips calendar extraction when no events provided', async () => {
    await extractAndUpsertOpenLoops(1, {});
    expect(h.create).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('deduplicates against existing open loops', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { description: 'Send CIBC proposal', type: 'commitment_made', due_date: null },
    ])));
    // existsSimilar returns true → skip insert
    mockGet.mockReturnValue({ 1: 1 });
    await extractAndUpsertOpenLoops(1, { transcript: 'I said I would send the CIBC proposal next week for sure' });
    expect(mockRun).not.toHaveBeenCalled();
  });
});
