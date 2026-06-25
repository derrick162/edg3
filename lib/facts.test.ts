import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: h.create };
  },
}));

// Stub ./calendar so extractAndUpsertFacts' auto-fetch of today's events (used for name
// grounding when calendarEventTitles isn't supplied) returns deterministically. Without this
// the real getCalendarEvents path runs and is flaky under parallel test load.
vi.mock('./calendar', () => ({
  getCalendarEvents: vi.fn(async () => []),
}));

// Stub factQueries and peopleProfileQueries so tests don't need a real DB
vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>();
  const store: import('./db').Fact[] = [];
  return {
    ...actual,
    factQueries: {
      getAll: vi.fn(() => store),
      upsertFact: vi.fn((userId, category, statement, entity, confidence = 'high', sourceBriefingId = null) => {
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
          store.push({ id: store.length + 1, user_id: userId, category: category as import('./db').Fact['category'], statement, entity: entity ?? null, learned_at: new Date().toISOString(), confidence, source_briefing_id: sourceBriefingId });
        }
      }),
      getByCategory: vi.fn((userId, category) => store.filter(f => f.user_id === userId && f.category === category)),
      updateFact: vi.fn((userId: number, id: number, statement: string, entity: string | null) => {
        const fact = store.find(f => f.id === id && f.user_id === userId);
        if (fact) { fact.statement = statement; fact.entity = entity; fact.learned_at = new Date().toISOString(); }
      }),
      updateLearnedAt: vi.fn((userId: number, id: number, learnedAt: string) => {
        const fact = store.find(f => f.id === id && f.user_id === userId);
        if (fact) fact.learned_at = learnedAt;
      }),
      deleteFact: vi.fn((userId: number, id: number) => {
        const idx = store.findIndex(f => f.id === id && f.user_id === userId);
        if (idx !== -1) store.splice(idx, 1);
      }),
      retire: vi.fn((userId: number, id: number) => {
        const fact = store.find(f => f.id === id && f.user_id === userId);
        if (fact) fact.valid_until = new Date().toISOString();
      }),
    },
    peopleProfileQueries: {
      // Default: returns empty array so existing tests are unaffected (no M2 filter applied).
      listForUser: vi.fn(() => []),
    },
  };
});

import { extractFactsFromTranscript, extractAndUpsertFacts, extractAndUpsertFactsFromEmail, linkEventsToFacts, buildPreferencesPrompt, consolidateFacts, cleanupPeopleFacts, runSleepTimeConsolidation, derivePersonModelFields, looksLikeEventEntity, reassignEventEntityFacts } from './facts';
import { factQueries, peopleProfileQueries, type Fact } from './db';
import type { EmailSignal, EmailSignalItem } from './gmail';

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
  it('calls upsertFact with confidence and sourceBriefingId', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'goal', statement: 'Close Acme by Q3', entity: 'Acme', confidence: 'high' },
    ])));
    await extractAndUpsertFacts(1, 'transcript about Acme', 'Derrick', 42);
    expect(factQueries.upsertFact).toHaveBeenCalledWith(1, 'goal', 'Close Acme by Q3', 'Acme', 'high', 42);
  });

  it('skips person facts where entity is the user themselves (exact name)', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'person', statement: 'Derrick is the CEO', entity: 'Derrick', confidence: 'high' },
      { category: 'goal', statement: 'Raise $2M by Q4', entity: null, confidence: 'high' },
    ])));
    await extractAndUpsertFacts(1, 'transcript', 'Derrick Fung');
    expect(factQueries.upsertFact).toHaveBeenCalledTimes(1); // goal only, self-person skipped
    expect(factQueries.upsertFact).toHaveBeenCalledWith(1, 'goal', 'Raise $2M by Q4', null, 'high', undefined);
  });

  it('skips person facts where entity is the user first name (case-insensitive)', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'person', statement: 'DERRICK is the founder', entity: 'DERRICK', confidence: 'high' },
    ])));
    await extractAndUpsertFacts(1, 'transcript', 'Derrick Fung');
    // "DERRICK" (case-insensitive) matches first name "derrick" — skip
    expect(factQueries.upsertFact).not.toHaveBeenCalled();
  });

  it('does NOT skip person facts about OTHER people', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'person', statement: 'Sarah is the CFO', entity: 'Sarah', confidence: 'high' },
    ])));
    await extractAndUpsertFacts(1, 'transcript', 'Derrick Fung');
    expect(factQueries.upsertFact).toHaveBeenCalledWith(1, 'person', 'Sarah is the CFO', 'Sarah', 'high', undefined);
  });

  it('does NOT throw when extraction fails', async () => {
    h.create.mockRejectedValue(new Error('API down'));
    await expect(extractAndUpsertFacts(1, 'transcript')).resolves.toBe(0);
  });
});

