import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { scheduleBriefingCall, CallError } from '@/lib/scheduler';

export async function POST() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // "I didn't get my call" / retry is an explicit user request — force past the once-a-day
    // guard (an earlier call may have been wrongly marked completed after voicemail).
    // scheduleBriefingCall still blocks a genuine in-flight double-click (call started <3 min ago).
    const briefingId = await scheduleBriefingCall(user.id, { force: true });
    console.log(`[retry-call] Initiated retry call for user ${user.id} — briefing ${briefingId}`);
    return NextResponse.json({ success: true, briefingId });
  } catch (err) {
    if (err instanceof CallError) {
      return NextResponse.json({ error: err.userMessage, code: err.code }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : 'Failed to initiate call';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
