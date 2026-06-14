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
    return NextResponse.json({ status: 'none' });
  }
  return NextResponse.json({ status: row.status, scheduledFor: row.scheduled_for });
}