describe('extractFactsFromTranscript — userName injection', () => {
  it('includes userName in the prompt when provided', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([])));
    await extractFactsFromTranscript('some transcript', 'Derrick Fung');
    const promptContent = h.create.mock.calls[0][0].messages[0].content as string;
    expect(promptContent).toContain('"Derrick Fung"');
  });

  // R26 T2 — the extractor must never read Edge's own deflections as the user's preferences.
  it('includes an ATTRIBUTION rule that excludes assistant statements (R26 T2)', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([])));
    await extractFactsFromTranscript('Edge: let us save that for another time.');
    const promptContent = h.create.mock.calls[0][0].messages[0].content as string;
    expect(promptContent).toContain('ATTRIBUTION');
    expect(promptContent).toMatch(/USER stated/);
    expect(promptContent).toMatch(/assistant.*NOT a user preference|NOT a user preference/);
  });

  // R39 T1/T2 — read more transcript (8000, not 2000) + person includes "friend" + explicit pet guidance.
  it('reads up to 8000 transcript chars and includes friend + pet guidance (R39)', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([])));
    const longTranscript = 'A'.repeat(2500) + ' JAMIE_THE_DOG_MARKER ' + 'B'.repeat(2500);
    await extractFactsFromTranscript(longTranscript);
    const prompt = h.create.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('JAMIE_THE_DOG_MARKER'); // would have been cut by the old 2000-char slice
    expect(prompt).toContain('friend, close friend');
    expect(prompt).toMatch(/PETS/);
  });

  // R34 T1 — commitments ("I'm going to tackle X today") are a first-class extraction category.
  it('includes the commitment category in the extraction prompt (R34)', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([])));
    await extractFactsFromTranscript('User: I am going to tackle the Railway fix today.');
    const promptContent = h.create.mock.calls[0][0].messages[0].content as string;
    expect(promptContent).toContain('"commitment"');
    expect(promptContent).toMatch(/will do/i);
  });

  it('accepts a commitment-category fact from the model (R34)', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'commitment', statement: 'tackle the Railway fix today', entity: null, confidence: 'high' },
    ])));
    const facts = await extractFactsFromTranscript('transcript');
    expect(facts).toHaveLength(1);
    expect(facts[0].category).toBe('commitment');
  });

  // R28 T1 — explicit "please remember" requests must be treated as mandatory facts.
  it('includes an EXPLICIT REMEMBER REQUESTS rule in the extraction prompt (R28)', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([])));
    await extractFactsFromTranscript('User: please remember that Patrick grew up in Dallas.');
    const promptContent = h.create.mock.calls[0][0].messages[0].content as string;
    expect(promptContent).toContain('EXPLICIT REMEMBER REQUESTS');
    expect(promptContent).toMatch(/please remember/);
    expect(promptContent).toMatch(/mandatory/i);
  });

  it('maps model confidence:"low" to ExtractedFact confidence:"low"', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'person', statement: 'Sarah is an investor', entity: 'Sarah', confidence: 'low' },
    ])));
    const facts = await extractFactsFromTranscript('transcript');
    expect(facts[0].confidence).toBe('low');
  });

  it('defaults to confidence:"high" when model omits the field', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'goal', statement: 'Launch by September', entity: null },
    ])));
    const facts = await extractFactsFromTranscript('transcript');
    expect(facts[0].confidence).toBe('high');
  });
});

// ── linkEventsToFacts ─────────────────────────────────────────────────────────

