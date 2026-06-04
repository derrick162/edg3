import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { exchangeCode } from '@/lib/calendar';
import { calendarQueries } from '@/lib/db';
import { cookies } from 'next/headers';
import { createToken, setSessionCookie } from '@/lib/auth';

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
    // Return a page that messages the opener and closes itself
    const html = `<!DOCTYPE html><html><body><script>
      if (window.opener) {
        window.opener.postMessage('calendar_connected', '*');
        window.close();
      } else {
        window.location.href = '/onboarding?step=priorities';
      }
    </script><p style="font-family:sans-serif;text-align:center;margin-top:40px;color:#888">Calendar connected! Closing...</p></body></html>`;
    const response = new Response(html, { headers: { 'Content-Type': 'text/html' } });
    return response;
  } catch (err) {
    console.error('Calendar OAuth error:', err);
    return NextResponse.redirect(new URL('/onboarding?error=calendar_failed', base));
  }
}
