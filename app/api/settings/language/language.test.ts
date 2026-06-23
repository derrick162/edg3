import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  session: null as { id: number } | null,
  language: 'en',
  rateLimitAllowed: true,
  setCalls: [] as unknown[],
}));

vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));
vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: h.rateLimitAllowed, remaining: 4, resetAt: Date.now() + 3_600_000 }),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
}));
vi.mock('@/lib/db', () => ({
  userQueries: {
    getLanguage: () => h.language,
    setLanguage: (...args: unknown[]) => { h.setCalls.push(args); },
  },
}));

import { GET, PATCH } from './route';

function patchReq(body: unknown) {
  return new NextRequest('http://localhost/api/settings/language', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  h.session = { id: 7 };
  h.language = 'en';
  h.rateLimitAllowed = true;
  h.setCalls = [];
});

describe('GET/PATCH /api/settings/language (R22)', () => {
  it('GET returns the stored language', async () => {
    h.language = 'yue';
    expect((await (await GET()).json()).language).toBe('yue');
  });

  it('GET 401 when unauthenticated', async () => {
    h.session = null;
    expect((await GET()).status).toBe(401);
  });

  it('PATCH accepts a supported language and rejects an unsupported one', async () => {
    const ok = await PATCH(patchReq({ language: 'yue' }));
    expect(ok.status).toBe(200);
    expect(h.setCalls).toEqual([[7, 'yue']]);

    h.setCalls = [];
    expect((await PATCH(patchReq({ language: 'fr' }))).status).toBe(400);
    expect((await PATCH(patchReq({ language: 123 }))).status).toBe(400);
    expect(h.setCalls).toHaveLength(0);
  });
});