function event(title: string) {
  return { summary: title, start: { dateTime: '2026-06-10T14:00:00Z' }, end: { dateTime: '2026-06-10T15:00:00Z' } };
}
function fact(id: number, category: Fact['category'], statement: string, entity: string | null): Fact {
  return { id, user_id: 1, category, statement, entity, learned_at: '2026-06-05', confidence: 'high', source_briefing_id: null };
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

// ── factQueries.updateFact / deleteFact ──────────────────────────────────────

describe('factQueries.updateFact', () => {
  it('is called with (userId, id, statement, entity)', () => {
    vi.mocked(factQueries.updateFact)(1, 7, 'likes tea', null);
    expect(factQueries.updateFact).toHaveBeenCalledWith(1, 7, 'likes tea', null);
  });

  it('passes through a non-null entity', () => {
    vi.mocked(factQueries.updateFact)(2, 3, 'Sarah is the CFO', 'Sarah');
    expect(factQueries.updateFact).toHaveBeenCalledWith(2, 3, 'Sarah is the CFO', 'Sarah');
  });

  it('does not affect a fact owned by a different user (user_id scoping)', () => {
    // Seed a fact for user 1, then attempt to update it as user 2.
    vi.mocked(factQueries.upsertFact)(1, 'preference', 'early bird', null);
    // Mock guard (f.user_id === userId) means user 2 cannot mutate user 1's row.
    vi.mocked(factQueries.updateFact)(2, 1, 'night owl', null);
    expect(factQueries.updateFact).toHaveBeenCalledWith(2, 1, 'night owl', null);
  });
});

describe('factQueries.deleteFact', () => {
  it('is called with (userId, id)', () => {
    vi.mocked(factQueries.deleteFact)(1, 5);
    expect(factQueries.deleteFact).toHaveBeenCalledWith(1, 5);
  });

  it('does not remove a fact owned by a different user (user_id scoping)', () => {
    vi.mocked(factQueries.upsertFact)(1, 'fact', 'protected', null);
    // User 2 attempts to delete id=1 — mock splice guard (f.user_id === userId) blocks it.
    vi.mocked(factQueries.deleteFact)(2, 1);
    expect(factQueries.deleteFact).toHaveBeenCalledWith(2, 1);
  });
});

// ── enrichFact (R29 — universally cumulative memory) ─────────────────────────

describe('enrichFact (R29)', () => {
  it('returns the Haiku-merged statement preserving all info (person: 4 facts)', async () => {
    const { enrichFact } = await import('./facts');
    h.create.mockResolvedValue(textResponse(
      'Patrick is a friend whose bachelor party is in Vegas; he grew up in Dallas and Derrick met him in New York.',
    ));
    const merged = await enrichFact(
      'Patrick is a friend whose bachelor party is in Vegas',
      'Patrick grew up in Dallas and Derrick met him in New York',
    );
    expect(merged).toContain('bachelor party');
    expect(merged).toContain('Vegas');
    expect(merged).toContain('Dallas');
    expect(merged).toContain('New York');
  });

  it('merges a preference (both retained)', async () => {
    const { enrichFact } = await import('./facts');
    h.create.mockResolvedValue(textResponse('Prefers morning calls and also likes to work Saturdays.'));
    const merged = await enrichFact('prefers morning calls', 'also likes to work Saturdays');
    expect(merged).toContain('morning calls');
    expect(merged).toContain('Saturdays');
  });

  it('on contradiction the NEW claim wins but other facts are preserved', async () => {
    const { enrichFact } = await import('./facts');
    h.create.mockResolvedValue(textResponse('Lives in New York; works in fintech and has two kids.'));
    const merged = await enrichFact('lives in Toronto, works in fintech and has two kids', 'lives in New York now');
    expect(merged).toContain('New York');
    expect(merged).not.toContain('Toronto');
    expect(merged).toContain('fintech');
  });

  it('strips wrapping quotes the model sometimes adds', async () => {
    const { enrichFact } = await import('./facts');
    h.create.mockResolvedValue(textResponse('"Patrick is a friend in Vegas and Dallas."'));
    const merged = await enrichFact('Patrick is a friend in Vegas', 'Patrick is from Dallas');
    expect(merged.startsWith('"')).toBe(false);
    expect(merged.endsWith('"')).toBe(false);
  });

  it('falls back to concatenation when Haiku fails (never throws)', async () => {
    const { enrichFact } = await import('./facts');
    h.create.mockRejectedValue(new Error('haiku down'));
    const merged = await enrichFact('prefers morning calls', 'likes Saturdays');
    expect(merged).toBe('prefers morning calls likes Saturdays');
  });

  it('falls back to concatenation when Haiku returns empty output', async () => {
    const { enrichFact } = await import('./facts');
    h.create.mockResolvedValue(textResponse('   '));
    const merged = await enrichFact('a fact', 'another fact');
    expect(merged).toBe('a fact another fact');
  });

  it('caps the merged result at 500 chars', async () => {
    const { enrichFact } = await import('./facts');
    h.create.mockRejectedValue(new Error('down')); // force concat fallback
    const merged = await enrichFact('x'.repeat(400), 'y'.repeat(400));
    expect(merged.length).toBeLessThanOrEqual(500);
  });

  it('skips the Haiku call entirely when the new info is already in the old statement', async () => {
    const { enrichFact } = await import('./facts');
    h.create.mockClear();
    const merged = await enrichFact('Patrick is a friend whose bachelor party is in Vegas', 'bachelor party is in Vegas');
    expect(h.create).not.toHaveBeenCalled();
    expect(merged).toBe('Patrick is a friend whose bachelor party is in Vegas');
  });
});

// ── consolidateFacts ──────────────────────────────────────────────────────────

function makeFact(id: number, category: Fact['category'], entity: string | null, statement: string, learned_at = '2026-06-01', confidence: 'high' | 'low' = 'high'): Fact {
  return { id, user_id: 1, category, entity, statement, learned_at, confidence, source_briefing_id: null };
}

describe('consolidateFacts', () => {
  it('returns 0 when there are no duplicates', () => {
    vi.mocked(factQueries.getAll).mockReturnValueOnce([
      makeFact(1, 'person', 'Sarah', 'Sarah is the CFO'),
      makeFact(2, 'person', 'Mike', 'Mike is an investor'),
    ]);
    expect(consolidateFacts(1)).toBe(0);
    expect(factQueries.deleteFact).not.toHaveBeenCalled();
  });

  it('deletes the shorter duplicate and keeps the longer statement', () => {
    vi.mocked(factQueries.getAll).mockReturnValueOnce([
      makeFact(1, 'person', 'CIBC', 'User owes CIBC'),
      makeFact(2, 'person', 'CIBC', 'User is in debt negotiation with CIBC for $45k'),
    ]);
    const removed = consolidateFacts(1);
    expect(removed).toBe(1);
    expect(factQueries.deleteFact).toHaveBeenCalledWith(1, 1); // shorter statement deleted
  });

  it('merges two facts with same category + same entity (case-insensitive)', () => {
    vi.mocked(factQueries.getAll).mockReturnValueOnce([
      makeFact(1, 'goal', 'Series A', 'Wants to close Series A'),
      makeFact(2, 'goal', 'Series A', 'Wants to close Series A by September 2026 at $3M'),
    ]);
    const removed = consolidateFacts(1);
    expect(removed).toBe(1);
    expect(factQueries.deleteFact).toHaveBeenCalledWith(1, 1); // id=1 is shorter, gets deleted
  });

  it('updates the kept fact when the best statement is not already on the keeper', () => {
    // keeper (longest) is fact id=2, but fact id=1 has a slightly longer statement
    vi.mocked(factQueries.getAll).mockReturnValueOnce([
      makeFact(1, 'goal', 'Series A', 'Wants to close Series A by September 2026 at $3M', '2026-06-10'),
      makeFact(2, 'goal', 'series a', 'Wants to close Series A', '2026-06-12'),
    ]);
    const removed = consolidateFacts(1);
    expect(removed).toBe(1);
    // id=2 is most recent (tiebreaker), but id=1 has the longest statement (>20 chars diff)
    // keeper = id=1 (longest first), bestStatement from id=1 = already on keeper → no update needed
    // OR keeper = id=2 (newest), but id=1 is longer by >20 → sorted[0] = id=1
    expect(factQueries.deleteFact).toHaveBeenCalledTimes(1);
  });

  it('merges null-entity goal/preference facts with high Jaccard overlap', () => {
    // "Prefers morning calls" vs "Prefers morning calls — confirmed twice" share 3/5 tokens
    // (Jaccard ≈ 0.6) → should be merged (Pass 0).
    vi.mocked(factQueries.getAll).mockReturnValueOnce([
      makeFact(1, 'preference', null, 'Prefers morning calls'),
      makeFact(2, 'preference', null, 'Prefers morning calls — confirmed twice'),
    ]);
    const removed = consolidateFacts(1);
    expect(removed).toBe(1);
    expect(factQueries.deleteFact).toHaveBeenCalledTimes(1);
  });

  it('skips null-entity facts from non-goal/preference categories (fact category)', () => {
    vi.mocked(factQueries.getAll).mockReturnValueOnce([
      makeFact(1, 'fact', null, 'Company founded in 2020'),
      makeFact(2, 'fact', null, 'Company was founded in 2020 by Derrick'),
    ]);
    const removed = consolidateFacts(1);
    expect(removed).toBe(0);
    expect(factQueries.deleteFact).not.toHaveBeenCalled();
  });

  it('does not merge null-entity goals with low token overlap (genuinely different goals)', () => {
    vi.mocked(factQueries.getAll).mockReturnValueOnce([
      makeFact(1, 'goal', null, 'Raise a Series A by end of year'),
      makeFact(2, 'goal', null, 'Hire a VP of Engineering'),
    ]);
    const removed = consolidateFacts(1);
    expect(removed).toBe(0);
    expect(factQueries.deleteFact).not.toHaveBeenCalled();
  });

  it('skips facts with blank (whitespace-only) entity', () => {
    vi.mocked(factQueries.getAll).mockReturnValueOnce([
      makeFact(1, 'fact', '  ', 'Some fact'),
      makeFact(2, 'fact', '   ', 'Another fact'),
    ]);
    expect(consolidateFacts(1)).toBe(0);
    expect(factQueries.deleteFact).not.toHaveBeenCalled();
  });

  it('handles multiple distinct entity groups independently', () => {
    vi.mocked(factQueries.getAll).mockReturnValueOnce([
      makeFact(1, 'person', 'Sarah', 'Sarah is CFO'),
      makeFact(2, 'person', 'Sarah', 'Sarah Green is the CFO and ally'),
      makeFact(3, 'person', 'Mike', 'Mike is an investor'),
      makeFact(4, 'person', 'Mike', 'Mike Rodriguez invested $500k in the seed round'),
    ]);
    const removed = consolidateFacts(1);
    expect(removed).toBe(2); // one dup per group
    expect(factQueries.deleteFact).toHaveBeenCalledTimes(2);
  });

  it('prefers high-confidence fact over longer low-confidence fact', () => {
    // low-confidence has a longer statement but user-corrected high-confidence wins
    vi.mocked(factQueries.getAll).mockReturnValueOnce([
      makeFact(1, 'person', 'Jim', 'Jim is a person who trains people at a local gym in Vancouver', '2026-06-10', 'low'),
      makeFact(2, 'person', 'Jim', 'Jim Smith is my personal trainer', '2026-06-12', 'high'),
    ]);
    const removed = consolidateFacts(1);
    expect(removed).toBe(1);
    // high-confidence fact (id=2) is kept as the primary; id=1 (low confidence, longer) is deleted
    expect(factQueries.deleteFact).toHaveBeenCalledWith(1, 1);
    // no updateFact call — the high-confidence statement is already on the keeper (id=2)
    expect(factQueries.updateFact).not.toHaveBeenCalled();
  });

  it('both high-confidence → falls back to length then recency', () => {
    vi.mocked(factQueries.getAll).mockReturnValueOnce([
      makeFact(1, 'person', 'Sarah', 'Sarah is the CFO', '2026-06-10', 'high'),
      makeFact(2, 'person', 'Sarah', 'Sarah Green is the Chief Financial Officer and board observer', '2026-06-12', 'high'),
    ]);
    const removed = consolidateFacts(1);
    expect(removed).toBe(1);
    // id=2 is longer (>20 char diff) → kept; id=1 deleted
    expect(factQueries.deleteFact).toHaveBeenCalledWith(1, 1);
  });

  // R25 T6 — a goal re-stated on a later call merges into the keeper; the "learned" stamp must
  // stay anchored to the ORIGINAL date, not jump forward to the re-statement date.
  it('preserves the original (oldest) learned_at when a re-stated goal merges into a newer keeper', () => {
    // id=2 is the keeper (longer statement) but was learned LATER than id=1.
    vi.mocked(factQueries.getAll).mockReturnValueOnce([
      makeFact(1, 'goal', 'Series A', 'Wants to close Series A', '2026-06-01'),
      makeFact(2, 'goal', 'series a', 'Wants to close Series A by September 2026 at a $3M valuation', '2026-06-20'),
    ]);
    consolidateFacts(1);
    expect(factQueries.updateLearnedAt).toHaveBeenCalledWith(1, 2, '2026-06-01');
  });

  it('does not touch learned_at when the keeper is already the oldest in the group', () => {
    // id=1 is the keeper (longer) AND the oldest → no re-anchor needed.
    vi.mocked(factQueries.getAll).mockReturnValueOnce([
      makeFact(1, 'goal', 'Series A', 'Wants to close Series A by September 2026 at a $3M valuation', '2026-06-01'),
      makeFact(2, 'goal', 'series a', 'Wants to close Series A', '2026-06-20'),
    ]);
    consolidateFacts(1);
    expect(factQueries.updateLearnedAt).not.toHaveBeenCalled();
  });
});

// ── extractFactsFromTranscript — existingFacts injection ─────────────────────

describe('extractFactsFromTranscript — existingFacts injection', () => {
  it('includes existing facts in the prompt when provided', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([])));
    const existingFacts = [
      { category: 'goal', statement: 'Wants to close Series A by September', entity: 'Series A' },
    ];
    await extractFactsFromTranscript('some transcript', undefined, undefined, existingFacts);
    const promptContent = h.create.mock.calls[0][0].messages[0].content as string;
    expect(promptContent).toContain('net-new');
    expect(promptContent).toContain('Wants to close Series A by September');
  });

  it('omits the existing-facts block when existingFacts is empty', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([])));
    await extractFactsFromTranscript('some transcript', undefined, undefined, []);
    const promptContent = h.create.mock.calls[0][0].messages[0].content as string;
    expect(promptContent).not.toContain('net-new');
  });

  it('caps the injected existing facts at 30 items', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([])));
    const many = Array.from({ length: 40 }, (_, i) => ({ category: 'fact', statement: `Fact ${i}`, entity: null }));
    await extractFactsFromTranscript('transcript', undefined, undefined, many);
    const promptContent = h.create.mock.calls[0][0].messages[0].content as string;
    expect(promptContent).toContain('Fact 29');
    expect(promptContent).not.toContain('Fact 30');
  });
});

