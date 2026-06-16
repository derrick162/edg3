import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { exchangeCode } from '@/lib/calendar';
import { calendarQueries, oauthStateQueries, userQueries } from '@/lib/db';

export async function GET(req: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://www.edg3.ai';
  const code = req.nextUrl.searchParams.get('code');
  const stateParam = req.nextUrl.searchParams.get('state');

  if (!code) return NextResponse.redirect(new URL('/onboarding?error=calendar_denied', base));

  // Resolve user — prefer CSRF state token (primary, verifies request is legit).
  // Fall back to session cookie only when state is absent (legacy or Vapi-initiated flow).
  let userId: number | null = null;

  if (stateParam) {
    const stateRecord = oauthStateQueries.consume(stateParam);
    if (!stateRecord || stateRecord.flow !== 'calendar') {
      // State present but invalid/expired — potential CSRF. Reject cleanly.
      console.warn('[calendar callback] invalid or expired state token');
      return NextResponse.redirect(new URL('/dashboard?error=oauth_invalid_state', base));
    }
    userId = stateRecord.userId;
  } else {
    // No state — fall back to active session (covers edge cases where state was not set).
    const sessionUser = await getSession();
    userId = sessionUser?.id ?? null;
  }

  console.log(`[calendar callback] state=${stateParam ? 'verified' : 'absent'} resolved userId=${userId}`);
  if (!userId) return NextResponse.redirect(new URL('/login', base));

  try {
    const tokens = await exchangeCode(code);
    calendarQueries.upsert(
      userId,
      tokens.access_token!,
      tokens.refresh_token || '',
      tokens.expiry_date?.toString() || '',
      tokens.scope
    );
    // Where to send a full-page (non-popup) return: an already-onboarded user is just
    // re-linking, so drop them back on the dashboard with a "linked ✓" confirmation.
    const onboarded = !!userQueries.findById(userId)?.onboarding_complete;
    const fallbackUrl = onboarded ? '/dashboard?linked=1' : '/onboarding?step=priorities';
    const nonce = req.headers.get('x-nonce') || '';
    const html = `<!DOCTYPE html><html><body><script${nonce ? ` nonce="${nonce}"` : ''}>
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
