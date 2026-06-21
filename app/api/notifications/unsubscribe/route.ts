import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { pushSubscriptionQueries } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

// POST /api/notifications/unsubscribe — remove a Web Push subscription by endpoint.
// Body: { endpoint }. No-op (still ok:true) if the endpoint wasn't stored.
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('pushSubscribe', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  let body: { endpoint?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const endpoint = body?.endpoint;
  if (typeof endpoint !== 'string') {
    return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
  }

  pushSubscriptionQueries.delete(user.id, endpoint);
  return NextResponse.json({ ok: true });
}
