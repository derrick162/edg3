import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'crypto';

// ── helpers ────────────────────────────────────────────────────────────────────

function mockReq(cookieValue: string | undefined): { cookies: { get: (k: string) => { value: string } | undefined } } {
  return {
    cookies: {
      get: (k: string) => (k === 'edg3_admin' && cookieValue !== undefined ? { value: cookieValue } : undefined),
    },
  };
}

function mockHeaderReq(secretHeader: string | undefined): { headers: { get: (k: string) => string | null }; cookies: { get: () => undefined } } {
  return {
    headers: { get: (k: string) => (k === 'x-admin-secret' && secretHeader !== undefined ? secretHeader : null) },
    cookies: { get: () => undefined },
  };
}

function deriveToken(password: string): string {
  return createHmac('sha256', password).update('edg3-admin-session-v1').digest('hex');
}

// ── import under test ─────────────────────────────────────────────────────────

import { checkAdminAuth, verifyAdminPassword, getAdminCookieToken, checkAdminSecretAuth } from './adminAuth';

// ── checkAdminAuth ─────────────────────────────────────────────────────────────

describe('checkAdminAuth', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns false when ADMIN_PASSWORD is not set', () => {
    vi.stubEnv('ADMIN_PASSWORD', '');
    const token = deriveToken('anypassword');
    expect(checkAdminAuth(mockReq(token) as any)).toBe(false);
  });

  it('returns false when no cookie is present', () => {
    vi.stubEnv('ADMIN_PASSWORD', 'secret123');
    expect(checkAdminAuth(mockReq(undefined) as any)).toBe(false);
  });

  it('returns false when cookie contains the raw plaintext password (old format)', () => {
    vi.stubEnv('ADMIN_PASSWORD', 'secret123');
    // Old behavior stored the raw password — must be rejected now.
    expect(checkAdminAuth(mockReq('secret123') as any)).toBe(false);
  });

  it('returns false when cookie contains an incorrect token', () => {
    vi.stubEnv('ADMIN_PASSWORD', 'secret123');
    const wrongToken = deriveToken('differentpassword');
    expect(checkAdminAuth(mockReq(wrongToken) as any)).toBe(false);
  });

  it('returns false when cookie contains invalid hex (not a valid buffer)', () => {
    vi.stubEnv('ADMIN_PASSWORD', 'secret123');
    expect(checkAdminAuth(mockReq('not-valid-hex!!') as any)).toBe(false);
  });

  it('returns true when cookie contains the correct HMAC-derived token', () => {
    vi.stubEnv('ADMIN_PASSWORD', 'secret123');
    const correctToken = deriveToken('secret123');
    expect(checkAdminAuth(mockReq(correctToken) as any)).toBe(true);
  });

  it('rejects a token derived from a different ADMIN_PASSWORD', () => {
    vi.stubEnv('ADMIN_PASSWORD', 'secret123');
    const tokenForOtherPassword = deriveToken('otherpassword');
    expect(checkAdminAuth(mockReq(tokenForOtherPassword) as any)).toBe(false);
  });
});

// ── verifyAdminPassword ────────────────────────────────────────────────────────

describe('verifyAdminPassword', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns false when ADMIN_PASSWORD is not set', () => {
    vi.stubEnv('ADMIN_PASSWORD', '');
    expect(verifyAdminPassword('anything')).toBe(false);
  });

  it('returns false for an empty submitted password', () => {
    vi.stubEnv('ADMIN_PASSWORD', 'secret123');
    expect(verifyAdminPassword('')).toBe(false);
  });

  it('returns false for a wrong password', () => {
    vi.stubEnv('ADMIN_PASSWORD', 'secret123');
    expect(verifyAdminPassword('wrongpassword')).toBe(false);
  });

  it('returns false for a password with wrong length', () => {
    vi.stubEnv('ADMIN_PASSWORD', 'secret123');
    expect(verifyAdminPassword('secret12')).toBe(false); // one char short
  });

  it('returns true for the correct password', () => {
    vi.stubEnv('ADMIN_PASSWORD', 'secret123');
    expect(verifyAdminPassword('secret123')).toBe(true);
  });

  it('is case-sensitive', () => {
    vi.stubEnv('ADMIN_PASSWORD', 'Secret123');
    expect(verifyAdminPassword('secret123')).toBe(false);
    expect(verifyAdminPassword('Secret123')).toBe(true);
  });
});

// ── checkAdminSecretAuth ───────────────────────────────────────────────────────

describe('checkAdminSecretAuth', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns false when ADMIN_SECRET is not set', () => {
    vi.stubEnv('ADMIN_SECRET', '');
    expect(checkAdminSecretAuth(mockHeaderReq('anything') as any)).toBe(false);
  });

  it('returns false when the x-admin-secret header is absent', () => {
    vi.stubEnv('ADMIN_SECRET', 'mysecret');
    expect(checkAdminSecretAuth(mockHeaderReq(undefined) as any)).toBe(false);
  });

  it('returns false for a wrong secret', () => {
    vi.stubEnv('ADMIN_SECRET', 'mysecret');
    expect(checkAdminSecretAuth(mockHeaderReq('wrongsecret') as any)).toBe(false);
  });

  it('returns false when the header has a different length (avoids timingSafeEqual panic)', () => {
    vi.stubEnv('ADMIN_SECRET', 'mysecret');
    expect(checkAdminSecretAuth(mockHeaderReq('short') as any)).toBe(false);
  });

  it('returns true for the correct secret', () => {
    vi.stubEnv('ADMIN_SECRET', 'mysecret');
    expect(checkAdminSecretAuth(mockHeaderReq('mysecret') as any)).toBe(true);
  });

  it('is case-sensitive', () => {
    vi.stubEnv('ADMIN_SECRET', 'MySecret');
    expect(checkAdminSecretAuth(mockHeaderReq('mysecret') as any)).toBe(false);
    expect(checkAdminSecretAuth(mockHeaderReq('MySecret') as any)).toBe(true);
  });
});

// ── getAdminCookieToken ────────────────────────────────────────────────────────

describe('getAdminCookieToken', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns a 64-char hex string (SHA-256 output)', () => {
    vi.stubEnv('ADMIN_PASSWORD', 'secret123');
    const token = getAdminCookieToken();
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic — same password always yields same token', () => {
    vi.stubEnv('ADMIN_PASSWORD', 'secret123');
    expect(getAdminCookieToken()).toBe(getAdminCookieToken());
  });

  it('is different for different passwords', () => {
    vi.stubEnv('ADMIN_PASSWORD', 'secret123');
    const t1 = getAdminCookieToken();
    vi.stubEnv('ADMIN_PASSWORD', 'different456');
    const t2 = getAdminCookieToken();
    expect(t1).not.toBe(t2);
  });

  it('matches what checkAdminAuth expects', () => {
    vi.stubEnv('ADMIN_PASSWORD', 'secret123');
    const token = getAdminCookieToken();
    expect(checkAdminAuth(mockReq(token) as any)).toBe(true);
  });
});
