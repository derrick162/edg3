import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  session: null as { id: number; name: string } | null,
  rateLimitAllowed: true,
  extract: vi.fn(async () => 3),
  upsert: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));
vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: h.rateLimitAllowed, remaining: 9, resetAt: Date.now() + 60_000 }),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
}));
vi.mock('@/lib/db', () => ({ factQueries: { upsertFact: h.upsert } }));
vi.mock('@/lib/facts', () => ({ extractAndUpsertFacts: h.extract }));

import { POST } from './route';

function noteReq(body: unknown) {
  return new NextRequest('http://localhost/api/memory/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  h.session = { id: 1, name: 'Derrick' };
  h.rateLimitAllowed = true;
  h.extract.mockClear();
  h.upsert.mockClear();
  h.extract.mockResolvedValue(3);
});

describe('POST /api/memory/notes (R36 T1)', () => {
  it('returns 401 when unauthenticated', async () => {
    h.session = null;
    const r = await POST(noteReq({ text: 'hi' }));
    expect(r.status).toBe(401);
  });

  it('returns 400 when text is empty/whitespace', async () => {
    expect((await POST(noteReq({ text: '   ' }))).status).toBe(400);
    expect((await POST(noteReq({}))).status).toBe(400);
  });

  it('returns 400 when text exceeds 6000 chars', async () => {
    const r = await POST(noteReq({ text: 'a'.repeat(6001) }));
    expect(r.status).toBe(400);
  });

  it('extracts structured facts, stores the raw user_note fact, and returns the count', async () => {
    const r = await POST(noteReq({ text: 'Patrick moved back to Toronto, job hunting in finance' }));
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d.factsExtracted).toBe(3);
    expect(h.extract).toHaveBeenCalledWith(1, 'Patrick moved back to Toronto, job hunting in finance', 'Derrick');
    expect(h.upsert).toHaveBeenCalledWith(1, 'user_note', 'Patrick moved back to Toronto, job hunting in finance', 'context note', 'high');
  });

  it('still saves the raw note (factsExtracted 0) when extraction fails', async () => {
    h.extract.mockRejectedValueOnce(new Error('haiku down'));
    const r = await POST(noteReq({ text: 'some context' }));
    expect(r.status).toBe(200);
    expect((await r.json()).factsExtracted).toBe(0);
    expect(h.upsert).toHaveBeenCalled();
  });
});
