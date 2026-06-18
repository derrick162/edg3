import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getGmailAuthUrl } from '@/lib/google-auth';
import { oauthStateQueries } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { randomBytes } from 'crypto';

// GET /api/auth/google/gmail — start OAuth for the DEDICATED Gmail account (compose-only).
// Returns { url } for the client to open; the callback saves tokens as the gmail account.
export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('gmailConnect', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  if (!process.env.GOOGLE_CLIENT_ID) {
    return NextResponse.json({ error: 'Google not configured' }, { status: 503 });
  }

  // CSRF state bound to this user + the 'gmail' flow; the callback verifies it.
  const state = randomBytes(20).toString('hex');
  oauthStateQueries.create(state, user.id, 'gmail');

  const url = await getGmailAuthUrl(state);
  return NextResponse.json({ url });
}
