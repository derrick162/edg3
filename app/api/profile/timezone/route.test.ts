import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  session: null as { id: number; email: string; name: string } | null,
  rateLimitAllowed: true,
  tzValid: true,
  setArgs: [] as unknown[],
  auditArgs: [] as unknown[],
}));

vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: h.rateLimitAllowed, remaining: 19, resetAt: Date.now() + 3_600_000 }),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
}));

vi.mock('@/lib/db', () => ({
  userQueries: { setCurrentTimezone: (...args: unknown[]) => { h.setArgs.push(args); } },
  auditLogQueries: { record: (e: unknown) => { h.auditArgs.push(e); } },
}));

vi.mock('@/lib/time', () => ({
  isValidTimeZone: (_tz: string) => h.tzValid,
}));

import { POST } from './route';

function req(body: unknown) {
  return new NextRequest('http://localhost/api/profile/timezone', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  h.session = { id: 3, email: 'a@b.com', name: 'A' };
  h.rateLimitAllowed = true;
  h.tzValid = true;
  h.setArgs = [];
  h.auditArgs = [];
});

describe('POST /api/profile/timezone', () => {
  it('returns 401 when unauthenticated', async () => {
    h.session = null;
    const res = await POST(req({ current_timezone: 'America/Vancouver' }));
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate limited', async () => {
    h.rateLimitAllowed = false;
    const res = await POST(req({ current_timezone: 'America/Vancouver' }));
    expect(res.status).toBe(429);
  });

  it('returns 400 for invalid JSON', async () => {
    const r = new NextRequest('http://localhost/api/profile/timezone', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    const res = await POST(r);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid timezone', async () => {
    h.tzValid = false;
    const res = await POST(req({ current_timezone: 'Not/AZone' }));
    expect(res.status).toBe(400);
  });

  it('returns 200 and records audit on success', async () => {
    const res = await POST(req({ current_timezone: 'America/Vancouver' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(h.setArgs).toHaveLength(1);
    expect(h.auditArgs).toHaveLength(1);
    const audit = h.auditArgs[0] as Record<string, unknown>;
    expect(audit.action).toBe('updateTimezone');
    expect(audit.ok).toBe(true);
    expect(audit.userId).toBe(3);
  });

  it('clears timezone when current_timezone is null', async () => {
    const res = await POST(req({ current_timezone: null }));
    expect(res.status).toBe(200);
    const call = h.setArgs[0] as unknown[];
    expect(call[1]).toBeNull();
  });

  it('clears timezone when current_timezone is empty string', async () => {
    const res = await POST(req({ current_timezone: '' }));
    expect(res.status).toBe(200);
    const call = h.setArgs[0] as unknown[];
    expect(call[1]).toBeNull();
  });
});
