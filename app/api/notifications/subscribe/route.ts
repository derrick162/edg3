import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { pushSubscriptionQueries } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

// POST /api/notifications/subscribe — store a Web Push subscription for the authenticated user.
// Body: a W3C PushSubscription JSON: { endpoint, keys: { p256dh, auth } }. Idempotent upsert.
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('pushSubscribe', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  let body: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (typeof endpoint !== 'string' || typeof p256dh !== 'string' || typeof auth !== 'string') {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
  }

  pushSubscriptionQueries.upsert(user.id, endpoint, p256dh, auth);
  return NextResponse.json({ ok: true });
}
