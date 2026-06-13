import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getAuthUrl } from '@/lib/whoop';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!process.env.WHOOP_CLIENT_ID) {
    return NextResponse.json({ error: 'Whoop not configured' }, { status: 503 });
  }

  const url = getAuthUrl(user.id);
  const response = NextResponse.json({ url });
  // Backup cookie: preserves userId across the OAuth redirect in case the session
  // cookie is dropped (same pattern as /api/calendar/connect).
  response.cookies.set('edg3_whoop_uid', String(user.id), {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   60 * 10,
    path:     '/',
  });
  return response;
}
