import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── hoisted mock values ────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  session: null as { id: number; email: string; name: string } | null,
  rateLimitAllowed: true,
  existingFact: null as Record<string, unknown> | null,
  updateArgs: [] as unknown[],
  deleteArgs: [] as unknown[],
  auditArgs: [] as unknown[],
}));

// ── module mocks ───────────────────────────────────────────────────────────────

vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: h.rateLimitAllowed, remaining: 19, resetAt: Date.now() + 60_000 }),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
}));

vi.mock('@/lib/db', () => ({
  factQueries: {
    getById: (_userId: number, _id: number) => h.existingFact,
    updateFact: (...args: unknown[]) => { h.updateArgs.push(args); },
    deleteFact: (...args: unknown[]) => { h.deleteArgs.push(args); },
  },
  auditLogQueries: {
    record: (entry: unknown) => { h.auditArgs.push(entry); },
  },
}));

// ── helpers ───────────────────────────────────────────────────────────────────

import { PATCH, DELETE } from './route';

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}
function patchReq(body: unknown, id = '1') {
  return [
    new NextRequest(`http://localhost/api/memory/facts/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    makeParams(id),
  ] as const;
}
function deleteReq(id = '1') {
  return [
    new NextRequest(`http://localhost/api/memory/facts/${id}`, { method: 'DELETE' }),
    makeParams(id),
  ] as const;
}

// ── PATCH tests ───────────────────────────────────────────────────────────────

describe('PATCH /api/memory/facts/[id]', () => {
  beforeEach(() => {
    h.session = { id: 1, email: 'a@b.com', name: 'A' };
    h.rateLimitAllowed = true;
    h.existingFact = { id: 1, user_id: 1, category: 'person', entity: 'Alice', statement: 'Alice is a friend', source: null };
    h.updateArgs = [];
    h.auditArgs = [];
  });

  it('returns 401 when unauthenticated', async () => {
    h.session = null;
    const res = await PATCH(...patchReq({ statement: 'New fact' }));
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate limited', async () => {
    h.rateLimitAllowed = false;
    const res = await PATCH(...patchReq({ statement: 'New fact' }));
    expect(res.status).toBe(429);
  });

  it('returns 400 for non-numeric id', async () => {
    const res = await PATCH(...patchReq({ statement: 'New fact' }, 'abc'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for id = 0', async () => {
    const res = await PATCH(...patchReq({ statement: 'New fact' }, '0'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for negative id', async () => {
    const res = await PATCH(...patchReq({ statement: 'New fact' }, '-1'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when statement is missing', async () => {
    const res = await PATCH(...patchReq({ entity: 'Alice' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when statement is empty string', async () => {
    const res = await PATCH(...patchReq({ statement: '   ' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when statement exceeds 500 chars', async () => {
    const res = await PATCH(...patchReq({ statement: 'x'.repeat(501) }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when entity is not a string or null', async () => {
    const res = await PATCH(...patchReq({ statement: 'Valid', entity: 42 }));
    expect(res.status).toBe(400);
  });

  it('returns 404 when fact not found for this user', async () => {
    h.existingFact = null;
    const res = await PATCH(...patchReq({ statement: 'New text' }));
    expect(res.status).toBe(404);
  });

  it('returns 200, calls updateFact, and records audit on success', async () => {
    const res = await PATCH(...patchReq({ statement: 'Updated statement', entity: 'Alice' }));
    expect(res.status).toBe(200);
    expect(h.updateArgs).toHaveLength(1);
    expect(h.auditArgs).toHaveLength(1);
    const audit = h.auditArgs[0] as Record<string, unknown>;
    expect(audit.action).toBe('fact_update');
    expect(audit.ok).toBe(true);
  });

  it('trims statement before saving', async () => {
    await PATCH(...patchReq({ statement: '  Padded  ' }));
    const call = h.updateArgs[0] as unknown[];
    expect(call[2]).toBe('Padded'); // userId=1, id=1, statement, entity
  });

  it('accepts null entity', async () => {
    const res = await PATCH(...patchReq({ statement: 'Valid', entity: null }));
    expect(res.status).toBe(200);
  });
});

// ── DELETE tests ──────────────────────────────────────────────────────────────

describe('DELETE /api/memory/facts/[id]', () => {
  beforeEach(() => {
    h.session = { id: 1, email: 'a@b.com', name: 'A' };
    h.rateLimitAllowed = true;
    h.existingFact = { id: 1, user_id: 1, category: 'fact', entity: null, statement: 'Some fact', source: null };
    h.deleteArgs = [];
    h.auditArgs = [];
  });

  it('returns 401 when unauthenticated', async () => {
    h.session = null;
    const res = await DELETE(...deleteReq());
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate limited', async () => {
    h.rateLimitAllowed = false;
    const res = await DELETE(...deleteReq());
    expect(res.status).toBe(429);
  });

  it('returns 400 for non-numeric id', async () => {
    const res = await DELETE(...deleteReq('abc'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for id = 0', async () => {
    const res = await DELETE(...deleteReq('0'));
    expect(res.status).toBe(400);
  });

  it('returns 404 when fact not found for this user', async () => {
    h.existingFact = null;
    const res = await DELETE(...deleteReq());
    expect(res.status).toBe(404);
  });

  it('returns 409 when fact has source=priority-sync (cannot delete via this UI)', async () => {
    h.existingFact = { ...h.existingFact!, source: 'priority-sync' };
    const res = await DELETE(...deleteReq());
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/priorities/i);
  });

  it('returns 200, calls deleteFact, and records audit for a normal fact', async () => {
    const res = await DELETE(...deleteReq());
    expect(res.status).toBe(200);
    expect(h.deleteArgs).toHaveLength(1);
    expect(h.auditArgs).toHaveLength(1);
    const audit = h.auditArgs[0] as Record<string, unknown>;
    expect(audit.action).toBe('fact_delete');
    expect(audit.ok).toBe(true);
  });

  it('does not call deleteFact for priority-sync facts', async () => {
    h.existingFact = { ...h.existingFact!, source: 'priority-sync' };
    await DELETE(...deleteReq());
    expect(h.deleteArgs).toHaveLength(0);
  });
});
