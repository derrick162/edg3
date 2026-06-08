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

// Convert a wall-clock local datetime ("YYYY-MM-DDTHH:MM:SS", no offset) in an IANA timezone
// to the correct UTC instant. The old approach appended 'Z', which wrongly treated the user's
// local time as UTC and shifted conflict windows by the zone offset.
function zonedWallTimeToUtc(localDateTime: string, timeZone: string): Date {
  const guess = new Date(`${localDateTime}Z`);
  if (isNaN(guess.getTime())) return new Date(localDateTime);
  const offsetAt = (instant: Date): number => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(instant);
    const m: Record<string, number> = {};
    for (const p of parts) if (p.type !== 'literal') m[p.type] = Number(p.value);
    return Date.UTC(m.year, m.month - 1, m.day, m.hour, m.minute, m.second) - instant.getTime();
  };
  const offset = offsetAt(guess);
  let utc = new Date(guess.getTime() - offset);
  const offset2 = offsetAt(utc); // refine across a possible DST boundary
  if (offset2 !== offset) utc = new Date(guess.getTime() - offset2);
  return utc;
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

// Translate an exception into something Edge can read out to the user.
function friendlyError(err: unknown): string {
  const msg = String(err);
  if (msg.includes('No calendar connected')) return "I can't access your calendar right now — it may need to be reconnected in the dashboard.";
  if (msg.includes('insufficientPermissions') || msg.includes('403')) return "I don't have permission to make that change — you may need to reconnect your calendar.";
  if (msg.includes('notFound') || msg.includes('404')) return "I couldn't find that event to modify it.";
  return "Something went wrong — you'll need to make that change manually in your calendar.";
}

interface ToolContext {
  cal: calendar_v3.Calendar;
  calIds: string[];
  userId: number;
}

