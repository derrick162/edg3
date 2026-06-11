import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { scheduleOpenCall, CallError } from '@/lib/scheduler';

export async function POST() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const briefingId = await scheduleOpenCall(user.id);
    return NextResponse.json({ success: true, briefingId });
  } catch (err) {
    console.error('Open call initiation error:', err);
    if (err instanceof CallError) {
      return NextResponse.json({ error: err.userMessage, code: err.code }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : 'Failed to start open call';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
