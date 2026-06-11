import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { scheduleBriefingCall, CallError } from '@/lib/scheduler';

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const briefingId = await scheduleBriefingCall(user.id);
    return NextResponse.json({ success: true, briefingId });
  } catch (err) {
    console.error('Call initiation error:', err);
    if (err instanceof CallError) {
      return NextResponse.json({ error: err.userMessage, code: err.code }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : 'Failed to initiate call';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
