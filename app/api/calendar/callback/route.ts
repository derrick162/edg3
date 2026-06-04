import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { exchangeCode } from '@/lib/calendar';
import { calendarQueries } from '@/lib/db';
import { cookies } from 'next/headers';

export async function GET(req: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://www.edg3.ai';
  const code = req.nextUrl.searchParams.get('code');
  const stateParam = req.nextUrl.searchParams.get('state');

  if (!code) return NextResponse.redirect(new URL('/onboarding?error=calendar_denied', base));

  // Resolve user from session, fallback to backup cookie, then state param
  const sessionUser = await getSession();
  const cookieStore = await cookies();
  const backupUid = cookieStore.get('edg3_oauth_uid')?.value;
  const userId = sessionUser?.id ?? (backupUid ? parseInt(backupUid) : null) ?? (stateParam ? parseInt(stateParam) : null);
  console.log(`[calendar callback] session=${sessionUser?.id} backupUid=${backupUid} state=${stateParam} resolved=${userId}`);
  if (!userId) return NextResponse.redirect(new URL('/login', base));

  try {
    const tokens = await exchangeCode(code);
    calendarQueries.upsert(
      userId,
      tokens.access_token!,
      tokens.refresh_token || '',
      tokens.expiry_date?.toString() || ''
    );
    const redirect = NextResponse.redirect(new URL('/onboarding?step=priorities', base));
    redirect.cookies.set('edg3_oauth_uid', '', { maxAge: 0, path: '/' });
    return redirect;
  } catch (err) {
    console.error('Calendar OAuth error:', err);
    return NextResponse.redirect(new URL('/onboarding?error=calendar_failed', base));
  }
}
