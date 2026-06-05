import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getOAuthClient, getColorId } from '@/lib/calendar';
import { calendarQueries, userQueries, priorityQueries } from '@/lib/db';
import { google, calendar_v3 } from 'googleapis';
import Anthropic from '@anthropic-ai/sdk';

function resolveNaturalTime(timeStr: string): string {
  const t = timeStr.toLowerCase().trim();
  const map: Record<string, string> = {
    'early morning': '06:00', 'morning': '09:00', 'mid morning': '10:00', 'late morning': '11:00',
    'noon': '12:00', 'midday': '12:00', 'lunch': '12:00', 'lunchtime': '12:00',
    'early afternoon': '13:00', 'afternoon': '14:00', 'mid afternoon': '15:00', 'late afternoon': '16:00',
    'end of day': '17:00', 'eod': '17:00', 'evening': '18:00', 'dinner': '19:00',
    'night': '20:00', 'late night': '22:00',
    'first thing': '07:00', 'first thing in the morning': '07:00',
  };
  if (map[t]) return map[t];
  if (/^\d{1,2}:\d{2}$/.test(timeStr)) return timeStr.padStart(5, '0');
  const match = timeStr.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (match) {
    let h = parseInt(match[1]);
    const m = match[2] ? parseInt(match[2]) : 0;
    const ampm = match[3]?.toLowerCase();
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  return timeStr;
}

async function getCalClient(userId: number) {
  const tokenRow = calendarQueries.get(userId);
  if (!tokenRow) throw new Error('No calendar connected');
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token ?? undefined,
    expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined,
  });
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

async function getCalIds(cal: calendar_v3.Calendar): Promise<string[]> {
  const list = await cal.calendarList.list({ minAccessRole: 'reader' });
  return (list.data.items ?? [])
    .filter((c) => !c.hidden)
    .map((c) => c.id!)
    .filter(Boolean);
}

function normTitle(s: string) { return s.replace(/^⚡\s*/, '').toLowerCase().replace(/\s+/g, '').trim(); }

