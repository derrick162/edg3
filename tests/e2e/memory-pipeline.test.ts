/**
 * S1 e2e — memory pipeline: POST a call-ended webhook → the transcript is stored on the briefing,
 * and the fire-and-forget post-call jobs extract ≥1 fact and write a call episode (within a few
 * seconds). Real in-memory DB; only the Anthropic SDK (extraction → JSON facts), the transcript
 * fetch, and the unrelated post-call jobs are mocked so the test isolates facts + episode + transcript.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

process.env.DB_PATH = ':memory:';
process.env.ANTHROPIC_API_KEY = 'test-key';

// Extraction parses a JSON array of {category, statement, entity} from the model's text.
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async () => ({
        content: [{ type: 'text', text: '[{"category":"goal","statement":"Ship the beta in July","entity":"beta"}]' }],
        stop_reason: 'end_turn',
      }),
    };
  },
}));

// Real modules the route needs:
vi.mock('@/lib/db', async () => await import('../../lib/db'));
vi.mock('@/lib/recentCallContinuity', async () => await import('../../lib/recentCallContinuity'));
vi.mock('@/lib/rateLimit', async () => await import('../../lib/rateLimit'));
vi.mock('@/lib/greeting', async () => await import('../../lib/greeting'));
vi.mock('@/lib/actionSummary', async () => await import('../../lib/actionSummary'));
vi.mock('@/lib/vapi', async () => await import('../../lib/vapi'));
vi.mock('@/lib/callMemory', async () => await import('../../lib/callMemory'));
vi.mock('@/lib/idempotency', async () => await import('../../lib/idempotency'));
vi.mock('@/lib/grounding', async () => await import('../../lib/grounding'));
vi.mock('@/lib/facts', async () => await import('../../lib/facts'));        // we WANT real extraction
vi.mock('@/lib/episodeStore', async () => await import('../../lib/episodeStore')); // and real episode write
vi.mock('@/lib/calendar', async () => await import('../../lib/calendar'));
vi.mock('@/lib/time', async () => await import('../../lib/time'));
// Pass-through retry so the (rejected) transcript fetch falls back immediately to the payload transcript.
vi.mock('@/lib/retry', () => ({ withRetry: async (fn: () => Promise<unknown>) => fn() }));
// No-op the post-call jobs that aren't under test (and would otherwise hit the mocked LLM oddly):
vi.mock('@/lib/briefing', () => ({ analyzeUserResponse: async () => {} }));
vi.mock('@/lib/peopleModels', () => ({ updatePeopleModels: async () => {} }));
vi.mock('@/lib/transcriptSignals', () => ({ recordTranscriptSignals: async () => {} }));
vi.mock('@/lib/openLoops', () => ({ extractAndUpsertOpenLoops: async () => {} }));
vi.mock('@/lib/verifyPromises', () => ({ runPromiseVerification: async () => ({}) }));

vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network'); }));

const { getDb } = await import('../../lib/db');
const { POST } = await import('../../app/api/vapi/webhook/route');
const { NextRequest } = await import('next/server');

afterAll(() => { delete process.env.DB_PATH; delete process.env.ANTHROPIC_API_KEY; vi.unstubAllGlobals(); });

const TRANSCRIPT = 'AI: Good morning. User: My big goal is to ship the beta in July, it has to happen. AI: Locked in.';

function seedCallingBriefing(callId: string): number {
  const info = getDb().prepare(
    "INSERT INTO briefings (user_id, content, vapi_call_id, status, scheduled_for) VALUES (1, 'brief', ?, 'calling', datetime('now'))",
  ).run(callId);
  return Number(info.lastInsertRowid);
}
function req(message: unknown) {
  return new NextRequest('http://localhost/api/vapi/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
}
async function waitFor(check: () => boolean, ms = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < ms) { if (check()) return true; await new Promise(r => setTimeout(r, 25)); }
  return check();
}

beforeEach(() => {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  for (const t of ['facts', 'episodes', 'briefings', 'users', 'webhook_dedup_keys']) { try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore */ } }
  db.pragma('foreign_keys = ON');
  db.prepare("INSERT INTO users (id, email, name, password_hash, onboarding_complete, timezone) VALUES (1, 'd@e.com', 'Derrick Fung', 'x', 1, 'America/New_York')").run();
});

describe('S1 e2e — memory pipeline (call-ended → transcript + fact + episode)', () => {
  it('stores the transcript synchronously and extracts a fact + episode within 5s', async () => {
    const id = seedCallingBriefing('call_mem_1');
    await POST(req({ type: 'call-ended', call: { id: 'call_mem_1', transcript: TRANSCRIPT } }));

    // Transcript + completed status are written before the response returns.
    const b = getDb().prepare('SELECT status, transcript FROM briefings WHERE id = ?').get(id) as { status: string; transcript: string | null };
    expect(b.status).toBe('completed');
    expect(b.transcript).toContain('ship the beta in July');

    // The fire-and-forget jobs land the fact + episode shortly after.
    const gotFact = await waitFor(() => (getDb().prepare('SELECT COUNT(*) AS n FROM facts WHERE user_id = 1').get() as { n: number }).n >= 1);
    expect(gotFact).toBe(true);
    const gotEpisode = await waitFor(() => (getDb().prepare('SELECT COUNT(*) AS n FROM episodes WHERE user_id = 1').get() as { n: number }).n >= 1);
    expect(gotEpisode).toBe(true);
  });

  it('a too-short transcript is marked missed (no completed pipeline)', async () => {
    const id = seedCallingBriefing('call_mem_2');
    await POST(req({ type: 'call-ended', call: { id: 'call_mem_2', transcript: 'hi' } }));
    const b = getDb().prepare('SELECT status FROM briefings WHERE id = ?').get(id) as { status: string };
    expect(b.status).toBe('missed');
  });
});
