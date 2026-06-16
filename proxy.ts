import { NextRequest, NextResponse } from 'next/server';

// Set a Content-Security-Policy header.
//
// NOTE (2026-06-16, PM hotfix): the previous strict nonce + 'strict-dynamic'
// policy broke production — Next.js 16 + Turbopack did NOT propagate the
// per-request nonce onto its framework <script> tags, so 'strict-dynamic'
// caused the browser to block every script (HTML rendered but nothing
// hydrated → blank page). Reverted to a still-meaningful same-origin policy:
// script-src 'self' 'unsafe-inline' allows the app's own chunks + Next's
// inline bootstrap scripts while blocking any cross-origin script injection.
//
// Security follow-up: re-introduce nonce-based strict CSP only after verifying
// in a real browser that Next emits the nonce on its script tags (see
// ROADMAP-SECURITY). 'unsafe-eval' added in dev for Turbopack HMR.
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
