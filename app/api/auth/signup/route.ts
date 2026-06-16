import { NextRequest, NextResponse } from 'next/server';
import { userQueries } from '@/lib/db';
import { hashPassword, createToken, setSessionCookie } from '@/lib/auth';
import { checkRateLimit, getClientIP, rateLimitResponse } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  // Rate limit: 5 signups per hour per IP (spam / scraper prevention).
  const ip = getClientIP(req);
  const rl = checkRateLimit('signup', ip);
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  try {
    const { email: rawEmail, name, password } = await req.json();
    const email = (rawEmail || '').trim().toLowerCase();

    if (!email || !name || !password) {
      return NextResponse.json({ error: 'All fields required' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const existing = userQueries.findByEmail(email);
    if (existing) {
      return NextResponse.json({ error: 'Account already exists' }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const result = userQueries.create(email, name, passwordHash) as any;
    const token = createToken(result.lastInsertRowid, 1);

    const response = NextResponse.json({ success: true });
    response.cookies.set(setSessionCookie(token));
    return response;
  } catch (err) {
    console.error('Signup error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
