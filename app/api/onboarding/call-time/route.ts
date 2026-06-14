import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { userQueries } from '@/lib/db';
import { resyncBriefingReminder } from '@/lib/calendar';

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { call_time?: string; timezone?: string; phone_number?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { call_time, timezone, phone_number } = body;

  if (!call_time || !timezone) {
    return NextResponse.json({ error: 'Call time and timezone required' }, { status: 400 });
  }

  userQueries.updateCallTime(user.id, call_time, timezone);

  // Store phone number if provided
  if (phone_number) {
    const db = (await import('@/lib/db')).getDb();
    db.prepare('UPDATE users SET phone_number = ? WHERE id = ?').run(phone_number, user.id);
  }

  userQueries.completeOnboarding(user.id);

  // Sync the recurring calendar reminder to the new call time — fire-and-forget.
  // Only updates if the user already has a reminder set up; never force-creates one.
  resyncBriefingReminder(user.id).catch(err =>
    console.error('[call-time] resyncBriefingReminder failed:', err),
  );

  return NextResponse.json({ success: true });
}
