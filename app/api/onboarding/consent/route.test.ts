import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  session: null as { id: number; email: string; name: string } | null,
  rateLimitAllowed: true,
  setArgs: [] as unknown[],
}));

vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: h.rateLimitAllowed, remaining: 9, resetAt: Date.now() + 60_000 }),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
}));

vi.mock('@/lib/db', () => ({
  userQueries: {
    setDataConsent: (...args: unknown[]) => { h.setArgs.push(args); },
  },
}));

import { POST } from './route';

function req(body: unknown) {
  return new NextRequest('http://localhost/api/onboarding/consent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  h.session = { id: 1, email: 'test@test.com', name: 'Test' };
  h.rateLimitAllowed = true;
  h.setArgs = [];
});

describe('POST /api/onboarding/consent', () => {
  it('returns 401 when unauthenticated', async () => {
    h.session = null;
    const res = await POST(req({ data_consent: 'privacy' }));
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate limited', async () => {
    h.rateLimitAllowed = false;
    const res = await POST(req({ data_consent: 'privacy' }));
    expect(res.status).toBe(429);
  });

  it('returns 400 for invalid JSON', async () => {
    const res = await POST(new NextRequest('http://localhost/api/onboarding/consent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing data_consent', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/data_consent/);
  });

  it('returns 400 for invalid consent value', async () => {
    const res = await POST(req({ data_consent: 'nope' }));
    expect(res.status).toBe(400);
  });

  it('saves "privacy" consent and returns ok', async () => {
    const res = await POST(req({ data_consent: 'privacy' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(h.setArgs).toEqual([[1, 'privacy']]);
  });

  it('saves "improve" consent and returns ok', async () => {
    const res = await POST(req({ data_consent: 'improve' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(h.setArgs).toEqual([[1, 'improve']]);
  });
});
