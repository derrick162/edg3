import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getOAuthClient, getColorId, zonedWallTimeToUtc, findFreeSlots } from '@/lib/calendar';
import { rruleUntilUtc, nextDay, wallTimeToUtc, dayRangeUtc, isValidTimeZone } from '@/lib/time';
import { titleMatchScore, selectEvent } from '@/lib/eventMatch';
import { effectiveTimezone } from '@/lib/db';
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

// Start time of an event as minutes-since-midnight in the user's timezone (null for all-day).
function startMinutesInTz(e: calendar_v3.Schema$Event, tz: string): number | null {
  if (!e.start?.dateTime) return null;
  const m = new Date(e.start.dateTime).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).match(/^(\d{2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// Parse a spoken/typed time hint ("7pm", "19:00", "noon") to minutes-since-midnight.
function parseTimeMinutes(s?: string): number | null {
  if (!s) return null;
  const m = resolveNaturalTime(s).match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// All events on `date` (user's local day window — a late-evening event rolls to the next UTC
// day, so a UTC window would miss it), each tagged with its calendar id.
async function eventsOnDay(cal: calendar_v3.Calendar, calIds: string[], date: string, tz: string): Promise<{ event: calendar_v3.Schema$Event; calId: string }[]> {
  const { start, end } = dayRangeUtc(tz, date);
  const out: { event: calendar_v3.Schema$Event; calId: string }[] = [];
  for (const calId of calIds) {
    const res = await cal.events.list({ calendarId: calId, timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: true, showHiddenInvitations: true }).catch(() => ({ data: { items: [] as calendar_v3.Schema$Event[] } }));
    for (const e of (res.data.items ?? [])) out.push({ event: e, calId });
  }
  return out;
}

function describeOptions(matches: { event: calendar_v3.Schema$Event }[], tz: string): string {
  return matches.map(m => {
    const t = m.event.start?.dateTime
      ? new Date(m.event.start.dateTime).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
      : 'all day';
    return `"${(m.event.summary ?? '').replace(/^⚡\s*/, '')}" at ${t}`;
  }).join(', ');
}

type ResolveResult =
  | { kind: 'one'; event: calendar_v3.Schema$Event; calId: string }
  | { kind: 'ambiguous'; message: string }
  | { kind: 'none' };

// Resolve which event the user means by title + an optional time hint, instead of grabbing the
// first loose title match. Ambiguous → caller asks the user which one.
function resolveEvent(matches: { event: calendar_v3.Schema$Event; calId: string }[], title: string, tz: string, currentTime?: string): ResolveResult {
  const sel = selectEvent(
    matches.map(m => ({ title: m.event.summary ?? '', startMinutes: startMinutesInTz(m.event, tz) })),
    title,
    parseTimeMinutes(currentTime),
  );
  if (sel.kind === 'none') return { kind: 'none' };
  if (sel.kind === 'one') return { kind: 'one', event: matches[sel.index].event, calId: matches[sel.index].calId };
  return { kind: 'ambiguous', message: describeOptions(sel.indexes.map(i => matches[i]), tz) };
}

// Translate an exception into something Edge can read out to the user.
function friendlyError(err: unknown): string {
  const msg = String(err);
  if (msg.includes('No calendar connected')) return "I can't access your calendar right now — it may need to be reconnected in the dashboard.";
  if (msg.includes('insufficientPermissions') || msg.includes('403')) return "I don't have permission to make that change — you may need to reconnect your calendar.";
  if (msg.includes('notFound') || msg.includes('404')) return "I couldn't find that event to modify it.";
  return "Something went wrong — you'll need to make that change manually in your calendar.";
}

// Result strings that indicate the action did NOT succeed (used for the activity log status).
// Conflict prompts and empty reads are NOT failures, so they're deliberately excluded.
const FAILURE_RE = /^(Error:|I can't access|I don't have permission|I couldn't find|Something went wrong|No event matching|No timed events|Couldn't|I didn't catch|I need the day)/i;

// Write-confirmation: re-read an event by id to verify the write actually persisted.
async function confirmExists(cal: calendar_v3.Calendar, calId: string, eventId: string | null | undefined): Promise<boolean> {
  if (!eventId) return false;
  try {
    const e = await cal.events.get({ calendarId: calId, eventId });
    return !!e.data?.id && e.data.status !== 'cancelled';
  } catch {
    return false;
  }
}

interface ToolContext {
  cal: calendar_v3.Calendar;
  calIds: string[];
  userId: number;
  tz: string;
}

// Execute a single tool call and return the human-readable result string.
async function executeTool(fn: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const { cal, calIds, userId, tz } = ctx;

  if (fn === 'readCalendar') {
    const { startDate, endDate } = args as { startDate: string; endDate: string };
    const events: calendar_v3.Schema$Event[] = [];
    const rcMin = dayRangeUtc(tz, startDate).start.toISOString();
    const rcMax = dayRangeUtc(tz, endDate).end.toISOString();
    for (const calId of calIds) {
      const res = await cal.events.list({ calendarId: calId, timeMin: rcMin, timeMax: rcMax, singleEvents: true, orderBy: 'startTime', maxResults: 50 }).catch(() => ({ data: { items: [] as calendar_v3.Schema$Event[] } }));
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

  } else if (fn === 'findTime') {
    const { startDate, endDate, minimumMinutes } = args as { startDate: string; endDate?: string; minimumMinutes?: number };
    if (!startDate) return 'I need at least a date to check your availability.';
    const end = endDate || startDate;
    const evMin = dayRangeUtc(tz, startDate).start.toISOString();
    const evMax = dayRangeUtc(tz, end).end.toISOString();
    const evts: calendar_v3.Schema$Event[] = [];
    for (const calId of calIds) {
      const res = await cal.events.list({ calendarId: calId, timeMin: evMin, timeMax: evMax, singleEvents: true, orderBy: 'startTime', maxResults: 250 }).catch(() => ({ data: { items: [] as calendar_v3.Schema$Event[] } }));
      evts.push(...(res.data.items ?? []));
    }
    return findFreeSlots(evts, tz, startDate, end, minimumMinutes && minimumMinutes > 0 ? minimumMinutes : 30);

  } else if (fn === 'setMyTimezone') {
    const { timezone } = args as { timezone?: string };
    if (!timezone) return "I didn't catch which timezone to set.";
    if (timezone.trim().toLowerCase() === 'home') {
      userQueries.setCurrentTimezone(userId, null);
      return 'Got it — back to your home timezone from now on.';
    }
    if (!isValidTimeZone(timezone)) return `"${timezone}" isn't a timezone I recognize — try one like America/Toronto.`;
    userQueries.setCurrentTimezone(userId, timezone);
    return `Got it — I'll use ${timezone} for your calendar and briefings from now on.`;

  } else if (fn === 'getEventDetails') {
    const { title, date, currentTime } = args as { title: string; date: string; currentTime?: string };
    const r = resolveEvent(await eventsOnDay(cal, calIds, date, tz), title, tz, currentTime);
    if (r.kind === 'none') return `No event matching "${title}" on ${date}.`;
    if (r.kind === 'ambiguous') return `There are multiple "${title}" events on ${date}: ${r.message}. Which one?`;
    const e = r.event;
    const when = e.start?.dateTime
      ? `at ${new Date(e.start.dateTime).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })}`
      : '(all day)';
    const lines = [`"${(e.summary ?? '').replace(/^⚡\s*/, '')}" on ${date} ${when}`];
    if (e.location) lines.push(`Location: ${e.location}`);
    if (e.attendees?.length) lines.push(`Attendees: ${e.attendees.map(a => a.displayName || a.email).filter(Boolean).join(', ')}`);
    lines.push(e.description ? `Notes: ${e.description}` : 'No notes/description.');
    return lines.join('\n');

  } else if (fn === 'editEvent') {
    const { title, date, currentTime, description, appendDescription, location } = args as { title: string; date: string; currentTime?: string; description?: string; appendDescription?: boolean; location?: string };
    const r = resolveEvent(await eventsOnDay(cal, calIds, date, tz), title, tz, currentTime);
    if (r.kind === 'none') return `No event matching "${title}" on ${date}.`;
    if (r.kind === 'ambiguous') return `There are multiple "${title}" events on ${date}: ${r.message}. Which one should I edit? Re-call with currentTime set to its start time.`;
    const e = r.event;
    const body: calendar_v3.Schema$Event = {};
    if (typeof location === 'string') body.location = location;
    if (typeof description === 'string') body.description = (appendDescription && e.description) ? `${e.description}\n${description}` : description;
    if (!Object.keys(body).length) return 'Tell me what to change — a description/note or a location.';
    await cal.events.patch({ calendarId: r.calId, eventId: e.id!, requestBody: body });
    if (!(await confirmExists(cal, r.calId, e.id))) return `Couldn't confirm the update to "${e.summary}" — please double-check your calendar.`;
    return `Updated and confirmed "${(e.summary ?? '').replace(/^⚡\s*/, '')}"${body.location ? ` — location: ${body.location}` : ''}${body.description ? ' — notes updated' : ''}.`;

  } else if (fn === 'researchToEvent') {
    const { title, date, query, currentTime } = args as { title: string; date: string; query: string; currentTime?: string };
    if (!query) return 'What should I research?';
    const r = resolveEvent(await eventsOnDay(cal, calIds, date, tz), title, tz, currentTime);
    if (r.kind === 'none') return `No event matching "${title}" on ${date} to attach research to.`;
    if (r.kind === 'ambiguous') return `There are multiple "${title}" events on ${date}: ${r.message}. Which one? Re-call with currentTime set.`;
    let findings = '';
    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const res = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 700,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }] as never,
        messages: [{ role: 'user', content: `Research this and return a concise, practical summary to save in a calendar note. Include names, phone numbers, and addresses where relevant. 4–7 short lines, no preamble.\n\n${query}` }],
      });
      findings = res.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n').trim();
    } catch (err) {
      console.error('[researchToEvent] web search failed:', err);
      return `I tried to research "${query}" but the lookup failed — you may need to do that one manually.`;
    }
    if (!findings) return `I couldn't find useful results for "${query}".`;
    const e = r.event;
    const block = `[Edge research: ${query}]\n${findings}`;
    await cal.events.patch({ calendarId: r.calId, eventId: e.id!, requestBody: { description: e.description ? `${e.description}\n\n${block}` : block } });
    if (!(await confirmExists(cal, r.calId, e.id))) return `I researched "${query}" but couldn't confirm it saved — please double-check.`;
    return `Done — researched "${query}" and added the findings to "${(e.summary ?? '').replace(/^⚡\s*/, '')}"'s notes.`;

  } else if (fn === 'createEvent') {
    let { startDateTime, endDateTime } = args as { startDateTime: string; endDateTime: string };
    const { title, timezone, color, overrideConflicts, allDay } = args as { title: string; timezone: string; color?: string; overrideConflicts?: boolean; allDay?: boolean };
    if (!title) return "I didn't catch what to call that event — what's the title?";

    // All-day event: date-only start/end (Google's end date is exclusive, so the next day).
    if (allDay) {
      const dateOnly = (startDateTime || endDateTime || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return "I didn't catch the date for that all-day event — what day is it?";
      const insAllDay = await cal.events.insert({ calendarId: 'primary', requestBody: {
        summary: `⚡ ${title}`, start: { date: dateOnly }, end: { date: nextDay(dateOnly) }, colorId: color ? getColorId(color) : '9',
      } });
      return (await confirmExists(cal, 'primary', insAllDay.data.id))
        ? `Created and confirmed all-day "${title}" on ${dateOnly}.`
        : `Couldn't confirm the all-day "${title}" saved — please double-check your calendar.`;
    }

    if (startDateTime && !startDateTime.includes('T')) {
      const date = new Date().toLocaleDateString('en-CA');
      startDateTime = `${date}T${resolveNaturalTime(startDateTime)}:00`;
      if (!endDateTime?.includes('T')) {
        const [h] = resolveNaturalTime(endDateTime ?? startDateTime).split(':').map(Number);
        endDateTime = `${date}T${String(h + 1).padStart(2, '0')}:00:00`;
      }
    }
    if (!startDateTime || !endDateTime) return "I didn't catch the time for that event — when should it be?";
    // Skip the conflict check when the user has explicitly asked to book over existing events.
    if (!overrideConflicts) {
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
        return `⚠️ Conflict: "${conflicts.join('", "')}" already at that time. Want me to book "${title}" over it anyway? If they confirm, call createEvent again with overrideConflicts set to true.`;
      }
    }
    const rb: calendar_v3.Schema$Event = { summary: `⚡ ${title}`, start: { dateTime: startDateTime, timeZone: timezone }, end: { dateTime: endDateTime, timeZone: timezone }, colorId: color ? getColorId(color) : '9' };
    const insTimed = await cal.events.insert({ calendarId: 'primary', requestBody: rb });
    if (!(await confirmExists(cal, 'primary', insTimed.data.id))) return `Couldn't confirm "${title}" saved — please double-check your calendar.`;
    return `Created and confirmed "${title}" on ${startDateTime.slice(0, 10)} at ${startDateTime.slice(11, 16)} ${timezone}${overrideConflicts ? ' (booked over existing events)' : ''}.`;

  } else if (fn === 'createRecurringEvent') {
    const { title, startTime, endTime, timezone, color, recurrence, startDate, endDate } = args as { title: string; startTime: string; endTime: string; timezone: string; color?: string; recurrence: string; startDate: string; endDate?: string };
    // UNTIL must be a UTC instant. A bare date (UNTIL=YYYYMMDD) means midnight, which drops the
    // last day's occurrence (e.g. a 10am event on the end date). Use end-of-day in the event's
    // timezone so the final day is inclusive — "Tuesday to Thursday" books all three days.
    let fullRrule = `RRULE:${recurrence}`;
    if (endDate) {
      fullRrule = `RRULE:${recurrence};UNTIL=${rruleUntilUtc(endDate, timezone || 'America/Vancouver')}`;
    }
    const rb: calendar_v3.Schema$Event = { summary: `⚡ ${title}`, start: { dateTime: `${startDate}T${startTime}:00`, timeZone: timezone }, end: { dateTime: `${startDate}T${endTime}:00`, timeZone: timezone }, recurrence: [fullRrule], colorId: color ? getColorId(color) : '9' };
    await cal.events.insert({ calendarId: 'primary', requestBody: rb });
    return `Created recurring "${title}" from ${startDate} at ${startTime} ${timezone}.`;

  } else if (fn === 'deleteEvent') {
    const { title, date, deleteAll, recurringScope, currentTime } = args as { title: string; date: string; deleteAll?: boolean; recurringScope?: 'this' | 'thisAndFollowing' | 'all'; currentTime?: string };
    const dayMatches = await eventsOnDay(cal, calIds, date, tz);

    // Which events to delete: all title matches (deleteAll), or one precisely-resolved event.
    let toDelete: { event: calendar_v3.Schema$Event; calId: string }[];
    if (deleteAll) {
      toDelete = dayMatches.filter(m => titleMatchScore(m.event.summary ?? '', title) > 0);
      if (!toDelete.length) return `No event matching "${title}" on ${date}.`;
    } else {
      const r = resolveEvent(dayMatches, title, tz, currentTime);
      if (r.kind === 'none') return `No event matching "${title}" on ${date}.`;
      if (r.kind === 'ambiguous') return `There are multiple "${title}" events on ${date}: ${r.message}. Which one should I delete? Ask the user, then call deleteEvent again with currentTime set to that event's start time (e.g. "7pm").`;
      toDelete = [{ event: r.event, calId: r.calId }];
    }

    const deleted: string[] = [];
    for (const { event: ev, calId } of toDelete) {
      if (ev.recurringEventId && !recurringScope) {
        return `"${ev.summary}" is a recurring event. Should I delete just this occurrence, this and all future ones, or all occurrences? Say "just this one", "this and future", or "all".`;
      }
      if (ev.recurringEventId && recurringScope === 'thisAndFollowing') {
        await cal.events.patch({ calendarId: calId, eventId: ev.recurringEventId, requestBody: { recurrence: [`RRULE:FREQ=DAILY;UNTIL=${date.replace(/-/g, '')}`] } }).catch(() => undefined);
      } else if (ev.recurringEventId && recurringScope === 'all') {
        await cal.events.delete({ calendarId: calId, eventId: ev.recurringEventId }).catch(() => undefined);
      } else {
        await cal.events.delete({ calendarId: calId, eventId: ev.id! }).catch(() => undefined);
      }
      deleted.push(ev.summary ?? ev.id!);
    }
    return deleted.length ? `Deleted: ${deleted.join(', ')}` : `No event matching "${title}" on ${date}.`;

  } else if (fn === 'moveEvent') {
    const { title, date, newStartDateTime, newEndDateTime, timezone, recurringScope, currentTime } = args as { title: string; date: string; newStartDateTime: string; newEndDateTime: string; timezone: string; recurringScope?: 'this' | 'all'; currentTime?: string };
    const r = resolveEvent(await eventsOnDay(cal, calIds, date, tz), title, tz, currentTime);
    if (r.kind === 'none') return `No event matching "${title}" on ${date}.`;
    if (r.kind === 'ambiguous') return `There are multiple "${title}" events on ${date}: ${r.message}. Which one should I move? Ask the user, then call moveEvent again with currentTime set to that event's start time (e.g. "7pm").`;
    const found = r;
    if (found.event.recurringEventId && !recurringScope) {
      return `"${found.event.summary}" is a recurring event. Should I move just this occurrence or all occurrences? Say "just this one" or "all".`;
    }
    const eventId = (recurringScope === 'all' && found.event.recurringEventId) ? found.event.recurringEventId : found.event.id!;
    const rb: calendar_v3.Schema$Event = { start: { dateTime: newStartDateTime, timeZone: timezone }, end: { dateTime: newEndDateTime, timeZone: timezone } };
    if (found.event.colorId) rb.colorId = found.event.colorId;
    const patched = await cal.events.patch({ calendarId: found.calId, eventId, requestBody: rb });
    if (!(await confirmExists(cal, found.calId, patched.data.id))) return `Couldn't confirm the move of "${found.event.summary}" — please double-check your calendar.`;
    return `Moved and confirmed "${found.event.summary}" to ${newStartDateTime.slice(11, 16)} ${timezone} on ${newStartDateTime.slice(0, 10)}${recurringScope === 'all' ? ' (all occurrences)' : ''}.`;

  } else if (fn === 'colorEvent') {
    const { title, date, color } = args as { title: string; date: string; color: string };
    const colorId = getColorId(color);
    let count = 0;
    const tMin = date === 'all' ? new Date().toISOString() : dayRangeUtc(tz, date).start.toISOString();
    const tMax = date === 'all' ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : dayRangeUtc(tz, date).end.toISOString();
    for (const calId of calIds) {
      const res = await cal.events.list({ calendarId: calId, timeMin: tMin, timeMax: tMax, singleEvents: true, maxResults: 100 }).catch(() => ({ data: { items: [] as calendar_v3.Schema$Event[] } }));
      for (const ev of (res.data.items ?? []).filter(e => titleMatchScore(e.summary ?? '', title) > 0)) {
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
    let priorities = priorityQueries.getThisWeek(userId, weekOf);
    if (!priorities.length) priorities = priorityQueries.getMostRecent(userId); // carry over "same as current"
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

  } else if (fn === 'copyDayEvents') {
    // Replicate all timed events from one day onto one or more other days, preserving the
    // wall-clock time of each event. One reliable call instead of many individual createEvents.
    const { sourceDate, targetDates } = args as { sourceDate: string; targetDates: string[] };
    if (!sourceDate || !Array.isArray(targetDates) || !targetDates.length) {
      return 'I need the day to copy from and the day(s) to copy to.';
    }
    const userTz = effectiveTimezone(userQueries.findById(userId) ?? {});
    const { start: sMin, end: sMax } = dayRangeUtc(userTz, sourceDate);
    const src: calendar_v3.Schema$Event[] = [];
    for (const calId of calIds) {
      const res = await cal.events.list({ calendarId: calId, timeMin: sMin.toISOString(), timeMax: sMax.toISOString(), singleEvents: true, orderBy: 'startTime' }).catch(() => ({ data: { items: [] as calendar_v3.Schema$Event[] } }));
      for (const e of (res.data.items ?? [])) {
        if (e.start?.dateTime && e.end?.dateTime) src.push(e); // timed events only (skip all-day)
      }
    }
    if (!src.length) return `No timed events found on ${sourceDate} to copy.`;

    let created = 0;
    const titles = new Set<string>();
    for (const target of targetDates) {
      for (const ev of src) {
        const evTz = ev.start!.timeZone || userTz;
        const startWall = ev.start!.dateTime!.slice(11, 19); // HH:MM:SS in the event's local time
        const durMs = new Date(ev.end!.dateTime!).getTime() - new Date(ev.start!.dateTime!).getTime();
        const newStart = wallTimeToUtc(`${target}T${startWall}`, evTz);
        const newEnd = new Date(newStart.getTime() + durMs);
        await cal.events.insert({ calendarId: 'primary', requestBody: {
          summary: ev.summary || '⚡ Event',
          start: { dateTime: newStart.toISOString() },
          end: { dateTime: newEnd.toISOString() },
          colorId: ev.colorId || undefined,
        } }).then(() => { created++; titles.add((ev.summary || '').replace(/^⚡\s*/, '')); }).catch(() => undefined);
      }
    }
    return created
      ? `Copied ${src.length} event(s) (${[...titles].join(', ')}) from ${sourceDate} to ${targetDates.length} day(s) — ${created} created.`
      : `Couldn't copy events from ${sourceDate}.`;
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
      const tz = effectiveTimezone(userQueries.findById(briefing.user_id) ?? {});
      ctx = { cal, calIds, userId: briefing.user_id, tz };
    } catch (err) {
      ctxError = friendlyError(err);
    }

    const results: { toolCallId: string | null; result: string }[] = [];
    for (const tc of calls) {
      let result: string;
      let ok = true;
      if (ctxError) {
        result = ctxError;
        ok = false;
      } else {
        try {
          console.log(`[tool-call] ${tc.name}(${JSON.stringify(tc.args)}) user=${briefing.user_id}`);
          result = await executeTool(tc.name, tc.args, ctx!);
          if (FAILURE_RE.test(result)) ok = false;
        } catch (err) {
          console.error(`[tool-call] ${tc.name} failed:`, err);
          result = friendlyError(err);
          ok = false;
        }
      }
      console.log(`[tool-call] Result (ok=${ok}): ${result}`);
      results.push({ toolCallId: tc.id, result });

      // Activity log: record EVERY action (successes and failures) so it's visible on the
      // dashboard without having to pull call transcripts. Keep the last 50 per briefing.
      try {
        const existing = db.prepare('SELECT tool_actions FROM briefings WHERE id = ?').get(briefing.id) as { tool_actions: string | null } | undefined;
        const actions = existing?.tool_actions ? JSON.parse(existing.tool_actions) : [];
        actions.push({ fn: tc.name, args: tc.args, result, ok, ts: new Date().toISOString() });
        db.prepare('UPDATE briefings SET tool_actions = ? WHERE id = ?').run(JSON.stringify(actions.slice(-50)), briefing.id);
      } catch (_e) { /* non-critical */ }
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
