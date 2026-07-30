import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { scheduleJournalCall, CallError } from '@/lib/scheduler';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

// POST /api/journal/call — Edge phones the user to start a verbal-journaling session.
// The call is recorded + transcribed and saved as a journal entry (see the Vapi webhook).
export async function POST() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Reuse the on-demand-call rate-limit bucket (same abuse surface as an open call).
  const rl = checkRateLimit('openCall', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  try {
    const briefingId = await scheduleJournalCall(user.id);
    return NextResponse.json({ success: true, briefingId });
  } catch (err) {
    console.error('Journal call initiation error:', err);
    if (err instanceof CallError) {
      return NextResponse.json({ error: err.userMessage, code: err.code }, { status: 503 });
    }
    return NextResponse.json({ error: 'Failed to start journal call — please try again shortly.' }, { status: 500 });
  }
}
