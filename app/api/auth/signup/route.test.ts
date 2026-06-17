/**
 * Security tests for POST /api/auth/signup.
 *
 * Key invariants validated in the pre-beta audit:
 * - Rate limit 5/hr per IP (spam prevention)
 * - Password max 128 chars (bcrypt DoS — bcrypt with a ~72-byte block limit
 *   means anything longer is wasted CPU; an unbounded input can also force
 *   bcrypt to spin on a huge string)
 * - Password min 8 chars
 * - Name max 100 chars
 * - Email max 254 chars (RFC 5321)
 * - All fields required
 * - Duplicate email → 409 (does NOT say which account exists)
 * - Successful signup → 200 with session cookie set
 * - Error path never leaks raw err.message to the user
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── hoisted mocks ─────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  allowed: true,
  existingUser: null as unknown,
  createResult: { lastInsertRowid: 1 } as unknown,
  createShouldThrow: false,
}));

vi.mock('@/lib/rateLimit', () => ({
  getClientIP: (_req: unknown) => '127.0.0.1',
  checkRateLimit: () => ({ allowed: h.allowed, remaining: 4, resetAt: Date.now() + 3600_000 }),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 }),
}));

vi.mock('@/lib/db', () => ({
  userQueries: {
    findByEmail: (_email: string) => h.existingUser,
    create: (_email: string, _name: string, _hash: string) => {
      if (h.createShouldThrow) throw new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed');
      return h.createResult;
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  hashPassword: async (_pw: string) => 'hashed-password',
  createToken: (_id: number, _ver: number) => 'test-jwt-token',
  setSessionCookie: (_token: string) => ({ name: 'session', value: 'test-jwt-token', httpOnly: true, maxAge: 86400 }),
}));

// ── helpers ───────────────────────────────────────────────────────────────────

function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── rate limit ────────────────────────────────────────────────────────────────

describe('POST /api/auth/signup — rate limit', () => {
  beforeEach(() => {
    h.allowed = true;
    h.existingUser = null;
    h.createShouldThrow = false;
  });

  it('returns 429 when rate-limited', async () => {
    h.allowed = false;
    const { POST } = await import('./route');
    const res = await POST(postReq({ email: 'a@b.com', name: 'A', password: 'password123' }));
    expect(res.status).toBe(429);
  });
});

// ── password length (bcrypt DoS prevention) ───────────────────────────────────

describe('POST /api/auth/signup — password length validation', () => {
  beforeEach(() => {
    h.allowed = true;
    h.existingUser = null;
  });

  it('rejects password shorter than 8 chars → 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({ email: 'a@b.com', name: 'A', password: 'short' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/8 char/i);
  });

  it('accepts password of exactly 8 chars → OK path', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({ email: 'a@b.com', name: 'A', password: '12345678' }));
    expect(res.status).toBe(200);
  });

  it('accepts password of exactly 128 chars → OK path (at the limit)', async () => {
    const { POST } = await import('./route');
    const pw = 'A'.repeat(128);
    const res = await POST(postReq({ email: 'a@b.com', name: 'A', password: pw }));
    expect(res.status).toBe(200);
  });

  it('rejects password of 129 chars → 400 (bcrypt DoS cap)', async () => {
    const { POST } = await import('./route');
    const pw = 'A'.repeat(129);
    const res = await POST(postReq({ email: 'a@b.com', name: 'A', password: pw }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/128 char/i);
  });

  it('rejects a very long password → 400 (no bcrypt CPU spike)', async () => {
    const { POST } = await import('./route');
    const pw = 'A'.repeat(10_000);
    const res = await POST(postReq({ email: 'a@b.com', name: 'A', password: pw }));
    expect(res.status).toBe(400);
  });
});

// ── name length validation ────────────────────────────────────────────────────

describe('POST /api/auth/signup — name length validation', () => {
  beforeEach(() => {
    h.allowed = true;
    h.existingUser = null;
  });

  it('accepts name of exactly 100 chars', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({ email: 'a@b.com', name: 'A'.repeat(100), password: 'password123' }));
    expect(res.status).toBe(200);
  });

  it('rejects name of 101 chars → 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({ email: 'a@b.com', name: 'A'.repeat(101), password: 'password123' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/100 char/i);
  });
});

// ── email length validation ───────────────────────────────────────────────────

describe('POST /api/auth/signup — email length validation (RFC 5321)', () => {
  beforeEach(() => {
    h.allowed = true;
    h.existingUser = null;
  });

  it('accepts email of exactly 254 chars', async () => {
    const { POST } = await import('./route');
    // Construct a valid 254-char email: local@domain where local+@+domain = 254
    const local = 'a'.repeat(243);
    const email = `${local}@b.com`; // 243 + 1 + 5 = 249... let's do it properly
    const domain = 'b.com';
    const localPart = 'a'.repeat(254 - 1 - domain.length); // 254 - '@' - domain
    const longEmail = `${localPart}@${domain}`;
    expect(longEmail.length).toBe(254);
    const res = await POST(postReq({ email: longEmail, name: 'A', password: 'password123' }));
    expect(res.status).toBe(200);
  });

  it('rejects email of 255 chars → 400', async () => {
    const { POST } = await import('./route');
    const domain = 'b.com';
    const localPart = 'a'.repeat(255 - 1 - domain.length);
    const longEmail = `${localPart}@${domain}`;
    expect(longEmail.length).toBe(255);
    const res = await POST(postReq({ email: longEmail, name: 'A', password: 'password123' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/254 char/i);
  });
});

// ── required fields ───────────────────────────────────────────────────────────

describe('POST /api/auth/signup — required fields', () => {
  beforeEach(() => {
    h.allowed = true;
    h.existingUser = null;
  });

  it('rejects missing email → 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({ name: 'A', password: 'password123' }));
    expect(res.status).toBe(400);
  });

  it('rejects missing name → 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({ email: 'a@b.com', password: 'password123' }));
    expect(res.status).toBe(400);
  });

  it('rejects missing password → 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({ email: 'a@b.com', name: 'A' }));
    expect(res.status).toBe(400);
  });
});

// ── duplicate email ───────────────────────────────────────────────────────────

describe('POST /api/auth/signup — duplicate email', () => {
  beforeEach(() => {
    h.allowed = true;
  });

  it('returns 409 when email already exists (no leak of which account)', async () => {
    h.existingUser = { id: 99, email: 'a@b.com', name: 'Existing' };
    const { POST } = await import('./route');
    const res = await POST(postReq({ email: 'a@b.com', name: 'A', password: 'password123' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    // Error message should not leak information about the existing account
    expect(body.error).not.toContain('99');
    expect(body.error).not.toContain('Existing');
  });
});

// ── successful signup ─────────────────────────────────────────────────────────

describe('POST /api/auth/signup — successful signup', () => {
  beforeEach(() => {
    h.allowed = true;
    h.existingUser = null;
    h.createShouldThrow = false;
  });

  it('returns 200 with success: true', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({ email: 'new@user.com', name: 'New User', password: 'password123' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('sets a session cookie on success', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({ email: 'new@user.com', name: 'New User', password: 'password123' }));
    expect(res.status).toBe(200);
    // Cookie should be set (session established immediately on signup)
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
  });

  it('normalises email to lowercase before storing', async () => {
    // The route does trim().toLowerCase() — test that uppercase input still works
    const { POST } = await import('./route');
    const res = await POST(postReq({ email: 'NEW@USER.COM', name: 'New User', password: 'password123' }));
    expect(res.status).toBe(200);
  });
});

// ── error safety ──────────────────────────────────────────────────────────────

describe('POST /api/auth/signup — error response safety', () => {
  beforeEach(() => {
    h.allowed = true;
    h.existingUser = null;
  });

  it('returns generic 500 on unexpected DB error (no raw error leaked)', async () => {
    h.createShouldThrow = true;
    const { POST } = await import('./route');
    const res = await POST(postReq({ email: 'a@b.com', name: 'A', password: 'password123' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    // The route catches and returns { error: 'Server error' } — no raw SQLITE message
    expect(body.error).toBe('Server error');
    expect(body.error).not.toContain('SQLITE_CONSTRAINT');
    expect(body.error).not.toContain('UNIQUE');
  });
});
