import { NextRequest, NextResponse } from 'next/server';
import { briefingQueries, getDb } from '@/lib/db';
import { getOAuthClient, getColorId } from '@/lib/calendar';
import { calendarQueries } from '@/lib/db';
import { google } from 'googleapis';

async function getCalendarClient(userId: number) {
  const tokenRow = calendarQueries.get(userId);
  if (!tokenRow) throw new Error('No calendar connected');
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token || undefined,
    expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined,
  });
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

async function getAllCalendarIds(calendar: any) {
  const list = await calendar.calendarList.list({ minAccessRole: 'reader' });
  return (list.data.items || []).filter((c: any) => !c.hidden).map((c: any) => c.id).filter(Boolean);
}

async function findEvent(calendar: any, calIds: string[], title: string, date: string) {
  const dayStart = new Date(`${date}T00:00:00Z`);
  const dayEnd = new Date(`${date}T23:59:59Z`);
  const normalize = (s: string) => s.replace(/^⚡\s*/, '').toLowerCase().trim();
  const titleNorm = normalize(title);

  for (const calId of calIds) {
    const res = await calendar.events.list({
      calendarId: calId,
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
      singleEvents: true,
    }).catch(() => ({ data: { items: [] } }));
    const events = res.data.items || [];
    const match = events.find((e: any) => normalize(e.summary || '').includes(titleNorm) || titleNorm.includes(normalize(e.summary || '')));
    if (match) return { event: match, calId };
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const message = body.message || body;
    const { type, call, functionCall } = message;

    if (type !== 'function-call' && type !== 'tool-calls') {
      return NextResponse.json({ received: true });
    }

    // Find user from call ID
    const db = getDb();
    const briefing = db.prepare('SELECT * FROM briefings WHERE vapi_call_id = ?').get(call?.id) as any;
    if (!briefing) return NextResponse.json({ result: 'Error: call not found' });

    const fn = functionCall?.name || message.toolCallList?.[0]?.function?.name;
    const args = functionCall?.parameters || JSON.parse(message.toolCallList?.[0]?.function?.arguments || '{}');

    console.log(`[tool-call] ${fn}(${JSON.stringify(args)}) for user ${briefing.user_id}`);

    const calendar = await getCalendarClient(briefing.user_id);
    const calIds = await getAllCalendarIds(calendar);

    let result = '';

    if (fn === 'readCalendar') {
      const { startDate, endDate } = args;
      const events: any[] = [];
      for (const calId of calIds) {
        const res = await calendar.events.list({
          calendarId: calId,
          timeMin: new Date(`${startDate}T00:00:00Z`).toISOString(),
          timeMax: new Date(`${endDate}T23:59:59Z`).toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 50,
        }).catch(() => ({ data: { items: [] } }));
        events.push(...(res.data.items || []));
      }
      events.sort((a, b) => (a.start?.dateTime || a.start?.date || '').localeCompare(b.start?.dateTime || b.start?.date || ''));
      const summary = events.map(e => `- ${e.summary}: ${e.start?.dateTime?.slice(0, 16) || e.start?.date || 'all day'}`).join('\n');
      result = events.length ? summary : 'No events found for that period.';

    } else if (fn === 'createEvent') {
      const { title, startDateTime, endDateTime, timezone, color } = args;

      // Conflict check before creating
      const date = startDateTime.slice(0, 10);
      const conflicts: string[] = [];
      for (const calId of calIds) {
        const res = await calendar.events.list({
          calendarId: calId,
          timeMin: new Date(`${startDateTime}Z`).toISOString(),
          timeMax: new Date(`${endDateTime}Z`).toISOString(),
          singleEvents: true,
        }).catch(() => ({ data: { items: [] } }));
        for (const ev of (res.data.items || [])) {
          const isPlaceholder = /\b(hold|block|tentative|maybe|tbd)\b/i.test(ev.summary || '');
          if (!isPlaceholder && ev.summary !== `⚡ ${title}`) conflicts.push(ev.summary || 'Untitled');
        }
      }
      if (conflicts.length > 0) {
        result = `⚠️ Conflict: "${conflicts.join('", "')}" already exists at that time. Should I still create "${title}" or pick a different time?`;
      } else {
        const requestBody: any = {
          summary: `⚡ ${title}`,
          start: { dateTime: startDateTime, timeZone: timezone },
          end: { dateTime: endDateTime, timeZone: timezone },
          colorId: '9',
        };
        if (color) requestBody.colorId = getColorId(color);
        await calendar.events.insert({ calendarId: 'primary', requestBody });
        result = `Created "${title}" on ${date} at ${startDateTime.slice(11, 16)} ${timezone}.`;
      }

    } else if (fn === 'deleteEvent') {
      const { title, date, deleteAll } = args;
      const found = [];
      for (const calId of calIds) {
        const res = await calendar.events.list({
          calendarId: calId,
          timeMin: new Date(`${date}T00:00:00Z`).toISOString(),
          timeMax: new Date(`${date}T23:59:59Z`).toISOString(),
          singleEvents: true,
        }).catch(() => ({ data: { items: [] } }));
        const normalize = (s: string) => s.replace(/^⚡\s*/, '').toLowerCase().trim();
        const titleNorm = normalize(title);
        const matches = (res.data.items || []).filter((e: any) =>
          normalize(e.summary || '').includes(titleNorm) || titleNorm.includes(normalize(e.summary || ''))
        );
        for (const ev of (deleteAll ? matches : matches.slice(0, 1))) {
          await calendar.events.delete({ calendarId: calId, eventId: ev.id }).catch(() => {});
          found.push(ev.summary);
        }
      }
      result = found.length ? `Deleted: ${found.join(', ')}` : `No event matching "${title}" found on ${date}.`;

    } else if (fn === 'moveEvent') {
      const { title, date, newStartDateTime, newEndDateTime, timezone } = args;
      const found = await findEvent(calendar, calIds, title, date);
      if (!found) {
        result = `No event matching "${title}" found on ${date}.`;
      } else {
        const requestBody: any = {
          start: { dateTime: newStartDateTime, timeZone: timezone },
          end: { dateTime: newEndDateTime, timeZone: timezone },
        };
        if (found.event.colorId) requestBody.colorId = found.event.colorId;
        await calendar.events.patch({ calendarId: found.calId, eventId: found.event.id, requestBody });
        result = `Moved "${found.event.summary}" to ${newStartDateTime.slice(11, 16)} ${timezone} on ${newStartDateTime.slice(0, 10)}.`;
      }

    } else if (fn === 'createRecurringEvent') {
      const { title, startTime, endTime, timezone, color, recurrence, startDate, endDate } = args;
      // Build RRULE — e.g. FREQ=WEEKLY;BYDAY=MO,WE,FR or FREQ=DAILY
      const rrule = recurrence || 'FREQ=DAILY';
      const untilDate = endDate ? endDate.replace(/-/g, '') : '';
      const fullRrule = untilDate ? `RRULE:${rrule};UNTIL=${untilDate}` : `RRULE:${rrule}`;

      const requestBody: any = {
        summary: `⚡ ${title}`,
        start: { dateTime: `${startDate}T${startTime}:00`, timeZone: timezone },
        end: { dateTime: `${startDate}T${endTime}:00`, timeZone: timezone },
        recurrence: [fullRrule],
        colorId: color ? getColorId(color) : '9',
      };
      await calendar.events.insert({ calendarId: 'primary', requestBody });
      result = `Created recurring "${title}" starting ${startDate} at ${startTime} ${timezone} (${rrule}${untilDate ? ` until ${endDate}` : ''}).`;

    } else if (fn === 'colorEvent') {
      const { title, date, color } = args;
      const colorId = getColorId(color);
      let count = 0;
      for (const calId of calIds) {
        const timeMin = date === 'all' ? new Date().toISOString() : new Date(`${date}T00:00:00Z`).toISOString();
        const timeMax = date === 'all' ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : new Date(`${date}T23:59:59Z`).toISOString();
        const res = await calendar.events.list({ calendarId: calId, timeMin, timeMax, singleEvents: true, maxResults: 100 }).catch(() => ({ data: { items: [] } }));
        const normalize = (s: string) => s.replace(/^⚡\s*/, '').toLowerCase().trim();
        const titleNorm = normalize(title);
        const matches = (res.data.items || []).filter((e: any) =>
          normalize(e.summary || '').includes(titleNorm) || titleNorm.includes(normalize(e.summary || ''))
        );
        for (const ev of matches) {
          await calendar.events.patch({ calendarId: calId, eventId: ev.id, requestBody: { colorId } }).catch(() => {});
          count++;
        }
      }
      result = count ? `Changed ${count} "${title}" event(s) to ${color}.` : `No events matching "${title}" found.`;
    }

    console.log(`[tool-call] Result: ${result}`);
    return NextResponse.json({ result });

  } catch (err) {
    console.error('[tool-call] Error:', err);
    return NextResponse.json({ result: `Error: ${String(err)}` });
  }
}