// Execute a single tool call and return the human-readable result string.
async function executeTool(fn: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const { cal, calIds, userId } = ctx;

  if (fn === 'readCalendar') {
    const { startDate, endDate } = args as { startDate: string; endDate: string };
    const events: calendar_v3.Schema$Event[] = [];
    for (const calId of calIds) {
      const res = await cal.events.list({ calendarId: calId, timeMin: new Date(`${startDate}T00:00:00Z`).toISOString(), timeMax: new Date(`${endDate}T23:59:59Z`).toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 50 }).catch(() => ({ data: { items: [] as calendar_v3.Schema$Event[] } }));
      events.push(...(res.data.items ?? []));
    }
    events.sort((a, b) => (a.start?.dateTime ?? a.start?.date ?? '').localeCompare(b.start?.dateTime ?? b.start?.date ?? ''));
    if (!events.length) return 'No events found for that period.';
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
    return `Found ${events.length} event(s):\n` + Array.from(byDay.entries()).map(([day, evs]) => `${day}:\n${evs.join('\n')}`).join('\n\n');

  } else if (fn === 'createEvent') {
    let { startDateTime, endDateTime } = args as { startDateTime: string; endDateTime: string };
    const { title, timezone, color } = args as { title: string; timezone: string; color?: string };
    if (startDateTime && !startDateTime.includes('T')) {
      const date = new Date().toLocaleDateString('en-CA');
      startDateTime = `${date}T${resolveNaturalTime(startDateTime)}:00`;
      if (!endDateTime?.includes('T')) {
        const [h] = resolveNaturalTime(endDateTime ?? startDateTime).split(':').map(Number);
        endDateTime = `${date}T${String(h + 1).padStart(2, '0')}:00:00`;
      }
    }
    const conflicts: string[] = [];
    const tz = timezone || 'America/Vancouver';
    const winMin = zonedWallTimeToUtc(startDateTime, tz).toISOString();
    const winMax = zonedWallTimeToUtc(endDateTime, tz).toISOString();
    for (const calId of calIds) {
      const res = await cal.events.list({ calendarId: calId, timeMin: winMin, timeMax: winMax, singleEvents: true }).catch(() => ({ data: { items: [] as calendar_v3.Schema$Event[] } }));
      for (const ev of (res.data.items ?? [])) {
        // All-day events (date, not dateTime) are context, not a hard time block — never a conflict.
        if (ev.start?.date && !ev.start?.dateTime) continue;
        if (!/\b(hold|block|tentative|maybe|tbd)\b/i.test(ev.summary ?? '') && ev.summary !== `⚡ ${title}`) conflicts.push(ev.summary ?? 'Untitled');
      }
    }
    if (conflicts.length > 0) {
      return `⚠️ Conflict: "${conflicts.join('", "')}" already at that time. Still create "${title}"?`;
    }
    const rb: calendar_v3.Schema$Event = { summary: `⚡ ${title}`, start: { dateTime: startDateTime, timeZone: timezone }, end: { dateTime: endDateTime, timeZone: timezone }, colorId: color ? getColorId(color) : '9' };
    await cal.events.insert({ calendarId: 'primary', requestBody: rb });
    return `Created "${title}" on ${startDateTime.slice(0, 10)} at ${startDateTime.slice(11, 16)} ${timezone}.`;

  } else if (fn === 'createRecurringEvent') {
    const { title, startTime, endTime, timezone, color, recurrence, startDate, endDate } = args as { title: string; startTime: string; endTime: string; timezone: string; color?: string; recurrence: string; startDate: string; endDate?: string };
    const untilDate = endDate ? endDate.replace(/-/g, '') : '';
    const fullRrule = untilDate ? `RRULE:${recurrence};UNTIL=${untilDate}` : `RRULE:${recurrence}`;
    const rb: calendar_v3.Schema$Event = { summary: `⚡ ${title}`, start: { dateTime: `${startDate}T${startTime}:00`, timeZone: timezone }, end: { dateTime: `${startDate}T${endTime}:00`, timeZone: timezone }, recurrence: [fullRrule], colorId: color ? getColorId(color) : '9' };
    await cal.events.insert({ calendarId: 'primary', requestBody: rb });
    return `Created recurring "${title}" from ${startDate} at ${startTime} ${timezone}.`;

  } else if (fn === 'deleteEvent') {
    const { title, date, deleteAll, recurringScope } = args as { title: string; date: string; deleteAll?: boolean; recurringScope?: 'this' | 'thisAndFollowing' | 'all' };
    const deleted: string[] = [];
    let prompt = '';
    for (const calId of calIds) {
      const res = await cal.events.list({ calendarId: calId, timeMin: new Date(`${date}T00:00:00Z`).toISOString(), timeMax: new Date(`${date}T23:59:59Z`).toISOString(), singleEvents: true, showHiddenInvitations: true }).catch(() => ({ data: { items: [] as calendar_v3.Schema$Event[] } }));
      const tn = normTitle(title);
      const matches = (res.data.items ?? []).filter(e => normTitle(e.summary ?? '').includes(tn) || tn.includes(normTitle(e.summary ?? '')));
      for (const ev of (deleteAll ? matches : matches.slice(0, 1))) {
        // Check if recurring
        if (ev.recurringEventId && !recurringScope) {
          prompt = `"${ev.summary}" is a recurring event. Should I delete just this occurrence, this and all future ones, or all occurrences? Say "just this one", "this and future", or "all".`;
          break;
        }
        if (ev.recurringEventId && recurringScope === 'thisAndFollowing') {
          // Delete this and following by updating the series end date
          await cal.events.patch({ calendarId: calId, eventId: ev.recurringEventId, requestBody: { recurrence: [`RRULE:FREQ=DAILY;UNTIL=${date.replace(/-/g, '')}`] } }).catch(() => undefined);
        } else if (ev.recurringEventId && recurringScope === 'all') {
          await cal.events.delete({ calendarId: calId, eventId: ev.recurringEventId }).catch(() => undefined);
        } else {
          await cal.events.delete({ calendarId: calId, eventId: ev.id! }).catch(() => undefined);
        }
        deleted.push(ev.summary ?? ev.id!);
      }
      if (prompt) break;
    }
    if (prompt) return prompt;
    return deleted.length ? `Deleted: ${deleted.join(', ')}` : `No event matching "${title}" on ${date}.`;

  } else if (fn === 'moveEvent') {
    const { title, date, newStartDateTime, newEndDateTime, timezone, recurringScope } = args as { title: string; date: string; newStartDateTime: string; newEndDateTime: string; timezone: string; recurringScope?: 'this' | 'all' };
    const found = await findEv(cal, calIds, title, date);
    if (!found) return `No event matching "${title}" on ${date}.`;
    if (found.event.recurringEventId && !recurringScope) {
      return `"${found.event.summary}" is a recurring event. Should I move just this occurrence or all occurrences? Say "just this one" or "all".`;
    }
    const eventId = (recurringScope === 'all' && found.event.recurringEventId) ? found.event.recurringEventId : found.event.id!;
    const rb: calendar_v3.Schema$Event = { start: { dateTime: newStartDateTime, timeZone: timezone }, end: { dateTime: newEndDateTime, timeZone: timezone } };
    if (found.event.colorId) rb.colorId = found.event.colorId;
    await cal.events.patch({ calendarId: found.calId, eventId, requestBody: rb });
    return `Moved "${found.event.summary}" to ${newStartDateTime.slice(11, 16)} ${timezone} on ${newStartDateTime.slice(0, 10)}${recurringScope === 'all' ? ' (all occurrences)' : ''}.`;

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
    return count ? `Changed ${count} "${title}" event(s) to ${color}.` : `No events matching "${title}" found.`;

  } else if (fn === 'planWeek') {
    const { weekStartDate, focusHoursPerDay, preferences } = args as { weekStartDate: string; focusHoursPerDay?: number; preferences?: string };
    const user = userQueries.findById(userId);
    if (!user) return 'User not found';
    const { format, startOfWeek } = await import('date-fns');
    const weekOf = format(startOfWeek(new Date(weekStartDate)), 'yyyy-MM-dd');
    const priorities = priorityQueries.getThisWeek(userId, weekOf);
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
    return created.length ? `Planned your week! Added: ${created.join(', ')}. Priorities: ${priorityText}.` : 'Week fully packed — no free slots.';
  }

  return `Error: unknown tool "${fn}"`;
}

