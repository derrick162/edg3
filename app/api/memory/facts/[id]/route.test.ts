import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockUser = { id: 1, name: 'Derrick' };
const mockFact = {
  id: 42, user_id: 1, category: 'person', statement: 'Ansi is an investor',
  entity: 'Ansi', confidence: 'high', learned_at: '2026-06-17T00:00:00',
};

vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/db', () => ({
  factQueries: {
    updateFact: vi.fn(),
    getById: vi.fn(),
    deleteFact: vi.fn(),
  },
}));

import { getSession } from '@/lib/auth';
import { factQueries } from '@/lib/db';
import { PATCH, DELETE } from './route';

function makeReq(body: object, id = '42'): NextRequest {
  return new NextRequest(`http://localhost/api/memory/facts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const params = (id = '42') => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
  (factQueries.getById as ReturnType<typeof vi.fn>).mockReturnValue(mockFact);
});

describe('PATCH /api/memory/facts/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await PATCH(makeReq({ statement: 'x' }), params());
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid id', async () => {
    const res = await PATCH(makeReq({ statement: 'ok' }), params('abc'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when statement missing', async () => {
    const res = await PATCH(makeReq({}), params());
    expect(res.status).toBe(400);
  });

  it('calls updateFact and returns updated fact', async () => {
    const res = await PATCH(makeReq({ statement: 'Ansi is a seed investor' }), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.fact.id).toBe(42);
    expect(factQueries.updateFact).toHaveBeenCalledWith(1, 42, 'Ansi is a seed investor', null);
  });

  it('passes entity when provided', async () => {
    await PATCH(makeReq({ statement: 'Ansi is a seed investor', entity: 'Ansi' }), params());
    expect(factQueries.updateFact).toHaveBeenCalledWith(1, 42, 'Ansi is a seed investor', 'Ansi');
  });

  it('returns 404 when fact not found after update', async () => {
    (factQueries.getById as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const res = await PATCH(makeReq({ statement: 'new' }), params());
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/memory/facts/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/memory/facts/42', { method: 'DELETE' });
    const res = await DELETE(req, params());
    expect(res.status).toBe(401);
  });

  it('calls deleteFact and returns ok', async () => {
    const req = new NextRequest('http://localhost/api/memory/facts/42', { method: 'DELETE' });
    const res = await DELETE(req, params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(factQueries.deleteFact).toHaveBeenCalledWith(1, 42);
  });
});
