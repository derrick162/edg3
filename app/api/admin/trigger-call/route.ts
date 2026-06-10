import { NextRequest, NextResponse } from 'next/server';
import { scheduleBriefingCall } from '@/lib/scheduler';
import { checkRateLimit, getClientIP, rateLimitResponse } from '@/lib/rateLimit';
import { checkAdminAuth } from '@/lib/adminAuth';

export async function POST(req: NextRequest) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rate limit: 3 trigger-calls per 5 min per IP — each call costs real Vapi minutes.
  const ip = getClientIP(req);
  const rl = checkRateLimit('triggerCall', ip);
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  try {
    const { userId } = await req.json();
    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }

    const briefingId = await scheduleBriefingCall(Number(userId));
    return NextResponse.json({ success: true, briefingId });
  } catch (err) {
    console.error('Admin trigger call error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
