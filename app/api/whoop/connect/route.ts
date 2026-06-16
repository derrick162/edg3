import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getAuthUrl } from '@/lib/whoop';
import { oauthStateQueries } from '@/lib/db';
import { randomBytes } from 'crypto';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!process.env.WHOOP_CLIENT_ID) {
    return NextResponse.json({ error: 'Whoop not configured' }, { status: 503 });
  }

  // Generate a cryptographic CSRF state token, bound to this user + flow.
  // The callback verifies it before accepting the OAuth code.
  const state = randomBytes(20).toString('hex');
  oauthStateQueries.create(state, user.id, 'whoop');

  const url = getAuthUrl(state);
  return NextResponse.json({ url });
}