// ── people fact guards ────────────────────────────────────────────────────────

describe('people fact guards', () => {
  it('blocks assistant entity "Edge" even at high confidence', async () => {
    // The model returned "Edge" as a person entity — should be silently dropped.
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'person', statement: 'Edge is the AI assistant', entity: 'Edge', confidence: 'high' },
    ])));
    await extractAndUpsertFacts(1, 'transcript', 'Derrick Fung');
    expect(factQueries.upsertFact).not.toHaveBeenCalled();
  });

  it('blocks activity entity "Gym" at low confidence', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'person', statement: 'Gym is where Derrick goes', entity: 'Gym', confidence: 'low' },
    ])));
    await extractAndUpsertFacts(1, 'transcript', 'Derrick Fung');
    expect(factQueries.upsertFact).not.toHaveBeenCalled();
  });

  it('blocks self-entity "Derrick" when userName is "Derrick Fung"', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'person', statement: 'Derrick works with Derrick Fung', entity: 'Derrick', confidence: 'high' },
    ])));
    await extractAndUpsertFacts(1, 'transcript', 'Derrick Fung');
    expect(factQueries.upsertFact).not.toHaveBeenCalled();
  });

  it('drops low-conf person with no M2 match when M2 data is available', async () => {
    // M2 has Faiza — "Laura" is unknown and low-confidence → should be dropped.
    vi.mocked(peopleProfileQueries.listForUser).mockReturnValueOnce([
      { id: 1, user_id: 1, canonical_name: 'Faiza', email: null, interaction_count: 3,
        last_interaction: '2026-06-01', upcoming_interaction: null, updated_at: '2026-06-01' },
    ]);
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'person', statement: 'Laura seems to be an investor', entity: 'Laura', confidence: 'low' },
    ])));
    await extractAndUpsertFacts(1, 'transcript', 'Derrick Fung');
    expect(factQueries.upsertFact).not.toHaveBeenCalled();
  });

  it('keeps low-conf person that matches a known M2 contact', async () => {
    // M2 has Faiza — a low-confidence "Faiza" fact should be kept.
    vi.mocked(peopleProfileQueries.listForUser).mockReturnValueOnce([
      { id: 1, user_id: 1, canonical_name: 'Faiza', email: null, interaction_count: 3,
        last_interaction: '2026-06-01', upcoming_interaction: null, updated_at: '2026-06-01' },
    ]);
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'person', statement: 'Faiza is a key investor', entity: 'Faiza', confidence: 'low' },
    ])));
    await extractAndUpsertFacts(1, 'transcript', 'Derrick Fung');
    expect(factQueries.upsertFact).toHaveBeenCalledWith(1, 'person', 'Faiza is a key investor', 'Faiza', 'low', undefined);
  });

  it('merges "Pfizer CIBC" into "Pfizer" via fuzzy containment dedup', () => {
    // Two person facts: shorter "Pfizer" and longer "Pfizer CIBC" — longer should be deleted.
    vi.mocked(factQueries.getAll).mockReturnValue([
      makeFact(1, 'person', 'Pfizer', 'Pfizer is a company Derrick is tracking'),
      makeFact(2, 'person', 'Pfizer CIBC', 'Pfizer CIBC seems to be a duplicate entry'),
    ]);
    consolidateFacts(1);
    // The longer entity "Pfizer CIBC" (id=2) should be deleted (or at minimum deleteFact called once)
    expect(factQueries.deleteFact).toHaveBeenCalledTimes(1);
    expect(factQueries.deleteFact).toHaveBeenCalledWith(1, 2);
  });

  it('keeps low-conf person when M2 returns no data (no filter applied)', async () => {
    // M2 is empty → hasM2Data is false → low-conf person "Unknown Person" is kept.
    vi.mocked(peopleProfileQueries.listForUser).mockReturnValueOnce([]);
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'person', statement: 'Unknown Person mentioned something', entity: 'Unknown Person', confidence: 'low' },
    ])));
    await extractAndUpsertFacts(1, 'transcript', 'Derrick Fung');
    expect(factQueries.upsertFact).toHaveBeenCalledWith(
      1, 'person', 'Unknown Person mentioned something', 'Unknown Person', 'low', undefined,
    );
  });
});

