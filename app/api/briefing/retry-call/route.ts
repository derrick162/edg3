import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { effectiveTimezone } from '@/lib/db';
import { scheduleBriefingCall, CallError } from '@/lib/scheduler';

export async function POST() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const tz = effectiveTimezone(user);
  const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: tz });

  const existing = db.prepare(`
    SELECT status FROM briefings
    WHERE user_id = ? AND scheduled_for LIKE ?
    ORDER BY scheduled_for DESC
    LIMIT 1
  `).get(user.id, `${todayLocal}%`) as { status: string } | undefined;

  if (existing?.status === 'completed') {
    return NextResponse.json({ error: 'Your call already completed today.' }, { status: 409 });
  }
  if (existing?.status === 'calling') {
    return NextResponse.json({ error: 'A call is already in progress.' }, { status: 409 });
  }

  try {
    const briefingId = await scheduleBriefingCall(user.id);
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