async function findEv(cal: calendar_v3.Calendar, calIds: string[], title: string, date: string) {
  const tMin = new Date(`${date}T00:00:00Z`).toISOString();
  const tMax = new Date(`${date}T23:59:59Z`).toISOString();
  const tn = normTitle(title);
  for (const calId of calIds) {
    const res = await cal.events.list({ calendarId: calId, timeMin: tMin, timeMax: tMax, singleEvents: true }).catch(() => ({ data: { items: [] as calendar_v3.Schema$Event[] } }));
    const match = (res.data.items ?? []).find((e) => normTitle(e.summary ?? '').includes(tn) || tn.includes(normTitle(e.summary ?? '')));
    if (match) return { event: match, calId };
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const message = body.message ?? body;
    const { type, call, functionCall } = message;

    if (type !== 'function-call' && type !== 'tool-calls') {
      return NextResponse.json({ received: true });
    }

    const db = getDb();
    const briefing = db.prepare('SELECT * FROM briefings WHERE vapi_call_id = ?').get(call?.id) as { id: number; user_id: number } | undefined;
    if (!briefing) return NextResponse.json({ result: 'Error: call not found' });

    const fn: string = functionCall?.name ?? message.toolCallList?.[0]?.function?.name ?? '';
    const argsRaw: string = functionCall?.parameters ?? message.toolCallList?.[0]?.function?.arguments ?? '{}';
    const args = typeof argsRaw === 'string' ? JSON.parse(argsRaw) : argsRaw;

    console.log(`[tool-call] ${fn}(${JSON.stringify(args)}) user=${briefing.user_id}`);

    const cal = await getCalClient(briefing.user_id);
    const calIds = await getCalIds(cal);
    let result = '';

    if (fn === 'readCalendar') {
      const { startDate, endDate } = args as { startDate: string; endDate: string };
      const events: calendar_v3.Schema$Event[] = [];
      for (const calId of calIds) {
        const res = await cal.events.list({ calendarId: calId, timeMin: new Date(`${startDate}T00:00:00Z`).toISOString(), timeMax: new Date(`${endDate}T23:59:59Z`).toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 50 }).catch(() => ({ data: { items: [] as calendar_v3.Schema$Event[] } }));
        events.push(...(res.data.items ?? []));
      }
      events.sort((a, b) => (a.start?.dateTime ?? a.start?.date ?? '').localeCompare(b.start?.dateTime ?? b.start?.date ?? ''));
      if (!events.length) {
        result = 'No events found for that period.';
      } else {
        // Group by day for cleaner output
        const byDay = new Map<string, string[]>();
        for (const e of events) {
          const day = (e.start?.dateTime ?? e.start?.date ?? '').slice(0, 10);
          const dayDate = new Date(`${day}T12:00:00Z`);
          const dayLabel = dayDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
          const time = e.start?.dateTime ? e.start.dateTime.slice(11, 16) : 'all day';
          const recurring = e.recurringEventId ? ' (recurring)' : '';
          if (!byDay.has(dayLabel)) byDay.set(dayLabel, []);
          byDay.get(dayLabel)!.push(`  ${time}: ${e.summary}${recurring}`);
        }
        result = Array.from(byDay.entries()).map(([day, evs]) => `${day}:\n${evs.join('\n')}`).join('\n\n');
      }

    } else if (fn === 'createEvent') {
      let { title, startDateTime, endDateTime, timezone, color } = args as { title: string; startDateTime: string; endDateTime: string; timezone: string; color?: string };
      if (startDateTime && !startDateTime.includes('T')) {
        const date = new Date().toLocaleDateString('en-CA');
        startDateTime = `${date}T${resolveNaturalTime(startDateTime)}:00`;
        if (!endDateTime?.includes('T')) {
          const [h] = resolveNaturalTime(endDateTime ?? startDateTime).split(':').map(Number);
          endDateTime = `${date}T${String(h + 1).padStart(2, '0')}:00:00`;
        }
      }
      const conflicts: string[] = [];
      for (const calId of calIds) {
        const res = await cal.events.list({ calendarId: calId, timeMin: new Date(`${startDateTime}Z`).toISOString(), timeMax: new Date(`${endDateTime}Z`).toISOString(), singleEvents: true }).catch(() => ({ data: { items: [] as calendar_v3.Schema$Event[] } }));
        for (const ev of (res.data.items ?? [])) {
          if (!/\b(hold|block|tentative|maybe|tbd)\b/i.test(ev.summary ?? '') && ev.summary !== `⚡ ${title}`) conflicts.push(ev.summary ?? 'Untitled');
        }
      }
      if (conflicts.length > 0) {
        result = `⚠️ Conflict: "${conflicts.join('", "')}" already at that time. Still create "${title}"?`;
      } else {
        const rb: calendar_v3.Schema$Event = { summary: `⚡ ${title}`, start: { dateTime: startDateTime, timeZone: timezone }, end: { dateTime: endDateTime, timeZone: timezone }, colorId: color ? getColorId(color) : '9' };
        await cal.events.insert({ calendarId: 'primary', requestBody: rb });
        result = `Created "${title}" on ${startDateTime.slice(0, 10)} at ${startDateTime.slice(11, 16)} ${timezone}.`;
      }

    } else if (fn === 'createRecurringEvent') {
      const { title, startTime, endTime, timezone, color, recurrence, startDate, endDate } = args as { title: string; startTime: string; endTime: string; timezone: string; color?: string; recurrence: string; startDate: string; endDate?: string };
      const untilDate = endDate ? endDate.replace(/-/g, '') : '';
      const fullRrule = untilDate ? `RRULE:${recurrence};UNTIL=${untilDate}` : `RRULE:${recurrence}`;
      const rb: calendar_v3.Schema$Event = { summary: `⚡ ${title}`, start: { dateTime: `${startDate}T${startTime}:00`, timeZone: timezone }, end: { dateTime: `${startDate}T${endTime}:00`, timeZone: timezone }, recurrence: [fullRrule], colorId: color ? getColorId(color) : '9' };
      await cal.events.insert({ calendarId: 'primary', requestBody: rb });
      result = `Created recurring "${title}" from ${startDate} at ${startTime} ${timezone}.`;

    } else if (fn === 'deleteEvent') {
      const { title, date, deleteAll, recurringScope } = args as { title: string; date: string; deleteAll?: boolean; recurringScope?: 'this' | 'thisAndFollowing' | 'all' };
      const deleted: string[] = [];
      for (const calId of calIds) {
        const res = await cal.events.list({ calendarId: calId, timeMin: new Date(`${date}T00:00:00Z`).toISOString(), timeMax: new Date(`${date}T23:59:59Z`).toISOString(), singleEvents: true, showHiddenInvitations: true }).catch(() => ({ data: { items: [] as calendar_v3.Schema$Event[] } }));
        const tn = normTitle(title);
        const matches = (res.data.items ?? []).filter(e => normTitle(e.summary ?? '').includes(tn) || tn.includes(normTitle(e.summary ?? '')));
        for (const ev of (deleteAll ? matches : matches.slice(0, 1))) {
          // Check if recurring
          if (ev.recurringEventId && !recurringScope) {
            result = `"${ev.summary}" is a recurring event. Should I delete just this occurrence, this and all future ones, or all occurrences? Say "just this one", "this and future", or "all".`;
            break;
          }
          const sendUpdates = 'none';
          if (ev.recurringEventId && recurringScope === 'thisAndFollowing') {
            // Delete this and following by updating the series end date
            await cal.events.patch({ calendarId: calId, eventId: ev.recurringEventId, requestBody: { recurrence: [`RRULE:FREQ=DAILY;UNTIL=${date.replace(/-/g,'')}`] } }).catch(() => undefined);
          } else if (ev.recurringEventId && recurringScope === 'all') {
            await cal.events.delete({ calendarId: calId, eventId: ev.recurringEventId }).catch(() => undefined);
          } else {
            await cal.events.delete({ calendarId: calId, eventId: ev.id! }).catch(() => undefined);
          }
          deleted.push(ev.summary ?? ev.id!);
        }
        if (result) break;
      }
      if (!result) result = deleted.length ? `Deleted: ${deleted.join(', ')}` : `No event matching "${title}" on ${date}.`;

    } else if (fn === 'moveEvent') {
      const { title, date, newStartDateTime, newEndDateTime, timezone, recurringScope } = args as { title: string; date: string; newStartDateTime: string; newEndDateTime: string; timezone: string; recurringScope?: 'this' | 'all' };
      const found = await findEv(cal, calIds, title, date);
      if (!found) {
        result = `No event matching "${title}" on ${date}.`;
      } else if (found.event.recurringEventId && !recurringScope) {
        result = `"${found.event.summary}" is a recurring event. Should I move just this occurrence or all occurrences? Say "just this one" or "all".`;
      } else {
        const eventId = (recurringScope === 'all' && found.event.recurringEventId) ? found.event.recurringEventId : found.event.id!;
        const rb: calendar_v3.Schema$Event = { start: { dateTime: newStartDateTime, timeZone: timezone }, end: { dateTime: newEndDateTime, timeZone: timezone } };
        if (found.event.colorId) rb.colorId = found.event.colorId;
        await cal.events.patch({ calendarId: found.calId, eventId, requestBody: rb });
        result = `Moved "${found.event.summary}" to ${newStartDateTime.slice(11, 16)} ${timezone} on ${newStartDateTime.slice(0, 10)}${recurringScope === 'all' ? ' (all occurrences)' : ''}.`;
      }

    } else if (fn === 'colorEvent') {
      const { title, date, color } = args as { title: string; date: string; color: string };
      const colorId = getColorId(color);
      let count = 0;
      for (const calId of calIds) {
        const tMin = date === 'all' ? new Date().toISOString() : new Date(`${date}T00:00:00Z`).toISOString();
        const tMax = date === 'all' ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : new Date(`${date}T23:59:59Z`).toISOString();
        const res = await cal.events.list({ calendarId: calId, timeMin: tMin, timeMax: tMax, singleEvents: true, maxResults: 100 }).catch(() => ({ data: { items: [] as calendar_v3.Schema$Event[] } }));
        const tn = normTitle(title);
        for (const ev of (res.data.items ?? []).filter(e => normTitle(e.summary ?? '').includes(tn) || tn.includes(normTitle(e.summary ?? '')))) {
          await cal.events.patch({ calendarId: calId, eventId: ev.id!, requestBody: { colorId } }).catch(() => undefined);
          count++;
        }
      }
      result = count ? `Changed ${count} "${title}" event(s) to ${color}.` : `No events matching "${title}" found.`;

    } else if (fn === 'planWeek') {
      const { weekStartDate, focusHoursPerDay, preferences } = args as { weekStartDate: string; focusHoursPerDay?: number; preferences?: string };
      const user = userQueries.findById(briefing.user_id);
      if (!user) {
        result = 'User not found';
      } else {
        const { format, startOfWeek } = await import('date-fns');
        const weekOf = format(startOfWeek(new Date(weekStartDate)), 'yyyy-MM-dd');
        const priorities = priorityQueries.getThisWeek(briefing.user_id, weekOf);
        const priorityText = priorities.map((p, i) => `${i + 1}. ${(p as { text: string }).text}`).join(', ') || 'No priorities set';
        const weekEnd = new Date(weekStartDate);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const weekEndStr = weekEnd.toLocaleDateString('en-CA');
        const allEvents: calendar_v3.Schema$Event[] = [];
        for (const calId of calIds) {
          const res = await cal.events.list({ calendarId: calId, timeMin: new Date(`${weekStartDate}T00:00:00Z`).toISOString(), timeMax: new Date(`${weekEndStr}T23:59:59Z`).toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 100 }).catch(() => ({ data: { items: [] as calendar_v3.Schema$Event[] } }));
          allEvents.push(...(res.data.items ?? []));
        }
        const eventSummary = allEvents.map(e => `- ${e.summary}: ${e.start?.dateTime?.slice(0, 16) ?? e.start?.date ?? 'all day'}`).join('\n') || 'No events';
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const planResult = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001', max_tokens: 600,
          messages: [{ role: 'user', content: `Plan this week. Priorities: ${priorityText}. Focus ${focusHoursPerDay ?? 2}h/day. Prefs: ${preferences ?? 'none'}. ${weekStartDate}-${weekEndStr}. TZ: ${user.timezone}.\n\nEXISTING:\n${eventSummary}\n\nReturn JSON array of new focus blocks (3-5 max):\n[{"title":"name","startDateTime":"YYYY-MM-DDTHH:MM:00","endDateTime":"YYYY-MM-DDTHH:MM:00"}]` }],
        });
        const planText = planResult.content[0].type === 'text' ? planResult.content[0].text : '[]';
        const planMatch = planText.match(/\[[\s\S]*\]/);
        const planEvents: Array<{ title: string; startDateTime: string; endDateTime: string }> = planMatch ? JSON.parse(planMatch[0]) : [];
        const created: string[] = [];
        for (const ev of planEvents) {
          try {
            await cal.events.insert({ calendarId: 'primary', requestBody: { summary: `⚡ ${ev.title}`, start: { dateTime: ev.startDateTime, timeZone: user.timezone }, end: { dateTime: ev.endDateTime, timeZone: user.timezone }, colorId: '9' } });
            created.push(`${ev.title} (${ev.startDateTime.slice(5, 10)} ${ev.startDateTime.slice(11, 16)})`);
          } catch (_e) { /* skip conflicts */ }
        }
        result = created.length ? `Planned your week! Added: ${created.join(', ')}. Priorities: ${priorityText}.` : 'Week fully packed — no free slots.';
      }
    }

    console.log(`[tool-call] Result: ${result}`);

    // Append to tool_actions log on the briefing
    if (result && !result.startsWith('Error:')) {
      try {
        const existing = db.prepare('SELECT tool_actions FROM briefings WHERE id = ?').get(briefing.id) as { tool_actions: string | null } | undefined;
        const actions = existing?.tool_actions ? JSON.parse(existing.tool_actions) : [];
        actions.push({ fn, args, result, ts: new Date().toISOString() });
        db.prepare('UPDATE briefings SET tool_actions = ? WHERE id = ?').run(JSON.stringify(actions), briefing.id);
      } catch (_e) { /* non-critical */ }
    }

    return NextResponse.json({ result });

  } catch (err) {
    const msg = String(err);
    console.error('[tool-call] Error:', msg);
    // Return a user-friendly error Edge can read out
    const friendly = msg.includes('No calendar connected')
      ? "I can't access your calendar right now — it may need to be reconnected in the dashboard."
      : msg.includes('insufficientPermissions') || msg.includes('403')
      ? "I don't have permission to make that change — you may need to reconnect your calendar."
      : msg.includes('notFound') || msg.includes('404')
      ? "I couldn't find that event to modify it."
      : "Something went wrong — you'll need to make that change manually in your calendar.";
    return NextResponse.json({ result: friendly });
  }
}
