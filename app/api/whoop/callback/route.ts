import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { exchangeCode } from '@/lib/whoop';
import { whoopQueries, oauthStateQueries } from '@/lib/db';

export async function GET(req: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://www.edg3.ai';
  const code       = req.nextUrl.searchParams.get('code');
  const stateParam = req.nextUrl.searchParams.get('state');
  const oauthError = req.nextUrl.searchParams.get('error');
  const oauthErrorDesc = req.nextUrl.searchParams.get('error_description');

  if (!code) {
    console.error('[whoop callback] no code returned — error=', oauthError, 'desc=', oauthErrorDesc);
    const reason = encodeURIComponent(oauthError || 'no_code');
    return NextResponse.redirect(new URL(`/dashboard?error=whoop_denied&whoop_reason=${reason}`, base));
  }

  // Resolve user — prefer CSRF state token (primary, verifies request is legit).
  // Fall back to session cookie only when state is absent (legacy or Vapi-initiated flow).
  let userId: number | null = null;

  if (stateParam) {
    const stateRecord = oauthStateQueries.consume(stateParam);
    if (!stateRecord || stateRecord.flow !== 'whoop') {
      console.warn('[whoop callback] invalid or expired state token');
      return NextResponse.redirect(new URL('/dashboard?error=oauth_invalid_state', base));
    }
    userId = stateRecord.userId;
  } else {
    const sessionUser = await getSession();
    userId = sessionUser?.id ?? null;
  }

  console.log(`[whoop callback] state=${stateParam ? 'verified' : 'absent'} resolved userId=${userId}`);
  if (!userId) return NextResponse.redirect(new URL('/login', base));

  try {
    const tokens   = await exchangeCode(code);
    const expiresAt = Date.now() + tokens.expires_in * 1000;
    whoopQueries.upsert(userId, tokens.access_token, tokens.refresh_token, expiresAt, tokens.scope);

    const nonce = req.headers.get('x-nonce') || '';
    const html = `<!DOCTYPE html><html><body><script${nonce ? ` nonce="${nonce}"` : ''}>
      if (window.opener) {
        window.opener.postMessage('whoop_connected', '${base}');
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
