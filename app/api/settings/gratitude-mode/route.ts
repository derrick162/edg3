import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { userQueries } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

// R20 — gratitude mode toggle. When on, the open call becomes a warm 3-minute
// gratitude check-in instead of a productivity briefing. User-scoped via session.
export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const row = userQueries.findById(user.id);
  return NextResponse.json({ gratitudeMode: !!row?.gratitude_mode });
}

export async function PATCH(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('gratitudeMode', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  let body: { enabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
  }

  userQueries.setGratitudeMode(user.id, body.enabled);
  return NextResponse.json({ ok: true });
}
