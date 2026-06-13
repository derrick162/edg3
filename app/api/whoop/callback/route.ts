import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { exchangeCode } from '@/lib/whoop';
import { whoopQueries } from '@/lib/db';

export async function GET(req: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://www.edg3.ai';
  const code       = req.nextUrl.searchParams.get('code');
  const stateParam = req.nextUrl.searchParams.get('state');
  const oauthError = req.nextUrl.searchParams.get('error');
  const oauthErrorDesc = req.nextUrl.searchParams.get('error_description');

  if (!code) {
    // Surface Whoop's actual reason (access_denied vs invalid_scope vs etc.) instead of a blanket denied.
    console.error('[whoop callback] no code returned — error=', oauthError, 'desc=', oauthErrorDesc);
    const reason = encodeURIComponent(oauthError || 'no_code');
    return NextResponse.redirect(new URL(`/dashboard?error=whoop_denied&whoop_reason=${reason}`, base));
  }

  // Resolve user: session → backup cookie → state param (same priority as calendar callback).
  const sessionUser  = await getSession();
  const cookieStore  = await cookies();
  const backupUid    = cookieStore.get('edg3_whoop_uid')?.value;
  const userId =
    sessionUser?.id ??
    (backupUid   ? parseInt(backupUid,   10) : null) ??
    (stateParam  ? parseInt(stateParam,  10) : null);

  if (!userId) return NextResponse.redirect(new URL('/login', base));

  try {
    const tokens   = await exchangeCode(code);
    const expiresAt = Date.now() + tokens.expires_in * 1000;
    whoopQueries.upsert(userId, tokens.access_token, tokens.refresh_token, expiresAt, tokens.scope);

    // Return a page that messages the opener and closes itself (popup flow),
    // or redirects directly if opened full-page.
    const html = `<!DOCTYPE html><html><body><script>
      if (window.opener) {
        window.opener.postMessage('whoop_connected', '*');
        window.close();
      } else {
        window.location.href = '/dashboard?whoop=connected';
      }
    </script><p style="font-family:sans-serif;text-align:center;margin-top:40px;color:#888">Whoop connected! Redirecting...</p></body></html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  } catch (err) {
    console.error('Whoop OAuth callback error:', err);
    return NextResponse.redirect(new URL('/dashboard?error=whoop_failed', base));
  }
}
