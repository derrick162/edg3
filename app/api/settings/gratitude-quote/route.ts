import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { userQueries } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

// R21 — gratitude-call daily quote: optional themed quote spoken before "Good morning".
// User-scoped via session.
export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json(userQueries.getGratitudeQuote(user.id));
}

export async function PATCH(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('gratitudeMode', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  let body: { enabled?: unknown; theme?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
  }
  if (typeof body.theme !== 'string') {
    return NextResponse.json({ error: 'theme must be a string' }, { status: 400 });
  }
  const theme = body.theme.trim() || 'resilience';
  if (theme.length > 100) {
    return NextResponse.json({ error: 'theme must be 100 characters or fewer' }, { status: 400 });
  }

  userQueries.setGratitudeQuote(user.id, body.enabled, theme);
  return NextResponse.json({ ok: true });
}
