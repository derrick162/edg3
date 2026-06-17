import { NextRequest, NextResponse } from 'next/server';

// Set a Content-Security-Policy header.
//
// CSP DECISION (2026-06-16, closed):
//   Strict nonce + 'strict-dynamic' was tested locally with `next build &&
//   next start`. curl of the served HTML confirmed that Next.js 16 + Turbopack
//   outputs nonce="$undefined" in RSC JSON and emits NO nonce attribute on
//   the actual <script> tags. Under 'strict-dynamic', 'self' is ignored, so
//   every script was blocked → blank page in production.
//
//   ACCEPTED PRE-BETA BASELINE: `script-src 'self' 'unsafe-inline'`.
//   This is strictly better than no CSP: cross-origin script injection is
//   blocked; only same-origin scripts run. 'unsafe-inline' is necessary for
//   Next.js's inline bootstrap chunks until Turbopack gains nonce emission.
//
//   Revisit strict nonce only if Turbopack adds `experimental.nonce` support
//   (track: nextjs.org/docs) AND we can browser-verify enforcement end-to-end.
//   'unsafe-eval' is added in dev for Turbopack HMR only.
export function proxy(request: NextRequest) {
  const isDev = process.env.NODE_ENV === 'development';

  const cspHeader = `
    default-src 'self';
    script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''};
    style-src 'self' 'unsafe-inline';
    img-src 'self' blob: data:;
    font-src 'self';
    connect-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
  `;
  const cspValue = cspHeader.replace(/\s{2,}/g, ' ').trim();

  const response = NextResponse.next();
  response.headers.set('Content-Security-Policy', cspValue);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
