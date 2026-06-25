/**
 * R37 (M4-4) — updatePeopleModels: per-person relationship model written after each call.
 * Real in-memory DB; Anthropic mocked to a canned model JSON.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

const ORIGINAL_DB_PATH = process.env.DB_PATH;
process.env.DB_PATH = ':memory:';

const h = vi.hoisted(() => ({
  create: vi.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify({ goals: 'job hunting in finance', communication_style: null, relationship_state: 'close friend', last_interaction: 'discussed the Toronto move' }) }] })),
}));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: h.create }; } }));

const { getDb, factQueries, peopleModelQueries } = await import('./db');
const { updatePeopleModels } = await import('./peopleModels');

afterAll(() => {
  if (ORIGINAL_DB_PATH === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = ORIGINAL_DB_PATH;
});

function makeUser(): void {
  getDb().prepare("INSERT INTO users (id, email, name, password_hash, onboarding_complete) VALUES (1, 'd@e.com', 'Derrick', 'x', 1)").run();
}

beforeEach(() => {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  for (const t of ['people_models', 'facts', 'fact_history', 'users']) { try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore */ } }
  db.pragma('foreign_keys = ON');
  makeUser();
  h.create.mockClear();
});

describe('updatePeopleModels (R37 T1)', () => {
  it('writes a model for a tracked person mentioned in the transcript', async () => {
    factQueries.upsertFact(1, 'person', 'Patrick is a friend', 'Patrick', 'high');
    await updatePeopleModels(1, 'Talked to Patrick — he is job hunting in finance after moving back to Toronto.', 'Derrick');
    const model = peopleModelQueries.getForUser(1, 'Patrick');
    expect(model).toBeDefined();
    expect(model!.goals).toContain('finance');
    expect(model!.relationship_state).toContain('friend');
  });

  it('does nothing (no Haiku call) when there are no person facts', async () => {
    await updatePeopleModels(1, 'A transcript that mentions nobody we track.', 'Derrick');
    expect(h.create).not.toHaveBeenCalled();
  });

  it('skips a tracked person NOT mentioned in this call', async () => {
    factQueries.upsertFact(1, 'person', 'Sarah is an investor', 'Sarah', 'high');
    await updatePeopleModels(1, 'A call about the gym and nothing else.', 'Derrick');
    expect(h.create).not.toHaveBeenCalled();
    expect(peopleModelQueries.getForUser(1, 'Sarah')).toBeUndefined();
  });

  it('never throws when the Haiku call fails', async () => {
    factQueries.upsertFact(1, 'person', 'Patrick is a friend', 'Patrick', 'high');
    h.create.mockRejectedValueOnce(new Error('haiku down'));
    await expect(updatePeopleModels(1, 'Patrick called about the move.', 'Derrick')).resolves.toBeUndefined();
    expect(peopleModelQueries.getForUser(1, 'Patrick')).toBeUndefined();
  });

  it('merges across calls — a second call preserves fields not re-mentioned', async () => {
    factQueries.upsertFact(1, 'person', 'Patrick is a friend', 'Patrick', 'high');
    await updatePeopleModels(1, 'Patrick is job hunting in finance.', 'Derrick');
    // Second call returns only a new last_interaction; goals must be preserved by upsert COALESCE.
    h.create.mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ goals: null, communication_style: null, relationship_state: null, last_interaction: 'caught up about the wedding' }) }] });
    await updatePeopleModels(1, 'Patrick mentioned the wedding.', 'Derrick');
    const model = peopleModelQueries.getForUser(1, 'Patrick');
    expect(model!.goals).toContain('finance');            // preserved
    expect(model!.last_interaction).toContain('wedding');  // updated
  });
});
