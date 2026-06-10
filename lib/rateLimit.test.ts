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
  it('prefers x-forwarded-for (Railway proxy header)', () => {
    const req = mockReq({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' });
    expect(getClientIP(req as any)).toBe('1.2.3.4');
  });

  it('falls back to x-real-ip', () => {
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
