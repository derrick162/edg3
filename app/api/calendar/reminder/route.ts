import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { userQueries, calendarQueries } from '@/lib/db';
import { getOAuthClient, BRIEFING_REMINDER_TITLE, buildBriefingReminderBody, findBriefingReminderMasters } from '@/lib/calendar';
import { google, calendar_v3 } from 'googleapis';

async function getCal(userId: number): Promise<calendar_v3.Calendar | null> {
  const tokenRow = calendarQueries.get(userId);
  if (!tokenRow) return null;
  const o = getOAuthClient();
  o.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token || undefined,
    expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined,
  });
  return google.calendar({ version: 'v3', auth: o });
}

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const cal = await getCal(user.id);
  if (!cal) return NextResponse.json({ exists: false, connected: false });
  const ids = await findBriefingReminderMasters(cal);
  return NextResponse.json({ exists: ids.length > 0, connected: true });
}

export async function DELETE() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const cal = await getCal(user.id);
  if (!cal) return NextResponse.json({ error: 'No calendar connected' }, { status: 400 });
  const ids = await findBriefingReminderMasters(cal);
  await Promise.all(ids.map(id => cal.events.delete({ calendarId: 'primary', eventId: id }).catch(() => undefined)));
  return NextResponse.json({ success: true, removed: ids.length });
}

export async function POST() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const fullUser = userQueries.findById(user.id);
  if (!fullUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  const cal = await getCal(user.id);
  if (!cal) return NextResponse.json({ error: 'No calendar connected' }, { status: 400 });

  // Idempotent: remove any existing reminder first so re-adding never duplicates.
  const existing = await findBriefingReminderMasters(cal);
  await Promise.all(existing.map(id => cal.events.delete({ calendarId: 'primary', eventId: id }).catch(() => undefined)));

  try {
    await cal.events.insert({
      calendarId: 'primary',
      requestBody: buildBriefingReminderBody(fullUser.call_time || '07:00', fullUser.timezone || 'America/Vancouver'),
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(`[reminder] Failed to create ${BRIEFING_REMINDER_TITLE}:`, err);
    return NextResponse.json({ error: 'Failed to create calendar event' }, { status: 500 });
  }
}
