import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mock the DB layer ────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  check: vi.fn(),
}));

vi.mock('./db', () => ({
  rateLimitQueries: { check: h.check },
}));

// Mock NextRequest for getClientIP tests.
function mockReq(headers: Record<string, string> = {}): { headers: { get: (k: string) => string | null } } {
  return { headers: { get: (k: string) => headers[k] ?? null } };
}

import { checkRateLimit, getClientIP, rateLimitResponse, LIMITS } from './rateLimit';

beforeEach(() => vi.clearAllMocks());

// ── LIMITS config ─────────────────────────────────────────────────────────────
describe('LIMITS', () => {
  it('defines login, signup, and triggerCall', () => {
    expect(LIMITS.login.limit).toBeGreaterThan(0);
    expect(LIMITS.signup.limit).toBeGreaterThan(0);
    expect(LIMITS.triggerCall.limit).toBeGreaterThan(0);
  });

  it('login window is longer than triggerCall window (brute-force vs expensive op)', () => {
    expect(LIMITS.login.windowMs).toBeGreaterThan(LIMITS.triggerCall.windowMs);
  });
});

// ── getClientIP ────────────────────────────────────────────────────────────────
describe('getClientIP', () => {
  it('returns the rightmost XFF hop (Railway-observed, cannot be spoofed)', () => {
    // Railway appends the IP it saw on the right; leftmost entries are client-controlled.
    const req = mockReq({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' });
    expect(getClientIP(req as any)).toBe('10.0.0.1');
  });

  it('rejects a spoofed leftmost XFF — attacker cannot get a fresh rate-limit bucket', () => {
    // Attacker sends X-Forwarded-For: <random>, Railway appends real source 9.9.9.9.
    const req = mockReq({ 'x-forwarded-for': '255.255.255.255, 9.9.9.9' });
    expect(getClientIP(req as any)).toBe('9.9.9.9'); // Railway's observed IP wins
  });

  it('handles a single-hop XFF (no proxy chain)', () => {
    const req = mockReq({ 'x-forwarded-for': '1.2.3.4' });
    expect(getClientIP(req as any)).toBe('1.2.3.4');
  });

  it('falls back to x-real-ip when XFF is absent', () => {
    const req = mockReq({ 'x-real-ip': '5.6.7.8' });
    expect(getClientIP(req as any)).toBe('5.6.7.8');
  });

  it('falls back to "unknown" when no headers present (local dev)', () => {
    expect(getClientIP(mockReq() as any)).toBe('unknown');
  });
});

// ── checkRateLimit ─────────────────────────────────────────────────────────────
describe('checkRateLimit', () => {
  it('returns allowed:true when DB says so', () => {
    h.check.mockReturnValue({ allowed: true, count: 1, remaining: 9, resetAt: Date.now() + 60_000 });
    const result = checkRateLimit('login', '1.2.3.4');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it('passes the correct limit + windowMs to the DB for "login"', () => {
    h.check.mockReturnValue({ allowed: true, count: 1, remaining: 9, resetAt: 0 });
    checkRateLimit('login', '1.2.3.4');
    const [key, limit, windowMs] = (h.check.mock.calls as any[])[0] as [string, number, number, number];
    expect(key).toBe('login:1.2.3.4');
    expect(limit).toBe(LIMITS.login.limit);
    expect(windowMs).toBe(LIMITS.login.windowMs);
  });

  it('returns allowed:false when limit is exceeded', () => {
    h.check.mockReturnValue({ allowed: false, count: 10, remaining: 0, resetAt: Date.now() + 5_000 });
    const result = checkRateLimit('login', '1.2.3.4');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('fails open — returns allowed:true when the DB throws', () => {
    h.check.mockImplementation(() => { throw new Error('db fault'); });
    const result = checkRateLimit('signup', '1.2.3.4');
    expect(result.allowed).toBe(true); // never lock out a real user on DB fault
  });

  // R11 T2 — runaway Vapi tool-loop guard
  it('vapiToolCall is configured at 60 per 60s (per-user runaway-loop guard)', () => {
    expect(LIMITS.vapiToolCall.limit).toBe(60);
    expect(LIMITS.vapiToolCall.windowMs).toBe(60 * 1000);
  });

  it('passes the vapiToolCall limit + window and a user-scoped key to the DB', () => {
    h.check.mockReturnValue({ allowed: true, count: 1, remaining: 59, resetAt: 0 });
    checkRateLimit('vapiToolCall', '42');
    const [key, limit, windowMs] = (h.check.mock.calls as any[])[0] as [string, number, number, number];
    expect(key).toBe('vapiToolCall:42');
    expect(limit).toBe(60);
    expect(windowMs).toBe(60 * 1000);
  });

  it('refuses the 61st tool call in the window (allowed:false)', () => {
    // The SQLite limiter counts; here we assert checkRateLimit surfaces a blocked verdict.
    h.check.mockReturnValue({ allowed: false, count: 61, remaining: 0, resetAt: Date.now() + 1_000 });
    expect(checkRateLimit('vapiToolCall', '42').allowed).toBe(false);
  });

  // S8 — Vapi webhook per-IP flood ceiling
  it('vapiWebhook is a high per-IP/min ceiling (DoS backstop, not a tight limit)', () => {
    expect(LIMITS.vapiWebhook.limit).toBe(1000);
    expect(LIMITS.vapiWebhook.windowMs).toBe(60 * 1000);
  });

  it('vapiWebhook keys by source IP and surfaces a blocked verdict past the ceiling', () => {
    h.check.mockReturnValue({ allowed: true, count: 1, remaining: 999, resetAt: 0 });
    checkRateLimit('vapiWebhook', '203.0.113.7');
    expect((h.check.mock.calls as any[])[0][0]).toBe('vapiWebhook:203.0.113.7');
    h.check.mockReturnValue({ allowed: false, count: 1001, remaining: 0, resetAt: Date.now() + 1_000 });
    expect(checkRateLimit('vapiWebhook', '203.0.113.7').allowed).toBe(false);
  });

  // S8 — per-user fact-extraction ceiling
  it('factExtraction is 10/hour per user and blocks the 11th', () => {
    expect(LIMITS.factExtraction.limit).toBe(10);
    expect(LIMITS.factExtraction.windowMs).toBe(60 * 60 * 1000);
    h.check.mockReturnValue({ allowed: false, count: 11, remaining: 0, resetAt: Date.now() + 1_000 });
    expect(checkRateLimit('factExtraction', '42').allowed).toBe(false);
  });
});

// ── rateLimitResponse ─────────────────────────────────────────────────────────
describe('rateLimitResponse', () => {
  it('returns HTTP 429', () => {
    const res = rateLimitResponse(Date.now() + 30_000);
    expect(res.status).toBe(429);
  });

  it('includes a Retry-After header (seconds)', () => {
    const resetAt = Date.now() + 30_000;
    const res = rateLimitResponse(resetAt);
    const retryAfter = Number(res.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(30);
  });

  it('includes an X-RateLimit-Reset header (unix epoch seconds)', () => {
    const resetAt = Date.now() + 60_000;
    const res = rateLimitResponse(resetAt);
    const reset = Number(res.headers.get('X-RateLimit-Reset'));
    expect(reset).toBeGreaterThan(0);
    expect(reset * 1000).toBeGreaterThan(Date.now());
  });
});
