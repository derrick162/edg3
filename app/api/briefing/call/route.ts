import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { scheduleBriefingCall, CallError } from '@/lib/scheduler';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('briefingCall', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  try {
    // Manual "Call me now" is an explicit user request — force past the once-a-day guard
    // (e.g. when an earlier call was wrongly marked completed after hitting voicemail).
    const briefingId = await scheduleBriefingCall(user.id, { force: true });
    return NextResponse.json({ success: true, briefingId });
  } catch (err) {
    console.error('Call initiation error:', err);
    if (err instanceof CallError) {
      return NextResponse.json({ error: err.userMessage, code: err.code }, { status: 503 });
    }
    return NextResponse.json({ error: 'Failed to initiate call — please try again shortly.' }, { status: 500 });
  }
}
