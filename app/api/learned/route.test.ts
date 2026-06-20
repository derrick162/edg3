import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  session: null as { id: number; email: string; name: string } | null,
  rateLimitAllowed: true,
  facts: [] as { learned_at?: string }[],
  hasCalToken: true,
  emailSignal: { scopeMissing: false, items: [{ subject: 's', sender: 'x', snippet: 'y' }] } as unknown,
  extractCalls: 0,
}));

vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: h.rateLimitAllowed, remaining: 4, resetAt: Date.now() + 3_600_000 }),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
}));

vi.mock('@/lib/db', () => ({
  factQueries: { getAll: () => h.facts },
  calendarQueries: { get: () => (h.hasCalToken ? { access_token: 't' } : null) },
}));

vi.mock('@/lib/gmail', () => ({
  getRecentEmailSignal: async () => h.emailSignal,
}));

vi.mock('@/lib/facts', () => ({
  extractAndUpsertFactsFromEmail: async () => { h.extractCalls++; },
}));

import { GET } from './route';

function req(qs = '') {
  return new Request(`http://localhost/api/learned${qs}`);
}

// Let the fire-and-forget extraction promise chain settle.
const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  h.session = { id: 7, email: 'a@b.com', name: 'Derrick Fung' };
  h.rateLimitAllowed = true;
  h.facts = [];
  h.hasCalToken = true;
  h.emailSignal = { scopeMissing: false, items: [{ subject: 's', sender: 'x', snippet: 'y' }] };
  h.extractCalls = 0;
});

describe('GET /api/learned', () => {
  it('returns 401 when unauthenticated', async () => {
    h.session = null;
    expect((await GET(req())).status).toBe(401);
  });

  it('returns 429 when rate limited', async () => {
    h.rateLimitAllowed = false;
    expect((await GET(req())).status).toBe(429);
  });

  it('triggers extraction on thin facts (default path)', async () => {
    h.facts = []; // below threshold
    await GET(req());
    await flush();
    expect(h.extractCalls).toBe(1);
  });

  it('does NOT trigger extraction when facts are above the thin threshold', async () => {
    h.facts = Array.from({ length: 20 }, () => ({ learned_at: '2026-06-01' }));
    await GET(req());
    await flush();
    expect(h.extractCalls).toBe(0);
  });

  it('FORCES extraction past the thin gate on ?source=gmail-connect', async () => {
    h.facts = Array.from({ length: 20 }, () => ({ learned_at: '2026-06-01' }));
    await GET(req('?source=gmail-connect'));
    await flush();
    expect(h.extractCalls).toBe(1);
  });

  it('still requires a Google token even when forced', async () => {
    h.facts = Array.from({ length: 20 }, () => ({ learned_at: '2026-06-01' }));
    h.hasCalToken = false;
    await GET(req('?source=gmail-connect'));
    await flush();
    expect(h.extractCalls).toBe(0);
  });
});
