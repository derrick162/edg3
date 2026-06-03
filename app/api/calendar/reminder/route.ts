import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { userQueries, calendarQueries } from '@/lib/db';
import { getOAuthClient } from '@/lib/calendar';
import { google } from 'googleapis';

export async function POST() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const fullUser = userQueries.findById(user.id);
  if (!fullUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const tokenRow = calendarQueries.get(user.id);
  if (!tokenRow) return NextResponse.json({ error: 'No calendar connected' }, { status: 400 });

  const callTime = (fullUser as any).call_time || '07:00';
  const timezone = fullUser.timezone || 'America/Vancouver';

  // Parse call time HH:MM
  const [hours, minutes] = callTime.split(':').map(Number);

  // Build next occurrence of that time in the user's timezone
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));
  const startLocal = new Date(now);
  startLocal.setHours(hours, minutes, 0, 0);
  // If already past today's call time, start tomorrow
  if (startLocal <= now) startLocal.setDate(startLocal.getDate() + 1);

  const endLocal = new Date(startLocal);
  endLocal.setMinutes(endLocal.getMinutes() + 15);

  // Format as local ISO strings without timezone offset (Google uses timeZone field separately)
  function toLocalISO(d: Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  }

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token || undefined,
    expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined,
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: 'Edg3 Morning Briefing',
      description: 'Your daily AI Chief of Staff call. Edge will call you at this time every morning.',
      start: { dateTime: toLocalISO(startLocal), timeZone: timezone },
      end: { dateTime: toLocalISO(endLocal), timeZone: timezone },
      colorId: '9',
      recurrence: ['RRULE:FREQ=DAILY'],
      reminders: {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: 2 }],
      },
    },
  });

  return NextResponse.json({ success: true });
}
