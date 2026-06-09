import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { userQueries, calendarQueries } from '@/lib/db';
import { getOAuthClient } from '@/lib/calendar';
import { google, calendar_v3 } from 'googleapis';

const REMINDER_TITLE = 'Edg3 Morning Briefing';

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

// The recurring-master reminder event ids (so we can dedupe/replace/remove).
async function findReminderMasters(cal: calendar_v3.Calendar): Promise<string[]> {
  const res = await cal.events.list({ calendarId: 'primary', q: REMINDER_TITLE, singleEvents: false, maxResults: 50 }).catch(() => ({ data: { items: [] as calendar_v3.Schema$Event[] } }));
  return (res.data.items ?? []).filter(e => e.summary === REMINDER_TITLE && (e.recurrence?.length || e.recurringEventId)).map(e => e.id!).filter(Boolean);
}

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const cal = await getCal(user.id);
  if (!cal) return NextResponse.json({ exists: false, connected: false });
  const ids = await findReminderMasters(cal);
  return NextResponse.json({ exists: ids.length > 0, connected: true });
}

export async function DELETE() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const cal = await getCal(user.id);
  if (!cal) return NextResponse.json({ error: 'No calendar connected' }, { status: 400 });
  const ids = await findReminderMasters(cal);
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

  // Idempotent: remove any existing reminder first so re-adding (or a changed call time) doesn't duplicate.
  const existing = await findReminderMasters(cal);
  await Promise.all(existing.map(id => cal.events.delete({ calendarId: 'primary', eventId: id }).catch(() => undefined)));

  const callTime = fullUser.call_time || '07:00';
  const timezone = fullUser.timezone || 'America/Vancouver';
  const [hours, minutes] = callTime.split(':').map(Number);
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));
  const startLocal = new Date(now);
  startLocal.setHours(hours, minutes, 0, 0);
  if (startLocal <= now) startLocal.setDate(startLocal.getDate() + 1);
  const endLocal = new Date(startLocal);
  endLocal.setMinutes(endLocal.getMinutes() + 15);
  const pad = (n: number) => String(n).padStart(2, '0');
  const toLocalISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

  try {
    await cal.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: REMINDER_TITLE,
        description: 'Your daily AI Chief of Staff call. Edge calls you at this time every morning and adds a summary of each call here afterward.',
        start: { dateTime: toLocalISO(startLocal), timeZone: timezone },
        end: { dateTime: toLocalISO(endLocal), timeZone: timezone },
        colorId: '9',
        recurrence: ['RRULE:FREQ=DAILY'],
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 2 }] },
      },
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to create calendar reminder:', err);
    return NextResponse.json({ error: 'Failed to create calendar event' }, { status: 500 });
  }
}
