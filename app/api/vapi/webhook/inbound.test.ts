/**
 * R23 T2 — inbound call handler (assistant-request) + call-started linking.
 * Real integration: each `@/lib/*` specifier the route imports is redirected to its real module
 * (vitest has no `@` alias, so we map them by relative path) and runs against an in-memory DB.
 * The assistant-request branch returns before the Anthropic call-ended path, so no stubs are needed.
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

const { getDb } = await import('../../../../lib/db');
const { POST } = await import('./route');
const { NextRequest } = await import('next/server');

afterAll(() => { delete process.env.DB_PATH; });

function makeUser(id: number, phone: string): void {
  getDb().prepare(
    "INSERT INTO users (id, email, name, password_hash, onboarding_complete, phone_number) VALUES (?, ?, 'Derrick Fung', 'x', 1, ?)",
  ).run(id, `u${id}@e.com`, phone);
}

function req(message: unknown) {
  return new NextRequest('http://localhost/api/vapi/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }),
  });
}

beforeEach(() => {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  for (const t of ['briefings', 'users']) { try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore */ } }
  db.pragma('foreign_keys = ON');
});

describe('inbound assistant-request (R23 T2)', () => {
  it('unknown caller → polite 15s decline', async () => {
    const res = await POST(req({ type: 'assistant-request', call: { customer: { number: '+15550000000' } } }));
    const json = await res.json();
    expect(json.assistant.firstMessage).toContain("isn't registered");
    expect(json.assistant.maxDurationSeconds).toBe(15);
  });

  it('registered caller → personalized assistant greeting the user by name', async () => {
    makeUser(1, '+15551234567');
    const res = await POST(req({ type: 'assistant-request', call: { customer: { number: '+15551234567' } } }));
    const json = await res.json();
    const cfg = json.assistant || json.assistantOverrides;
    expect(cfg.firstMessage).toContain('Derrick');
    expect(cfg.model.systemPrompt).toContain('TOOL CALL DISCIPLINE');
    const b = getDb().prepare('SELECT * FROM briefings WHERE user_id = 1').get() as { is_inbound: number; status: string };
    expect(b.is_inbound).toBe(1);
    expect(b.status).toBe('calling');
  });

  it('call-started links the Vapi call id to the inbound briefing', async () => {
    makeUser(1, '+15551234567');
    await POST(req({ type: 'assistant-request', call: { customer: { number: '+15551234567' } } }));
    await POST(req({ type: 'call-started', call: { id: 'vapi_call_xyz', customer: { number: '+15551234567' } } }));
    const b = getDb().prepare('SELECT * FROM briefings WHERE user_id = 1').get() as { vapi_call_id: string | null };
    expect(b.vapi_call_id).toBe('vapi_call_xyz');
  });
});
