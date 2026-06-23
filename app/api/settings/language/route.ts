import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { userQueries } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

// R22 — call language preference. 'en' (default) or 'yue' (Cantonese). Drives the
// transcriber / voice / system-prompt selection on every call. User-scoped via session.
const SUPPORTED_LANGUAGES = ['en', 'yue'];

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({ language: userQueries.getLanguage(user.id) });
}

export async function PATCH(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('languageSetting', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  let body: { language?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body.language !== 'string' || !SUPPORTED_LANGUAGES.includes(body.language)) {
    return NextResponse.json({ error: `language must be one of ${SUPPORTED_LANGUAGES.join(', ')}` }, { status: 400 });
  }

  userQueries.setLanguage(user.id, body.language);
  return NextResponse.json({ ok: true });
}
