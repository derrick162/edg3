import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import { userQueries, User } from './db';

const COOKIE_NAME = 'edg3_session';

// Fail closed: never fall back to a hardcoded secret. An unset JWT_SECRET would
// let anyone forge a session cookie (account takeover), so we refuse to sign or
// verify rather than silently using a public default. Resolved lazily so a build
// without runtime env doesn't crash at import — only actual auth operations throw.
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set — refusing to sign/verify sessions with a fallback secret.');
  }
  return secret;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function createToken(userId: number): string {
  return jwt.sign({ userId }, getJwtSecret(), { expiresIn: '30d' });
}

export function verifyToken(token: string): { userId: number } | null {
  // Resolve the secret outside the try so a misconfigured server surfaces loudly
  // (500) instead of silently treating every session as invalid; only a genuinely
  // bad/expired token falls through to null.
  const secret = getJwtSecret();
  try {
    return jwt.verify(token, secret) as { userId: number };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<User | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = verifyToken(token);
  if (!payload) return null;

  return userQueries.findById(payload.userId) || null;
}

export function setSessionCookie(token: string) {
  return {
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  };
}

export function clearSessionCookie() {
  return {
    name: COOKIE_NAME,
    value: '',
    maxAge: 0,
    path: '/',
  };
}
