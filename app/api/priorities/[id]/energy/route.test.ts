import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  session: null as { id: number; email: string; name: string } | null,
  rateLimitAllowed: true,
  setArgs: [] as unknown[],
  auditArgs: [] as unknown[],
}));

vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: h.rateLimitAllowed, remaining: 29, resetAt: Date.now() + 3_600_000 }),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
}));

vi.mock('@/lib/db', () => ({
  priorityQueries: { setEnergyCost: (...args: unknown[]) => { h.setArgs.push(args); } },
  auditLogQueries: { record: (e: unknown) => { h.auditArgs.push(e); } },
}));

import { PATCH } from './route';

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}
function patchReq(body: unknown, id = '1') {
  return [
    new NextRequest(`http://localhost/api/priorities/${id}/energy`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    makeParams(id),
  ] as const;
}

beforeEach(() => {
  h.session = { id: 2, email: 'a@b.com', name: 'A' };
  h.rateLimitAllowed = true;
  h.setArgs = [];
  h.auditArgs = [];
});

describe('PATCH /api/priorities/[id]/energy', () => {
  it('returns 401 when unauthenticated', async () => {
    h.session = null;
    const res = await PATCH(...patchReq({ energy_cost: 'high' }));
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate limited', async () => {
    h.rateLimitAllowed = false;
    const res = await PATCH(...patchReq({ energy_cost: 'high' }));
    expect(res.status).toBe(429);
  });

  it('returns 400 for non-numeric id', async () => {
    const res = await PATCH(...patchReq({ energy_cost: 'high' }, 'abc'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for id = 0', async () => {
    const res = await PATCH(...patchReq({ energy_cost: 'high' }, '0'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid energy_cost', async () => {
    const res = await PATCH(...patchReq({ energy_cost: 'extreme' }));
    expect(res.status).toBe(400);
  });

  it('returns 200 with high energy_cost and records audit', async () => {
    const res = await PATCH(...patchReq({ energy_cost: 'high' }));
    expect(res.status).toBe(200);
    expect(h.setArgs).toHaveLength(1);
    expect(h.auditArgs).toHaveLength(1);
    const audit = h.auditArgs[0] as Record<string, unknown>;
    expect(audit.action).toBe('setEnergyTag');
    expect(audit.ok).toBe(true);
    expect(audit.userId).toBe(2);
  });

  it('returns 200 with null energy_cost (clearing)', async () => {
    const res = await PATCH(...patchReq({ energy_cost: null }));
    expect(res.status).toBe(200);
    const call = h.setArgs[0] as unknown[];
    expect(call[2]).toBeNull();
  });

  it('accepts medium and low values', async () => {
    await PATCH(...patchReq({ energy_cost: 'medium' }));
    await PATCH(...patchReq({ energy_cost: 'low' }));
    expect(h.setArgs).toHaveLength(2);
  });
});
