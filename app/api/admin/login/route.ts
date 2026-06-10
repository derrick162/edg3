import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminPassword, getAdminCookieToken } from '@/lib/adminAuth';
import { checkRateLimit, getClientIP, rateLimitResponse } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  // Rate-limit brute-force attempts — shares the login bucket (10 req / 15 min per IP).
  const ip = getClientIP(req);
  const rl = checkRateLimit('login', ip);
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  try {
    const { password } = await req.json();

    // Constant-time compare — prevents timing side-channels.
    if (!verifyAdminPassword(password)) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    // Store a derived HMAC token, never the raw password.
    const response = NextResponse.json({ success: true });
    response.cookies.set('edg3_admin', getAdminCookieToken(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    });
    return response;
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
