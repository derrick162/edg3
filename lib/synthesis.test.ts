/**
 * M4-5 — hierarchical summarization (weekly synthesis + lifetime profile).
 * Real in-memory better-sqlite3; Anthropic mocked to a canned narrative.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

const ORIGINAL_DB_PATH = process.env.DB_PATH;
process.env.DB_PATH = ':memory:';

// Mock Haiku — every call returns a deterministic narrative.
const h = vi.hoisted(() => ({ create: vi.fn(async () => ({ content: [{ type: 'text', text: 'SYNTHESIZED NARRATIVE' }] })) }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: h.create }; } }));
// Stub calendar so extractAndUpsertFacts' auto-fetch path (unused here) never hits the network.
vi.mock('./calendar', () => ({ getCalendarEvents: vi.fn(async () => []) }));

const { getDb, factQueries, briefingQueries } = await import('./db');
const { runWeeklySynthesis, runLifetimeSynthesis } = await import('./facts');
const { currentOpenCallMemoryText } = await import('./callMemory');

afterAll(() => {
  if (ORIGINAL_DB_PATH === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = ORIGINAL_DB_PATH;
});

function makeUser(): void {
  getDb().prepare("INSERT INTO users (id, email, name, password_hash, onboarding_complete) VALUES (1, 'd@e.com', 'Derrick', 'x', 1)").run();
}

function seedCompletedCall(daysAgo: number, response: string): void {
  const when = new Date(Date.now() - daysAgo * 86400000).toISOString();
  const b = briefingQueries.create(1, 'briefing content', when) as { lastInsertRowid: number };
  briefingQueries.update(b.lastInsertRowid, { status: 'completed', user_response: response });
}

beforeEach(() => {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  for (const t of ['facts', 'fact_history', 'briefings', 'users']) { try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore */ } }
  db.pragma('foreign_keys = ON');
  makeUser();
  h.create.mockClear();
});

describe('runWeeklySynthesis (M4-5 Tier 2)', () => {
  it('produces a weekly_summary fact when >= 3 calls happened this week', async () => {
    seedCompletedCall(1, 'talked about Railway');
    seedCompletedCall(2, 'Railway still frustrating');
    seedCompletedCall(3, 'Railway finally fixed');
    const ok = await runWeeklySynthesis(1);
    expect(ok).toBe(true);
    const summaries = factQueries.getByCategory(1, 'weekly_summary');
    expect(summaries).toHaveLength(1);
    expect(summaries[0].statement).toContain('SYNTHESIZED NARRATIVE');
    expect(summaries[0].entity).toMatch(/^week_of_\d{4}-\d{2}-\d{2}$/);
  });

  it('does nothing (no error) when fewer than 3 calls happened', async () => {
    seedCompletedCall(1, 'one call');
    seedCompletedCall(2, 'two calls');
    const ok = await runWeeklySynthesis(1);
    expect(ok).toBe(false);
    expect(factQueries.getByCategory(1, 'weekly_summary')).toHaveLength(0);
    expect(h.create).not.toHaveBeenCalled();
  });

  it('caps active weekly summaries at 3 (retires the oldest)', async () => {
    // Pre-seed 3 older weekly summaries, then synthesize a new one → oldest retired, 3 remain.
    for (let i = 1; i <= 3; i++) factQueries.upsertFact(1, 'weekly_summary', `old week ${i}`, `week_of_2026-05-0${i}`, 'high');
    seedCompletedCall(1, 'a'); seedCompletedCall(2, 'b'); seedCompletedCall(3, 'c');
    await runWeeklySynthesis(1);
    expect(factQueries.getByCategory(1, 'weekly_summary').length).toBeLessThanOrEqual(3);
  });
});

describe('runLifetimeSynthesis (M4-5 Tier 3)', () => {
  it('produces a lifetime_profile once there are >= 10 weekly summaries', async () => {
    for (let i = 1; i <= 10; i++) factQueries.upsertFact(1, 'weekly_summary', `week ${i} narrative`, `week_of_2026-04-${String(i).padStart(2, '0')}`, 'high');
    const ok = await runLifetimeSynthesis(1);
    expect(ok).toBe(true);
    const profiles = factQueries.getByCategory(1, 'lifetime_profile');
    expect(profiles).toHaveLength(1);
    expect(profiles[0].statement).toContain('SYNTHESIZED NARRATIVE');
  });

  it('does nothing when fewer than 10 weekly summaries exist', async () => {
    for (let i = 1; i <= 5; i++) factQueries.upsertFact(1, 'weekly_summary', `week ${i}`, `week_of_2026-04-0${i}`, 'high');
    const ok = await runLifetimeSynthesis(1);
    expect(ok).toBe(false);
    expect(factQueries.getByCategory(1, 'lifetime_profile')).toHaveLength(0);
  });
});

describe('currentOpenCallMemoryText — lifetime profile injection (M4-5)', () => {
  it('injects the lifetime profile FIRST in the memory block', () => {
    factQueries.upsertFact(1, 'lifetime_profile', 'A driven founder rebuilding calm work capacity.', null, 'high');
    factQueries.upsertFact(1, 'goal', 'Reach 135 lbs', null, 'high');
    const text = currentOpenCallMemoryText(1);
    expect(text).toContain('LIFETIME PROFILE:');
    // It must come before GOALS in the block.
    expect(text.indexOf('LIFETIME PROFILE:')).toBeLessThan(text.indexOf('GOALS:'));
  });
});