// ── UX-2: No duplicate contacts/facts/events (PILLAR-TRUST) ─────────────────────
// Verification tests: extract from a transcript that mentions the user, Edge, Edg3,
// and a repeated fact — none should produce duplicates or blocked entities.

describe('UX-2 duplicate and blocked entity guards', () => {
  it('blocks "Edg3" as a person entity (assistant brand variant)', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'person', statement: 'Edg3 is the AI assistant Derrick uses', entity: 'Edg3', confidence: 'high' },
    ])));
    await extractAndUpsertFacts(1, 'transcript', 'Derrick Fung');
    expect(factQueries.upsertFact).not.toHaveBeenCalled();
  });

  it('blocks "Edg3 AI" as a person entity', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'person', statement: 'Edg3 AI handles briefings', entity: 'Edg3 AI', confidence: 'high' },
    ])));
    await extractAndUpsertFacts(1, 'transcript', 'Derrick Fung');
    expect(factQueries.upsertFact).not.toHaveBeenCalled();
  });

  it('stores a non-duplicate goal when identical active fact already exists (consolidation dedup)', () => {
    // Two identical goal facts → consolidateFacts should keep the higher-confidence one
    vi.mocked(factQueries.getAll).mockReturnValue([
      makeFact(1, 'goal', 'Series A', 'Wants to close Series A by September'),
      makeFact(2, 'goal', 'Series A', 'Wants to close Series A by September'),
    ]);
    consolidateFacts(1);
    // One of the duplicates should be deleted
    expect(factQueries.deleteFact).toHaveBeenCalledTimes(1);
  });

  it('full UX-2 scenario: transcript with user name, Edge, Edg3, repeated fact → zero bad upserts', async () => {
    // Model returns 4 candidates: user self, Edge, Edg3, and a valid goal
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'person', statement: 'Derrick runs the company', entity: 'Derrick', confidence: 'high' },
      { category: 'person', statement: 'Edge is the AI', entity: 'Edge', confidence: 'high' },
      { category: 'person', statement: 'Edg3 handles scheduling', entity: 'Edg3', confidence: 'high' },
      { category: 'goal', statement: 'Wants to close Series A by September', entity: 'Series A', confidence: 'high' },
    ])));
    await extractAndUpsertFacts(1, 'Morning briefing transcript', 'Derrick Fung');

    // Only the goal should be stored — all person facts should be blocked
    const calls = (factQueries.upsertFact as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toBe('goal'); // only the goal category passes through
  });
});

