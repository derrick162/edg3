import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  session: null as { id: number } | null,
  quote: { quoteEnabled: false, quoteTheme: 'resilience' },
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
    getGratitudeQuote: () => h.quote,
    setGratitudeQuote: (...args: unknown[]) => { h.setCalls.push(args); },
  },
}));

import { GET, PATCH } from './route';

function patchReq(body: unknown) {
  return new NextRequest('http://localhost/api/settings/gratitude-quote', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  h.session = { id: 7 };
  h.quote = { quoteEnabled: false, quoteTheme: 'resilience' };
  h.rateLimitAllowed = true;
  h.setCalls = [];
});

describe('GET/PATCH /api/settings/gratitude-quote (R21)', () => {
  it('GET returns the stored quote settings', async () => {
    h.quote = { quoteEnabled: true, quoteTheme: 'rebuilding' };
    expect(await (await GET()).json()).toEqual({ quoteEnabled: true, quoteTheme: 'rebuilding' });
  });

  it('PATCH accepts valid input and rejects bad enabled / empty / over-long theme', async () => {
    const ok = await PATCH(patchReq({ enabled: true, theme: 'rebuilding' }));
    expect(ok.status).toBe(200);
    expect(h.setCalls).toEqual([[7, true, 'rebuilding']]);

    h.setCalls = [];
    expect((await PATCH(patchReq({ enabled: 'yes', theme: 'x' }))).status).toBe(400);     // bad enabled
    expect((await PATCH(patchReq({ enabled: true, theme: '   ' }))).status).toBe(400);     // empty theme
    expect((await PATCH(patchReq({ enabled: true, theme: 'a'.repeat(101) }))).status).toBe(400); // too long
    expect(h.setCalls).toHaveLength(0);
  });
});
