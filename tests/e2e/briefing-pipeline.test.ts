/**
 * S1 e2e — briefing pipeline: a fact stored in the DB flows into the briefing builder and reaches
 * the model prompt. Real in-memory DB; only the Anthropic SDK is mocked (its messages.create
 * captures the prompt and returns a canned briefing). External calendar/whoop calls degrade to
 * empty via their own .catch guards (no creds needed).
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

process.env.DB_PATH = ':memory:';
process.env.ANTHROPIC_API_KEY = 'test-key';

const h = vi.hoisted(() => ({ prompts: [] as string[] }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async (args: { system?: string; messages?: Array<{ content?: unknown }> }) => {
        // Capture every prompt (system + user content) so the test can assert what the model saw.
        const sys = typeof args.system === 'string' ? args.system : JSON.stringify(args.system ?? '');
        const usr = JSON.stringify(args.messages ?? '');
        h.prompts.push(`${sys}\n${usr}`);
        return { content: [{ type: 'text', text: 'Good morning Derrick. Your day looks focused.' }], stop_reason: 'end_turn' };
      },
    };
  },
}));

const { getDb, factQueries } = await import('../../lib/db');
const { generateDailyBriefing } = await import('../../lib/briefing');

afterAll(() => { delete process.env.DB_PATH; delete process.env.ANTHROPIC_API_KEY; });

beforeEach(() => {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  for (const t of ['facts', 'users']) { try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore */ } }
  db.pragma('foreign_keys = ON');
  db.prepare("INSERT INTO users (id, email, name, password_hash, onboarding_complete, timezone) VALUES (1, 'd@e.com', 'Derrick Fung', 'x', 1, 'America/New_York')").run();
  h.prompts = [];
});

describe('S1 e2e — briefing pipeline (fact → briefing prompt)', () => {
  it('a stored goal fact reaches the briefing model prompt', async () => {
    factQueries.upsertFact(1, 'goal', 'Raise a seed round by Q3', 'fundraising', 'high');
    const briefing = await generateDailyBriefing(1);
    expect(typeof briefing).toBe('string');
    expect(briefing.length).toBeGreaterThan(0);
    // The stored fact must have been injected into at least one model prompt.
    const allPrompts = h.prompts.join('\n');
    expect(allPrompts).toContain('Raise a seed round by Q3');
  });

  it('produces a briefing string even with no facts (degrades cleanly)', async () => {
    const briefing = await generateDailyBriefing(1);
    expect(typeof briefing).toBe('string');
    expect(briefing.length).toBeGreaterThan(0);
  });
});
