/**
 * S1 e2e — inbound call (`assistant-request`). POST the Vapi webhook with a known / unknown /
 * rate-limited caller number and verify the correct assistant config is returned. Real in-memory
 * DB; the assistant-request branch returns before any LLM/network call, so no external stubs needed.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

process.env.DB_PATH = ':memory:';

vi.mock('@/lib/db', async () => await import('../../lib/db'));
vi.mock('@/lib/recentCallContinuity', async () => await import('../../lib/recentCallContinuity'));
vi.mock('@/lib/rateLimit', async () => await import('../../lib/rateLimit'));
vi.mock('@/lib/greeting', async () => await import('../../lib/greeting'));
vi.mock('@/lib/briefing', async () => await import('../../lib/briefing'));
vi.mock('@/lib/actionSummary', async () => await import('../../lib/actionSummary'));
vi.mock('@/lib/vapi', async () => await import('../../lib/vapi'));
vi.mock('@/lib/callMemory', async () => await import('../../lib/callMemory'));
vi.mock('@/lib/idempotency', async () => await import('../../lib/idempotency'));
vi.mock('@/lib/retry', async () => await import('../../lib/retry'));

const { getDb } = await import('../../lib/db');
const { POST } = await import('../../app/api/vapi/webhook/route');
const { NextRequest } = await import('next/server');

afterAll(() => { delete process.env.DB_PATH; });

function makeUser(id: number, phone: string): void {
  getDb().prepare("INSERT INTO users (id, email, name, password_hash, onboarding_complete, phone_number) VALUES (?, ?, 'Derrick Fung', 'x', 1, ?)").run(id, `u${id}@e.com`, phone);
}
function req(message: unknown) {
  return new NextRequest('http://localhost/api/vapi/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
}

beforeEach(() => {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  for (const t of ['briefings', 'users', 'inbound_call_attempts']) { try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore */ } }
  try { db.prepare("DELETE FROM audit_log WHERE action = 'inbound_call_attempt'").run(); } catch { /* ignore */ }
  db.pragma('foreign_keys = ON');
});

describe('S1 e2e — inbound assistant-request', () => {
  it('known caller → personalized assistant config greeting them by name + inbound briefing row', async () => {
    makeUser(1, '+15551234567');
    const res = await POST(req({ type: 'assistant-request', call: { customer: { number: '+15551234567' } } }));
    const json = await res.json();
    const cfg = json.assistant || json.assistantOverrides;
    expect(cfg.firstMessage).toContain('Derrick');
    expect(cfg.model.systemPrompt).toBeTruthy();
    const b = getDb().prepare('SELECT is_inbound, status FROM briefings WHERE user_id = 1').get() as { is_inbound: number; status: string };
    expect(b.is_inbound).toBe(1);
    expect(b.status).toBe('calling');
    const audit = getDb().prepare("SELECT args_json FROM audit_log WHERE action = 'inbound_call_attempt'").get() as { args_json: string };
    expect(JSON.parse(audit.args_json).outcome).toBe('allowed');
  });

  it('unknown caller → polite decline, no briefing created', async () => {
    const res = await POST(req({ type: 'assistant-request', call: { customer: { number: '+15550000000' } } }));
    const json = await res.json();
    expect(json.assistant.firstMessage).toContain("isn't registered");
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM briefings').get()).toMatchObject({ n: 0 });
  });

  it('rate-limited caller (6th in 24h) → 8s decline, no new briefing, rate_limited audit', async () => {
    makeUser(1, '+15551234567');
    const now = Date.now();
    for (let i = 0; i < 5; i++) getDb().prepare('INSERT INTO inbound_call_attempts (phone_number, user_id, attempted_at) VALUES (?, 1, ?)').run('+15551234567', now - i * 1000);
    const res = await POST(req({ type: 'assistant-request', call: { customer: { number: '+15551234567' } } }));
    const json = await res.json();
    expect(json.assistant.maxDurationSeconds).toBe(8);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM briefings WHERE user_id = 1').get()).toMatchObject({ n: 0 });
    const audit = getDb().prepare("SELECT args_json FROM audit_log WHERE action = 'inbound_call_attempt'").get() as { args_json: string };
    expect(JSON.parse(audit.args_json).outcome).toBe('rate_limited');
  });

  it('missing caller number → error, no crash', async () => {
    const res = await POST(req({ type: 'assistant-request', call: { customer: {} } }));
    const json = await res.json();
    expect(json.error).toBeTruthy();
  });
});