interface ParsedToolCall { id: string | null; name: string; args: Record<string, unknown>; }

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return {}; } }
  return {};
}

// Normalise Vapi's two payload shapes into a flat list of tool calls.
// `tool-calls` (current) carries an array in toolCallList, each with its own id that
// MUST be echoed back as toolCallId. `function-call` (legacy) is a single call with no id.
function extractToolCalls(message: Record<string, unknown>): { calls: ParsedToolCall[]; useResultsArray: boolean } {
  const list = message.toolCallList as Array<{ id?: string; function?: { name?: string; arguments?: unknown } }> | undefined;
  if (Array.isArray(list) && list.length) {
    return {
      useResultsArray: true,
      calls: list.map(tc => ({ id: tc.id ?? null, name: tc.function?.name ?? '', args: parseArgs(tc.function?.arguments) })),
    };
  }
  const fc = message.functionCall as { name?: string; parameters?: unknown } | undefined;
  if (fc) {
    return { useResultsArray: false, calls: [{ id: null, name: fc.name ?? '', args: parseArgs(fc.parameters) }] };
  }
  return { useResultsArray: false, calls: [] };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const message = (body.message ?? body) as Record<string, unknown>;
    const type = message.type;

    if (type !== 'function-call' && type !== 'tool-calls') {
      return NextResponse.json({ received: true });
    }

    const call = message.call as { id?: string } | undefined;
    const db = getDb();
    const briefing = db.prepare('SELECT * FROM briefings WHERE vapi_call_id = ?').get(call?.id) as { id: number; user_id: number } | undefined;

    const { calls, useResultsArray } = extractToolCalls(message);
    if (!calls.length) return NextResponse.json({ received: true });

    // If we can't tie this back to a briefing, still answer in the right shape so Vapi
    // surfaces a usable message instead of "No result returned".
    if (!briefing) {
      const errMsg = 'Error: call not found';
      return NextResponse.json(
        useResultsArray
          ? { results: calls.map(c => ({ toolCallId: c.id, result: errMsg })) }
          : { result: errMsg }
      );
    }

    // Build the calendar client once; if it fails, every tool call gets the same friendly error.
    let ctx: ToolContext | null = null;
    let ctxError: string | null = null;
    try {
      const cal = await getCalClient(briefing.user_id);
      const calIds = await getCalIds(cal);
      ctx = { cal, calIds, userId: briefing.user_id };
    } catch (err) {
      ctxError = friendlyError(err);
    }

    const results: { toolCallId: string | null; result: string }[] = [];
    for (const tc of calls) {
      let result: string;
      if (ctxError) {
        result = ctxError;
      } else {
        try {
          console.log(`[tool-call] ${tc.name}(${JSON.stringify(tc.args)}) user=${briefing.user_id}`);
          result = await executeTool(tc.name, tc.args, ctx!);
        } catch (err) {
          console.error(`[tool-call] ${tc.name} failed:`, err);
          result = friendlyError(err);
        }
      }
      console.log(`[tool-call] Result: ${result}`);
      results.push({ toolCallId: tc.id, result });

      // Append to tool_actions log on the briefing (skip errors)
      if (result && !result.startsWith('Error:')) {
        try {
          const existing = db.prepare('SELECT tool_actions FROM briefings WHERE id = ?').get(briefing.id) as { tool_actions: string | null } | undefined;
          const actions = existing?.tool_actions ? JSON.parse(existing.tool_actions) : [];
          actions.push({ fn: tc.name, args: tc.args, result, ts: new Date().toISOString() });
          db.prepare('UPDATE briefings SET tool_actions = ? WHERE id = ?').run(JSON.stringify(actions), briefing.id);
        } catch (_e) { /* non-critical */ }
      }
    }

    return NextResponse.json(
      useResultsArray
        ? { results: results.map(r => ({ toolCallId: r.toolCallId, result: r.result })) }
        : { result: results[0]?.result ?? '' }
    );

  } catch (err) {
    const msg = String(err);
    console.error('[tool-call] Error:', msg);
    // Last-resort: Vapi accepts a bare { result } too; better than a 500 (which yields "No result returned").
    return NextResponse.json({ result: friendlyError(err) });
  }
}
