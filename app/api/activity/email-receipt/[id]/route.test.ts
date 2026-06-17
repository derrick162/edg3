import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── hoisted mock values ────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  session: null as { id: number; email: string; name: string } | null,
  subjects: null as string[] | null,
}));

// ── module mocks ───────────────────────────────────────────────────────────────

vi.mock('@/lib/auth', () => ({
  getSession: async () => h.session,
}));

vi.mock('@/lib/gmail', () => ({
  getEmailSignalSubjects: (_userId: number, _auditId: number) => h.subjects,
}));

// ── helpers ───────────────────────────────────────────────────────────────────

function makeReq(id: string): [NextRequest, { params: Promise<{ id: string }> }] {
  const req = new NextRequest(`http://localhost/api/activity/email-receipt/${id}`);
  return [req, { params: Promise.resolve({ id }) }];
}

// ── tests ─────────────────────────────────────────────────────────────────────

import { GET } from './route';

describe('GET /api/activity/email-receipt/[id]', () => {
  beforeEach(() => {
    h.session = null;
    h.subjects = null;
  });

  it('returns 401 when unauthenticated', async () => {
    h.session = null;
    const res = await GET(...makeReq('42'));
    expect(res.status).toBe(401);
  });

  it('returns 400 for a non-numeric id', async () => {
    h.session = { id: 1, email: 'a@b.com', name: 'A' };
    const res = await GET(...makeReq('abc'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for id = 0', async () => {
    h.session = { id: 1, email: 'a@b.com', name: 'A' };
    const res = await GET(...makeReq('0'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for a negative id', async () => {
    h.session = { id: 1, email: 'a@b.com', name: 'A' };
    const res = await GET(...makeReq('-5'));
    expect(res.status).toBe(400);
  });

  it('returns 404 when getEmailSignalSubjects returns null (entry not found or wrong user)', async () => {
    h.session = { id: 1, email: 'a@b.com', name: 'A' };
    h.subjects = null;
    const res = await GET(...makeReq('99'));
    expect(res.status).toBe(404);
  });

  it('returns 200 with subjects on a valid request', async () => {
    h.session = { id: 1, email: 'a@b.com', name: 'A' };
    h.subjects = ['Invoice due', 'Meeting tomorrow'];
    const res = await GET(...makeReq('42'));
    expect(res.status).toBe(200);
    const body = await res.json() as { subjects: string[] };
    expect(body.subjects).toEqual(['Invoice due', 'Meeting tomorrow']);
  });

  it('returns an empty subjects array when Edge found no threads', async () => {
    h.session = { id: 1, email: 'a@b.com', name: 'A' };
    h.subjects = [];
    const res = await GET(...makeReq('7'));
    expect(res.status).toBe(200);
    const body = await res.json() as { subjects: string[] };
    expect(body.subjects).toEqual([]);
  });
});
