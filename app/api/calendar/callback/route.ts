import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { exchangeCode } from '@/lib/calendar';
import { calendarQueries, userQueries } from '@/lib/db';
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
  const userId = sessionUser?.id ?? (backupUid ? parseInt(backupUid, 10) : null) ?? (stateParam ? parseInt(stateParam, 10) : null);
  console.log(`[calendar callback] session=${sessionUser?.id} backupUid=${backupUid} state=${stateParam} resolved=${userId}`);
  if (!userId) return NextResponse.redirect(new URL('/login', base));

  try {
    const tokens = await exchangeCode(code);
    calendarQueries.upsert(
      userId,
      tokens.access_token!,
      tokens.refresh_token || '',
      tokens.expiry_date?.toString() || '',
      tokens.scope // persist granted scopes so we can detect Gmail re-consent needs
    );
    // Where to send a full-page (non-popup) return: an already-onboarded user is just
    // re-linking, so drop them back on the dashboard with a "linked ✓" confirmation —
    // NOT through the onboarding/priorities flow (that flash looked like being logged out).
    // First-time users (mid-onboarding) still continue to the priorities step.
    const onboarded = !!userQueries.findById(userId)?.onboarding_complete;
    const fallbackUrl = onboarded ? '/dashboard?linked=1' : '/onboarding?step=priorities';
    // Return a page that messages the opener and closes itself (popup), or redirects (full page).
    const html = `<!DOCTYPE html><html><body><script>
      if (window.opener) {
        window.opener.postMessage('calendar_connected', '${base}');
        window.close();
      } else {
        window.location.href = '${fallbackUrl}';
      }
    </script><p style="font-family:sans-serif;text-align:center;margin-top:40px;color:#888">Google connected! Redirecting...</p></body></html>`;
    const response = new Response(html, { headers: { 'Content-Type': 'text/html' } });
    return response;
  } catch (err) {
    console.error('Calendar OAuth error:', err);
    return NextResponse.redirect(new URL('/onboarding?error=calendar_failed', base));
  }
}
