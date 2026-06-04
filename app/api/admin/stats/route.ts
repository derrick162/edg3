import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

function checkAdminAuth(req: NextRequest): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD;
  const cookie = req.cookies.get('edg3_admin');
  return !!(adminPassword && cookie && cookie.value === adminPassword);
}

export async function GET(req: NextRequest) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);

    const totalUsers = (db.prepare(`SELECT COUNT(*) as count FROM users`).get() as { count: number }).count;
    const callsToday = (db.prepare(`SELECT COUNT(*) as count FROM briefings WHERE scheduled_for LIKE ?`).get(`${today}%`) as { count: number }).count;
    const completedToday = (db.prepare(`SELECT COUNT(*) as count FROM briefings WHERE scheduled_for LIKE ? AND status = 'completed'`).get(`${today}%`) as { count: number }).count;
    const missedToday = (db.prepare(`SELECT COUNT(*) as count FROM briefings WHERE scheduled_for LIKE ? AND status IN ('missed','failed')`).get(`${today}%`) as { count: number }).count;

    return NextResponse.json({ totalUsers, callsToday, completedToday, missedToday });
  } catch (err) {
    console.error('Admin stats error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
