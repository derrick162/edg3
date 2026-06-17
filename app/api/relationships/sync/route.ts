import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { userQueries } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { getPastCalendarEvents, getUpcomingEvents } from '@/lib/calendar';
import { syncPeopleProfiles } from '@/lib/relationships';

// 30 days of past events for interaction history
const PAST_DAYS = 30;

export async function POST() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('profileUpdate', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  const [pastEvents, upcomingEvents] = await Promise.all([
    getPastCalendarEvents(user.id, PAST_DAYS).catch(() => []),
    getUpcomingEvents(user.id, 14).catch(() => []),
  ]);

  const fullUser = userQueries.findById(user.id);
  await syncPeopleProfiles(user.id, pastEvents, upcomingEvents, fullUser?.email ?? null);

  return NextResponse.json({ ok: true });
}
