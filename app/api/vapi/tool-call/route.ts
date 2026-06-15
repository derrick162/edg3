import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getOAuthClient, getColorId, zonedWallTimeToUtc, findFreeSlots, getCalendarEvents, getWeekEvents } from '@/lib/calendar';
import { rruleUntilUtc, nextDay, prevDay, wallTimeToUtc, dayRangeUtc, isValidTimeZone, todayInTz, timedEventDateMove, recurringSeriesTimeShift } from '@/lib/time';
import { titleMatchScore, selectEvent, resolveEventExact, findDuplicateGroups } from '@/lib/eventMatch';
import { checkVapiSecret } from '@/lib/vapi';
import { computeCalendarFit, classifyEventsEnergy, parseEnergyProfile } from '@/lib/calendarScore';
import { computeAlignment } from '@/lib/alignment';
import { deriveEnergySignal } from '@/lib/energy';
import { getLatestRecovery } from '@/lib/whoop';
import { buildCalendarPlan } from '@/lib/calendarPlan';
import { effectiveTimezone, vapiAuthLogQueries } from '@/lib/db';
import { calendarQueries, userQueries, priorityQueries, dailyFocusQueries, factQueries, energyLogQueries, energyProfileQueries, calendarScoreQueries, undoQueries, watchedThreadQueries, auditLogQueries } from '@/lib/db';
import { type UndoOp, recordUndo, executeUndo, cleanForRecreate, parseUndoOps } from '@/lib/undo';
import { emailableRecipients, formatSlotsForEmail, composeOutreachEmail, recipientsFromNotes, correctRecipientNames } from '@/lib/outreach';
import { checkOutreachReplies, formatRepliesForVoice } from '@/lib/replies';
import { hasGmailReadScope } from '@/lib/google-auth';
import { createDraft, GmailScopeError, GmailRateLimitError } from '@/lib/gmail';
import { claimEventCreate, buildEventDedupeKey, issueDeleteToken, consumeDeleteToken } from '@/lib/idempotency';
import { isWritable, canUserReschedule } from '@/lib/calendarWritable';
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

// The visible calendar list barely changes but costs ~500ms, and we fetch it on every tool
// call. Cache it per user for a few minutes to cut that latency from every interaction.
// We store the full entry (id + accessRole + summary) so mutation tools can check whether
// a resolved event lives on a read-only calendar before attempting the Google API call.
interface CalEntry { id: string; accessRole: string; summary: string; }
const calMetaCache = new Map<string, { entries: CalEntry[]; exp: number }>();
async function getCalMeta(cal: calendar_v3.Calendar, userKey: string): Promise<CalEntry[]> {
  const cached = calMetaCache.get(userKey);
  if (cached && cached.exp > Date.now()) return cached.entries;
  const list = await cal.calendarList.list({ minAccessRole: 'reader' });
  const entries = (list.data.items ?? [])
    .filter(c => !c.hidden && c.id)
    .map(c => ({ id: c.id!, accessRole: c.accessRole ?? 'reader', summary: c.summary ?? c.id! }));
  calMetaCache.set(userKey, { entries, exp: Date.now() + 5 * 60 * 1000 });
  return entries;
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
  const perCal = await Promise.all(calIds.map(async calId => {
    const res = await cal.events.list({ calendarId: calId, timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: true, showHiddenInvitations: true }).catch(() => ({ data: { items: [] as calendar_v3.Schema$Event[] } }));
    return (res.data.items ?? []).map(e => ({ event: e, calId }));
  }));
  return perCal.flat();
}

function describeOptions(matches: { event: calendar_v3.Schema$Event }[], tz: string): string {
  return matches.map(m => {
    const summary = (m.event.summary ?? '').replace(/^⚡\s*/, '');
    // All-day events: describe by date span so same-title events on different spans are distinguishable.
    if (m.event.start?.date && !m.event.start?.dateTime) {
      const startD = m.event.start.date;
      const endIncl = m.event.end?.date ? prevDay(m.event.end.date) : startD;
      const fmtD = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return startD === endIncl
        ? `"${summary}" (all-day ${fmtD(startD)})`
        : `"${summary}" (all-day ${fmtD(startD)}–${fmtD(endIncl)})`;
    }
    const t = m.event.start?.dateTime
      ? new Date(m.event.start.dateTime).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
      : 'all day';
    return `"${summary}" at ${t}`;
  }).join(', ');
}

// Human-readable description of what a delete will remove — for the confirmation read-back.
function describeDeleteTargets(targets: { event: calendar_v3.Schema$Event }[], recurringScope: string | undefined, tz: string): string {
  if (targets.length > 1) {
    const name = (targets[0].event.summary ?? '').replace(/^⚡\s*/, '');
    return `all ${targets.length} "${name}" events that day`;
  }
  const e = targets[0].event;
  const name = (e.summary ?? '').replace(/^⚡\s*/, '');
  if (e.recurringEventId && recurringScope === 'all') return `the entire "${name}" recurring series — every occurrence`;
  if (e.recurringEventId && recurringScope === 'thisAndFollowing') return `"${name}" and all its future occurrences`;
  const when = e.start?.dateTime ? ` at ${new Date(e.start.dateTime).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })}` : '';
  return `"${name}"${when}`;
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
  return "Something went wrong on my end — want me to try again or take a different approach?";
}

