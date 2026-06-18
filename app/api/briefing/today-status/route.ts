import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { effectiveTimezone } from '@/lib/db';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const tz = effectiveTimezone(user);
  const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD

  const row = db.prepare(`
    SELECT status, scheduled_for
    FROM briefings
    WHERE user_id = ? AND scheduled_for LIKE ?
    ORDER BY scheduled_for DESC
    LIMIT 1
  `).get(user.id, `${todayLocal}%`) as { status: string; scheduled_for: string } | undefined;

  if (!row) {
    // No briefing row for today — check if the call window has already passed.
    // If so, the scheduler silently failed (no pending/failed row was ever created),
    // and the user should see a 'missed' status with the retry button rather than nothing.
    if (user.call_time) {
      const nowLocal = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
      const [callH, callM] = user.call_time.split(':').map(Number);
      const callMinutes = callH * 60 + callM;
      const nowMinutes = nowLocal.getHours() * 60 + nowLocal.getMinutes();
      // Show 'missed' if at least 10 minutes past call time (avoids false positive on first load)
      if (nowMinutes >= callMinutes + 10) {
        return NextResponse.json({ status: 'missed' });
      }
    }
    return NextResponse.json({ status: 'none' });
  }
  return NextResponse.json({ status: row.status, scheduledFor: row.scheduled_for });
}
