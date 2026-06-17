import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { scheduleOpenCall, CallError } from '@/lib/scheduler';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

export async function POST() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('openCall', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  try {
    const briefingId = await scheduleOpenCall(user.id);
    return NextResponse.json({ success: true, briefingId });
  } catch (err) {
    console.error('Open call initiation error:', err);
    if (err instanceof CallError) {
      return NextResponse.json({ error: err.userMessage, code: err.code }, { status: 503 });
    }
    return NextResponse.json({ error: 'Failed to start call — please try again shortly.' }, { status: 500 });
  }
}
