import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  session: null as { id: number } | null,
  user: { gratitude_mode: 0 } as { gratitude_mode: number } | undefined,
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
    findById: () => h.user,
    setGratitudeMode: (...args: unknown[]) => { h.setCalls.push(args); },
  },
}));

import { GET, PATCH } from './route';

function patchReq(body: unknown) {
  return new NextRequest('http://localhost/api/settings/gratitude-mode', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  h.session = { id: 7 };
  h.user = { gratitude_mode: 0 };
  h.rateLimitAllowed = true;
  h.setCalls = [];
});

describe('GET/PATCH /api/settings/gratitude-mode (R20)', () => {
  it('GET returns a boolean from users.gratitude_mode', async () => {
    h.user = { gratitude_mode: 1 };
    expect((await (await GET()).json()).gratitudeMode).toBe(true);
    h.user = { gratitude_mode: 0 };
    expect((await (await GET()).json()).gratitudeMode).toBe(false);
  });

  it('GET 401 when unauthenticated', async () => {
    h.session = null;
    expect((await GET()).status).toBe(401);
  });

  it('PATCH updates the flag and 400s on a non-boolean', async () => {
    const ok = await PATCH(patchReq({ enabled: true }));
    expect(ok.status).toBe(200);
    expect(h.setCalls).toEqual([[7, true]]);

    h.setCalls = [];
    const bad = await PATCH(patchReq({ enabled: 'yes' }));
    expect(bad.status).toBe(400);
    expect(h.setCalls).toHaveLength(0);
  });
});
