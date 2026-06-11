/**
 * Admin authentication helpers for EDG3 (#10 — harden admin auth).
 *
 * Two fixes over the original pattern:
 *
 * 1. Constant-time comparisons via timingSafeEqual throughout — prevents timing
 *    side-channels that could leak the password character-by-character.
 *
 * 2. The edg3_admin cookie no longer stores the raw ADMIN_PASSWORD. It stores
 *    HMAC-SHA256(ADMIN_PASSWORD, "edg3-admin-session-v1") — a derived token.
 *    An attacker who reads the cookie cannot use it as the password elsewhere,
 *    and cannot reverse it to recover the password.
 *    Token is deterministic from the env var → no server-side session store needed.
 *
 * Existing admin sessions (with the raw password in the cookie) will be rejected
 * after this deploy and will require a fresh admin login. This is expected.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { type NextRequest } from 'next/server';

const HMAC_LABEL = 'edg3-admin-session-v1';

/**
 * Derive the cookie token from the admin password.
 * Returns a 64-char hex string (SHA-256 output).
 */
function deriveCookieToken(adminPassword: string): string {
  return createHmac('sha256', adminPassword).update(HMAC_LABEL).digest('hex');
}

/**
 * Verify a request carries a valid admin session cookie.
 * Uses timingSafeEqual on the HMAC-derived token (both buffers are always 32 bytes).
 */
export function checkAdminAuth(req: NextRequest): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return false;
  const cookieValue = req.cookies.get('edg3_admin')?.value;
  if (!cookieValue) return false;
  try {
    const expected = Buffer.from(deriveCookieToken(adminPassword), 'hex'); // 32 bytes
    const received = Buffer.from(cookieValue, 'hex');                       // 32 bytes if valid
    return received.length === expected.length && timingSafeEqual(expected, received);
  } catch {
    // cookieValue wasn't valid hex (old plaintext cookie) — reject cleanly.
    return false;
  }
}

/**
 * Verify a submitted plaintext password against ADMIN_PASSWORD using
 * timingSafeEqual. Returns false immediately on length mismatch (leaks length,
 * acceptable for a non-public admin endpoint behind rate limiting).
 */
export function verifyAdminPassword(submitted: string): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword || !submitted) return false;
  try {
    const a = Buffer.from(adminPassword, 'utf8');
    const b = Buffer.from(submitted, 'utf8');
    if (a.length !== b.length) return false; // length check is fine — admin endpoint only
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * The value to set in the edg3_admin cookie on successful login.
 * Callers should use this rather than the raw password.
 */
export function getAdminCookieToken(): string {
  return deriveCookieToken(process.env.ADMIN_PASSWORD ?? '');
}

/**
 * Verify a request carries a valid x-admin-secret header.
 * Used by CoS-agent routes that call the admin API directly (no browser session).
 * Uses timingSafeEqual to prevent the same timing side-channel as checkAdminAuth.
 */
export function checkAdminSecretAuth(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  const header = req.headers.get('x-admin-secret');
  if (!header) return false;
  try {
    const a = Buffer.from(secret, 'utf8');
    const b = Buffer.from(header, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
