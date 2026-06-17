/**
 * Security tests for POST /api/auth/logout.
 *
 * The key security invariant: logout bumps session_version so the user's
 * current JWT is immediately invalidated. A stolen token cannot be used
 * after the legitimate user logs out.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  session: null as { id: number; email: string; name: string } | null,
  incrementCalled: false,
}));

vi.mock('@/lib/auth', () => ({
  getSession: async () => h.session,
  clearSessionCookie: () => ({ name: 'session', value: '', maxAge: 0, httpOnly: true }),
}));

vi.mock('@/lib/db', () => ({
  userQueries: {
    incrementSessionVersion: (_id: number) => {
      h.incrementCalled = true;
    },
  },
}));

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    h.session = null;
    h.incrementCalled = false;
  });

  it('returns 200 success even when not authenticated (idempotent logout)', async () => {
    const { POST } = await import('./route');
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('clears the session cookie (set-cookie header present)', async () => {
    const { POST } = await import('./route');
    const res = await POST();
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    // Cookie should be cleared — maxAge=0 or similar
    expect(setCookie).toMatch(/session/i);
  });

  it('increments session_version when user is authenticated (token invalidation)', async () => {
    h.session = { id: 7, email: 'u@test.com', name: 'User' };
    const { POST } = await import('./route');
    await POST();
    // incrementSessionVersion must be called so any existing JWT for this user
    // becomes invalid immediately (session_version mismatch in getSession())
    expect(h.incrementCalled).toBe(true);
  });

  it('does NOT increment session_version when not authenticated', async () => {
    h.session = null;
    const { POST } = await import('./route');
    await POST();
    expect(h.incrementCalled).toBe(false);
  });
});
