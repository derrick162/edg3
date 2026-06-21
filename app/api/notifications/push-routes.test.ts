/**
 * R14 T1 — POST /api/notifications/subscribe + /unsubscribe route tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  session: null as { id: number } | null,
  allowed: true,
  upsert: vi.fn(),
  del: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));
vi.mock('@/lib/db', () => ({
  pushSubscriptionQueries: {
    upsert: (...a: unknown[]) => h.upsert(...a),
    delete: (...a: unknown[]) => h.del(...a),
  },
}));
vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: h.allowed, remaining: 1, resetAt: Date.now() + 1000 }),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 }),
}));

const { POST: subscribe } = await import('./subscribe/route');
const { POST: unsubscribe } = await import('./unsubscribe/route');

function req(body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/notifications/subscribe', {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.session = { id: 42 };
  h.allowed = true;
});

describe('POST /api/notifications/subscribe', () => {
  it('401 when unauthenticated', async () => {
    h.session = null;
    expect((await subscribe(req({ endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } }))).status).toBe(401);
  });

  it('upserts a valid subscription and returns ok', async () => {
    const res = await subscribe(req({ endpoint: 'https://push/e', keys: { p256dh: 'P', auth: 'A' } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.upsert).toHaveBeenCalledWith(42, 'https://push/e', 'P', 'A');
  });

  it('400 when the subscription is malformed (missing keys)', async () => {
    const res = await subscribe(req({ endpoint: 'e' }));
    expect(res.status).toBe(400);
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it('429 when rate-limited', async () => {
    h.allowed = false;
    expect((await subscribe(req({ endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } }))).status).toBe(429);
  });
});

describe('POST /api/notifications/unsubscribe', () => {
  it('401 when unauthenticated', async () => {
    h.session = null;
    expect((await unsubscribe(req({ endpoint: 'e' }))).status).toBe(401);
  });

  it('deletes the subscription by endpoint', async () => {
    const res = await unsubscribe(req({ endpoint: 'https://push/e' }));
    expect(res.status).toBe(200);
    expect(h.del).toHaveBeenCalledWith(42, 'https://push/e');
  });

  it('400 when endpoint is missing', async () => {
    const res = await unsubscribe(req({}));
    expect(res.status).toBe(400);
    expect(h.del).not.toHaveBeenCalled();
  });
});
