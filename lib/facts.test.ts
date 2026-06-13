import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: h.create };
  },
}));

// Stub factQueries so tests don't need a real DB
vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>();
  const store: import('./db').Fact[] = [];
  return {
    ...actual,
    factQueries: {
      getAll: vi.fn(() => store),
      upsertFact: vi.fn((userId, category, statement, entity) => {
        const entityNorm = entity?.toLowerCase() ?? null;
        const existing = store.find(f =>
          f.user_id === userId && f.category === category &&
          (entity
            ? f.entity?.toLowerCase() === entityNorm
            : f.entity === null && f.statement.toLowerCase().slice(0, 80) === statement.toLowerCase().slice(0, 80))
        );
        if (existing) {
          if (existing.statement.toLowerCase() !== statement.toLowerCase()) {
            existing.statement = statement;
            existing.learned_at = new Date().toISOString();
          }
        } else {
          store.push({ id: store.length + 1, user_id: userId, category: category as import('./db').Fact['category'], statement, entity: entity ?? null, learned_at: new Date().toISOString() });
        }
      }),
      getByCategory: vi.fn((userId, category) => store.filter(f => f.user_id === userId && f.category === category)),
    },
  };
});

import { extractFactsFromTranscript, extractAndUpsertFacts, linkEventsToFacts, buildPreferencesPrompt } from './facts';
import { factQueries, type Fact } from './db';

function textResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Clear the in-memory store between tests
  (factQueries.getAll as ReturnType<typeof vi.fn>).mockImplementation(() => []);
});

// ── extractFactsFromTranscript ────────────────────────────────────────────────

describe('extractFactsFromTranscript', () => {
  it('parses a valid JSON array from the model response', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'goal', statement: 'Wants to close Series A by September', entity: 'Series A' },
      { category: 'person', statement: 'Sarah is the CFO and a key ally', entity: 'Sarah' },
    ])));

    const facts = await extractFactsFromTranscript('some transcript');
    expect(facts).toHaveLength(2);
    expect(facts[0].category).toBe('goal');
    expect(facts[0].entity).toBe('Series A');
    expect(facts[1].category).toBe('person');
  });

  it('returns [] when the model returns no JSON array', async () => {
    h.create.mockResolvedValue(textResponse('Nothing durable found.'));
    expect(await extractFactsFromTranscript('short')).toEqual([]);
  });

  it('returns [] on API error', async () => {
    h.create.mockRejectedValue(new Error('network failure'));
    expect(await extractFactsFromTranscript('transcript')).toEqual([]);
  });

  it('filters out items with invalid category', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'unknown', statement: 'Some fact', entity: null },
      { category: 'goal', statement: 'Valid goal', entity: 'Project X' },
    ])));
    const facts = await extractFactsFromTranscript('transcript');
    expect(facts).toHaveLength(1);
    expect(facts[0].category).toBe('goal');
  });

  it('caps at 10 facts', async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      category: 'fact',
      statement: `Fact number ${i}`,
      entity: null,
    }));
    h.create.mockResolvedValue(textResponse(JSON.stringify(many)));
    expect(await extractFactsFromTranscript('transcript')).toHaveLength(10);
  });

  it('normalises empty entity string to null', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'preference', statement: 'Prefers morning calls', entity: '  ' },
    ])));
    const facts = await extractFactsFromTranscript('transcript');
    expect(facts[0].entity).toBeNull();
  });
});

// ── extractAndUpsertFacts (dedupe behaviour via the stub) ─────────────────────

describe('extractAndUpsertFacts', () => {
  it('calls upsertFact for each extracted fact', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'goal', statement: 'Close Acme by Q3', entity: 'Acme' },
    ])));
    await extractAndUpsertFacts(1, 'transcript about Acme');
    expect(factQueries.upsertFact).toHaveBeenCalledWith(1, 'goal', 'Close Acme by Q3', 'Acme');
  });

  it('does NOT throw when extraction fails', async () => {
    h.create.mockRejectedValue(new Error('API down'));
    await expect(extractAndUpsertFacts(1, 'transcript')).resolves.toBeUndefined();
  });
});

