import { type NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse, getClientIP } from '@/lib/rateLimit';
import { waitlistQueries } from '@/lib/db';

// Public landing-page waitlist signup. No auth (pre-account). Rate-limited by IP.
// Always returns a generic success so we never leak whether an email already signed up.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const rl = checkRateLimit('waitlist', ip);
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  const body = await req.json().catch(() => ({}));
  const emailRaw = (body as { email?: unknown }).email;
  const sourceRaw = (body as { source?: unknown }).source;

  const email = typeof emailRaw === 'string' ? emailRaw.trim() : '';
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
  }
  const source = typeof sourceRaw === 'string' ? sourceRaw.slice(0, 60) : 'landing';

  try {
    waitlistQueries.add(email, source);
  } catch {
    // Non-fatal — never expose DB internals; treat as success to avoid leaking state.
  }

  // Generic success regardless of new-vs-duplicate (no enumeration).
  return NextResponse.json({ ok: true });
}
