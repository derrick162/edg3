import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { exchangeCode } from '@/lib/calendar';
import { calendarQueries } from '@/lib/db';

export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.redirect(new URL('/login', req.url));

  const code = req.nextUrl.searchParams.get('code');
  if (!code) return NextResponse.redirect(new URL('/onboarding?error=calendar_denied', req.url));

  try {
    const tokens = await exchangeCode(code);
    calendarQueries.upsert(
      user.id,
      tokens.access_token!,
      tokens.refresh_token || '',
      tokens.expiry_date?.toString() || ''
    );
    return NextResponse.redirect(new URL('/onboarding?step=priorities', req.url));
  } catch (err) {
    console.error('Calendar OAuth error:', err);
    return NextResponse.redirect(new URL('/onboarding?error=calendar_failed', req.url));
  }
}
