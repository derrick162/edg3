/**
 * T0-3 Smoke test: "7am path" — call transcript → facts extracted → episode stored.
 *
 * Validates the fire-and-forget chain that runs after every Vapi call:
 *   extractAndUpsertFacts  → factQueries.upsertFact
 *   persistCallEpisode     → episodeQueries.insert
 *
 * Uses the same mocking pattern as facts.test.ts (vi.mock('./db') + mocked Anthropic).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Anthropic mock ────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: h.create };
  },
}));

// ── DB mock ───────────────────────────────────────────────────────────────────
// Spread ...actual so type helpers (Fact type, etc.) are preserved.
// Override only the query namespaces that touch the DB.

vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>();
  const factStore: import('./db').Fact[] = [];
  const episodeStore: import('./db').Episode[] = [];
  return {
    ...actual,
    factQueries: {
      getAll: vi.fn(() => [...factStore]),
      upsertFact: vi.fn((userId, category, statement, entity, confidence = 'high', sourceBriefingId = null) => {
        factStore.push({
          id: factStore.length + 1,
          user_id: userId,
          category: category as import('./db').Fact['category'],
          statement,
          entity: entity ?? null,
          learned_at: new Date().toISOString(),
          confidence,
          source_briefing_id: sourceBriefingId,
        });
      }),
      getByCategory: vi.fn((userId: number, category: string) =>
        factStore.filter(f => f.user_id === userId && f.category === category),
      ),
      updateFact: vi.fn((userId: number, id: number, statement: string, entity: string | null) => {
        const f = factStore.find(x => x.id === id && x.user_id === userId);
        if (f) { f.statement = statement; f.entity = entity; }
      }),
      deleteFact: vi.fn((userId: number, id: number) => {
        const idx = factStore.findIndex(x => x.id === id && x.user_id === userId);
        if (idx !== -1) factStore.splice(idx, 1);
      }),
      retire: vi.fn(),
    },
    peopleProfileQueries: {
      listForUser: vi.fn(() => []),
    },
    episodeQueries: {
      insert: vi.fn((userId, source, occurredAt, contentRaw, topics, commitments) => {
        const id = episodeStore.length + 1;
        episodeStore.push({ id, userId, source, occurredAt, contentRaw, topics, commitments, createdAt: new Date().toISOString() });
        return id;
      }),
      search: vi.fn(() => [...episodeStore]),
      recent: vi.fn(() => [...episodeStore]),
      prune: vi.fn(() => 0),
    },
    notificationQueries: {
      create: vi.fn(),
      existsToday: vi.fn(() => false),
      listRecent: vi.fn(() => []),
      markRead: vi.fn(),
    },
  };
});

// ── Subject imports ───────────────────────────────────────────────────────────

import { extractAndUpsertFacts } from './facts';
import {
  persistCallEpisode,
  buildEpisodeMemoryBlock,
  tagTopicsFromTranscript,
  tagCommitmentsFromTasks,
} from './episodeStore';
import { factQueries, episodeQueries } from './db';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = 1;
const USER_NAME = 'Derrick';
const OCCURRED_AT = '2026-06-17T07:00:00.000Z';

const SAMPLE_TRANSCRIPT = [
  'Edg3: Good morning Derrick. Your recovery is 72%. You committed to sending the pitch deck by Friday.',
  'Derrick: Yeah, deck is done. I need to close the Series A by September. My fundraising lead is Sarah at a16z.',
  'Edg3: Got it. Want me to block Tuesday at 2 PM for investor outreach?',
  'Derrick: Yes, block it. Also remind me to hit 135 pounds by end of July.',
  'Edg3: Done. I\'ll track that too.',
].join('\n');

function textResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the in-memory stores for each test by clearing mock calls
  (factQueries.getAll as ReturnType<typeof vi.fn>).mockImplementation(() => []);
});

// ── tagTopicsFromTranscript (pure) ────────────────────────────────────────────

describe('tagTopicsFromTranscript', () => {
  it('detects domain keywords in the transcript', () => {
    const tags = tagTopicsFromTranscript(SAMPLE_TRANSCRIPT, []);
    expect(tags).toContain('fundraising');
    expect(tags).toContain('recovery');
  });

  it('matches priority texts that appear in the transcript', () => {
    const priorities = ['Close Series A', 'Weight goal 135 lbs'];
    const tags = tagTopicsFromTranscript(SAMPLE_TRANSCRIPT, priorities);
    expect(tags).toContain('Close Series A');
  });

  it('caps tags at 10', () => {
    const manyPriorities = Array.from({ length: 20 }, (_, i) => `Priority ${i + 1}`);
    const longTranscript = manyPriorities.join(' invest workout health exercise hiring product launch revenue customer user ');
    const tags = tagTopicsFromTranscript(longTranscript, manyPriorities);
    expect(tags.length).toBeLessThanOrEqual(10);
  });

  it('returns empty array for empty transcript', () => {
    expect(tagTopicsFromTranscript('', ['Goal 1'])).toEqual([]);
  });
});

// ── tagCommitmentsFromTasks (pure) ────────────────────────────────────────────

describe('tagCommitmentsFromTasks', () => {
  it('returns task texts as commitments (capped at 10)', () => {
    const tasks = ['Send pitch deck', 'Block Tuesday 2 PM', 'Hit 135 lbs'];
    const commitments = tagCommitmentsFromTasks(tasks);
    expect(commitments).toEqual(tasks);
  });

  it('caps at 10 tasks', () => {
    const manyTasks = Array.from({ length: 15 }, (_, i) => `Task ${i + 1}`);
    expect(tagCommitmentsFromTasks(manyTasks)).toHaveLength(10);
  });
});

// ── persistCallEpisode ────────────────────────────────────────────────────────

describe('persistCallEpisode', () => {
  it('writes episode to DB for a sufficiently long transcript', () => {
    persistCallEpisode(
      USER_ID,
      SAMPLE_TRANSCRIPT,
      OCCURRED_AT,
      ['Close Series A', 'Weight goal'],
      ['Send pitch deck'],
    );

    expect(episodeQueries.insert).toHaveBeenCalledOnce();
    const [uid, source, occurredAt, transcript, topics, commitments] =
      (episodeQueries.insert as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(uid).toBe(USER_ID);
    expect(source).toBe('call');
    expect(occurredAt).toBe(OCCURRED_AT);
    expect(transcript).toBe(SAMPLE_TRANSCRIPT);
    expect(Array.isArray(topics)).toBe(true);
    expect(topics).toContain('fundraising'); // domain keyword detected
    expect(commitments).toEqual(['Send pitch deck']);
  });

  it('skips trivially short transcripts (< 50 chars)', () => {
    persistCallEpisode(USER_ID, 'Too short.', OCCURRED_AT, [], []);
    expect(episodeQueries.insert).not.toHaveBeenCalled();
  });

  it('skips empty transcripts', () => {
    persistCallEpisode(USER_ID, '', OCCURRED_AT, [], []);
    expect(episodeQueries.insert).not.toHaveBeenCalled();
  });

  it('tags priority-matching topics', () => {
    const priorities = ['Series A fundraising'];
    persistCallEpisode(USER_ID, SAMPLE_TRANSCRIPT, OCCURRED_AT, priorities, []);

    const topics = (episodeQueries.insert as ReturnType<typeof vi.fn>).mock.calls[0][4];
    expect(topics).toContain('Series A fundraising');
  });
});

// ── extractAndUpsertFacts ─────────────────────────────────────────────────────

describe('extractAndUpsertFacts', () => {
  it('upserts facts returned by Anthropic into the DB', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'goal', statement: 'Wants to close Series A by September', entity: 'Series A' },
      { category: 'person', statement: 'Sarah works at a16z and leads fundraising', entity: 'Sarah' },
    ])));

    await extractAndUpsertFacts(USER_ID, SAMPLE_TRANSCRIPT, USER_NAME, undefined, []);

    expect(factQueries.upsertFact).toHaveBeenCalledWith(
      USER_ID,
      'goal',
      'Wants to close Series A by September',
      'Series A',
      expect.any(String),
      undefined,
    );
    // 'Sarah' is a person fact — must have been upserted
    expect(factQueries.upsertFact).toHaveBeenCalledWith(
      USER_ID,
      'person',
      'Sarah works at a16z and leads fundraising',
      'Sarah',
      expect.any(String),
      undefined,
    );
  });

  it('drops person facts that are the user themselves', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'person', statement: 'Derrick is focused on health', entity: 'Derrick' },
      { category: 'goal', statement: 'Wants to reach 135 lbs', entity: null },
    ])));

    await extractAndUpsertFacts(USER_ID, SAMPLE_TRANSCRIPT, USER_NAME, undefined, []);

    // Self-entity 'Derrick' should be filtered out; goal should be stored
    const calls = (factQueries.upsertFact as ReturnType<typeof vi.fn>).mock.calls;
    const entities = calls.map((c: unknown[]) => c[3]);
    expect(entities).not.toContain('Derrick');
    expect(calls.some((c: unknown[]) => c[1] === 'goal')).toBe(true);
  });

  it('degrades gracefully when Anthropic returns malformed JSON', async () => {
    h.create.mockResolvedValue(textResponse('not valid json at all'));
    // Should not throw — errors are caught internally
    await expect(extractAndUpsertFacts(USER_ID, SAMPLE_TRANSCRIPT, USER_NAME)).resolves.toBeUndefined();
  });
});

// ── buildEpisodeMemoryBlock ───────────────────────────────────────────────────

describe('buildEpisodeMemoryBlock', () => {
  it('returns empty string when no episodes found', () => {
    (episodeQueries.search as ReturnType<typeof vi.fn>).mockReturnValue([]);
    const block = buildEpisodeMemoryBlock(USER_ID, ['Series A'], []);
    expect(block).toBe('');
  });

  it('builds a memory block when episodes match', () => {
    const episode: import('./db').Episode = {
      id: 1,
      userId: USER_ID,
      source: 'call',
      occurredAt: '2026-06-16T07:00:00.000Z',
      contentRaw: SAMPLE_TRANSCRIPT,
      topics: ['fundraising', 'health'],
      commitments: ['Send pitch deck'],
      createdAt: OCCURRED_AT,
    };
    (episodeQueries.search as ReturnType<typeof vi.fn>).mockReturnValue([episode]);

    const block = buildEpisodeMemoryBlock(USER_ID, ['fundraising'], []);
    expect(block).toContain('EPISODIC MEMORY');
    expect(block).toContain('2026-06-16');
    expect(block).toContain('fundraising');
    expect(block).toContain('Send pitch deck');
  });

  it('handles episodeQueries.search throwing without propagating', () => {
    (episodeQueries.search as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('DB unavailable');
    });
    expect(() => buildEpisodeMemoryBlock(USER_ID, [], [])).not.toThrow();
    expect(buildEpisodeMemoryBlock(USER_ID, [], [])).toBe('');
  });
});

// ── End-to-end "7am path" smoke test ─────────────────────────────────────────

describe('7am path smoke test', () => {
  it('runs the full post-call chain: facts extracted AND episode stored', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'goal', statement: 'Wants to close Series A by September', entity: 'Series A' },
    ])));

    const taskTexts = ['Send pitch deck by Friday'];
    const priorityTexts = ['Close Series A'];

    // Simulate the fire-and-forget chain from the Vapi webhook
    await extractAndUpsertFacts(USER_ID, SAMPLE_TRANSCRIPT, USER_NAME, undefined, []);
    persistCallEpisode(USER_ID, SAMPLE_TRANSCRIPT, OCCURRED_AT, priorityTexts, taskTexts);

    // Fact was upserted
    expect(factQueries.upsertFact).toHaveBeenCalledWith(
      USER_ID,
      'goal',
      'Wants to close Series A by September',
      'Series A',
      expect.any(String),
      undefined,
    );

    // Episode was stored
    expect(episodeQueries.insert).toHaveBeenCalledOnce();
    const [uid, source, , , topics, commitments] =
      (episodeQueries.insert as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(uid).toBe(USER_ID);
    expect(source).toBe('call');
    expect(topics).toContain('fundraising');
    expect(commitments).toEqual(taskTexts);
  });

  it('episode memory block reflects stored episode on next briefing', () => {
    // Simulate webhook storing episode
    persistCallEpisode(
      USER_ID,
      SAMPLE_TRANSCRIPT,
      OCCURRED_AT,
      ['Close Series A'],
      ['Send pitch deck'],
    );

    // Simulate briefing builder querying episodes
    const storedEpisode: import('./db').Episode = {
      id: 1,
      userId: USER_ID,
      source: 'call',
      occurredAt: OCCURRED_AT,
      contentRaw: SAMPLE_TRANSCRIPT,
      topics: ['fundraising', 'Close Series A'],
      commitments: ['Send pitch deck'],
      createdAt: OCCURRED_AT,
    };
    (episodeQueries.search as ReturnType<typeof vi.fn>).mockReturnValue([storedEpisode]);

    const block = buildEpisodeMemoryBlock(USER_ID, ['Close Series A'], []);
    expect(block).toContain('EPISODIC MEMORY');
    expect(block).toContain('Send pitch deck'); // commitment surfaces in briefing
  });
});
