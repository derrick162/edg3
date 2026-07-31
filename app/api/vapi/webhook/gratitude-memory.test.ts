/**
 * C8 — gratitude / open-call memory integration.
 *
 * A gratitude or open call creates a `briefings` row (is_open_call = 1) with a vapi_call_id,
 * exactly like a scheduled briefing. The webhook's post-call learning block is NOT gated on
 * call type, so the full memory pipeline — fact extraction, per-person social models, and
 * conversation-state (emotional) signals — must run for these calls too. This locks that in so
 * a future refactor can't silently gate the learners on call type and starve gratitude memory.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

process.env.DB_PATH = ':memory:';

vi.mock('@/lib/db', async () => await import('../../../../lib/db'));
vi.mock('@/lib/vapi', async () => await import('../../../../lib/vapi'));
vi.mock('@/lib/idempotency', async () => await import('../../../../lib/idempotency'));
vi.mock('@/lib/retry', async () => await import('../../../../lib/retry'));
vi.mock('@/lib/rateLimit', async () => await import('../../../../lib/rateLimit'));
vi.mock('@/lib/greeting', async () => await import('../../../../lib/greeting'));
vi.mock('@/lib/actionSummary', async () => await import('../../../../lib/actionSummary'));
vi.mock('@/lib/callMemory', async () => await import('../../../../lib/callMemory'));
vi.mock('@/lib/recentCallContinuity', async () => await import('../../../../lib/recentCallContinuity'));
// analyzeUserResponse is awaited inline — stub so it never makes a real LLM call.
vi.mock('@/lib/briefing', () => ({ analyzeUserResponse: vi.fn().mockResolvedValue(undefined) }));
// The three memory learners we assert run for gratitude calls — spy on each.
vi.mock('@/lib/facts', async () => {
  const actual = await import('../../../../lib/facts');
  return { ...actual, extractAndUpsertFacts: vi.fn().mockResolvedValue(3), runSleepTimeConsolidation: vi.fn().mockResolvedValue(false) };
});
vi.mock('@/lib/peopleModels', () => ({ updatePeopleModels: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/transcriptSignals', () => ({ recordTranscriptSignals: vi.fn().mockResolvedValue(undefined) }));
// Other fire-and-forget learners — stub so no real LLM/network is hit.
vi.mock('@/lib/openLoops', () => ({ extractAndUpsertOpenLoops: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/episodeStore', () => ({ persistCallEpisode: vi.fn().mockResolvedValue(undefined) }));

const { getDb } = await import('../../../../lib/db');
// Import the spies from the SAME `@/lib/...` specifier the webhook + vi.mock use, so we get the
// mocked vi.fn (a relative-path import would resolve to the real, unmocked module).
const { extractAndUpsertFacts } = await import('@/lib/facts');
const { updatePeopleModels } = await import('@/lib/peopleModels');
const { recordTranscriptSignals } = await import('@/lib/transcriptSignals');
const { POST } = await import('./route');
const { NextRequest } = await import('next/server');

// No real Vapi transcript fetch — reject so it falls through to the payload transcript fast.
vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in test'); }));

afterAll(() => { delete process.env.DB_PATH; vi.unstubAllGlobals(); });

const TRANSCRIPT = 'User: Honestly I have been feeling pretty anxious about runway lately, but grateful that Patrick checked in on me yesterday. It helped a lot.';

function req(message: unknown) {
  return new NextRequest('http://localhost/api/vapi/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }),
  });
}

async function waitForCalled(spy: { mock: { calls: unknown[] } }, ms = 1500): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (spy.mock.calls.length > 0) return;
    await new Promise(r => setTimeout(r, 10));
  }
}

beforeEach(() => {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  for (const t of ['briefings', 'users', 'webhook_dedup_keys']) { try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore */ } }
  db.pragma('foreign_keys = ON');
  db.prepare("INSERT INTO users (id, email, name, password_hash, onboarding_complete) VALUES (1, 'd@e.com', 'Derrick', 'x', 1)").run();
  vi.mocked(extractAndUpsertFacts).mockClear();
  vi.mocked(updatePeopleModels).mockClear();
  vi.mocked(recordTranscriptSignals).mockClear();
});

function makeOpenCall(callId: string): number {
  const info = getDb().prepare(
    "INSERT INTO briefings (user_id, content, vapi_call_id, status, scheduled_for, is_open_call, retry_attempted) VALUES (1, '[Open call] How are you doing this morning?', ?, 'calling', datetime('now'), 1, 0)",
  ).run(callId);
  return Number(info.lastInsertRowid);
}

describe('C8 — gratitude/open calls feed the memory pipeline', () => {
  it('runs fact extraction, people-model update, and signal recording on an open-call transcript', async () => {
    makeOpenCall('call_grat_1');
    const res = await POST(req({
      type: 'end-of-call-report',
      call: { id: 'call_grat_1', transcript: TRANSCRIPT },
      endedReason: 'customer-ended-call',
    }));
    expect((await res.json()).received).toBe(true);

    await waitForCalled(vi.mocked(extractAndUpsertFacts));
    await waitForCalled(vi.mocked(updatePeopleModels));
    await waitForCalled(vi.mocked(recordTranscriptSignals));

    // All three learners ran for the gratitude/open call, with the call transcript.
    expect(extractAndUpsertFacts).toHaveBeenCalled();
    expect(vi.mocked(extractAndUpsertFacts).mock.calls[0][1]).toContain('anxious about runway');
    expect(updatePeopleModels).toHaveBeenCalled();
    expect(recordTranscriptSignals).toHaveBeenCalled();
    expect(vi.mocked(recordTranscriptSignals).mock.calls[0][1]).toContain('Patrick');
  });
});
