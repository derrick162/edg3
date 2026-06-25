import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { checkAdminAuth } from '@/lib/adminAuth';

function getNextCallTime(callTime: string, timezone: string): string {
  try {
    const now = new Date();
    const [hh, mm] = callTime.split(':').map(Number);

    // Get current time in user's timezone
    const userNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    const candidate = new Date(userNow);
    candidate.setHours(hh, mm, 0, 0);

    // If the time has already passed today, schedule for tomorrow
    if (candidate <= userNow) {
      candidate.setDate(candidate.getDate() + 1);
    }

    // Convert back to UTC for display
    const diffMs = candidate.getTime() - userNow.getTime();
    const diffMins = Math.round(diffMs / 60000);

    if (diffMins < 60) return `in ${diffMins}m`;
    if (diffMins < 1440) {
      const h = Math.floor(diffMins / 60);
      const m = diffMins % 60;
      return `in ${h}h${m > 0 ? ` ${m}m` : ''}`;
    }
    return `tomorrow at ${callTime}`;
  } catch {
    return callTime;
  }
}

export async function GET(req: NextRequest) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getDb();

    const users = db.prepare(`SELECT * FROM users ORDER BY created_at DESC`).all() as Array<{
      id: number;
      name: string;
      email: string;
      call_time: string;
      timezone: string;
      phone_number: string | null;
      onboarding_complete: number;
      created_at: string;
    }>;

    const result = users.map(user => {
      const lastBriefing = db.prepare(`
        SELECT scheduled_for, status FROM briefings
        WHERE user_id = ?
        ORDER BY scheduled_for DESC LIMIT 1
      `).get(user.id) as { scheduled_for: string; status: string } | undefined;

      const totalBriefings = (db.prepare(`
        SELECT COUNT(*) as count FROM briefings WHERE user_id = ?
      `).get(user.id) as { count: number }).count;

      const completedBriefings = (db.prepare(`
        SELECT COUNT(*) as count FROM briefings WHERE user_id = ? AND status = 'completed'
      `).get(user.id) as { count: number }).count;

      // S3 — active-fact count per user, for the multi-user admin overview.
      const totalFacts = (db.prepare(`
        SELECT COUNT(*) as count FROM facts WHERE user_id = ? AND valid_until IS NULL
      `).get(user.id) as { count: number }).count;

      const nextCall = user.call_time && user.timezone
        ? getNextCallTime(user.call_time, user.timezone)
        : null;

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        call_time: user.call_time,
        timezone: user.timezone,
        phone_number: user.phone_number,
        onboarding_complete: user.onboarding_complete,
        created_at: user.created_at,
        last_briefing: lastBriefing || null,
        next_call: nextCall,
        total_briefings: totalBriefings,
        completed_briefings: completedBriefings,
        total_facts: totalFacts,
      };
    });

    return NextResponse.json({ users: result });
  } catch (err) {
    console.error('Admin users error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
