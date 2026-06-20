import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  session: null as { id: number; email: string; name: string } | null,
  setSpeedArgs: [] as unknown[],
}));

vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));

vi.mock('@/lib/db', () => ({
  userQueries: { setVoiceSpeed: (id: number, speed: string) => { h.setSpeedArgs.push([id, speed]); } },
}));

import { POST } from './route';

function req(body: unknown) {
  return new NextRequest('http://localhost/api/profile/voice-speed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  h.session = { id: 7, email: 'a@b.com', name: 'A' };
  h.setSpeedArgs = [];
});

describe('POST /api/profile/voice-speed', () => {
  it('returns 401 when unauthenticated', async () => {
    h.session = null;
    expect((await POST(req({ speed: 'fast' }))).status).toBe(401);
  });

  it('returns 400 for an invalid speed enum', async () => {
    const res = await POST(req({ speed: 'turbo' }));
    expect(res.status).toBe(400);
    expect(h.setSpeedArgs).toHaveLength(0);
  });

  it('returns 400 when speed is missing', async () => {
    expect((await POST(req({}))).status).toBe(400);
  });

  it('saves a valid speed and returns ok', async () => {
    const res = await POST(req({ speed: 'slow' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(h.setSpeedArgs).toEqual([[7, 'slow']]);
  });

  it('accepts all three presets', async () => {
    for (const s of ['slow', 'default', 'fast']) await POST(req({ speed: s }));
    expect(h.setSpeedArgs.map(a => (a as [number, string])[1])).toEqual(['slow', 'default', 'fast']);
  });
});
