/**
 * R19 T1 — quota-error retry cascade fix.
 * ElevenLabs quota-exceeded surfaces as `pipeline-error-eleven-labs-quota-exceeded`,
 * which matches MISSED_CALL_REASONS via 'pipeline-error'. Retrying a quota error just
 * burns more failed calls until the quota is topped up (14 consecutive failures on
 * 2026-06-22). The fix: skip retry for quota errors; preserve retry for other
 * transient pipeline / no-answer failures.
 *
 * Real integration against an in-memory DB (same harness style as inbound.test.ts):
 * the call-ended missed-branch returns before the Anthropic path, so no LLM stubs are
 * needed. The transcript fetch is forced to reject (no network) so it falls through
 * to the partial transcript quickly.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

process.env.DB_PATH = ':memory:';

vi.mock('@/lib/db', async () => await import('../../../../lib/db'));
vi.mock('@/lib/vapi', async () => await import('../../../../lib/vapi'));
vi.mock('@/lib/callMemory', async () => await import('../../../../lib/callMemory'));
vi.mock('@/lib/briefing', async () => await import('../../../../lib/briefing'));
vi.mock('@/lib/actionSummary', async () => await import('../../../../lib/actionSummary'));
vi.mock('@/lib/idempotency', async () => await import('../../../../lib/idempotency'));
vi.mock('@/lib/retry', async () => await import('../../../../lib/retry'));
vi.mock('@/lib/rateLimit', async () => await import('../../../../lib/rateLimit'));
vi.mock('@/lib/greeting', async () => await import('../../../../lib/greeting'));

const { getDb } = await import('../../../../lib/db');
const { POST } = await import('./route');
const { NextRequest } = await import('next/server');

// No real Vapi transcript fetch — reject so withRetry falls through to the partial transcript fast.
vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in test'); }));

afterAll(() => { delete process.env.DB_PATH; vi.unstubAllGlobals(); });

function makeUser(id: number): void {
  getDb().prepare(
    "INSERT INTO users (id, email, name, password_hash, onboarding_complete) VALUES (?, ?, 'Derrick Fung', 'x', 1)",
  ).run(id, `u${id}@e.com`);
}

function makeCallingBriefing(callId: string): number {
  const info = getDb().prepare(
    "INSERT INTO briefings (user_id, content, vapi_call_id, status, scheduled_for, retry_attempted) VALUES (1, 'brief', ?, 'calling', datetime('now'), 0)",
  ).run(callId);
  return Number(info.lastInsertRowid);
}

function req(message: unknown) {
  return new NextRequest('http://localhost/api/vapi/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }),
  });
}

function getBriefing(id: number) {
  return getDb().prepare('SELECT status, retry_after, retry_attempted FROM briefings WHERE id = ?').get(id) as
    { status: string; retry_after: string | null; retry_attempted: number };
}

beforeEach(() => {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  for (const t of ['briefings', 'users', 'webhook_dedup_keys']) { try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore */ } }
  db.pragma('foreign_keys = ON');
  makeUser(1);
});

describe('R19 — quota-error retry cascade fix', () => {
  it('quota-exceeded pipeline error → missed, NO retry stamped', async () => {
    const id = makeCallingBriefing('call_quota');
    const res = await POST(req({
      type: 'call-ended', call: { id: 'call_quota' },
      endedReason: 'pipeline-error-eleven-labs-quota-exceeded',
    }));
    expect((await res.json()).received).toBe(true);
    const b = getBriefing(id);
    expect(b.status).toBe('missed');
    expect(b.retry_after).toBeNull();
  });

  it('non-quota pipeline error → missed, retry stamped (existing behavior preserved)', async () => {
    const id = makeCallingBriefing('call_pipe');
    await POST(req({
      type: 'call-ended', call: { id: 'call_pipe' },
      endedReason: 'pipeline-error-something-transient',
    }));
    const b = getBriefing(id);
    expect(b.status).toBe('missed');
    expect(b.retry_after).not.toBeNull();
    expect(b.retry_attempted).toBe(1);
  });

  it('no-answer → still retries (unchanged)', async () => {
    const id = makeCallingBriefing('call_noanswer');
    await POST(req({
      type: 'call-ended', call: { id: 'call_noanswer' },
      endedReason: 'customer-did-not-answer',
    }));
    const b = getBriefing(id);
    expect(b.status).toBe('missed');
    expect(b.retry_after).not.toBeNull();
  });
});
