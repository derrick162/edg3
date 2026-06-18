import { NextRequest, NextResponse } from 'next/server';
import { exchangeGmailCode, emailFromIdToken, saveGmailTokens } from '@/lib/google-auth';
import { oauthStateQueries, auditLogQueries } from '@/lib/db';

// GET /api/auth/google/gmail/callback — finishes the dedicated Gmail account OAuth.
// Verifies the CSRF state (flow='gmail'), exchanges the code, and saves the tokens as the
// user's gmail account. Stricter than the calendar callback: state is REQUIRED (no session
// fallback) since this is a pure settings action.
export async function GET(req: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://www.edg3.ai';
  const code = req.nextUrl.searchParams.get('code');
  const stateParam = req.nextUrl.searchParams.get('state');

  if (!code) return NextResponse.redirect(new URL('/dashboard?error=gmail_denied', base));
  if (!stateParam) return NextResponse.redirect(new URL('/dashboard?error=oauth_invalid_state', base));

  const stateRecord = oauthStateQueries.consume(stateParam);
  if (!stateRecord || stateRecord.flow !== 'gmail') {
    console.warn('[gmail callback] invalid or expired state token');
    return NextResponse.redirect(new URL('/dashboard?error=oauth_invalid_state', base));
  }
  const userId = stateRecord.userId;

  try {
    const tokens = await exchangeGmailCode(code);
    if (!tokens.access_token) throw new Error('Gmail token exchange returned no access token');
    const email = emailFromIdToken(tokens.id_token);
    saveGmailTokens(
      userId,
      {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        expiry: tokens.expiry_date?.toString() ?? null,
        scope: tokens.scope ?? null,
      },
      email,
    );
    try { auditLogQueries.record({ userId, action: 'gmailAccountConnect', argsJson: JSON.stringify({ email: email ?? null }), ok: true }); } catch { /* non-critical */ }

    const nonce = req.headers.get('x-nonce') || '';
    const html = `<!DOCTYPE html><html><body><script${nonce ? ` nonce="${nonce}"` : ''}>
      if (window.opener) {
        window.opener.postMessage('gmail_connected', '${base}');
        window.close();
      } else {
        window.location.href = '/dashboard?gmail_linked=1';
      }
    </script><p style="font-family:sans-serif;text-align:center;margin-top:40px;color:#888">Gmail account connected! Redirecting...</p></body></html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  } catch (err) {
    console.error('Gmail OAuth error:', err);
    return NextResponse.redirect(new URL('/dashboard?error=gmail_failed', base));
  }
}
