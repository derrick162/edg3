import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── hoisted mock values ────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  rateLimitAllowed: true,
  rateLimitResetAt: Date.now() + 60_000,
  addEmail: vi.fn<(email: string, source: string) => void>(),
  clientIP: '1.2.3.4',
}));

// ── module mocks ───────────────────────────────────────────────────────────────

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: (_type: string, _ip: string) => ({
    allowed: h.rateLimitAllowed,
    remaining: h.rateLimitAllowed ? 4 : 0,
    resetAt: h.rateLimitResetAt,
  }),
  rateLimitResponse: (_resetAt: number) => new Response(
    JSON.stringify({ error: 'Too many requests — please slow down and try again shortly.' }),
    { status: 429 }
  ),
  getClientIP: (_req: unknown) => h.clientIP,
}));

vi.mock('@/lib/db', () => ({
  waitlistQueries: {
    add: (email: string, source: string) => h.addEmail(email, source),
  },
}));

// ── helpers ───────────────────────────────────────────────────────────────────

function makeReq(body: unknown, ip = '1.2.3.4'): NextRequest {
  return new NextRequest('http://localhost/api/waitlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

import { POST } from './route';

beforeEach(() => {
  h.rateLimitAllowed = true;
  h.rateLimitResetAt = Date.now() + 60_000;
  h.clientIP = '1.2.3.4';
  vi.clearAllMocks();
});

// ── Valid submissions ─────────────────────────────────────────────────────────

describe('POST /api/waitlist — valid email', () => {
  it('returns { ok: true } for a well-formed email', async () => {
    const res = await POST(makeReq({ email: 'user@example.com' }));
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  it('calls waitlistQueries.add with trimmed email and default source', async () => {
    await POST(makeReq({ email: '  hello@example.com  ' }));
    expect(h.addEmail).toHaveBeenCalledWith('hello@example.com', 'landing');
  });

  it('passes source field through (up to 60 chars)', async () => {
    await POST(makeReq({ email: 'a@b.com', source: 'hero-cta' }));
    expect(h.addEmail).toHaveBeenCalledWith('a@b.com', 'hero-cta');
  });

  it('truncates source at 60 characters', async () => {
    const longSource = 'x'.repeat(80);
    await POST(makeReq({ email: 'a@b.com', source: longSource }));
    const [, savedSource] = h.addEmail.mock.calls[0] as [string, string];
    expect(savedSource.length).toBe(60);
  });

  it('returns { ok: true } for a duplicate email (no enumeration leak)', async () => {
    // waitlistQueries.add uses ON CONFLICT DO NOTHING — second sign-up should still succeed
    h.addEmail.mockImplementationOnce(() => { /* no-op, simulating duplicate */ });
    const res = await POST(makeReq({ email: 'existing@example.com' }));
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  it('returns { ok: true } even when DB throws (graceful degradation, no leak)', async () => {
    h.addEmail.mockImplementationOnce(() => { throw new Error('SQLITE_CONSTRAINT'); });
    const res = await POST(makeReq({ email: 'a@b.com' }));
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean };
    expect(json.ok).toBe(true);
  });
});

// ── Email validation ─────────────────────────────────────────────────────────

describe('POST /api/waitlist — email validation', () => {
  it('rejects missing email', async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it('rejects empty string email', async () => {
    const res = await POST(makeReq({ email: '' }));
    expect(res.status).toBe(400);
  });

  it('rejects email without @', async () => {
    const res = await POST(makeReq({ email: 'notanemail' }));
    expect(res.status).toBe(400);
  });

  it('rejects email without domain', async () => {
    const res = await POST(makeReq({ email: 'user@' }));
    expect(res.status).toBe(400);
  });

  it('rejects email over 254 chars (RFC 5321 max)', async () => {
    const longEmail = 'a'.repeat(243) + '@example.com'; // 243+12 = 255 chars
    expect(longEmail.length).toBe(255);
    const res = await POST(makeReq({ email: longEmail }));
    expect(res.status).toBe(400);
  });

  it('accepts an email at exactly 254 chars', async () => {
    const email = 'a'.repeat(242) + '@example.com'; // 242+12 = 254 chars
    expect(email.length).toBe(254);
    const res = await POST(makeReq({ email }));
    expect(res.status).toBe(200);
  });

  it('rejects non-string email (number)', async () => {
    const res = await POST(makeReq({ email: 12345 }));
    expect(res.status).toBe(400);
  });

  it('rejects email with newline (header injection attempt)', async () => {
    const res = await POST(makeReq({ email: 'user@example.com\nBcc:evil@evil.com' }));
    expect(res.status).toBe(400);
  });

  it('does not call waitlistQueries.add on invalid email', async () => {
    await POST(makeReq({ email: 'not-an-email' }));
    expect(h.addEmail).not.toHaveBeenCalled();
  });
});

// ── Rate limiting ─────────────────────────────────────────────────────────────

describe('POST /api/waitlist — rate limiting', () => {
  it('returns 429 when rate limit is exceeded', async () => {
    h.rateLimitAllowed = false;
    const res = await POST(makeReq({ email: 'a@b.com' }));
    expect(res.status).toBe(429);
  });

  it('does not add to DB when rate limited', async () => {
    h.rateLimitAllowed = false;
    await POST(makeReq({ email: 'a@b.com' }));
    expect(h.addEmail).not.toHaveBeenCalled();
  });
});

// ── Invalid request body ──────────────────────────────────────────────────────

describe('POST /api/waitlist — malformed body', () => {
  it('handles non-JSON body gracefully (treats as empty object → 400)', async () => {
    const req = new NextRequest('http://localhost/api/waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
      body: 'this is not json',
    });
    const res = await POST(req);
    // body parse fails → email is '' → 400
    expect(res.status).toBe(400);
  });
});
