import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getAuthUrl } from '@/lib/calendar';
import { oauthStateQueries } from '@/lib/db';
import { randomBytes } from 'crypto';

export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!process.env.GOOGLE_CLIENT_ID) {
    return NextResponse.json({ error: 'Google Calendar not configured' }, { status: 503 });
  }

  // Generate a cryptographic CSRF state token, bound to this user + flow.
  // The callback verifies it before accepting the OAuth code.
  const state = randomBytes(20).toString('hex');
  oauthStateQueries.create(state, user.id, 'calendar');

  // R18 T3 — ?select_account=1 forces Google's account picker so the user can switch accounts.
  const selectAccount = req.nextUrl.searchParams.get('select_account') === '1';
  const url = getAuthUrl(state, { selectAccount });
  return NextResponse.json({ url });
}
