/**
 * Tests for POST /api/auth/consent.
 *
 * Security invariants:
 * - 401 when unauthenticated
 * - 400 for invalid consent values
 * - 200 with { success: true, consent } on valid update
 * - Rate limit enforced per user
 * - audit log record written on success
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── hoisted mock state ────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  sessionUser: null as null | { id: number; data_consent?: string | null },
  rateLimitAllowed: true,
  updatedConsent: null as string | null,
  auditRecorded: null as unknown,
}));

vi.mock('@/lib/auth', () => ({
  getSession: async () => h.sessionUser,
}));

vi.mock('@/lib/db', () => ({
  userQueries: {
    setDataConsent: (_id: number, consent: string) => {
      h.updatedConsent = consent;
    },
  },
  auditLogQueries: {
    record: (entry: unknown) => {
      h.auditRecorded = entry;
    },
  },
}));

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: h.rateLimitAllowed, resetAt: new Date(Date.now() + 60000) }),
  getClientIP: () => '127.0.0.1',
  rateLimitResponse: () => new Response('rate limited', { status: 429 }),
}));

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/auth/consent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/auth/consent', () => {
  beforeEach(() => {
    h.sessionUser = null;
    h.rateLimitAllowed = true;
    h.updatedConsent = null;
    h.auditRecorded = null;
  });

  it('returns 401 when not authenticated', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ consent: 'privacy' }));
    expect(res.status).toBe(401);
    expect(h.updatedConsent).toBeNull();
  });

  it('returns 400 for an invalid consent value', async () => {
    h.sessionUser = { id: 7, data_consent: null };
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ consent: 'both' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/improve.*privacy/i);
    expect(h.updatedConsent).toBeNull();
  });

  it('returns 400 when consent field is missing', async () => {
    h.sessionUser = { id: 7, data_consent: null };
    const { POST } = await import('./route');
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(h.updatedConsent).toBeNull();
  });

  it('accepts "privacy" and returns { success: true, consent: "privacy" }', async () => {
    h.sessionUser = { id: 7, data_consent: 'improve' };
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ consent: 'privacy' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, consent: 'privacy' });
    expect(h.updatedConsent).toBe('privacy');
  });

  it('accepts "improve" and returns { success: true, consent: "improve" }', async () => {
    h.sessionUser = { id: 42, data_consent: 'privacy' };
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ consent: 'improve' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, consent: 'improve' });
    expect(h.updatedConsent).toBe('improve');
  });

  it('records an audit log entry with prev + new consent on success', async () => {
    h.sessionUser = { id: 7, data_consent: 'improve' };
    const { POST } = await import('./route');
    await POST(makeRequest({ consent: 'privacy' }));
    expect(h.auditRecorded).toMatchObject({
      userId: 7,
      action: 'consent_update',
      ok: true,
    });
    const args = JSON.parse((h.auditRecorded as { argsJson: string }).argsJson);
    expect(args).toEqual({ consent: 'privacy', prev: 'improve' });
  });

  it('returns 429 when rate limit is exceeded', async () => {
    h.sessionUser = { id: 7, data_consent: null };
    h.rateLimitAllowed = false;
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ consent: 'privacy' }));
    expect(res.status).toBe(429);
    expect(h.updatedConsent).toBeNull();
  });
});
