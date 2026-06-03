import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { scheduleBriefingCall } from '@/lib/scheduler';

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const briefingId = await scheduleBriefingCall(user.id);
    return NextResponse.json({ success: true, briefingId });
  } catch (err: any) {
    console.error('Call initiation error:', err);
    return NextResponse.json({ error: err.message || 'Failed to initiate call' }, { status: 500 });
  }
}
