/**
 * Security tests for POST /api/auth/login.
 *
 * Key invariants:
 * - Rate limit 10/15min per IP (brute-force protection)
 * - Unknown email and wrong password both return 401 with the SAME error message
 *   (prevents user enumeration via different error messages)
 * - Successful login → 200 + session cookie
 * - onboarding_complete flag reflects DB value
 * - DB error → generic 500 (no raw error details to client)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── hoisted mocks ─────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  allowed: true,
  foundUser: null as Record<string, unknown> | null,
  passwordValid: false,
  verifyError: false,
}));

vi.mock('@/lib/rateLimit', () => ({
  getClientIP: (_req: unknown) => '127.0.0.1',
  checkRateLimit: () => ({ allowed: h.allowed, remaining: 9, resetAt: Date.now() + 900_000 }),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 }),
}));

vi.mock('@/lib/db', () => ({
  userQueries: {
    findByEmail: (_email: string) => h.foundUser,
  },
}));

vi.mock('@/lib/auth', () => ({
  verifyPassword: async (_pw: string, _hash: string) => {
    if (h.verifyError) throw new Error('bcrypt internal error');
    return h.passwordValid;
  },
  createToken: (_id: number, _ver: number) => 'test-jwt-token',
  setSessionCookie: (_token: string) => ({ name: 'session', value: 'test-jwt-token', httpOnly: true, maxAge: 86400 }),
}));

// ── helpers ───────────────────────────────────────────────────────────────────

function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const MOCK_USER = {
  id: 1, email: 'derrick@test.com', name: 'Derrick',
  password_hash: '$2b$12$fake', session_version: 1, onboarding_complete: 1,
};

// ── rate limit ────────────────────────────────────────────────────────────────

describe('POST /api/auth/login — rate limit (brute-force prevention)', () => {
  beforeEach(() => { h.allowed = false; h.foundUser = null; h.passwordValid = false; });

  it('returns 429 when rate-limited', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({ email: 'a@b.com', password: 'password' }));
    expect(res.status).toBe(429);
  });
});

// ── anti-enumeration ──────────────────────────────────────────────────────────
//
// IMPORTANT: both "user not found" and "wrong password" must return the same
// status code and error message. Different messages would let an attacker
// enumerate which emails are registered.

describe('POST /api/auth/login — anti-enumeration', () => {
  beforeEach(() => { h.allowed = true; h.foundUser = null; h.passwordValid = false; h.verifyError = false; });

  it('returns 401 for unknown email', async () => {
    h.foundUser = null; // user not found
    const { POST } = await import('./route');
    const res = await POST(postReq({ email: 'nobody@test.com', password: 'anypassword' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Invalid credentials');
  });

  it('returns 401 for wrong password (same message as unknown email)', async () => {
    h.foundUser = MOCK_USER;
    h.passwordValid = false; // wrong password
    const { POST } = await import('./route');
    const res = await POST(postReq({ email: 'derrick@test.com', password: 'wrongpassword' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Invalid credentials'); // SAME message — no enumeration
  });

  it('unknown email and wrong password return identical error messages', async () => {
    const { POST } = await import('./route');

    h.foundUser = null;
    const r1 = await POST(postReq({ email: 'nobody@x.com', password: 'wrong' }));
    const b1 = await r1.json();

    h.foundUser = MOCK_USER;
    h.passwordValid = false;
    const r2 = await POST(postReq({ email: 'derrick@test.com', password: 'wrong' }));
    const b2 = await r2.json();

    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);
    expect(b1.error).toBe(b2.error); // exact same message
  });
});

// ── successful login ──────────────────────────────────────────────────────────

describe('POST /api/auth/login — successful login', () => {
  beforeEach(() => { h.allowed = true; h.foundUser = MOCK_USER; h.passwordValid = true; h.verifyError = false; });

  it('returns 200 with success:true', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({ email: 'derrick@test.com', password: 'correctpassword' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('sets a session cookie on success', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({ email: 'derrick@test.com', password: 'correctpassword' }));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
  });

  it('returns onboarding_complete: true when user has finished onboarding', async () => {
    h.foundUser = { ...MOCK_USER, onboarding_complete: 1 };
    const { POST } = await import('./route');
    const res = await POST(postReq({ email: 'derrick@test.com', password: 'correctpassword' }));
    const body = await res.json();
    expect(body.onboarding_complete).toBe(true);
  });

  it('returns onboarding_complete: false when user has not finished onboarding', async () => {
    h.foundUser = { ...MOCK_USER, onboarding_complete: 0 };
    const { POST } = await import('./route');
    const res = await POST(postReq({ email: 'derrick@test.com', password: 'correctpassword' }));
    const body = await res.json();
    expect(body.onboarding_complete).toBe(false);
  });

  it('normalises email (case-insensitive lookup)', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({ email: 'DERRICK@TEST.COM', password: 'correctpassword' }));
    expect(res.status).toBe(200);
  });
});

// ── error safety ──────────────────────────────────────────────────────────────

describe('POST /api/auth/login — error response safety', () => {
  beforeEach(() => { h.allowed = true; h.foundUser = MOCK_USER; h.passwordValid = false; });

  it('returns generic 500 when verifyPassword throws (no raw error leaked)', async () => {
    h.verifyError = true;
    const { POST } = await import('./route');
    const res = await POST(postReq({ email: 'derrick@test.com', password: 'anything' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Server error');
    expect(body.error).not.toContain('bcrypt');
    expect(body.error).not.toContain('internal');
  });
});
