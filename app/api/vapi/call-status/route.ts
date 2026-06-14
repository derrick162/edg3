import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getTodayCallStatus } from '@/lib/scheduler';

// Returns today's call status for the authenticated user — used by the dashboard
// to show whether a briefing call has happened, is in progress, or failed (and why).
export async function GET(_req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const row = await getTodayCallStatus(user.id);
  if (!row) {
    return NextResponse.json({ status: 'none', errorCode: null, briefingId: null, scheduledFor: null });
  }

  return NextResponse.json({
    status: row.status,
    errorCode: row.error_code ?? null,
    briefingId: row.id,
    scheduledFor: row.scheduled_for,
  });
}
