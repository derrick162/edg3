import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetAllIncludingRetired,
  mockGetAll,
  mockRetire,
  mockUpsertFact,
  mockCreate,
} = vi.hoisted(() => ({
  mockGetAllIncludingRetired: vi.fn(),
  mockGetAll: vi.fn(),
  mockRetire: vi.fn(),
  mockUpsertFact: vi.fn(),
  mockCreate: vi.fn(),
}));

vi.mock('./db', () => ({
  factQueries: {
    getAllIncludingRetired: mockGetAllIncludingRetired,
    getAll: mockGetAll,
    retire: mockRetire,
    upsertFact: mockUpsertFact,
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

import { runHistoricalPatternDetection, getHistoricalPatterns } from './factPatterns';
import type { Fact } from './db';

const WEEK_AGO = new Date(Date.parse('2026-06-09T10:00:00Z')).toISOString();
const RECENT = new Date(Date.parse('2026-06-16T10:00:00Z')).toISOString();

function makeFact(overrides: Partial<Fact> = {}): Fact {
  return {
    id: 1,
    user_id: 1,
    category: 'goal',
    statement: 'Test statement',
    entity: null,
    learned_at: WEEK_AGO,
    confidence: 'low',
    source_briefing_id: null,
    source: null,
    valid_from: null,
    valid_until: null,
    ...overrides,
  };
}

const activeFact = () => makeFact({ id: 1, statement: 'Active goal' });

describe('runHistoricalPatternDetection', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns [] when fewer than 3 retired facts', async () => {
    mockGetAllIncludingRetired.mockReturnValue([
      activeFact(),
      makeFact({ id: 3, valid_until: '2026-06-01T00:00:00Z' }),
    ]);
    const result = await runHistoricalPatternDetection(1);
    expect(result).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns cached patterns without API call when run recently', async () => {
    const cachedPattern = { type: 'priority_drift', summary: 'Priorities shift weekly', confidence: 'medium', sampleDays: 5 };
    const patternFact = makeFact({
      id: 10,
      source: 'historical-pattern',
      statement: JSON.stringify(cachedPattern),
      learned_at: RECENT,
      valid_until: null,
    });
    const retired1 = makeFact({ id: 2, valid_until: '2026-06-01T00:00:00Z' });
    const retired2 = makeFact({ id: 3, valid_until: '2026-06-02T00:00:00Z' });
    const retired3 = makeFact({ id: 4, valid_until: '2026-06-03T00:00:00Z' });
    mockGetAllIncludingRetired.mockReturnValue([activeFact(), patternFact, retired1, retired2, retired3]);

    const result = await runHistoricalPatternDetection(1);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('priority_drift');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('calls Haiku and stores patterns when cache is stale', async () => {
    const stalePatternFact = makeFact({
      id: 10,
      source: 'historical-pattern',
      statement: JSON.stringify({ type: 'priority_drift', summary: 'Old', confidence: 'medium', sampleDays: 3 }),
      learned_at: WEEK_AGO,
      valid_until: null,
    });
    const retired1 = makeFact({ id: 2, valid_until: '2026-06-01T00:00:00Z', statement: 'Goal A' });
    const retired2 = makeFact({ id: 3, valid_until: '2026-06-02T00:00:00Z', statement: 'Goal B' });
    const retired3 = makeFact({ id: 4, valid_until: '2026-06-03T00:00:00Z', statement: 'Goal C' });
    mockGetAllIncludingRetired.mockReturnValue([activeFact(), stalePatternFact, retired1, retired2, retired3]);

    const newPattern = [{ type: 'commitment_follow_through', summary: 'Commits consistently', confidence: 'high', sampleDays: 7 }];
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(newPattern) }],
    });

    const result = await runHistoricalPatternDetection(1);
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('commitment_follow_through');
    expect(mockRetire).toHaveBeenCalledWith(1, 10);
    expect(mockUpsertFact).toHaveBeenCalledWith(1, 'fact', JSON.stringify(newPattern[0]), 'pattern:commitment_follow_through', 'high');
  });

  it('filters out patterns with invalid type from Haiku response', async () => {
    const retired1 = makeFact({ id: 2, valid_until: '2026-06-01T00:00:00Z' });
    const retired2 = makeFact({ id: 3, valid_until: '2026-06-02T00:00:00Z' });
    const retired3 = makeFact({ id: 4, valid_until: '2026-06-03T00:00:00Z' });
    mockGetAllIncludingRetired.mockReturnValue([activeFact(), retired1, retired2, retired3]);

    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '[{"type":"invalid_type","summary":"Bad","confidence":"high","sampleDays":3}]' }],
    });

    const result = await runHistoricalPatternDetection(1);
    expect(result).toHaveLength(0);
    expect(mockUpsertFact).not.toHaveBeenCalled();
  });

  it('degrades silently when Haiku throws', async () => {
    const retired1 = makeFact({ id: 2, valid_until: '2026-06-01T00:00:00Z' });
    const retired2 = makeFact({ id: 3, valid_until: '2026-06-02T00:00:00Z' });
    const retired3 = makeFact({ id: 4, valid_until: '2026-06-03T00:00:00Z' });
    mockGetAllIncludingRetired.mockReturnValue([activeFact(), retired1, retired2, retired3]);
    mockCreate.mockRejectedValue(new Error('API error'));

    const result = await runHistoricalPatternDetection(1);
    expect(result).toEqual([]);
  });

  it('caps stored patterns at 2 even if Haiku returns more', async () => {
    const retired1 = makeFact({ id: 2, valid_until: '2026-06-01T00:00:00Z' });
    const retired2 = makeFact({ id: 3, valid_until: '2026-06-02T00:00:00Z' });
    const retired3 = makeFact({ id: 4, valid_until: '2026-06-03T00:00:00Z' });
    mockGetAllIncludingRetired.mockReturnValue([activeFact(), retired1, retired2, retired3]);

    const threePatterns = [
      { type: 'commitment_follow_through', summary: 'A', confidence: 'high', sampleDays: 5 },
      { type: 'priority_drift', summary: 'B', confidence: 'medium', sampleDays: 4 },
      { type: 'commitment_follow_through', summary: 'C', confidence: 'high', sampleDays: 3 },
    ];
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(threePatterns) }] });

    const result = await runHistoricalPatternDetection(1);
    expect(result).toHaveLength(2);
    expect(mockUpsertFact).toHaveBeenCalledTimes(2);
  });
});

describe('getHistoricalPatterns', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns parsed patterns from active historical-pattern facts', () => {
    const p = { type: 'priority_drift', summary: 'Shifts weekly', confidence: 'medium', sampleDays: 6 };
    mockGetAll.mockReturnValue([
      makeFact({ id: 5, source: 'historical-pattern', statement: JSON.stringify(p) }),
      makeFact({ id: 6, source: null, statement: 'Regular fact' }),
    ]);
    const result = getHistoricalPatterns(1);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('priority_drift');
  });

  it('skips facts with unparseable JSON', () => {
    mockGetAll.mockReturnValue([
      makeFact({ id: 7, source: 'historical-pattern', statement: 'not json' }),
    ]);
    const result = getHistoricalPatterns(1);
    expect(result).toHaveLength(0);
  });

  it('returns [] when getAll throws', () => {
    mockGetAll.mockImplementation(() => { throw new Error('DB error'); });
    const result = getHistoricalPatterns(1);
    expect(result).toEqual([]);
  });
});