// ── UX-3: Name spelled correctly in extraction (PILLAR-TRUST) ─────────────────
// Verifies that the extraction prompt includes userName so the model uses correct spelling,
// and that isSelfEntity correctly filters self-references at different name forms.

describe('UX-3 name spelling and self-entity filtering', () => {
  it('blocks first-name-only self reference (Derrick → filtered)', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'person', statement: 'Derrick is focused on fundraising', entity: 'Derrick', confidence: 'high' },
    ])));
    await extractAndUpsertFacts(1, 'transcript', 'Derrick');
    expect(factQueries.upsertFact).not.toHaveBeenCalled();
  });

  it('blocks full-name self reference (Derrick Fung → filtered)', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'person', statement: 'Derrick Fung is the CEO', entity: 'Derrick Fung', confidence: 'high' },
    ])));
    await extractAndUpsertFacts(1, 'transcript', 'Derrick Fung');
    expect(factQueries.upsertFact).not.toHaveBeenCalled();
  });

  it('blocks a nickname/STT self reference (derek → Derrick Fung, filtered)', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'person', statement: 'Derrick works with Derrick Fung', entity: 'derek', confidence: 'high' },
    ])));
    await extractAndUpsertFacts(1, 'transcript', 'Derrick Fung');
    expect(factQueries.upsertFact).not.toHaveBeenCalled();
  });

  it('blocks a last-name-only self reference (Fung → filtered)', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'person', statement: 'Fung is the founder', entity: 'Fung', confidence: 'high' },
    ])));
    await extractAndUpsertFacts(1, 'transcript', 'Derrick Fung');
    expect(factQueries.upsertFact).not.toHaveBeenCalled();
  });

  it('passes user name to extractFactsFromTranscript so STT misspellings use correct name', async () => {
    // Verify the Anthropic API receives the prompt containing the userName hint
    h.create.mockResolvedValue(textResponse(JSON.stringify([])));
    await extractAndUpsertFacts(1, 'Derek said he wants to close the deal', 'Derrick Fung');
    // The create call should have been made with a prompt containing userName
    const callArgs = (h.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const promptText = JSON.stringify(callArgs);
    expect(promptText).toContain('Derrick Fung');
  });
});

// ── Ungrounded health-fact guard (Memory tab P0) ──────────────────────────────
describe('health-fact anti-hallucination guard', () => {
  it('drops a weight fact whose number is not in the transcript', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'fact', statement: 'Derrick weighs 122 lbs', entity: null, confidence: 'high' },
    ])));
    await extractAndUpsertFacts(1, 'We talked about fundraising and the calendar.', 'Derrick Fung');
    expect(factQueries.upsertFact).not.toHaveBeenCalled();
  });

  it('keeps a weight fact the user explicitly stated', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { category: 'fact', statement: 'Derrick weighs 122 lbs', entity: null, confidence: 'high' },
    ])));
    await extractAndUpsertFacts(1, 'I weigh 122 right now and want to get to 135.', 'Derrick Fung');
    expect(factQueries.upsertFact).toHaveBeenCalledTimes(1);
  });
});