// Result strings that indicate the action did NOT succeed (used for the activity log status).
// Conflict prompts and empty reads are NOT failures, so they're deliberately excluded.
const FAILURE_RE = /^(Error:|I can't access|I don't have permission|I couldn't find|Something went wrong|No event matching|No timed events|Couldn't|I didn't catch|I need the day|I need a date)/i;

// Research notes Edge attaches are wrapped in these delimiters so a later research call can
// REPLACE the prior block (not stack on it) while leaving the user's own typed notes intact.
const RESEARCH_OPEN = '--- Edge research (latest) ---';
const RESEARCH_CLOSE = '--- end Edge research ---';

// Return a description with any delimited Edge-research block(s) removed — i.e. just the user's
// own notes. Index-based (no regex) so the marker text needs no escaping.
function stripResearchBlock(desc: string | null | undefined): string {
  let out = desc ?? '';
  for (;;) {
    const s = out.indexOf(RESEARCH_OPEN);
    if (s === -1) break;
    const e = out.indexOf(RESEARCH_CLOSE, s);
    if (e === -1) { out = out.slice(0, s); break; }
    out = out.slice(0, s) + out.slice(e + RESEARCH_CLOSE.length);
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

interface ToolContext {
  cal: calendar_v3.Calendar;
  calIds: string[];
  calMeta: Map<string, { accessRole: string; summary: string }>;
  userId: number;
  tz: string;
}

// Execute a single tool call and return the human-readable result string.
async function executeTool(fn: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const { cal, calIds, calMeta, userId, tz } = ctx;

  if (fn === 'readCalendar') {
    const { startDate, endDate } = args as { startDate: string; endDate: string };
    const rcMin = dayRangeUtc(tz, startDate).start.toISOString();
    const rcMax = dayRangeUtc(tz, endDate).end.toISOString();
    const allEvents: calendar_v3.Schema$Event[] = (await Promise.all(calIds.map(calId =>
      cal.events.list({ calendarId: calId, timeMin: rcMin, timeMax: rcMax, singleEvents: true, orderBy: 'startTime', maxResults: 50 }).then(r => r.data.items ?? []).catch(() => [] as calendar_v3.Schema$Event[])
    ))).flat();
    allEvents.sort((a, b) => (a.start?.dateTime ?? a.start?.date ?? '').localeCompare(b.start?.dateTime ?? b.start?.date ?? ''));
    // Drop cancelled events — they appear in recurring-event expansions but add noise to context.
    // Cap at 25 to keep tool-result size bounded across a long call (prevents Vapi context growth).
    const CAP = 25;
    const active = allEvents.filter(e => e.status !== 'cancelled');
    const truncated = active.length > CAP;
    const events = truncated ? active.slice(0, CAP) : active;
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
    const trailer = truncated ? `\n(Showing first ${CAP} of ${active.length} events — ask about a specific date for more detail.)` : '';
    return `Found ${events.length} event(s):\n` + Array.from(byDay.entries()).map(([day, evs]) => `${day}:\n${evs.join('\n')}`).join('\n\n') + trailer;

  } else if (fn === 'findTime') {
    const { startDate, endDate, minimumMinutes } = args as { startDate: string; endDate?: string; minimumMinutes?: number };
    if (!startDate) return 'I need at least a date to check your availability.';
    const end = endDate || startDate;
    const evMin = dayRangeUtc(tz, startDate).start.toISOString();
    const evMax = dayRangeUtc(tz, end).end.toISOString();
    const evts: calendar_v3.Schema$Event[] = (await Promise.all(calIds.map(calId =>
      cal.events.list({ calendarId: calId, timeMin: evMin, timeMax: evMax, singleEvents: true, orderBy: 'startTime', maxResults: 250 }).then(r => r.data.items ?? []).catch(() => [] as calendar_v3.Schema$Event[])
    ))).flat();
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
    const editEntry = calMeta.get(r.calId);
    if (editEntry && !isWritable(editEntry.accessRole)) {
      const eventName = (r.event.summary ?? '').replace(/^⚡\s*/, '');
      return `"${eventName}" is on a read-only calendar — I can't edit it from here. Want me to add a note to a related event or draft a message about it instead?`;
    }
    const e = r.event;
    const body: calendar_v3.Schema$Event = {};
    if (typeof location === 'string') body.location = location;
    if (typeof description === 'string') body.description = (appendDescription && e.description) ? `${e.description}\n${description}` : description;
    if (!Object.keys(body).length) return 'Tell me what to change — a description/note or a location.';
    const undoBody: calendar_v3.Schema$Event = {};
    if ('location' in body) undoBody.location = e.location ?? '';
    if ('description' in body) undoBody.description = e.description ?? '';
    const editPatched = await cal.events.patch({ calendarId: r.calId, eventId: e.id!, requestBody: body });
    if (!editPatched.data.id) return `Couldn't confirm the update to "${e.summary}" — please double-check your calendar.`;
    recordUndo(userId, `edited "${(e.summary ?? '').replace(/^⚡\s*/, '')}"`, [{ type: 'patch', calId: r.calId, eventId: e.id!, requestBody: undoBody }]);
    return `Updated and confirmed "${(e.summary ?? '').replace(/^⚡\s*/, '')}"${body.location ? ` — location: ${body.location}` : ''}${body.description ? ' — notes updated' : ''}.`;

  } else if (fn === 'researchToEvent') {
    const { title, date, query, currentTime } = args as { title: string; date: string; query: string; currentTime?: string };
    if (!query) return 'What should I research?';
    const r = resolveEvent(await eventsOnDay(cal, calIds, date, tz), title, tz, currentTime);
    if (r.kind === 'none') return `No event matching "${title}" on ${date} to attach research to.`;
    if (r.kind === 'ambiguous') return `There are multiple "${title}" events on ${date}: ${r.message}. Which one? Re-call with currentTime set.`;
    const researchEntry = calMeta.get(r.calId);
    if (researchEntry && !isWritable(researchEntry.accessRole)) {
      const eventName = (r.event.summary ?? '').replace(/^⚡\s*/, '');
      return `"${eventName}" is on a calendar you can only view ("${researchEntry.summary}") — I can't add notes to it from here.`;
    }
    let findings = '';
    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const res = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 900,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }] as never,
        messages: [{ role: 'user', content: `Research this and produce ONLY clean plain-text notes for a calendar event — nothing else.
Rules:
- One result per block. For each: Name, then "Phone: ...", "Email: ...", "Website: ...", "Address: ..." (include a field only if it applies; for contact fields you can't find after searching, write "Phone: not found" / "Email: not found").
- Always try to find a phone AND an email/website for each.
- NO markdown (no asterisks, no bold, no headings). NO introduction, NO commentary, NO "I cannot find", NO "please verify", NO questions back to me.
- Up to 6 results, most relevant first.
- If you genuinely find nothing relevant, output exactly: NO_RESULTS

Query: ${query}` }],
      });
      // Keep only the FINAL text block — the model narrates "I'll search…" in earlier text
      // blocks between web searches, which would otherwise pollute the note.
      const textBlocks = res.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text);
      findings = (textBlocks[textBlocks.length - 1] ?? '').trim();
      // Clean up: strip markdown, list bullets, collapse blank lines.
      findings = findings.replace(/[*_#`]+/g, '').replace(/^\s*[-•]\s*/gm, '').replace(/\n{3,}/g, '\n\n').trim();
    } catch (err) {
      console.error('[researchToEvent] web search failed:', err);
      return `I tried to research "${query}" but the lookup failed — you may need to do that one manually.`;
    }
    // Don't pollute the notes with "couldn't find / please verify" rambles.
    if (!findings || /^NO_RESULTS/i.test(findings) || /^(i (can'?t|cannot|could ?n'?t|was unable)|please verify|i'?m unable|no results)/i.test(findings)) {
      return `I searched for "${query}" but couldn't find solid results, so I didn't add anything — you may want to refine the request.`;
    }
    const e = r.event;
    // Replace any prior research block but KEEP the user's own typed notes, so re-researching
    // shows only the latest findings instead of an ever-growing pile.
    const userNotes = stripResearchBlock(e.description);
    const block = `${RESEARCH_OPEN}\n${query}:\n${findings}\n${RESEARCH_CLOSE}`;
    const newDescription = userNotes ? `${userNotes}\n\n${block}` : block;
    const researchPatched = await cal.events.patch({ calendarId: r.calId, eventId: e.id!, requestBody: { description: newDescription } });
    if (!researchPatched.data.id) return `I researched "${query}" but couldn't confirm it saved — please double-check.`;
    recordUndo(userId, `added research notes to "${(e.summary ?? '').replace(/^⚡\s*/, '')}"`, [{ type: 'patch', calId: r.calId, eventId: e.id!, requestBody: { description: e.description ?? '' } }]);
    return `Done — researched "${query}" and added the findings to "${(e.summary ?? '').replace(/^⚡\s*/, '')}"'s notes.`;

  } else if (fn === 'createEvent') {
    let { startDateTime, endDateTime } = args as { startDateTime: string; endDateTime: string };
    const { title, timezone, color, overrideConflicts, allDay, endDate, description, location } = args as { title: string; timezone: string; color?: string; overrideConflicts?: boolean; allDay?: boolean; endDate?: string; description?: string; location?: string };
    if (!title) return "I didn't catch what to call that event — what's the title?";

    // All-day event: date-only start/end. `endDate` is the LAST day the event covers (inclusive);
    // Google's end.date is exclusive, so we store the day after. One spanning event for a range —
    // no per-day loop. Omit endDate for a single-day all-day event.
    if (allDay) {
      const startOnly = (startDateTime || endDateTime || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startOnly)) return "I didn't catch the date for that all-day event — what day is it?";
      const endOnly = (endDate || '').slice(0, 10);
      const lastDay = /^\d{4}-\d{2}-\d{2}$/.test(endOnly) && endOnly >= startOnly ? endOnly : startOnly;
      // Anti-duplication guard: never create an all-day event that already exists on that
      // date (e.g. re-adding "Dad's birthday" while booking around it). Checks the live
      // calendar, not just the in-memory retry claim, so it catches model-driven dupes.
      const dupWin = (await Promise.all(calIds.map(calId =>
        cal.events.list({ calendarId: calId, timeMin: `${prevDay(startOnly)}T00:00:00Z`, timeMax: `${nextDay(nextDay(lastDay))}T00:00:00Z`, singleEvents: true }).then(r => r.data.items ?? []).catch(() => [] as calendar_v3.Schema$Event[])
      ))).flat();
      const normTitle = (s: string) => s.replace(/^⚡\s*/, '').trim().toLowerCase();
      if (dupWin.some(ev => ev.start?.date && !ev.start?.dateTime && normTitle(ev.summary ?? '') === normTitle(title))) {
        return `"${title}" is already on your calendar around then — I won't create a duplicate. It's still there; nothing changed.`;
      }
      if (!claimEventCreate(userId, buildEventDedupeKey(title, lastDay === startOnly ? startOnly : `${startOnly}..${lastDay}`))) {
        const span = lastDay === startOnly ? `on ${startOnly}` : `from ${startOnly} to ${lastDay}`;
        return `All-day "${title}" ${span} was just created — looks like a retry. If you need a separate event, wait a moment and try again.`;
      }
      const insAllDay = await cal.events.insert({ calendarId: 'primary', requestBody: {
        summary: `⚡ ${title}`, start: { date: startOnly }, end: { date: nextDay(lastDay) }, colorId: color ? getColorId(color) : '9',
        ...(description ? { description } : {}),
        ...(location ? { location } : {}),
      } });
      if (!insAllDay.data.id) return `Couldn't confirm the all-day "${title}" saved — please double-check your calendar.`;
      recordUndo(userId, `created all-day "${title}"`, [{ type: 'delete', calId: 'primary', eventId: insAllDay.data.id }]);
      const span = lastDay === startOnly ? `on ${startOnly}` : `from ${startOnly} to ${lastDay}`;
      return `Created and confirmed all-day "${title}" ${span}.`;
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
      const winEvents = (await Promise.all(calIds.map(calId =>
        cal.events.list({ calendarId: calId, timeMin: winMin, timeMax: winMax, singleEvents: true }).then(r => r.data.items ?? []).catch(() => [] as calendar_v3.Schema$Event[])
      ))).flat();
      for (const ev of winEvents) {
        // All-day events (date, not dateTime) are context, not a hard time block — never a conflict.
        if (ev.start?.date && !ev.start?.dateTime) continue;
        if (!/\b(hold|block|tentative|maybe|tbd)\b/i.test(ev.summary ?? '') && ev.summary !== `⚡ ${title}`) conflicts.push(ev.summary ?? 'Untitled');
      }
      if (conflicts.length > 0) {
        return `⚠️ Conflict: "${conflicts.join('", "')}" already at that time. Want me to book "${title}" over it anyway? If they confirm, call createEvent again with overrideConflicts set to true.`;
      }
    }
    // Anti-duplication guard (timed): refuse to create an event identical to one already
    // on the calendar — same title at the same wall-clock start. This is the corruption from
    // the "copied the whole day" call, which replicated walks/meals/gym across the week.
    // Runs regardless of overrideConflicts (overriding a conflict ≠ duplicating the same event).
    {
      const dt = startDateTime.slice(0, 10);
      const existingTimed = (await Promise.all(calIds.map(calId =>
        cal.events.list({ calendarId: calId, timeMin: `${prevDay(dt)}T00:00:00Z`, timeMax: `${nextDay(nextDay(dt))}T00:00:00Z`, singleEvents: true }).then(r => r.data.items ?? []).catch(() => [] as calendar_v3.Schema$Event[])
      ))).flat();
      const nT = (s: string) => s.replace(/^⚡\s*/, '').trim().toLowerCase();
      if (existingTimed.some(ev => ev.start?.dateTime && nT(ev.summary ?? '') === nT(title) && ev.start.dateTime.slice(0, 16) === startDateTime.slice(0, 16))) {
        return `"${title}" is already on your calendar at that time — I won't create a duplicate. Nothing changed.`;
      }
    }
    if (!claimEventCreate(userId, buildEventDedupeKey(title, startDateTime))) {
      return `"${title}" on ${startDateTime.slice(0, 10)} at ${startDateTime.slice(11, 16)} was just created — looks like a retry. If you need a separate event, wait a moment and try again.`;
    }
    const rb: calendar_v3.Schema$Event = { summary: `⚡ ${title}`, start: { dateTime: startDateTime, timeZone: timezone }, end: { dateTime: endDateTime, timeZone: timezone }, colorId: color ? getColorId(color) : '9', ...(description ? { description } : {}), ...(location ? { location } : {}) };
    const insTimed = await cal.events.insert({ calendarId: 'primary', requestBody: rb });
    if (!insTimed.data.id) return `Couldn't confirm "${title}" saved — please double-check your calendar.`;
    recordUndo(userId, `created "${title}"`, [{ type: 'delete', calId: 'primary', eventId: insTimed.data.id }]);
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
    if (!claimEventCreate(userId, buildEventDedupeKey(title, `${startDate}T${startTime}`))) {
      return `Recurring "${title}" starting ${startDate} at ${startTime} was just created — looks like a retry.`;
    }
    const rb: calendar_v3.Schema$Event = { summary: `⚡ ${title}`, start: { dateTime: `${startDate}T${startTime}:00`, timeZone: timezone }, end: { dateTime: `${startDate}T${endTime}:00`, timeZone: timezone }, recurrence: [fullRrule], colorId: color ? getColorId(color) : '9' };
    const insRec = await cal.events.insert({ calendarId: 'primary', requestBody: rb });
    if (!insRec.data.id) return `Couldn't confirm recurring "${title}" saved — please double-check your calendar.`;
    recordUndo(userId, `created recurring "${title}"`, [{ type: 'delete', calId: 'primary', eventId: insRec.data.id }]);
    return `Created recurring "${title}" from ${startDate} at ${startTime} ${timezone}.`;

  } else if (fn === 'deleteEvent') {
    const { title, date, deleteAll, recurringScope, currentTime, confirmToken, targetEndDate } = args as { title: string; date: string; deleteAll?: boolean; recurringScope?: 'this' | 'thisAndFollowing' | 'all'; currentTime?: string; confirmToken?: string; targetEndDate?: string };
    let dayMatches = await eventsOnDay(cal, calIds, date, tz);

    // All-day disambiguation: if the caller supplied targetEndDate, narrow all-day events to
    // the one whose last inclusive day matches — leaves timed events unaffected.
    if (targetEndDate) {
      const exclusive = nextDay(targetEndDate);
      dayMatches = dayMatches.filter(({ event }) =>
        !event.start?.date || event.end?.date === exclusive
      );
    }

    // Which events to delete: all title matches (deleteAll), or one precisely-resolved event.
    let toDelete: { event: calendar_v3.Schema$Event; calId: string }[];
    if (deleteAll) {
      toDelete = dayMatches.filter(m => titleMatchScore(m.event.summary ?? '', title) > 0);
      if (!toDelete.length) return `No event matching "${title}" on ${date}.`;
    } else {
      const r = resolveEvent(dayMatches, title, tz, currentTime);
      if (r.kind === 'none') return `No event matching "${title}" on ${date}.`;
      if (r.kind === 'ambiguous') {
        // All-day events can't be disambiguated by time — direct the model to use targetEndDate.
        const hasAllDay = dayMatches.some(m => m.event.start?.date && !m.event.start?.dateTime && titleMatchScore(m.event.summary ?? '', title) > 0);
        if (hasAllDay) {
          return `There are multiple "${title}" all-day events starting ${date}: ${r.message}. Ask the user which date span, then call deleteEvent again with targetEndDate set to the last inclusive day (e.g. "${date}" for a single-day event, or "2026-06-28" for a June 25–28 event).`;
        }
        return `There are multiple "${title}" events on ${date}: ${r.message}. Which one should I delete? Ask the user, then call deleteEvent again with currentTime set to that event's start time (e.g. "7pm").`;
      }
      toDelete = [{ event: r.event, calId: r.calId }];
    }

    // Read-only check: refuse mutations on calendars where we only have view access.
    // This prevents a misleading "reconnect" error — the real issue is the calendar is shared/subscribed.
    const readOnlyItems = toDelete.filter(({ calId }) => {
      const entry = calMeta.get(calId);
      return entry && !isWritable(entry.accessRole);
    });
    if (readOnlyItems.length === toDelete.length) {
      const entry = calMeta.get(readOnlyItems[0].calId);
      const calName = entry?.summary ?? 'that calendar';
      const eventName = (readOnlyItems[0].event.summary ?? '').replace(/^⚡\s*/, '');
      return `"${eventName}" is on a read-only calendar — I can't remove it from here. Let me know if there's something else I can help with.`;
    }
    if (readOnlyItems.length > 0) {
      toDelete = toDelete.filter(({ calId }) => {
        const entry = calMeta.get(calId);
        return !entry || isWritable(entry.accessRole);
      });
    }

    // Recurring scope must be known before we can confirm or delete.
    const needsScope = toDelete.find(({ event }) => event.recurringEventId && !recurringScope);
    if (needsScope) {
      return `"${needsScope.event.summary}" is a recurring event. Should I delete just this occurrence, this and all future ones, or all occurrences? Say "just this one", "this and future", or "all".`;
    }

    // HARD CONFIRMATION GATE (#9) — server-issued one-time token prevents model self-confirmation.
    // First call: server issues a token embedded in the response; model cannot mint its own.
    // Second call: model presents the token it received; server verifies + consumes (one-time use).
    if (!confirmToken) {
      const token = issueDeleteToken(userId);
      return `⚠️ Just confirming before I delete ${describeDeleteTargets(toDelete, recurringScope, tz)} — should I go ahead? Ask the user, and ONLY if they say yes, call deleteEvent again with confirmToken set to "${token}" (keep the same title, date, currentTime and recurringScope). Token expires in 2 minutes.`;
    }
    if (!consumeDeleteToken(userId, confirmToken)) {
      // Token invalid, expired, or already used — re-issue so the user can try again.
      const token = issueDeleteToken(userId);
      return `⚠️ That confirmation code was invalid or expired. To delete ${describeDeleteTargets(toDelete, recurringScope, tz)}, call deleteEvent again with the new confirmToken: "${token}". Token expires in 2 minutes.`;
    }

    // Honest failure: only report an event as deleted if the Google call actually succeeded.
    const deleted: string[] = [];
    const failedDel: string[] = [];
    const recreates: UndoOp[] = [];
    for (const { event: ev, calId } of toDelete) {
      let ok = false;
      try {
        if (ev.recurringEventId && recurringScope === 'thisAndFollowing') {
          await cal.events.patch({ calendarId: calId, eventId: ev.recurringEventId, requestBody: { recurrence: [`RRULE:FREQ=DAILY;UNTIL=${date.replace(/-/g, '')}`] } });
        } else if (ev.recurringEventId && recurringScope === 'all') {
          await cal.events.delete({ calendarId: calId, eventId: ev.recurringEventId });
        } else {
          await cal.events.delete({ calendarId: calId, eventId: ev.id! });
        }
        ok = true;
      } catch (delErr) {
        console.error(`[deleteEvent] failed calId=${calId} accessRole=${calMeta.get(calId)?.accessRole ?? 'unknown'}:`, delErr);
        ok = false;
      }
      if (ok) {
        deleted.push(ev.summary ?? ev.id!);
        // Record undo (recreate) only for the non-recurring single events we ACTUALLY removed.
        if (!ev.recurringEventId) recreates.push({ type: 'recreate', calId, event: cleanForRecreate(ev) });
      } else {
        failedDel.push(ev.summary ?? ev.id!);
      }
    }
    if (recreates.length) recordUndo(userId, `deleted ${describeDeleteTargets(toDelete, recurringScope, tz)}`, recreates);
    if (!deleted.length) {
      return failedDel.length
        ? `I hit a snag removing ${failedDel.join(', ')} — couldn't clear ${failedDel.length > 1 ? 'those' : 'that one'} from here.`
        : `No event matching "${title}" on ${date}.`;
    }
    return failedDel.length
      ? `Deleted: ${deleted.join(', ')}. Hit a snag on ${failedDel.join(', ')} — couldn't remove ${failedDel.length > 1 ? 'those' : 'that one'} from here.`
      : `Deleted: ${deleted.join(', ')}`;

  } else if (fn === 'moveEvent') {
    const { title, date, newStartDateTime, newEndDateTime, newStartDate, newEndDate, timezone, recurringScope, currentTime, targetEndDate } = args as { title: string; date: string; newStartDateTime: string; newEndDateTime: string; newStartDate?: string; newEndDate?: string; timezone: string; recurringScope?: 'this' | 'all'; currentTime?: string; targetEndDate?: string };
    let moveMatches = await eventsOnDay(cal, calIds, date, tz);
    if (targetEndDate) {
      const exclusive = nextDay(targetEndDate);
      moveMatches = moveMatches.filter(({ event }) =>
        !event.start?.date || event.end?.date === exclusive
      );
    }
    const r = resolveEvent(moveMatches, title, tz, currentTime);
    if (r.kind === 'none') return `No event matching "${title}" on ${date}.`;
    if (r.kind === 'ambiguous') {
      const hasAllDay = moveMatches.some(m => m.event.start?.date && !m.event.start?.dateTime && titleMatchScore(m.event.summary ?? '', title) > 0);
      if (hasAllDay) {
        return `There are multiple "${title}" all-day events starting ${date}: ${r.message}. Ask the user which date span, then call moveEvent again with targetEndDate set to the last inclusive day (e.g. "${date}" for a single-day event, or "2026-06-28" for a June 25–28 event).`;
      }
      return `There are multiple "${title}" events on ${date}: ${r.message}. Which one should I move? Ask the user, then call moveEvent again with currentTime set to that event's start time (e.g. "7pm").`;
    }
    const found = r;
    const moveEntry = calMeta.get(found.calId);
    if (moveEntry && !isWritable(moveEntry.accessRole)) {
      const eventName = (found.event.summary ?? '').replace(/^⚡\s*/, '');
      return `"${eventName}" is on a read-only calendar — I can't move it from here. Want me to draft a note to the organizer about rescheduling?`;
    }
    if (!canUserReschedule(found.event)) {
      const eventName = (found.event.summary ?? '').replace(/^⚡\s*/, '');
      const org = found.event.organizer;
      const orgId = org?.displayName || org?.email || 'the organizer';
      return `"${eventName}" was set up by ${orgId} — Google only lets the organizer reschedule it, so I can't move it from your side. Want me to draft a quick message to ${orgId} requesting a different time?`;
    }
    if (found.event.recurringEventId && !recurringScope) {
      return `"${found.event.summary}" is a recurring event. Should I move just this occurrence or all occurrences? Say "just this one" or "all".`;
    }
    const eventId = (recurringScope === 'all' && found.event.recurringEventId) ? found.event.recurringEventId : found.event.id!;

    // Three distinct move paths:
    // 1. All-day → all-day re-date: use date-only patch.
    // 2. Timed + date-only input (newStartDate, no newStartDateTime): preserve wall-clock time on the new date.
    //    (Previously fell into path 1, silently converting the event to all-day and destroying its time.)
    // 3. Timed + full datetime: model supplied explicit newStartDateTime/newEndDateTime.
    const isAllDay = !!(found.event.start?.date && !found.event.start?.dateTime);
    let rb: calendar_v3.Schema$Event;
    let confirmWhen: string;
    if (recurringScope === 'all' && found.event.recurringEventId && !isAllDay) {
      // Path 0: move the WHOLE recurring series to a new time. Fetch the master and
      // change only its time-of-day, keeping its anchor date so the recurrence rule
      // stays aligned. (Patching the master with the model's absolute future date
      // re-anchored the series and Google rejected it — the "gym to 2pm" failure.)
      const master = await cal.events.get({ calendarId: found.calId, eventId }).then(g => g.data).catch(() => null);
      const startTime = (newStartDateTime || found.event.start?.dateTime || '').slice(11, 19);
      const endTime = (newEndDateTime || '').slice(11, 19);
      if (!master?.start?.dateTime || !/^\d{2}:\d{2}/.test(startTime)) {
        console.error(`[moveEvent] recurring-all could not read master calId=${found.calId} eventId=${eventId}`);
        return `I couldn't retime the whole "${(found.event.summary ?? '').replace(/^⚡\s*/, '')}" series just now — I'll flag it to get sorted. Want me to move just the next occurrence instead?`;
      }
      const masterTz = master.start.timeZone ?? timezone;
      rb = recurringSeriesTimeShift(master.start.dateTime, master.end?.dateTime ?? '', startTime, endTime, masterTz);
      confirmWhen = `${startTime.slice(0, 5)} ${masterTz}`;
    } else if (isAllDay) {
      // Path 1: all-day re-date.
      const existingStart = (found.event.start?.date ?? '').slice(0, 10);
      const startD = (newStartDate || newStartDateTime || existingStart || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startD)) return "I need a date to move that all-day event to — what day should it start?";
      const endIn = (newEndDate || newEndDateTime || '').slice(0, 10);
      const lastDay = /^\d{4}-\d{2}-\d{2}$/.test(endIn) && endIn >= startD ? endIn : startD;
      rb = { start: { date: startD }, end: { date: nextDay(lastDay) } };
      confirmWhen = lastDay === startD ? startD : `${startD} to ${lastDay}`;
    } else if (newStartDate && !newStartDateTime) {
      // Path 2: timed event + date-only input — preserve wall-clock time.
      const eventTz = found.event.start?.timeZone ?? timezone;
      const timedPatch = timedEventDateMove(
        found.event.start?.dateTime ?? '',
        found.event.end?.dateTime ?? '',
        newStartDate,
        eventTz,
      );
      rb = timedPatch;
      confirmWhen = `${newStartDate} (same time, ${eventTz})`;
    } else {
      // Path 3: full datetime move (non-recurring, or single occurrence with explicit datetime).
      // Robust timezone: a move/resize never changes the zone, so prefer the event's OWN timeZone;
      // fall back to a valid model-supplied tz, then the user's tz. A bad/empty model `timezone`
      // would otherwise make Google 400 the start/end patch (while colorEvent, which sends no tz,
      // still succeeds) — the exact "color worked, move didn't" failure.
      const moveTz = found.event.start?.timeZone || (isValidTimeZone(timezone) ? timezone : tz);
      rb = { start: { dateTime: newStartDateTime, timeZone: moveTz }, end: { dateTime: newEndDateTime, timeZone: moveTz } };
      confirmWhen = `${newStartDateTime.slice(11, 16)} ${moveTz} on ${newStartDateTime.slice(0, 10)}`;
    }
    if (found.event.colorId) rb.colorId = found.event.colorId;
    const origStart = found.event.start;
    const origEnd = found.event.end;
    const patched = await cal.events.patch({ calendarId: found.calId, eventId, requestBody: rb }).catch((moveErr: unknown) => {
      console.error(`[moveEvent] failed calId=${found.calId} accessRole=${calMeta.get(found.calId)?.accessRole ?? 'unknown'} rb=${JSON.stringify(rb)}:`, moveErr instanceof Error ? moveErr.message : moveErr);
      return null;
    });
    if (!patched || !patched.data.id) return `Couldn't get that shift through for "${(found.event.summary ?? '').replace(/^⚡\s*/, '')}" — want me to draft a message to the organizer requesting a different time?`;
    // Undo = move it back to where it was (single-occurrence moves only — 'all' has no clean inverse here).
    if (recurringScope !== 'all' && origStart && origEnd) {
      recordUndo(userId, `moved "${(found.event.summary ?? '').replace(/^⚡\s*/, '')}"`, [{ type: 'patch', calId: found.calId, eventId, requestBody: { start: origStart, end: origEnd } }]);
    }
    return `Moved and confirmed "${(found.event.summary ?? '').replace(/^⚡\s*/, '')}" to ${confirmWhen}${recurringScope === 'all' ? ' (all occurrences)' : ''}.`;

  } else if (fn === 'colorEvent') {
    const { title, date, color } = args as { title: string; date: string; color: string };
    const colorId = getColorId(color);
    const tMin = date === 'all' ? new Date().toISOString() : dayRangeUtc(tz, date).start.toISOString();
    const tMax = date === 'all' ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : dayRangeUtc(tz, date).end.toISOString();
    const lists = await Promise.all(calIds.map(calId =>
      cal.events.list({ calendarId: calId, timeMin: tMin, timeMax: tMax, singleEvents: true, maxResults: 100 }).then(r => ({ calId, items: r.data.items ?? [] })).catch(() => ({ calId, items: [] as calendar_v3.Schema$Event[] }))
    ));
    const allMatched = lists.flatMap(l => l.items.filter(e => titleMatchScore(e.summary ?? '', title) > 0).map(e => ({ calId: l.calId, id: e.id!, prevColor: e.colorId ?? '9' })));
    const toColor = allMatched.filter(x => {
      const entry = calMeta.get(x.calId);
      return !entry || isWritable(entry.accessRole);
    });
    await Promise.all(toColor.map(x => cal.events.patch({ calendarId: x.calId, eventId: x.id, requestBody: { colorId } }).catch(() => undefined)));
    if (toColor.length) recordUndo(userId, `recolored ${toColor.length} "${title}" event(s)`, toColor.map(x => ({ type: 'patch', calId: x.calId, eventId: x.id, requestBody: { colorId: x.prevColor } })));
    const skippedColor = allMatched.length - toColor.length;
    const skippedNote = skippedColor > 0 ? ` (${skippedColor} on read-only calendars skipped)` : '';
    if (!allMatched.length) return `No events matching "${title}" found.`;
    if (!toColor.length) return `All "${title}" events are on calendars you can only view — no color changes made.`;
    return `Changed ${toColor.length} "${title}" event(s) to ${color}${skippedNote}.`;

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
    const allEvents: calendar_v3.Schema$Event[] = (await Promise.all(calIds.map(calId =>
      cal.events.list({ calendarId: calId, timeMin: new Date(`${weekStartDate}T00:00:00Z`).toISOString(), timeMax: new Date(`${weekEndStr}T23:59:59Z`).toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 100 }).then(r => r.data.items ?? []).catch(() => [] as calendar_v3.Schema$Event[])
    ))).flat();
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
    if (!claimEventCreate(userId, `copyDay:${sourceDate}:${targetDates.slice().sort().join(',')}`)) {
      return `Those events were just copied from ${sourceDate} — looks like a retry. They should already be on your calendar.`;
    }
    const userTz = effectiveTimezone(userQueries.findById(userId) ?? {});
    const { start: sMin, end: sMax } = dayRangeUtc(userTz, sourceDate);
    const src: calendar_v3.Schema$Event[] = (await Promise.all(calIds.map(calId =>
      cal.events.list({ calendarId: calId, timeMin: sMin.toISOString(), timeMax: sMax.toISOString(), singleEvents: true, orderBy: 'startTime' }).then(r => r.data.items ?? []).catch(() => [] as calendar_v3.Schema$Event[])
    ))).flat().filter(e => e.start?.dateTime && e.end?.dateTime); // timed events only (skip all-day)
    if (!src.length) return `No timed events found on ${sourceDate} to copy.`;

    let created = 0;
    const titles = new Set<string>();
    const createdIds: string[] = [];
    const inserts: Promise<unknown>[] = [];
    for (const target of targetDates) {
      for (const ev of src) {
        const evTz = ev.start!.timeZone || userTz;
        const startWall = ev.start!.dateTime!.slice(11, 19); // HH:MM:SS in the event's local time
        const durMs = new Date(ev.end!.dateTime!).getTime() - new Date(ev.start!.dateTime!).getTime();
        const newStart = wallTimeToUtc(`${target}T${startWall}`, evTz);
        const newEnd = new Date(newStart.getTime() + durMs);
        inserts.push(cal.events.insert({ calendarId: 'primary', requestBody: {
          summary: ev.summary || '⚡ Event',
          start: { dateTime: newStart.toISOString() },
          end: { dateTime: newEnd.toISOString() },
          colorId: ev.colorId || undefined,
        } }).then(r => { created++; titles.add((ev.summary || '').replace(/^⚡\s*/, '')); if (r.data.id) createdIds.push(r.data.id); }).catch(() => undefined));
      }
    }
    await Promise.all(inserts);
    if (createdIds.length) recordUndo(userId, `copied ${src.length} event(s) to ${targetDates.length} day(s)`, [{ type: 'deleteMany', calId: 'primary', eventIds: createdIds }]);
    return created
      ? `Copied ${src.length} event(s) (${[...titles].join(', ')}) from ${sourceDate} to ${targetDates.length} day(s) — ${created} created.`
      : `Couldn't copy events from ${sourceDate}.`;

  } else if (fn === 'draftEmail') {
    // Draft (never send) a personalized outreach email per recipient, optionally proposing the
    // user's real open slots. Composition lives in lib/outreach.ts (Core); the actual draft is
    // created by Security's guarded, draft-only createDraft (lib/gmail.ts). Undo deletes the drafts.
    const { recipients, title, date, ask, proposeAvailability, startDate, endDate, subject } = args as {
      recipients?: { name?: string; email?: string }[];
      title?: string;
      date?: string;
      ask?: string;
      proposeAvailability?: boolean;
      startDate?: string;
      endDate?: string;
      subject?: string;
    };
    if (!ask || !ask.trim()) return 'What should I ask them in the email?';

    // Recipients: prefer an explicit list; otherwise read them from the research notes on the
    // referenced event (title + date) — the model only has to name the event, not build the list.
    let sourceRecipients: { name?: string; email?: string }[] = Array.isArray(recipients) ? recipients : [];
    if (!sourceRecipients.length && title && date) {
      const er = resolveEvent(await eventsOnDay(cal, calIds, date, tz), title, tz);
      if (er.kind === 'none') return `I couldn't find an event matching "${title}" on ${date} to pull contacts from.`;
      if (er.kind === 'ambiguous') return `There are multiple "${title}" events on ${date}: ${er.message}. Which one has the contacts?`;
      sourceRecipients = recipientsFromNotes(er.event.description ?? '');
      if (!sourceRecipients.length) return `I found "${title}" on ${date}, but couldn't pull any contacts with emails from its notes. Research them first so the emails are saved.`;
    }
    if (!sourceRecipients.length) return "Tell me who to email — point me to the event that has the research, or give me names and emails.";

    // Prefer user-typed name spellings over STT-transcribed ones.
    // (1) If a recipient's email matches the user's own, use their profile name.
    // (2) If the event title has a name token that fuzzy-matches a notes name, prefer title.
    // This reduces errors like "Derek" (transcribed) → "Derrick" (user-typed in title).
    const userRow = userQueries.findById(userId);
    sourceRecipients = correctRecipientNames(sourceRecipients, {
      eventTitle: title,
      userEmail: userRow?.email,
      userName: userRow?.name,
    });

    const { ok, skipped } = emailableRecipients(sourceRecipients);
    if (!ok.length) {
      return `I couldn't draft anything — none of those contacts had a usable email${skipped.length ? ` (missing for ${skipped.join(', ')})` : ''}. Research them first to find emails, then try again.`;
    }

    const senderName = userRow?.name?.trim() || 'Me';

    // Availability: default to a one-week window starting today (in the user's tz).
    let slots: string[] = [];
    if (proposeAvailability !== false) {
      const start = startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : todayInTz(tz);
      let end = endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : '';
      if (!end || end < start) {
        const d = new Date(`${start}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 6);
        end = d.toISOString().slice(0, 10);
      }
      const evMin = dayRangeUtc(tz, start).start.toISOString();
      const evMax = dayRangeUtc(tz, end).end.toISOString();
      const evts: calendar_v3.Schema$Event[] = (await Promise.all(calIds.map(calId =>
        cal.events.list({ calendarId: calId, timeMin: evMin, timeMax: evMax, singleEvents: true, orderBy: 'startTime', maxResults: 250 }).then(r => r.data.items ?? []).catch(() => [] as calendar_v3.Schema$Event[])
      ))).flat();
      slots = formatSlotsForEmail(findFreeSlots(evts, tz, start, end, 30));
    }

    // Compose + draft all recipients in PARALLEL so the tool returns quickly — a sequential
    // per-recipient Claude+Gmail loop was slow enough to trip the call's 30s silence timeout.
    const results = await Promise.all(ok.map(async (recipient): Promise<{ ok: true; name: string; draftId: string } | { ok: false; name: string; fatal: unknown }> => {
      try {
        const composed = await composeOutreachEmail({ recipient, senderName, ask, slots, subject, userTimezone: tz });
        const to = recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email;
        const { draftId, threadId } = await createDraft(userId, { to, subject: composed.subject, body: composed.body });
        // Email-reply tracking (Phase 1): remember this outreach thread so Edge can watch it
        // for replies later. Only threads Edge itself drafts are ever recorded.
        if (threadId) watchedThreadQueries.register(userId, threadId, recipient.name || recipient.email, ask, title, date);
        return { ok: true, name: recipient.name || recipient.email, draftId };
      } catch (perErr) {
        if (perErr instanceof GmailScopeError || perErr instanceof GmailRateLimitError) return { ok: false, name: recipient.name || recipient.email, fatal: perErr };
        console.error(`[draftEmail] draft failed for ${recipient.email}:`, perErr);
        return { ok: false, name: recipient.name || recipient.email, fatal: null };
      }
    }));

    const undoOps: UndoOp[] = [];
    const draftedFor: string[] = [];
    const failed: string[] = [];
    let fatalErr: unknown = null;
    for (const res of results) {
      if (res.ok) { undoOps.push({ type: 'deleteDraft', userId, draftId: res.draftId }); draftedFor.push(res.name); }
      else if (res.fatal) { fatalErr = res.fatal; }
      else { failed.push(res.name); }
    }
    if (undoOps.length) recordUndo(userId, `drafted ${undoOps.length} email(s)`, undoOps);
    if (fatalErr instanceof GmailScopeError) {
      return "I can't create email drafts yet — you'll need to re-approve Google so I can use Gmail. Open the dashboard and reconnect your Google account; this time it'll ask for email/draft permission.";
    }
    if (fatalErr instanceof GmailRateLimitError) {
      return `Couldn't finish — ${fatalErr.message}${undoOps.length ? ` I did draft ${undoOps.length} before hitting the limit; they're in your Gmail.` : ''}`;
    }
    if (!draftedFor.length) return `Couldn't create any drafts${failed.length ? ` — Gmail errored for ${failed.join(', ')}` : ''}. Please try again.`;
    const notes = [
      skipped.length ? `skipped ${skipped.join(', ')} (no email on file)` : '',
      failed.length ? `couldn't draft for ${failed.join(', ')}` : '',
    ].filter(Boolean);
    return `Drafted ${draftedFor.length} email(s) in your Gmail — review and send.${notes.length ? ` I ${notes.join('; and ')}.` : ''}`;

  } else if (fn === 'cleanupEvents') {
    // Batch delete for consolidation cleanup — deletes a list of events by EXACT start time,
    // bypassing fuzzy-title resolution that would otherwise hit the newly-created merged event.
    const { events: eventList, confirmToken } = args as {
      events: Array<{ title: string; startDateTime?: string; startDate?: string; targetEndDate?: string }>;
      confirmToken?: string;
    };
    if (!Array.isArray(eventList) || !eventList.length) return 'I need a list of events to clean up.';

    // Resolve each spec by exact datetime — avoids fuzzy-title collision on the merged event.
    const resolved: { event: calendar_v3.Schema$Event; calId: string }[] = [];
    const unresolved: string[] = [];
    for (const spec of eventList) {
      const date = (spec.startDateTime ?? spec.startDate ?? '').slice(0, 10);
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        unresolved.push(`"${spec.title}" (no date)`);
        continue;
      }
      let dayMatches = await eventsOnDay(cal, calIds, date, tz);
      if (spec.targetEndDate) {
        const exclusive = nextDay(spec.targetEndDate);
        dayMatches = dayMatches.filter(({ event }) => !event.start?.date || event.end?.date === exclusive);
      }
      const match = resolveEventExact(dayMatches, spec.title, spec.startDateTime, spec.startDate);
      if (!match) {
        unresolved.push(`"${spec.title}" on ${date} (not found or ambiguous)`);
        continue;
      }
      resolved.push(match);
    }

    if (!resolved.length) {
      return `Couldn't find any of the events to clean up${unresolved.length ? `: ${unresolved.join('; ')}` : ''}.`;
    }

    const writableResolved = resolved.filter(({ calId }) => {
      const entry = calMeta.get(calId);
      return !entry || isWritable(entry.accessRole);
    });
    const readOnlyResolved = resolved.filter(({ calId }) => {
      const entry = calMeta.get(calId);
      return entry && !isWritable(entry.accessRole);
    });
    const nameList = (items: { event: calendar_v3.Schema$Event }[]) =>
      items.map(m => `"${(m.event.summary ?? '').replace(/^⚡\s*/, '')}"`).join(', ');

    if (!writableResolved.length) {
      return `All resolved events are on calendars you can only view — no deletions made.`;
    }

    // SINGLE confirmation gate for the whole batch.
    if (!confirmToken) {
      const token = issueDeleteToken(userId);
      const roNote = readOnlyResolved.length ? ` (${readOnlyResolved.length} on read-only calendars will be skipped)` : '';
      const unresolvedNote = unresolved.length ? ` Couldn't find: ${unresolved.join('; ')}.` : '';
      return `⚠️ Just confirming before I delete ${writableResolved.length} event(s): ${nameList(writableResolved)}${roNote}.${unresolvedNote} Should I go ahead? ONLY if the user says yes, call cleanupEvents again with the same events list and confirmToken set to "${token}". Token expires in 2 minutes.`;
    }
    if (!consumeDeleteToken(userId, confirmToken)) {
      const token = issueDeleteToken(userId);
      return `⚠️ That confirmation code was invalid or expired. To delete ${nameList(writableResolved)}, call cleanupEvents again with the new confirmToken: "${token}". Token expires in 2 minutes.`;
    }

    const deleted: string[] = [];
    const failedDel: string[] = [];
    const recreates: UndoOp[] = [];
    for (const { event: ev, calId } of writableResolved) {
      try {
        await cal.events.delete({ calendarId: calId, eventId: ev.id! });
        deleted.push((ev.summary ?? ev.id!).replace(/^⚡\s*/, ''));
        recreates.push({ type: 'recreate', calId, event: cleanForRecreate(ev) });
      } catch (cleanErr) {
        console.error(`[cleanupEvents] delete failed calId=${calId}:`, cleanErr);
        failedDel.push((ev.summary ?? ev.id!).replace(/^⚡\s*/, ''));
      }
    }
    if (recreates.length) recordUndo(userId, `batch-deleted ${recreates.length} event(s)`, recreates);

    const parts: string[] = [];
    if (deleted.length) parts.push(`Deleted: ${deleted.join(', ')}`);
    if (failedDel.length) parts.push(`Couldn't delete: ${failedDel.join(', ')}`);
    if (readOnlyResolved.length) parts.push(`Skipped (read-only): ${nameList(readOnlyResolved)}`);
    if (unresolved.length) parts.push(`Not found: ${unresolved.join('; ')}`);
    return parts.join('. ') || 'Done.';

  } else if (fn === 'cleanupDuplicates') {
    // Scan a date window for duplicate events (same normalized title + same minute), keep the
    // earliest-created copy of each, delete the rest with a single confirmation token.
    const { startDate: sdArg, endDate: edArg, confirmToken } = args as {
      startDate?: string;
      endDate?: string;
      confirmToken?: string;
    };
    const today = todayInTz(tz);
    const windowStart = sdArg ?? today;
    const d14 = new Date(`${today}T00:00:00Z`);
    d14.setUTCDate(d14.getUTCDate() + 14);
    const windowEnd = edArg ?? d14.toISOString().slice(0, 10);

    const timeMin = dayRangeUtc(tz, windowStart).start.toISOString();
    const timeMax = dayRangeUtc(tz, windowEnd).end.toISOString();
    const allEventsRaw = await Promise.all(calIds.map(async calId => {
      const res = await cal.events.list({
        calendarId: calId, timeMin, timeMax, singleEvents: true, maxResults: 2500, showHiddenInvitations: true,
      }).catch(() => ({ data: { items: [] as calendar_v3.Schema$Event[] } }));
      return (res.data.items ?? []).map(e => ({ event: e, calId }));
    }));
    const allEvents = allEventsRaw.flat();

    const dupeGroups = findDuplicateGroups(allEvents, { timezone: tz });
    if (!dupeGroups.length) {
      return `No duplicate events found between ${windowStart} and ${windowEnd} — your calendar looks clean.`;
    }

    const toRemove = dupeGroups.flatMap(g => g.remove);
    const writableRemove = toRemove.filter(({ calId }) => {
      const entry = calMeta.get(calId);
      return !entry || isWritable(entry.accessRole);
    });

    if (!writableRemove.length) {
      return `Found ${toRemove.length} duplicate(s) but they're all on read-only calendars — no deletions made.`;
    }

    // Per-group description with times, so different-time copies (e.g. two "dinner"
    // entries on the same day) are clear and the user can veto the right one.
    const fmtWhen = (ev: calendar_v3.Schema$Event): string => {
      if (ev.start?.date) return 'all day';
      if (ev.start?.dateTime) return new Date(ev.start.dateTime).toLocaleString('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit' });
      return '';
    };
    const groupDescriptions = dupeGroups.map(g => {
      const writRemove = g.remove.filter(({ calId }) => { const e = calMeta.get(calId); return !e || isWritable(e.accessRole); });
      if (!writRemove.length) return null;
      const title = (g.keep.event.summary ?? 'Untitled').replace(/^⚡\s*/, '');
      const keepWhen = fmtWhen(g.keep.event);
      const removeWhens = writRemove.map(r => fmtWhen(r.event)).filter(Boolean);
      const sameTime = removeWhens.every(w => w === keepWhen);
      return sameTime
        ? `${title} (${keepWhen}) — ${writRemove.length} exact duplicate${writRemove.length > 1 ? 's' : ''}`
        : `${title} — keep ${keepWhen}, remove ${removeWhens.join(' and ')}`;
    }).filter(Boolean) as string[];
    const shownGroups = groupDescriptions.slice(0, 8).join('; ');
    const moreGroups = groupDescriptions.length > 8 ? ` …and ${groupDescriptions.length - 8} more` : '';

    if (!confirmToken) {
      const token = issueDeleteToken(userId);
      return `⚠️ Found ${writableRemove.length} duplicate event(s) to remove (keeping the earliest copy of each): ${shownGroups}${moreGroups}. Read this back so the user can confirm — and if any "keep/remove" choice is wrong, they can tell you which time to keep. ONLY if the user says yes, call cleanupDuplicates again with the same args and confirmToken set to "${token}". Token expires in 2 minutes.`;
    }
    if (!consumeDeleteToken(userId, confirmToken)) {
      const token = issueDeleteToken(userId);
      return `⚠️ That confirmation code was invalid or expired. To remove ${writableRemove.length} duplicate(s), call cleanupDuplicates again with confirmToken: "${token}". Token expires in 2 minutes.`;
    }

    const deleted: string[] = [];
    const failedDel: string[] = [];
    const recreates: UndoOp[] = [];
    for (const { event: ev, calId } of writableRemove) {
      try {
        await cal.events.delete({ calendarId: calId, eventId: ev.id! });
        deleted.push((ev.summary ?? ev.id!).replace(/^⚡\s*/, ''));
        recreates.push({ type: 'recreate', calId, event: cleanForRecreate(ev) });
      } catch (dupErr) {
        console.error(`[cleanupDuplicates] delete failed calId=${calId}:`, dupErr);
        failedDel.push((ev.summary ?? ev.id!).replace(/^⚡\s*/, ''));
      }
    }
    if (recreates.length) recordUndo(userId, `removed ${recreates.length} duplicate event(s)`, recreates);

    const removedCounts = new Map<string, number>();
    for (const t of deleted) removedCounts.set(t, (removedCounts.get(t) ?? 0) + 1);
    const removedSummary = [...removedCounts.entries()].map(([t, n]) => `${n} ${t}`).join(', ');
    const parts: string[] = [];
    if (deleted.length) parts.push(`Found and removed ${deleted.length} duplicate${deleted.length !== 1 ? 's' : ''} — ${removedSummary}`);
    if (failedDel.length) parts.push(`Couldn't remove: ${failedDel.join(', ')}`);
    return parts.join('. ') || 'Done.';

  } else if (fn === 'rememberPreference') {
    // Deterministic persistence: save a preference immediately during the call so it
    // survives even if post-call transcript extraction misses or mis-categorises it.
    const { statement } = args as { statement: string };
    if (!statement?.trim()) return "What preference should I remember? Tell me in one sentence.";
    factQueries.upsertFact(userId, 'preference', statement.trim(), null);
    return `Got it — I've saved that preference and will apply it going forward.`;

  } else if (fn === 'checkReplies') {
    const tokenRow = calendarQueries.get(userId);
    const hasReadScope = hasGmailReadScope(tokenRow?.scope);
    const updates = hasReadScope ? await checkOutreachReplies(userId) : [];
    return formatRepliesForVoice(updates, hasReadScope);

  } else if (fn === 'setEnergyLevel') {
    const { level, source } = args as { level?: string; source?: string };
    const validLevels = ['red', 'yellow', 'green'] as const;
    const validSources = ['manual', 'override'] as const;
    if (!level || !validLevels.includes(level as typeof validLevels[number])) {
      return "Which energy level — red, yellow, or green?";
    }
    const src = validSources.includes(source as typeof validSources[number])
      ? (source as 'manual' | 'override')
      : 'manual';
    const user = userQueries.findById(userId);
    const tz = user ? effectiveTimezone(user) : 'America/Vancouver';
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    energyLogQueries.upsert(userId, today, level as 'red' | 'yellow' | 'green', src);
    const msgs: Record<string, string> = {
      green: "Noted — full capacity today. I'll keep high-energy work up front.",
      yellow: "Got it — moderate energy. I'll keep things balanced.",
      red: "Understood — low energy today. I'll protect your time and lean on lighter work.",
    };
    return msgs[level] || 'Energy level saved.';

  } else if (fn === 'confirmFocus') {
    // Write confirmed daily focus areas to the daily_focus store (day-scoped — fresh each morning).
    // Called when the user says yes to Edge's morning focus recommendation.
    const { areas } = args as { areas?: unknown };
    if (!Array.isArray(areas) || areas.length === 0) {
      return "Which focus areas should I lock in? Tell me the 1–3 things you want to concentrate on today.";
    }

    // Accept string titles or full FocusArea objects from Sonnet
    const cleaned = (areas as unknown[])
      .map(a => {
        if (typeof a === 'string') return { title: a.trim(), rationale: '', confidence: 'medium' as const };
        if (typeof a === 'object' && a !== null) {
          const o = a as Record<string, unknown>;
          return { title: String(o.title ?? '').trim(), rationale: String(o.rationale ?? '').trim(), confidence: 'medium' as const };
        }
        return null;
      })
      .filter((a): a is { title: string; rationale: string; confidence: 'medium' } => a !== null && a.title.length > 0)
      .slice(0, 3);
    if (cleaned.length === 0) return "I didn't catch those — what are your top 1–3 focus areas for today?";

    // Derive today's date in the user's local timezone
    const profile = userQueries.findById(userId);
    const tz = profile?.timezone ?? 'UTC';
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

    dailyFocusQueries.upsert(userId, date, JSON.stringify(cleaned), new Date().toISOString());
    dailyFocusQueries.confirm(userId, date);

    const listed = cleaned.map((a, i) => `${i + 1}. ${a.title}`).join(', ');
    return `Locked in — your focus today: ${listed}. I'll score your calendar against these and keep you on track.`;

  } else if (fn === 'applyCalendarPlan') {
    // Two-step hero loop: step 1 (no token) builds the plan and previews it;
    // step 2 (with token) executes and re-scores.
    const { confirmToken } = args as { confirmToken?: string };
    const user = userQueries.findById(userId);
    const userTz = user ? effectiveTimezone(user) : 'UTC';
    const today = new Date().toLocaleDateString('en-CA', { timeZone: userTz });

    // Gather today's context — mirrors /api/scores/route.ts so the plan uses the
    // same data the CalendarFitCard already shows the user.
    const priorities = priorityQueries.getMostRecent(userId);
    const [planTodayEvents, planWeekEvents, planWhoopRec] = await Promise.all([
      getCalendarEvents(userId).catch(() => [] as calendar_v3.Schema$Event[]),
      getWeekEvents(userId).catch(() => [] as calendar_v3.Schema$Event[]),
      getLatestRecovery(userId).catch(() => null),
    ]);
    const todayEnergyLog = (() => { try { return energyLogQueries.getToday(userId, today); } catch { return undefined; } })();
    const energySignal   = deriveEnergySignal(todayEnergyLog, planWhoopRec?.recoveryScore ?? null);
    const [alignment, planTagged] = await Promise.all([
      computeAlignment(priorities, planWeekEvents, userTz).catch(() => null),
      classifyEventsEnergy(planTodayEvents).catch(() => []),
    ]);
    const dbProfile = (() => { try { return energyProfileQueries.get(userId); } catch { return undefined; } })();
    const energyProfile = dbProfile
      ? { peakStart: dbProfile.peak_start, peakEnd: dbProfile.peak_end, troughStart: dbProfile.trough_start, troughEnd: dbProfile.trough_end }
      : (() => {
          try {
            const stmts = factQueries.getAll(userId).filter(f => f.category === 'preference').map(f => f.statement);
            return parseEnergyProfile(stmts);
          } catch { return null; }
        })();

    const fit = computeCalendarFit(planTagged, alignment, priorities, energySignal, energyProfile);
    const plan = buildCalendarPlan(planTodayEvents, fit, priorities, today, userTz);

    if (plan.actions.length === 0) {
      return `Your Edge Score is ${fit.edgeScore} — calendar looks solid. Nothing to reshape right now.`;
    }

    if (!confirmToken) {
      const token = issueDeleteToken(userId);
      return `${plan.summary} ONLY if ${user?.name?.split(' ')[0] ?? 'they'} says yes, call applyCalendarPlan again with confirmToken: "${token}". Token expires in 2 minutes.`;
    }

    if (!consumeDeleteToken(userId, confirmToken)) {
      const token = issueDeleteToken(userId);
      return `That confirmation code was invalid or expired. Call applyCalendarPlan again with the new confirmToken: "${token}". Token expires in 2 minutes.`;
    }

    // Execute each plan action
    const previousScore = fit.edgeScore;
    const doneDescs: string[] = [];
    const undoOps: UndoOp[] = [];

    for (const action of plan.actions) {
      if (action.type === 'create' && action.title && action.startDateTime && action.endDateTime) {
        try {
          const startUtc = wallTimeToUtc(action.startDateTime, userTz);
          const endUtc   = wallTimeToUtc(action.endDateTime,   userTz);
          const res = await cal.events.insert({
            calendarId: 'primary',
            requestBody: {
              summary:  `⚡ ${action.title}`,
              start: { dateTime: startUtc.toISOString(), timeZone: userTz },
              end:   { dateTime: endUtc.toISOString(),   timeZone: userTz },
              colorId: '9', // blueberry — visual focus-block marker
            },
          });
          if (res.data.id) {
            undoOps.push({ type: 'delete', calId: 'primary', eventId: res.data.id });
            doneDescs.push(action.description);
          }
        } catch (planErr) {
          console.error('[applyCalendarPlan] create failed:', planErr);
        }
      } else if (action.type === 'move' && action.eventId && action.newDate) {
        // Find the event's calendar; try primary first then fall through to calIds.
        let moveCalId = 'primary';
        let moveEv: calendar_v3.Schema$Event | null = null;
        const calIdsToSearch = ['primary', ...calIds.filter(id => id !== 'primary')];
        for (const cId of calIdsToSearch) {
          try {
            const res = await cal.events.get({ calendarId: cId, eventId: action.eventId });
            if (res.data?.id) { moveCalId = cId; moveEv = res.data; break; }
          } catch { /* not in this calendar */ }
        }
        if (moveEv?.start?.dateTime) {
          try {
            const eventTz = moveEv.start.timeZone ?? userTz;
            const patch   = timedEventDateMove(moveEv.start.dateTime, moveEv.end?.dateTime ?? '', action.newDate, eventTz);
            await cal.events.patch({
              calendarId: moveCalId,
              eventId: action.eventId,
              requestBody: { start: patch.start, end: patch.end },
            });
            // Undo a move = patch back to the original start/end datetimes
            undoOps.push({ type: 'patch', calId: moveCalId, eventId: action.eventId, requestBody: {
              start: { dateTime: moveEv.start.dateTime, timeZone: moveEv.start.timeZone ?? userTz },
              end:   moveEv.end?.dateTime ? { dateTime: moveEv.end.dateTime, timeZone: moveEv.end.timeZone ?? userTz } : undefined,
            } });
            doneDescs.push(action.description);
          } catch (planMoveErr) {
            console.error('[applyCalendarPlan] move failed:', planMoveErr);
          }
        }
      }
    }

    if (undoOps.length) {
      recordUndo(userId, `calendar plan — ${doneDescs.length} action${doneDescs.length !== 1 ? 's' : ''}`, undoOps);
    }

    if (doneDescs.length === 0) {
      return "I tried to reshape your calendar but couldn't get it done — want me to try a different approach?";
    }

    // Re-score to show improvement
    let newEdgeScore: number | null = null;
    try {
      const [newTodayEvts, newWeekEvts] = await Promise.all([
        getCalendarEvents(userId).catch(() => planTodayEvents),
        getWeekEvents(userId).catch(() => planWeekEvents),
      ]);
      const [newAlignment, newTagged] = await Promise.all([
        computeAlignment(priorities, newWeekEvts, userTz).catch(() => alignment),
        classifyEventsEnergy(newTodayEvts).catch(() => planTagged),
      ]);
      const newFit = computeCalendarFit(newTagged, newAlignment, priorities, energySignal, energyProfile);
      newEdgeScore = newFit.edgeScore;
      try {
        calendarScoreQueries.upsert(userId, today, {
          edgeScore:    newFit.edgeScore,
          focusScore:   newFit.focusScore.score,
          energyScore:  newFit.energyScore.score,
          focusDrivers: newFit.focusScore.drivers,
          energyDrivers: newFit.energyScore.drivers,
        });
      } catch { /* non-fatal */ }
    } catch { /* non-fatal — use original score in message */ }

    const delta = newEdgeScore !== null ? newEdgeScore - previousScore : null;
    const scoreNote = delta !== null && delta > 0
      ? ` Edge Score moved from ${previousScore} → ${newEdgeScore} (+${delta}). Your day just got better.`
      : ` Edge Score is ${newEdgeScore ?? previousScore}.`;
    return `Done — ${doneDescs.join('; ')}.${scoreNote} Say "undo that" if you change your mind.`;

  } else if (fn === 'undoLastAction') {
    const last = undoQueries.getLatest(userId);
    if (!last) return "There's nothing for me to undo.";
    const ok = await executeUndo(cal, parseUndoOps(last.payload));
    undoQueries.markUndone(last.id);
    return ok
      ? `Done — I reversed that: ${last.label}.`
      : `I tried to undo "${last.label}" but couldn't fully reverse it — please double-check your calendar.`;
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
    const sec = checkVapiSecret(req.headers.get('x-vapi-secret'));
    if (sec.status !== 'accepted') {
      console.warn(`[tool-call] Vapi secret ${sec.status}`);
      vapiAuthLogQueries.record('tool-call', sec.status); // persist mismatches for admin monitoring
    }
    if (!sec.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

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
      const calEntries = await getCalMeta(cal, String(briefing.user_id));
      const calIds = calEntries.map(e => e.id);
      const calMeta = new Map(calEntries.map(e => [e.id, { accessRole: e.accessRole, summary: e.summary }]));
      const tz = effectiveTimezone(userQueries.findById(briefing.user_id) ?? {});
      ctx = { cal, calIds, calMeta, userId: briefing.user_id, tz };
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

      // Activity log — two writes:
      // 1. Legacy briefings.tool_actions JSON blob (capped 50, mutable) — kept for
      //    backward compatibility until Core migrates the dashboard to audit_log.
      // 2. Append-only audit_log table (#7) — uncapped, source of truth going forward.
      try {
        const existing = db.prepare('SELECT tool_actions FROM briefings WHERE id = ?').get(briefing.id) as { tool_actions: string | null } | undefined;
        const actions = existing?.tool_actions ? JSON.parse(existing.tool_actions) : [];
        actions.push({ fn: tc.name, args: tc.args, result, ok, ts: new Date().toISOString() });
        db.prepare('UPDATE briefings SET tool_actions = ? WHERE id = ?').run(JSON.stringify(actions.slice(-50)), briefing.id);
      } catch (_e) { /* non-critical */ }
      auditLogQueries.record({
        userId: briefing.user_id,
        briefingId: briefing.id,
        action: tc.name,
        argsJson: JSON.stringify(tc.args),
        resultText: result,
        ok,
      });
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
