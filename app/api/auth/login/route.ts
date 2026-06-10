import { NextRequest, NextResponse } from 'next/server';
import { userQueries } from '@/lib/db';
import { verifyPassword, createToken, setSessionCookie } from '@/lib/auth';
import { checkRateLimit, getClientIP, rateLimitResponse } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  // Rate limit: 10 attempts per 15 min per IP (brute-force protection).
  const ip = getClientIP(req);
  const rl = checkRateLimit('login', ip);
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  try {
    const { email, password } = await req.json();

    const user = userQueries.findByEmail(email);
    if (!user) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const token = createToken(user.id);
    const response = NextResponse.json({
      success: true,
      onboarding_complete: user.onboarding_complete === 1,
    });
    response.cookies.set(setSessionCookie(token));
    return response;
  } catch (err) {
    console.error('Login error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