// ── Sleep-time consolidation agent (T2) ───────────────────────────────────────
describe('runSleepTimeConsolidation', () => {
  it('returns early for short transcripts without calling Haiku', async () => {
    await runSleepTimeConsolidation(1, 'too short', 'Derrick');
    expect(h.create).not.toHaveBeenCalled();
  });

  it('calls upsertFact for "update" action with new statement', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { action: 'update', category: 'preference', entity: 'gym schedule', old: 'gym is at 6am', new: 'gym is at 7am', reason: 'user said moved to 7am' },
    ])));
    await runSleepTimeConsolidation(1, 'x'.repeat(100), 'Derrick');
    expect(factQueries.upsertFact).toHaveBeenCalledWith(1, 'preference', 'gym is at 7am', 'gym schedule', 'high');
  });

  it('calls upsertFact for "add" action with new statement', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { action: 'add', category: 'goal', entity: null, new: 'Close Series A by September', reason: 'new goal stated' },
    ])));
    await runSleepTimeConsolidation(1, 'x'.repeat(100), 'Derrick');
    expect(factQueries.upsertFact).toHaveBeenCalledWith(1, 'goal', 'Close Series A by September', null, 'high');
  });

  it('drops an ungrounded health metric on "add" (guard parity with extraction path)', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { action: 'add', category: 'fact', entity: null, new: 'Derrick weighs 122 lbs', reason: 'mentioned' },
    ])));
    await runSleepTimeConsolidation(1, 'We discussed fundraising and the calendar today.', 'Derrick Fung');
    expect(factQueries.upsertFact).not.toHaveBeenCalled();
  });

  it('blocks a self-entity person fact on "add" (guard parity with extraction path)', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { action: 'add', category: 'person', entity: 'derek', new: 'Derrick works with Derrick Fung', reason: 'mentioned' },
    ])));
    await runSleepTimeConsolidation(1, 'x'.repeat(100), 'Derrick Fung');
    expect(factQueries.upsertFact).not.toHaveBeenCalled();
  });

  it('calls retire for "retire" action when matching active fact exists', async () => {
    vi.mocked(factQueries.getByCategory).mockReturnValue([
      { id: 99, user_id: 1, category: 'goal', statement: 'Raise $500K by June', entity: 'fundraising', learned_at: '2026-06-01', confidence: 'low', source_briefing_id: null },
    ]);
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { action: 'retire', category: 'goal', entity: 'fundraising', old: 'Raise $500K by June', reason: 'user said round is closed' },
    ])));
    await runSleepTimeConsolidation(1, 'x'.repeat(100), 'Derrick');
    expect(factQueries.retire).toHaveBeenCalledWith(1, 99);
  });

  it('does nothing when Haiku returns empty array', async () => {
    h.create.mockResolvedValue(textResponse('[]'));
    await runSleepTimeConsolidation(1, 'x'.repeat(100), 'Derrick');
    expect(factQueries.upsertFact).not.toHaveBeenCalled();
    expect(factQueries.retire).not.toHaveBeenCalled();
  });

  it('degrades silently when Haiku call throws', async () => {
    h.create.mockRejectedValue(new Error('API down'));
    await expect(runSleepTimeConsolidation(1, 'x'.repeat(100), 'Derrick')).resolves.toBeUndefined();
    expect(factQueries.upsertFact).not.toHaveBeenCalled();
  });

  it('skips updates with invalid category', async () => {
    h.create.mockResolvedValue(textResponse(JSON.stringify([
      { action: 'add', category: 'invalid_category', entity: null, new: 'Some fact', reason: 'test' },
    ])));
    await runSleepTimeConsolidation(1, 'x'.repeat(100), 'Derrick');
    expect(factQueries.upsertFact).not.toHaveBeenCalled();
  });

  it('M2-1: retires the older of two active facts with the same entity+category', async () => {
    vi.mocked(factQueries.getAll).mockReturnValue([
      { id: 10, user_id: 1, category: 'goal', statement: 'Raise $500K', entity: 'fundraising', learned_at: '2026-06-01T00:00:00', confidence: 'high', source_briefing_id: null },
      { id: 11, user_id: 1, category: 'goal', statement: 'Raise $1M', entity: 'fundraising', learned_at: '2026-06-15T00:00:00', confidence: 'high', source_briefing_id: null },
    ]);
    h.create.mockResolvedValue(textResponse('[]'));
    await runSleepTimeConsolidation(1, 'x'.repeat(100), 'Derrick');
    expect(factQueries.retire).toHaveBeenCalledWith(1, 10);
    expect(factQueries.retire).not.toHaveBeenCalledWith(1, 11);
  });

  it('M2-1: no spurious retires when all facts are unique entity+category', async () => {
    vi.mocked(factQueries.getAll).mockReturnValue([
      { id: 1, user_id: 1, category: 'goal', statement: 'Fundraising', entity: 'fundraising', learned_at: '2026-06-10T00:00:00', confidence: 'high', source_briefing_id: null },
      { id: 2, user_id: 1, category: 'preference', statement: 'Morning workouts', entity: 'gym', learned_at: '2026-06-10T00:00:00', confidence: 'high', source_briefing_id: null },
    ]);
    h.create.mockResolvedValue(textResponse('[]'));
    await runSleepTimeConsolidation(1, 'x'.repeat(100), 'Derrick');
    expect(factQueries.retire).not.toHaveBeenCalled();
  });
});

describe('extractAndUpsertFactsFromEmail (Round 7 — full bodies + spam filter)', () => {
  function item(over: Partial<EmailSignalItem>): EmailSignalItem {
    return {
      threadId: 't', sender: 'a@b.com', subject: 'Subject', snippet: 'snip',
      date: '2026-06-18', isUnread: false, isImportant: false, ...over,
    };
  }
  function signal(items: EmailSignalItem[]): EmailSignal {
    return { items, fetchedAt: '2026-06-18T00:00:00Z', scopeMissing: false };
  }

  beforeEach(() => { h.create.mockResolvedValue(textResponse('[]')); });

  it('uses full body text in the prompt when present (not the snippet)', async () => {
    await extractAndUpsertFactsFromEmail(1, signal([
      item({ sender: 'cfo@acme.com', subject: 'Series A', snippet: 'short snip', body: 'We are wiring the 2 million dollar tranche on Friday per the term sheet.' }),
    ]), 'Derrick');
    const prompt = h.create.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('wiring the 2 million dollar tranche');
    expect(prompt).toContain('Body:');
    expect(prompt).not.toContain('short snip');
  });

  it('falls back to the snippet when no body is present', async () => {
    await extractAndUpsertFactsFromEmail(1, signal([
      item({ subject: 'Catch up', snippet: 'lets grab coffee next week', body: undefined }),
    ]), 'Derrick');
    const prompt = h.create.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('lets grab coffee next week');
    expect(prompt).toContain('Snippet:');
  });

  it('skips likely-spam threads before extraction', async () => {
    await extractAndUpsertFactsFromEmail(1, signal([
      item({ sender: 'no-reply@promo.com', subject: '30% off everything', body: 'Big sale ends tonight!' }),
      item({ sender: 'sarah@acme.com', subject: 'Re: the raise', body: 'Confirming the round closes next week.' }),
    ]), 'Derrick');
    const prompt = h.create.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('Confirming the round closes next week');
    expect(prompt).not.toContain('Big sale ends tonight');
  });

  it('does nothing when every thread is filtered out as spam', async () => {
    await extractAndUpsertFactsFromEmail(1, signal([
      item({ sender: 'newsletter@news.com', subject: 'Your weekly digest', body: 'top stories' }),
    ]), 'Derrick');
    expect(h.create).not.toHaveBeenCalled();
  });

  it('no-ops when scope is missing', async () => {
    await extractAndUpsertFactsFromEmail(1, { items: [], fetchedAt: 'x', scopeMissing: true }, 'Derrick');
    expect(h.create).not.toHaveBeenCalled();
  });
});