// ── linkEventsToFacts ─────────────────────────────────────────────────────────

function event(title: string) {
  return { summary: title, start: { dateTime: '2026-06-10T14:00:00Z' }, end: { dateTime: '2026-06-10T15:00:00Z' } };
}
function fact(id: number, category: Fact['category'], statement: string, entity: string | null): Fact {
  return { id, user_id: 1, category, statement, entity, learned_at: '2026-06-05' };
}

describe('linkEventsToFacts', () => {
  it('returns empty array when no entity facts exist', () => {
    const facts: Fact[] = [fact(1, 'preference', 'Prefers morning calls', null)];
    expect(linkEventsToFacts([event('Team sync')], facts)).toEqual([]);
  });

  it('matches an event whose title contains the fact entity', () => {
    const facts: Fact[] = [fact(1, 'goal', 'Wants to close Acme by Q3', 'Acme')];
    const result = linkEventsToFacts([event('Acme quarterly sync')], facts);
    expect(result).toHaveLength(1);
    expect(result[0].eventTitle).toBe('Acme quarterly sync');
    expect(result[0].fact.entity).toBe('Acme');
  });

  it('is case-insensitive in entity matching', () => {
    const facts: Fact[] = [fact(1, 'person', 'Sarah is the CFO', 'Sarah')];
    const result = linkEventsToFacts([event('call with sarah re fundraise')], facts);
    expect(result).toHaveLength(1);
  });

  it('caps results at 3', () => {
    const facts: Fact[] = [
      fact(1, 'goal', 'Goal about Alpha', 'Alpha'),
      fact(2, 'goal', 'Goal about Beta', 'Beta'),
      fact(3, 'goal', 'Goal about Gamma', 'Gamma'),
      fact(4, 'goal', 'Goal about Delta', 'Delta'),
    ];
    const events = [event('Alpha sync'), event('Beta review'), event('Gamma standup'), event('Delta call')];
    expect(linkEventsToFacts(events, facts)).toHaveLength(3);
  });

  it('skips facts with no entity', () => {
    const facts: Fact[] = [fact(1, 'preference', 'Likes focus time', null)];
    expect(linkEventsToFacts([event('Focus time block')], facts)).toEqual([]);
  });

  it('prioritises goal and project facts over preference', () => {
    const facts: Fact[] = [
      fact(1, 'preference', 'Acme preference note', 'Acme'),
      fact(2, 'goal', 'Acme is top acquisition target', 'Acme'),
    ];
    const result = linkEventsToFacts([event('Acme sync')], facts);
    // both match; goal should come first
    expect(result[0].fact.category).toBe('goal');
  });
});

// ── buildPreferencesPrompt ────────────────────────────────────────────────────

describe('buildPreferencesPrompt', () => {
  it('returns empty string for no preferences', () => {
    expect(buildPreferencesPrompt([])).toBe('');
  });

  it('formats a single preference as a bullet', () => {
    expect(buildPreferencesPrompt(['Prefers boutique gyms over big chains']))
      .toBe('- Prefers boutique gyms over big chains');
  });

  it('formats multiple preferences as a bullet list', () => {
    const result = buildPreferencesPrompt(['Boutique gyms only', 'No meetings before 9am']);
    expect(result).toBe('- Boutique gyms only\n- No meetings before 9am');
  });

  it('caps at 10 entries even when more are passed', () => {
    const many = Array.from({ length: 15 }, (_, i) => `Preference ${i}`);
    const lines = buildPreferencesPrompt(many).split('\n');
    expect(lines).toHaveLength(10);
  });

  it('preserves the first 10 entries in order', () => {
    const many = Array.from({ length: 12 }, (_, i) => `Pref ${i}`);
    const result = buildPreferencesPrompt(many);
    expect(result).toContain('- Pref 0');
    expect(result).toContain('- Pref 9');
    expect(result).not.toContain('- Pref 10');
  });
});
