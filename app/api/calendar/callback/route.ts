import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { exchangeCode } from '@/lib/calendar';
import { calendarQueries } from '@/lib/db';

export async function GET(req: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://www.edg3.ai';
  const code = req.nextUrl.searchParams.get('code');
  const stateParam = req.nextUrl.searchParams.get('state');

  if (!code) return NextResponse.redirect(new URL('/onboarding?error=calendar_denied', base));

  // Resolve user from session or state param (state is set when session cookie drops during OAuth)
  const sessionUser = await getSession();
  const userId = sessionUser?.id ?? (stateParam ? parseInt(stateParam) : null);
  if (!userId) return NextResponse.redirect(new URL('/login', base));

  try {
    const tokens = await exchangeCode(code);
    calendarQueries.upsert(
      userId,
      tokens.access_token!,
      tokens.refresh_token || '',
      tokens.expiry_date?.toString() || ''
    );
    return NextResponse.redirect(new URL('/onboarding?step=priorities', base));
  } catch (err) {
    console.error('Calendar OAuth error:', err);
    return NextResponse.redirect(new URL('/onboarding?error=calendar_failed', base));
  }
}
