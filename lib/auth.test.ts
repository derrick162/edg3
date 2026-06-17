import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

// ── mock DB layer ───────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  user: null as { id: number; email: string; name: string; session_version: number; onboarding_complete: number } | null,
}));

vi.mock('./db', () => ({
  userQueries: {
    findById: (_id: number) => h.user,
  },
}));

// ── mock next/headers for getSession tests ──────────────────────────────────────

let _cookieValue: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (k: string) => (k === 'edg3_session' && _cookieValue ? { value: _cookieValue } : undefined),
  }),
}));

// ── module under test ───────────────────────────────────────────────────────────

import { createToken, verifyToken, setSessionCookie, clearSessionCookie, getSession, hashPassword, verifyPassword } from './auth';

const SECRET = 'test-secret-32-chars-minimum-abc';

beforeEach(() => {
  process.env.JWT_SECRET = SECRET;
  h.user = null;
  _cookieValue = undefined;
});

// ── createToken / verifyToken ────────────────────────────────────────────────────

describe('createToken + verifyToken round-trip', () => {
  it('round-trips userId and session version', () => {
    const token = createToken(42, 7);
    const payload = verifyToken(token);
    expect(payload?.userId).toBe(42);
    expect(payload?.ver).toBe(7);
  });

  it('returns null for a tampered token', () => {
    const token = createToken(1, 1);
    const tampered = token.slice(0, -4) + 'XXXX';
    expect(verifyToken(tampered)).toBeNull();
  });

  it('returns null for a token signed with a different secret', () => {
    const foreign = jwt.sign({ userId: 99, ver: 1 }, 'other-secret');
    expect(verifyToken(foreign)).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const token = jwt.sign({ userId: 1, ver: 1 }, SECRET, { expiresIn: -1 }); // already expired
    expect(verifyToken(token)).toBeNull();
  });

  it('returns null for a completely invalid string', () => {
    expect(verifyToken('not.a.jwt')).toBeNull();
    expect(verifyToken('')).toBeNull();
  });

  it('throws (instead of returning null) when JWT_SECRET is not set', () => {
    delete process.env.JWT_SECRET;
    expect(() => verifyToken('any')).toThrow(/JWT_SECRET/);
  });
});

// ── getSession — session_version revocation ─────────────────────────────────────

describe('getSession — session_version revocation', () => {
  const CURRENT_VERSION = 5;

  beforeEach(() => {
    h.user = { id: 1, email: 'a@b.com', name: 'Test', session_version: CURRENT_VERSION, onboarding_complete: 1 };
  });

  it('returns the user when token version matches DB version', async () => {
    _cookieValue = createToken(1, CURRENT_VERSION);
    const user = await getSession();
    expect(user).not.toBeNull();
    expect(user?.id).toBe(1);
  });

  it('returns null when token version does NOT match DB version (post-logout invalidation)', async () => {
    // Simulate: user logged out (DB bumped to 5), but attacker reuses old token (ver=4)
    _cookieValue = createToken(1, CURRENT_VERSION - 1);
    const user = await getSession();
    expect(user).toBeNull();
  });

  it('returns null when the user no longer exists in DB (deleted account)', async () => {
    _cookieValue = createToken(1, CURRENT_VERSION);
    h.user = null; // user was deleted
    const user = await getSession();
    expect(user).toBeNull();
  });

  it('returns null when no cookie is present', async () => {
    _cookieValue = undefined;
    const user = await getSession();
    expect(user).toBeNull();
  });

  it('returns null for a tampered cookie', async () => {
    _cookieValue = 'garbage.token.value';
    const user = await getSession();
    expect(user).toBeNull();
  });

  it('grandfathers legacy tokens with no ver field (ver=undefined) through session_version check', async () => {
    // Legacy tokens (pre-session-versioning) have no ver field; they should still work
    // until they expire naturally — breaking them would log out existing users.
    _cookieValue = jwt.sign({ userId: 1 }, SECRET); // no ver field
    const user = await getSession();
    expect(user).not.toBeNull(); // grandfathered through
  });
});

// ── setSessionCookie / clearSessionCookie — security flags ──────────────────────

describe('setSessionCookie security flags', () => {
  it('sets httpOnly=true (JS cannot read the cookie)', () => {
    const cookie = setSessionCookie('sometoken');
    expect(cookie.httpOnly).toBe(true);
  });

  it('sets sameSite=lax (blocks cross-site POST, allows OAuth navigation)', () => {
    const cookie = setSessionCookie('sometoken');
    expect(cookie.sameSite).toBe('lax');
  });

  it('sets maxAge to 30 days', () => {
    const cookie = setSessionCookie('sometoken');
    expect(cookie.maxAge).toBe(60 * 60 * 24 * 30);
  });

  it('includes the token value', () => {
    const cookie = setSessionCookie('my-jwt');
    expect(cookie.value).toBe('my-jwt');
  });
});

describe('clearSessionCookie', () => {
  it('sets maxAge=0 (immediately expires the cookie)', () => {
    const cookie = clearSessionCookie();
    expect(cookie.maxAge).toBe(0);
  });

  it('sets an empty value', () => {
    const cookie = clearSessionCookie();
    expect(cookie.value).toBe('');
  });

  it('preserves httpOnly and sameSite flags on clear', () => {
    const cookie = clearSessionCookie();
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('lax');
  });
});

// ── password hashing ─────────────────────────────────────────────────────────────

describe('hashPassword + verifyPassword', () => {
  it('round-trips a password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(await verifyPassword('correct-horse-battery-staple', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('right-password');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('produces a different hash each time (bcrypt salting)', async () => {
    const h1 = await hashPassword('abc');
    const h2 = await hashPassword('abc');
    expect(h1).not.toBe(h2);
  });
});