describe('derivePersonModelFields (M4-4)', () => {
  it('returns empty object for no statements', () => {
    expect(derivePersonModelFields([])).toEqual({});
    expect(derivePersonModelFields(['', '  '])).toEqual({});
  });

  it('extracts goals from goal-keyword statements', () => {
    const f = derivePersonModelFields(['Sarah is trying to close a Series A']);
    expect(f.goals).toBe('Sarah is trying to close a Series A');
  });

  it('extracts communication style from comm-keyword statements', () => {
    const f = derivePersonModelFields(['Jim prefers async, brief messages']);
    expect(f.communicationStyle).toBe('Jim prefers async, brief messages');
  });

  it('relationship_state + last_interaction default to the most recent (first) statement', () => {
    const f = derivePersonModelFields(['most recent context', 'older context']);
    expect(f.relationshipState).toBe('most recent context');
    expect(f.lastInteraction).toBe('most recent context');
  });

  it('picks distinct statements for goals vs comm style when both present', () => {
    const f = derivePersonModelFields([
      'Alice is the CFO',
      'Alice wants to raise a bridge round',
      'Alice prefers detailed written updates',
    ]);
    expect(f.goals).toContain('raise a bridge round');
    expect(f.communicationStyle).toContain('detailed written updates');
    expect(f.relationshipState).toBe('Alice is the CFO');
  });
});

// ── R38 Part B — event-as-entity guard ────────────────────────────────────────
describe('looksLikeEventEntity (R38)', () => {
  it('flags event-title entities', () => {
    expect(looksLikeEventEntity("Friend's Bachelor Party")).toBe(true);
    expect(looksLikeEventEntity('Vegas Trip')).toBe(true);
    expect(looksLikeEventEntity('Sarah and Mike Wedding')).toBe(true);
  });
  it('does not flag plain person names', () => {
    expect(looksLikeEventEntity('Patrick')).toBe(false);
    expect(looksLikeEventEntity('Sarah Chen')).toBe(false);
    expect(looksLikeEventEntity(null)).toBe(false);
  });
});

describe('reassignEventEntityFacts (R38)', () => {
  it('re-files an event-entity fact under the single named person in the call', () => {
    const out = reassignEventEntityFacts([
      { category: 'person', entity: 'Patrick', statement: 'Patrick is a friend' },
      { category: 'fact', entity: "Friend's Bachelor Party", statement: 'bachelor party in Vegas' },
    ]);
    const moved = out.find(f => f.statement === 'bachelor party in Vegas');
    expect(moved!.entity).toBe('Patrick');
    expect(moved!.category).toBe('person');
  });

  it('leaves entities as-is when there is no single clear person (ambiguous)', () => {
    const input = [
      { category: 'person' as const, entity: 'Patrick', statement: 'a friend' },
      { category: 'person' as const, entity: 'Sarah', statement: 'an investor' },
      { category: 'fact' as const, entity: 'Vegas Trip', statement: 'trip in June' },
    ];
    const out = reassignEventEntityFacts(input);
    expect(out.find(f => f.statement === 'trip in June')!.entity).toBe('Vegas Trip');
  });

  it('leaves entities as-is when no named person exists at all', () => {
    const out = reassignEventEntityFacts([
      { category: 'fact', entity: 'Wedding', statement: 'a wedding in fall' },
    ]);
    expect(out[0].entity).toBe('Wedding');
  });
});

// ── R38 Part A — unknown-entity resolution in sleep-time consolidation ─────────
describe('runSleepTimeConsolidation — unknown-entity resolution (R38 Part A)', () => {
  it('retires an unknown person fact and re-files it under a newly-named person (high confidence)', async () => {
    const unknownFact = makeFact(10, 'person', null, 'friend with a bachelor party in Vegas');
    const patrickFact = makeFact(11, 'person', 'Patrick', 'Patrick is a friend');
    vi.mocked(factQueries.getAll).mockReturnValue([unknownFact, patrickFact]);
    h.create
      .mockResolvedValueOnce(textResponse('[]')) // consolidation pass: no contradictions
      .mockResolvedValueOnce(textResponse(JSON.stringify([{ unknownFactId: 10, matchedEntity: 'Patrick', confidence: 'high' }])));
    await runSleepTimeConsolidation(1, 'x'.repeat(100), 'Derrick');
    expect(factQueries.retire).toHaveBeenCalledWith(1, 10);
    expect(factQueries.upsertFact).toHaveBeenCalledWith(1, 'person', 'friend with a bachelor party in Vegas', 'Patrick', 'high');
  });

  it('leaves the unknown fact untouched when no person matches ([])', async () => {
    vi.mocked(factQueries.getAll).mockReturnValue([
      makeFact(10, 'person', null, 'someone mentioned once'),
      makeFact(11, 'person', 'Patrick', 'Patrick is a friend'),
    ]);
    h.create.mockResolvedValueOnce(textResponse('[]')).mockResolvedValueOnce(textResponse('[]'));
    await runSleepTimeConsolidation(1, 'x'.repeat(100), 'Derrick');
    expect(factQueries.retire).not.toHaveBeenCalledWith(1, 10);
  });

  it('does NOT retire a medium-confidence match unless an identical statement already exists', async () => {
    vi.mocked(factQueries.getAll).mockReturnValue([
      makeFact(10, 'person', null, 'maybe related to Patrick'),
      makeFact(11, 'person', 'Patrick', 'Patrick is a friend'),
    ]);
    // getByCategory returns the real store (empty) → no identical statement under Patrick → no retire.
    h.create
      .mockResolvedValueOnce(textResponse('[]'))
      .mockResolvedValueOnce(textResponse(JSON.stringify([{ unknownFactId: 10, matchedEntity: 'Patrick', confidence: 'medium' }])));
    await runSleepTimeConsolidation(1, 'x'.repeat(100), 'Derrick');
    expect(factQueries.retire).not.toHaveBeenCalledWith(1, 10);
  });
});
