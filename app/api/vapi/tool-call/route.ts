import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getOAuthClient, getColorId, zonedWallTimeToUtc, findFreeSlots, getCalendarEvents, getWeekEvents } from '@/lib/calendar';
import { rruleUntilUtc, nextDay, prevDay, wallTimeToUtc, dayRangeUtc, isValidTimeZone, todayInTz, timedEventDateMove, recurringSeriesTimeShift, applyRruleUntil, bookEventTimes, computeFreeSlots } from '@/lib/time';
import { titleMatchScore, selectEvent, resolveEventExact, findDuplicateGroups, normalizeTitle } from '@/lib/eventMatch';
import { getRecentEmailSignal } from '@/lib/gmail';
import { hasGmailReadScope } from '@/lib/google-auth';
import { isTimedEventInWindow, formatBatchPreview, nearbyTimedEvents, buildConflictWarning } from '@/lib/batchSchedule';
import { mergeAttendees } from '@/lib/attendees';
import { dedupeSortEvents, formatEventForSpeech, findOverlappingEvents } from '@/lib/calendarQuery';
import { groundProperNouns } from '@/lib/grounding';
import { checkVapiSecret } from '@/lib/vapi';
import { computeCalendarFit, classifyEventsEnergy, colorByEnergy } from '@/lib/calendarScore';
import { computeAlignment } from '@/lib/alignment';
import { deriveEnergySignal } from '@/lib/energy';
import { getLatestRecovery, getRecoveryHistory, getLastSleep } from '@/lib/whoop';
import { buildCalendarPlan } from '@/lib/calendarPlan';
import { effectiveTimezone, vapiAuthLogQueries } from '@/lib/db';
import { calendarQueries, userQueries, priorityQueries, dailyFocusQueries, factQueries, factHistoryQueries, memoryQueries, episodeQueries, energyLogQueries, calendarScoreQueries, undoQueries, auditLogQueries, openLoopQueries, taskQueries, gratitudeQueries } from '@/lib/db';
import { pickTaskToComplete } from '@/lib/taskMatch';
import { factsMatchingTopic } from '@/lib/factForget';
import { enrichFact } from '@/lib/facts';
import { type UndoOp, recordUndo, executeUndo, cleanForRecreate, parseUndoOps } from '@/lib/undo';
import { claimEventCreate, buildEventDedupeKey, issueDeleteToken, consumeDeleteToken, claimToolCall, recordToolCallResult, getToolCallCached } from '@/lib/idempotency';
import { isWritable, canUserReschedule } from '@/lib/calendarWritable';
import { checkRateLimit } from '@/lib/rateLimit';
import { maybeCreateActivityNotif } from '@/lib/notifications';
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
  if (msg.includes('insufficientPermissions') || msg.includes('403')) return "I don't have permission to make that change — the event may be on a read-only calendar or organized by someone else. Want me to draft a message to the organizer instead?";
  if (msg.includes('notFound') || msg.includes('404')) return "I couldn't find that event to modify it.";
  if (msg.includes('rateLimitExceeded') || msg.includes('429')) return "Google Calendar is temporarily rate-limiting requests — try again in a moment.";
  if (msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('ECONNRESET') || msg.includes('ECONNREFUSED')) return "The request timed out — want me to try again?";
  return "Something went wrong on my end — want me to try again or take a different approach?";
}

// Result strings that indicate the action did NOT succeed (used for the activity log status).
// Conflict prompts and empty reads are NOT failures, so they're deliberately excluded.
const FAILURE_RE = /^(Error:|I can't access|I don't have permission|I couldn't find|Something went wrong|No event matching|No timed events|Couldn't|I didn't catch|I need the day|I need a date|Google Calendar is temporarily|The request timed out)/i;

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

  // Tier-1 grounding: correct STT phonetic errors in title args before event resolution.
  // Loads person-fact names once per tool call (synchronous SQLite read).
  // E.g., "shorten Gym's appointment" → "Jim's" when Jim is a stored person fact.
  const _personNames = (() => {
    try {
      return factQueries.getAll(userId)
        .filter(f => f.category === 'person' && f.entity?.trim())
        .map(f => f.entity as string);
    } catch { return []; }
  })();
  function groundTitle(raw: string): string {
    if (!_personNames.length || !raw) return raw;
    return groundProperNouns(raw, _personNames);
  }

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
    const { title: rawTitle, date, currentTime } = args as { title: string; date: string; currentTime?: string };
    const title = groundTitle(rawTitle);
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
    const { title: rawTitle, date, currentTime, description, appendDescription, location } = args as { title: string; date: string; currentTime?: string; description?: string; appendDescription?: boolean; location?: string };
    const title = groundTitle(rawTitle);
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
    const { title: rawTitle, date, query, currentTime } = args as { title: string; date: string; query: string; currentTime?: string };
    const title = groundTitle(rawTitle);
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
    const { title: rawCreateTitle, timezone, color, overrideConflicts, allDay, endDate, description, location, recurrence, attendees } = args as { title: string; timezone: string; color?: string; overrideConflicts?: boolean; allDay?: boolean; endDate?: string; description?: string; location?: string; recurrence?: string; attendees?: { email?: string; name?: string }[] };
    if (!rawCreateTitle) return "I didn't catch what to call that event — what's the title?";
    // R14 T2 — only accept a well-formed RRULE string (the model passes it directly).
    const recur = typeof recurrence === 'string' && /^RRULE:/i.test(recurrence.trim()) ? recurrence.trim() : undefined;
    // R14 T3 — Google sends invites for any attendees with an email.
    const attendeeList = Array.isArray(attendees)
      ? attendees.filter(a => a?.email && /@/.test(a.email)).map(a => ({ email: a.email!, ...(a.name ? { displayName: a.name } : {}) }))
      : [];
    const title = groundTitle(rawCreateTitle);

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
        ...(recur ? { recurrence: [recur] } : {}),
        ...(attendeeList.length ? { attendees: attendeeList } : {}),
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
        if (!/\b(hold|block|tentative|maybe|tbd)\b/i.test(ev.summary ?? '') && ev.summary !== `⚡ ${title}`) {
          // R13 T4 — name the conflict WITH its time so Edge can say it out loud.
          const ct = ev.start?.dateTime
            ? new Date(ev.start.dateTime).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
            : '';
          const cname = (ev.summary ?? 'Untitled').replace(/^⚡\s*/, '');
          conflicts.push(ct ? `${cname} at ${ct}` : cname);
        }
      }
      if (conflicts.length > 0) {
        // R13 T4 — surface the specific clashing event(s) + offer both paths; do NOT set
        // overrideConflicts here. Only re-call with overrideConflicts:true after the user says book over it.
        return buildConflictWarning(conflicts, title);
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
    const rb: calendar_v3.Schema$Event = { summary: `⚡ ${title}`, start: { dateTime: startDateTime, timeZone: timezone }, end: { dateTime: endDateTime, timeZone: timezone }, colorId: color ? getColorId(color) : '9', ...(description ? { description } : {}), ...(location ? { location } : {}), ...(recur ? { recurrence: [recur] } : {}), ...(attendeeList.length ? { attendees: attendeeList } : {}) };
    const insTimed = await cal.events.insert({ calendarId: 'primary', requestBody: rb });
    if (!insTimed.data.id) return `Couldn't confirm "${title}" saved — please double-check your calendar.`;
    recordUndo(userId, `created "${title}"`, [{ type: 'delete', calId: 'primary', eventId: insTimed.data.id }]);
    const inviteNote = attendeeList.length ? ` Invited ${attendeeList.length} ${attendeeList.length === 1 ? 'person' : 'people'}.` : '';
    return `Created and confirmed ${recur ? 'recurring ' : ''}"${title}" on ${startDateTime.slice(0, 10)} at ${startDateTime.slice(11, 16)} ${timezone}${overrideConflicts ? ' (booked over existing events)' : ''}.${inviteNote}`;

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
    const { title: rawTitle, date, deleteAll, recurringScope, currentTime, confirmToken, targetEndDate } = args as { title: string; date: string; deleteAll?: boolean; recurringScope?: 'this' | 'thisAndFollowing' | 'all'; currentTime?: string; confirmToken?: string; targetEndDate?: string };
    const title = groundTitle(rawTitle);
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
      // R12 T1: log the mismatch so production shows exactly which token/event collided
      // (the multi-token loop happens when the user corrects the event name mid-flow).
      console.error('[deleteEvent] token mismatch', { userId, providedToken: confirmToken, resolvedTitle: toDelete[0]?.event?.summary });
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
    const { title: rawTitle, date, newStartDateTime, newEndDateTime, newStartDate, newEndDate, timezone, recurringScope, currentTime, targetEndDate } = args as { title: string; date: string; newStartDateTime: string; newEndDateTime: string; newStartDate?: string; newEndDate?: string; timezone: string; recurringScope?: 'this' | 'all'; currentTime?: string; targetEndDate?: string };
    const title = groundTitle(rawTitle);
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
    const { title: rawTitle, date, color } = args as { title: string; date: string; color: string };
    const title = groundTitle(rawTitle);
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

  } else if (fn === 'colorEventsByEnergy') {
    // Classify today's events by energy demand, then apply Google Calendar colorId per event.
    // Green day: high = blueberry, med = banana, low = sage.
    // Yellow day: high = tangerine, med = banana, low = sage.
    // Red day: high = tomato, med = tangerine, low = sage.
    const colorUser = userQueries.findById(userId);
    const colorTz = colorUser ? effectiveTimezone(colorUser) : tz;
    const colorToday = new Date().toLocaleDateString('en-CA', { timeZone: colorTz });

    const [colorTodayEvts, colorWhoopRec] = await Promise.all([
      getCalendarEvents(userId).catch(() => [] as calendar_v3.Schema$Event[]),
      getLatestRecovery(userId).catch(() => null),
    ]);
    const colorEnergyLog = (() => { try { return energyLogQueries.getToday(userId, colorToday); } catch { return undefined; } })();
    const colorSignal = deriveEnergySignal(colorEnergyLog, colorWhoopRec?.recoveryScore ?? null);

    const tagged = await classifyEventsEnergy(colorTodayEvts).catch(() => []);
    if (tagged.length === 0) {
      return "No timed events on your calendar today — nothing to color.";
    }

    const assignments = colorByEnergy(
      tagged.filter(t => t.event.id).map(t => ({ eventId: t.event.id!, demand: t.tag.demand })),
      colorSignal,
    );

    const undoOps: UndoOp[] = [];
    let colored = 0;
    await Promise.all(assignments.map(async ({ eventId, colorId }) => {
      // Look up which calendar owns this event
      for (const cId of calIds) {
        try {
          const evRes = await cal.events.get({ calendarId: cId, eventId });
          if (!evRes.data?.id) continue;
          const prev = evRes.data.colorId ?? '9';
          if (prev === colorId) break; // already this color
          const entry = calMeta.get(cId);
          if (entry && !isWritable(entry.accessRole)) break; // read-only
          await cal.events.patch({ calendarId: cId, eventId, requestBody: { colorId } });
          undoOps.push({ type: 'patch', calId: cId, eventId, requestBody: { colorId: prev } });
          colored++;
          break;
        } catch { /* not in this cal or failed — try next */ }
      }
    }));

    if (colored === 0) return "Couldn't apply colors — calendar may be read-only or no events have IDs.";
    if (undoOps.length) recordUndo(userId, `energy color-coding — ${colored} event(s)`, undoOps);

    const colorTier = colorSignal?.level ?? 'unknown';
    return `Done — colored ${colored} event${colored !== 1 ? 's' : ''} based on energy demand. High-demand events are ${colorTier === 'green' ? 'blue' : colorTier === 'yellow' ? 'orange' : colorTier === 'red' ? 'red' : 'marked'}, medium are ${colorTier === 'red' ? 'orange' : 'yellow'}, and low-demand events are green.`;

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
    const planCreatedIds: string[] = [];
    for (const ev of planEvents) {
      try {
        const planRes = await cal.events.insert({ calendarId: 'primary', requestBody: { summary: `⚡ ${ev.title}`, start: { dateTime: ev.startDateTime, timeZone: user.timezone }, end: { dateTime: ev.endDateTime, timeZone: user.timezone }, colorId: '9' } });
        if (planRes.data.id) {
          created.push(`${ev.title} (${ev.startDateTime.slice(5, 10)} ${ev.startDateTime.slice(11, 16)})`);
          planCreatedIds.push(planRes.data.id);
        }
      } catch (_e) { /* skip conflicts */ }
    }
    if (planCreatedIds.length) recordUndo(userId, `week plan — ${planCreatedIds.length} focus block(s)`, [{ type: 'deleteMany', calId: 'primary', eventIds: planCreatedIds }]);
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
      : `Couldn't save the copies from ${sourceDate} — Google didn't confirm them. Want me to try again?`;

  } else if (fn === 'batchReschedule') {
    // R13 T1 — move or clear every timed event in a window with ONE confirmation, instead of
    // one-by-one deleteEvent/moveEvent handshakes. Skips all-day events + read-only/non-organizer
    // events. First call (no token) previews + issues a token; second call (token) executes.
    const { window, action, targetDate, confirmToken } = args as {
      window?: { date?: string; startTime?: string; endTime?: string };
      action?: 'move' | 'delete';
      targetDate?: string;
      confirmToken?: string;
    };
    if (!window?.date || !/^\d{4}-\d{2}-\d{2}$/.test(window.date)) return "Which day's events should I reschedule? Give me the date.";
    if (action !== 'move' && action !== 'delete') return 'Should I move those events to another day, or clear them? Say "move" or "delete".';
    if (action === 'move' && (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate))) return 'What day should I move them to?';

    const startBound = window.startTime ? zonedWallTimeToUtc(`${window.date}T${resolveNaturalTime(window.startTime)}:00`, tz).getTime() : -Infinity;
    const endBound = window.endTime ? zonedWallTimeToUtc(`${window.date}T${resolveNaturalTime(window.endTime)}:00`, tz).getTime() : Infinity;

    const dayEvents = await eventsOnDay(cal, calIds, window.date, tz);
    const inWindow = dayEvents.filter(({ event, calId }) => {
      if (!isTimedEventInWindow(event, startBound, endBound)) return false; // timed, live, in range
      const meta = calMeta.get(calId);
      if (meta && !isWritable(meta.accessRole)) return false; // skip read-only calendars
      if (!canUserReschedule(event)) return false;        // skip events the user can't reschedule
      return true;
    });

    if (!inWindow.length) {
      const range = window.startTime || window.endTime ? ` between ${window.startTime ?? 'the start'} and ${window.endTime ?? 'the end'}` : '';
      return `I don't see any moveable events on ${window.date}${range}.`;
    }

    const previewList = formatBatchPreview(inWindow.map(w => w.event), tz);
    const actionLabel = action === 'move' ? `move them all to ${targetDate}` : 'clear them';

    if (!confirmToken) {
      const token = issueDeleteToken(userId);
      return `Found ${inWindow.length} event(s): ${previewList} — ${actionLabel}? Ask the user, and ONLY if they say yes, call batchReschedule again with the same window and action plus confirmToken set to "${token}". Token expires in 2 minutes.`;
    }
    if (!consumeDeleteToken(userId, confirmToken)) {
      console.error('[batchReschedule] token mismatch', { userId, providedToken: confirmToken, date: window.date, action });
      const token = issueDeleteToken(userId);
      return `That confirmation was invalid or expired. To ${actionLabel}, call batchReschedule again with confirmToken "${token}". Token expires in 2 minutes.`;
    }

    const doneNames: string[] = [];
    const failedNames: string[] = [];
    const undoOps: UndoOp[] = [];
    for (const { event, calId } of inWindow) {
      const name = (event.summary ?? 'Untitled').replace(/^⚡\s*/, '');
      try {
        if (action === 'delete') {
          await cal.events.delete({ calendarId: calId, eventId: event.id! });
          if (!event.recurringEventId) undoOps.push({ type: 'recreate', calId, event: cleanForRecreate(event) });
          doneNames.push(name);
        } else {
          const eventTz = event.start?.timeZone ?? tz;
          const patch = timedEventDateMove(event.start!.dateTime!, event.end?.dateTime ?? event.start!.dateTime!, targetDate!, eventTz);
          const origStart = event.start, origEnd = event.end;
          await cal.events.patch({ calendarId: calId, eventId: event.id!, requestBody: patch });
          undoOps.push({ type: 'patch', calId, eventId: event.id!, requestBody: { start: origStart, end: origEnd } });
          doneNames.push(name);
        }
      } catch (err) {
        console.error(`[batchReschedule] ${action} failed for "${name}":`, err instanceof Error ? err.message : err);
        failedNames.push(name);
      }
    }
    if (undoOps.length) recordUndo(userId, `${action === 'move' ? 'moved' : 'cleared'} ${undoOps.length} event(s)`, undoOps);
    if (!doneNames.length) return `I couldn't ${action === 'move' ? 'move' : 'clear'} those — Google errored${failedNames.length ? ` for ${failedNames.join(', ')}` : ''}. Want me to try again?`;
    const head = action === 'move' ? `Moved ${doneNames.length} event(s) to ${targetDate}` : `Cleared ${doneNames.length} event(s) from ${window.date}`;
    return `${head}: ${doneNames.join(', ')}.${failedNames.length ? ` Couldn't do ${failedNames.join(', ')}.` : ''}`;

  } else if (fn === 'findFreeTime') {
    // R14 T1 — find open slots of a given duration across a date range, honoring a daily
    // wall-clock window. Uses freebusy across all calendars + pure computeFreeSlots.
    const { duration, startDate, endDate, windowStart, windowEnd } = args as {
      duration?: number; startDate?: string; endDate?: string; windowStart?: string; windowEnd?: string;
    };
    if (!duration || duration <= 0) return 'How long a block are you looking for?';
    const fStart = startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : todayInTz(tz);
    let fEnd = endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : '';
    if (!fEnd || fEnd < fStart) {
      const d = new Date(`${fStart}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 6); fEnd = d.toISOString().slice(0, 10);
    }
    const [wsH, wsM] = resolveNaturalTime(windowStart || '9:00 AM').split(':').map(Number);
    const [weH, weM] = resolveNaturalTime(windowEnd || '6:00 PM').split(':').map(Number);
    const fDates: string[] = [];
    for (let c = fStart; c <= fEnd; c = nextDay(c)) { fDates.push(c); if (fDates.length > 31) break; }
    const fbMin = dayRangeUtc(tz, fStart).start.toISOString();
    const fbMax = dayRangeUtc(tz, fEnd).end.toISOString();
    const fb = await cal.freebusy.query({ requestBody: { timeMin: fbMin, timeMax: fbMax, items: calIds.map(id => ({ id })) } })
      .then(r => r.data).catch((e: unknown) => { console.error('[findFreeTime] freebusy failed:', e instanceof Error ? e.message : e); return null; });
    if (!fb) return `I couldn't pull your availability just now — want me to try again?`;
    const busy: { start: number; end: number }[] = [];
    for (const c of Object.values(fb.calendars ?? {})) {
      for (const b of (c.busy ?? [])) if (b.start && b.end) busy.push({ start: Date.parse(b.start), end: Date.parse(b.end) });
    }
    const slots = computeFreeSlots({ busy, durationMs: duration * 60000, windowStartMin: wsH * 60 + wsM, windowEndMin: weH * 60 + weM, dates: fDates, tz, maxResults: 3 });
    if (!slots.length) return `Your calendar looks pretty packed in that window — want me to look at next week?`;
    const fmtT = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
    const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long' });
    const list = slots.map(s => `${fmtDay(s.date)} at ${fmtT(s.startMs)}–${fmtT(s.endMs)}`).join(', ');
    return `Here are some open windows: ${list}. Want me to block one?`;

  } else if (fn === 'searchEvents') {
    // R15 T1 — Google calendar text search across all calendars.
    const { query, startDate, endDate } = args as { query?: string; startDate?: string; endDate?: string };
    if (!query?.trim()) return 'What should I search your calendar for?';
    const seToday = todayInTz(tz);
    const offsetDate = (days: number) => { const d = new Date(`${seToday}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
    const seStart = startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : offsetDate(-30);
    const seEnd = endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : offsetDate(60);
    const found = (await Promise.all(calIds.map(calId =>
      cal.events.list({ calendarId: calId, q: query, timeMin: dayRangeUtc(tz, seStart).start.toISOString(), timeMax: dayRangeUtc(tz, seEnd).end.toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 10 })
        .then(r => r.data.items ?? []).catch(() => [] as calendar_v3.Schema$Event[])
    ))).flat();
    const results = dedupeSortEvents(found.filter(e => e.status !== 'cancelled')).slice(0, 5);
    if (!results.length) return `Nothing on your calendar matches "${query}".`;
    return `Found ${results.length} event${results.length !== 1 ? 's' : ''} matching "${query}": ${results.map(e => formatEventForSpeech(e, tz, { withDate: true })).join(', ')}.`;

  } else if (fn === 'checkConflict') {
    // R15 T2 — point-in-time availability check.
    const { date, startTime, endTime } = args as { date?: string; startTime?: string; endTime?: string };
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'What day should I check?';
    if (!startTime) return 'What time should I check?';
    const ccStartMs = zonedWallTimeToUtc(`${date}T${resolveNaturalTime(startTime)}:00`, tz).getTime();
    let ccEndMs = endTime ? zonedWallTimeToUtc(`${date}T${resolveNaturalTime(endTime)}:00`, tz).getTime() : ccStartMs + 60 * 60000;
    if (ccEndMs <= ccStartMs) ccEndMs = ccStartMs + 60 * 60000;
    const ccEvents = (await eventsOnDay(cal, calIds, date, tz)).map(x => x.event).filter(e => e.status !== 'cancelled');
    const conflicts = findOverlappingEvents(ccEvents, ccStartMs, ccEndMs);
    const whenLabel = new Date(ccStartMs).toLocaleString('en-US', { timeZone: tz, weekday: 'long', hour: 'numeric', minute: '2-digit' });
    if (!conflicts.length) return `You're free ${whenLabel} — nothing on your calendar then.`;
    return `You've got ${conflicts.map(e => formatEventForSpeech(e, tz)).join(', ')} then. Want me to find another slot?`;

  } else if (fn === 'getNextEvents') {
    // R15 T5 — the next N timed events from now.
    const { count } = args as { count?: number };
    const n = Math.min(Math.max(typeof count === 'number' && count > 0 ? Math.floor(count) : 3, 1), 5);
    const nowIso = new Date().toISOString();
    const nextRaw = (await Promise.all(calIds.map(calId =>
      cal.events.list({ calendarId: calId, timeMin: nowIso, singleEvents: true, orderBy: 'startTime', maxResults: n + 5 })
        .then(r => r.data.items ?? []).catch(() => [] as calendar_v3.Schema$Event[])
    ))).flat();
    const timed = dedupeSortEvents(nextRaw.filter(e => e.status !== 'cancelled' && e.start?.dateTime)).slice(0, n);
    if (!timed.length) return `Nothing else on your calendar coming up.`;
    return `Your next ${timed.length === 1 ? 'event' : `${timed.length} events`}: ${timed.map(e => formatEventForSpeech(e, tz)).join(', ')}.`;

  } else if (fn === 'setEventReminder') {
    // R15 T3 — set a popup reminder N minutes before an event.
    const { title: rawTitle, minutesBefore, currentTime } = args as { title?: string; minutesBefore?: number; currentTime?: string };
    if (!rawTitle) return 'Which event should I set a reminder on?';
    if (typeof minutesBefore !== 'number' || minutesBefore < 0) return 'How many minutes before should I remind you?';
    const title = groundTitle(rawTitle);
    const srToday = todayInTz(tz);
    const srEnd = (() => { const d = new Date(`${srToday}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 30); return d.toISOString().slice(0, 10); })();
    const srMatches = (await Promise.all(calIds.map(calId =>
      cal.events.list({ calendarId: calId, timeMin: dayRangeUtc(tz, srToday).start.toISOString(), timeMax: dayRangeUtc(tz, srEnd).end.toISOString(), singleEvents: true, orderBy: 'startTime' })
        .then(r => (r.data.items ?? []).map(e => ({ event: e, calId }))).catch(() => [] as { event: calendar_v3.Schema$Event; calId: string }[])
    ))).flat();
    const r = resolveEvent(srMatches, title, tz, currentTime);
    if (r.kind === 'none') return `I couldn't find "${title}" on your upcoming calendar.`;
    if (r.kind === 'ambiguous') return `There are multiple "${title}" events: ${r.message}. Which one? Re-call with currentTime set to its start time.`;
    const srName = (r.event.summary ?? '').replace(/^⚡\s*/, '');
    const srMeta = calMeta.get(r.calId);
    if (srMeta && !isWritable(srMeta.accessRole)) return `"${srName}" is on a read-only calendar — I can't change its reminders from here.`;
    const origReminders = r.event.reminders ?? { useDefault: true };
    const srPatched = await cal.events.patch({ calendarId: r.calId, eventId: r.event.id!, requestBody: { reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: minutesBefore }] } } })
      .catch((e: unknown) => { console.error('[setEventReminder] patch failed:', e instanceof Error ? e.message : e); return null; });
    if (!srPatched) return `I couldn't set that reminder just now — want me to try again?`;
    recordUndo(userId, `set reminder on "${srName}"`, [{ type: 'patch', calId: r.calId, eventId: r.event.id!, requestBody: { reminders: origReminders } }]);
    return `Set a ${minutesBefore}-minute reminder for "${srName}".`;

  } else if (fn === 'blockFocusTime') {
    // R15 T4 — find the earliest open slot of `duration` and book a focus block in one shot.
    const { label, duration, startDate, endDate, windowStart, windowEnd } = args as {
      label?: string; duration?: number; startDate?: string; endDate?: string; windowStart?: string; windowEnd?: string;
    };
    if (!label?.trim()) return 'What should I block the time for?';
    if (!duration || duration <= 0) return 'How long should I block?';
    const bfStart = startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : todayInTz(tz);
    let bfEnd = endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : '';
    if (!bfEnd || bfEnd < bfStart) { const d = new Date(`${bfStart}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 6); bfEnd = d.toISOString().slice(0, 10); }
    const [bwsH, bwsM] = resolveNaturalTime(windowStart || '9:00 AM').split(':').map(Number);
    const [bweH, bweM] = resolveNaturalTime(windowEnd || '6:00 PM').split(':').map(Number);
    const bfDates: string[] = [];
    for (let c = bfStart; c <= bfEnd; c = nextDay(c)) { bfDates.push(c); if (bfDates.length > 31) break; }
    const bfFb = await cal.freebusy.query({ requestBody: { timeMin: dayRangeUtc(tz, bfStart).start.toISOString(), timeMax: dayRangeUtc(tz, bfEnd).end.toISOString(), items: calIds.map(id => ({ id })) } })
      .then(r => r.data).catch((e: unknown) => { console.error('[blockFocusTime] freebusy failed:', e instanceof Error ? e.message : e); return null; });
    if (!bfFb) return `I couldn't check your availability just now — want me to try again?`;
    const bfBusy: { start: number; end: number }[] = [];
    for (const c of Object.values(bfFb.calendars ?? {})) for (const b of (c.busy ?? [])) if (b.start && b.end) bfBusy.push({ start: Date.parse(b.start), end: Date.parse(b.end) });
    const bfSlots = computeFreeSlots({ busy: bfBusy, durationMs: duration * 60000, windowStartMin: bwsH * 60 + bwsM, windowEndMin: bweH * 60 + bweM, dates: bfDates, tz, maxResults: 1 });
    if (!bfSlots.length) return `Your week looks packed in that window — want me to look at next week instead?`;
    const slot = bfSlots[0];
    const focusTitle = `Focus: ${label.trim()}`;
    const bfIns = await cal.events.insert({ calendarId: 'primary', requestBody: { summary: `⚡ ${focusTitle}`, start: { dateTime: new Date(slot.startMs).toISOString(), timeZone: tz }, end: { dateTime: new Date(slot.endMs).toISOString(), timeZone: tz }, colorId: '2' } })
      .catch((e: unknown) => { console.error('[blockFocusTime] insert failed:', e instanceof Error ? e.message : e); return null; });
    if (!bfIns?.data.id) return `I found a slot but couldn't book it just now — want me to try again?`;
    recordUndo(userId, `blocked focus time for ${label.trim()}`, [{ type: 'delete', calId: 'primary', eventId: bfIns.data.id }]);
    const dayName = new Date(`${slot.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long' });
    const fmtSlot = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
    const durLabel = duration % 60 === 0 ? `${duration / 60} hour${duration >= 120 ? 's' : ''}` : `${duration} minutes`;
    return `Blocked ${durLabel} for ${label.trim()}: ${dayName} at ${fmtSlot(slot.startMs)}–${fmtSlot(slot.endMs)}. Want me to protect more time this week?`;

  } else if (fn === 'briefEvent') {
    // R15 T6 — pre-meeting prep: event details + matching email signal + attendee facts → Haiku brief.
    const { title: rawTitle, currentTime } = args as { title?: string; currentTime?: string };
    if (!rawTitle) return 'Which event should I brief you on?';
    const title = groundTitle(rawTitle);
    const beToday = todayInTz(tz);
    const beEnd = (() => { const d = new Date(`${beToday}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 30); return d.toISOString().slice(0, 10); })();
    const beMatches = (await Promise.all(calIds.map(calId =>
      cal.events.list({ calendarId: calId, timeMin: dayRangeUtc(tz, beToday).start.toISOString(), timeMax: dayRangeUtc(tz, beEnd).end.toISOString(), singleEvents: true, orderBy: 'startTime' })
        .then(r => (r.data.items ?? []).map(e => ({ event: e, calId }))).catch(() => [] as { event: calendar_v3.Schema$Event; calId: string }[])
    ))).flat();
    const r = resolveEvent(beMatches, title, tz, currentTime);
    if (r.kind === 'none') return `I couldn't find "${title}" on your upcoming calendar to brief you on.`;
    if (r.kind === 'ambiguous') return `There are multiple "${title}" events: ${r.message}. Which one? Re-call with currentTime set to its start time.`;
    const ev = r.event;
    const beName = (ev.summary ?? '').replace(/^⚡\s*/, '');
    const attendeeNames = (ev.attendees ?? []).filter(a => !a.self).map(a => a.displayName || a.email).filter(Boolean) as string[];
    const nTitle = normalizeTitle(beName);
    // Email signal matching the event title (best-effort, gmail.readonly only).
    let emailContext = '';
    try {
      const calTok = calendarQueries.get(userId);
      if (hasGmailReadScope(calTok?.scope)) {
        const sig = await getRecentEmailSignal(userId, { days: 7, max: 20 });
        if (sig && !sig.scopeMissing) {
          const hits = (sig.items ?? []).filter(it => { const ns = normalizeTitle(it.subject || ''); return ns && (ns.includes(nTitle) || nTitle.includes(ns)); }).slice(0, 3);
          if (hits.length) emailContext = hits.map(h => `- ${h.subject} (from ${h.sender})`).join('\n');
        }
      }
    } catch { /* degrade */ }
    // Stored facts about attendees or the event topic.
    let factContext = '';
    try {
      const allF = factQueries.getAll(userId);
      const hits = allF.filter(f => {
        const ne = normalizeTitle(f.entity ?? ''); const nst = normalizeTitle(f.statement ?? '');
        if (ne && attendeeNames.some(a => { const na = normalizeTitle(a); return na && (ne.includes(na) || na.includes(ne)); })) return true;
        return nTitle.length > 2 && (ne.includes(nTitle) || nst.includes(nTitle));
      }).slice(0, 5);
      if (hits.length) factContext = hits.map(f => `- ${f.entity ? `${f.entity}: ` : ''}${f.statement}`).join('\n');
    } catch { /* degrade */ }

    const rawDetails = [
      attendeeNames.length ? `Attendees: ${attendeeNames.join(', ')}.` : '',
      ev.location ? `Location: ${ev.location}.` : '',
      ev.description ? `Notes: ${ev.description.slice(0, 400)}` : '',
    ].filter(Boolean).join(' ');

    try {
      const beFirst = (userQueries.findById(userId)?.name ?? '').split(' ')[0] || 'them';
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const res = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001', max_tokens: 250,
        messages: [{ role: 'user', content: `In 3 sentences or fewer, brief ${beFirst} on this upcoming event. State who's attending (if known), what the agenda/notes say, and one piece of relevant context from recent emails or memory. Be specific and concise — this is read aloud.

EVENT: ${beName}
${rawDetails || '(no description or attendees)'}
${emailContext ? `\nRELATED EMAILS:\n${emailContext}` : ''}
${factContext ? `\nWHAT I KNOW:\n${factContext}` : ''}` }],
      }, { signal: AbortSignal.timeout(20000) });
      const text = res.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('').trim();
      if (text) return text;
    } catch (e) { console.error('[briefEvent] Haiku failed:', e instanceof Error ? e.message : e); }
    // Degrade: raw details without synthesis.
    return rawDetails ? `Here's what I have on "${beName}": ${rawDetails}` : `I don't have much detail on "${beName}" beyond it being on your calendar.`;

  } else if (fn === 'generateWeeklyReview') {
    // R15 T7 — end-of-week wrap-up from real event + task + recovery data → Haiku review.
    const { weekOf } = args as { weekOf?: string };
    // Resolve the week's Monday (in user tz) and its Sunday end.
    const baseDay = weekOf && /^\d{4}-\d{2}-\d{2}$/.test(weekOf) ? weekOf : todayInTz(tz);
    const monday = (() => {
      const d = new Date(`${baseDay}T12:00:00Z`);
      const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
      d.setUTCDate(d.getUTCDate() - dow);
      return d.toISOString().slice(0, 10);
    })();
    const sunday = (() => { const d = new Date(`${monday}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 6); return d.toISOString().slice(0, 10); })();
    const [weekEventsRaw, recHist] = await Promise.all([
      (async () => (await Promise.all(calIds.map(calId =>
        cal.events.list({ calendarId: calId, timeMin: dayRangeUtc(tz, monday).start.toISOString(), timeMax: dayRangeUtc(tz, sunday).end.toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 50 })
          .then(r => r.data.items ?? []).catch(() => [] as calendar_v3.Schema$Event[])
      ))).flat())(),
      getRecoveryHistory(userId, 7).catch(() => []),
    ]);
    const meetings = dedupeSortEvents(weekEventsRaw.filter(e => e.status !== 'cancelled' && e.start?.dateTime))
      .map(e => (e.summary ?? '').replace(/^⚡\s*/, '')).filter(Boolean).slice(0, 12);
    const recentTasks = (() => { try { return taskQueries.getRecent(userId, 10); } catch { return []; } })();
    const completed = recentTasks.filter(t => t.completed && (t.completed_at ?? '') >= monday).map(t => t.text).slice(0, 12);
    const openTasks = recentTasks.filter(t => !t.completed).map(t => t.text).slice(0, 12);
    let whoopNote = '';
    try {
      if (recHist.length >= 3) {
        const { computeWhoopTrends, formatTrendForBriefing } = await import('@/lib/whoopTrends');
        const trend = computeWhoopTrends(recHist.map(h => ({ date: h.date, value: h.recoveryScore })), [], []);
        whoopNote = trend ? (formatTrendForBriefing(trend) ?? '') : '';
      }
    } catch { /* degrade */ }

    try {
      const wrFirst = (userQueries.findById(userId)?.name ?? '').split(' ')[0] || 'them';
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const res = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001', max_tokens: 300,
        messages: [{ role: 'user', content: `Give ${wrFirst} a brief spoken weekly review (3–4 sentences max). Cover: (1) what happened — key events/meetings, (2) what was completed, (3) one honest observation or pattern. If recovery data is present, weave in one note about energy. End with one question: what's the priority for next week?

WEEK: ${monday} to ${sunday}
MEETINGS/EVENTS: ${meetings.length ? meetings.join(', ') : '(none logged)'}
COMPLETED TASKS: ${completed.length ? completed.join(', ') : '(none)'}
OPEN TASKS: ${openTasks.length ? openTasks.join(', ') : '(none)'}
${whoopNote ? `RECOVERY: ${whoopNote}` : ''}` }],
      }, { signal: AbortSignal.timeout(20000) });
      const text = res.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('').trim();
      if (text) return text;
    } catch (e) { console.error('[generateWeeklyReview] Haiku failed:', e instanceof Error ? e.message : e); }
    // Degrade: plain list.
    return `This week (${monday} to ${sunday}): ${meetings.length} event(s)${completed.length ? `, ${completed.length} task(s) done` : ''}${openTasks.length ? `, ${openTasks.length} still open` : ''}. What's the priority for next week?`;

  } else if (fn === 'editEventAttendees') {
    // R14 T3 — add/remove guests on an existing event (Google sends invites/cancellations).
    const { title: rawTitle, currentTime, add, remove } = args as {
      title?: string; currentTime?: string; add?: { email?: string; name?: string }[]; remove?: string[];
    };
    if (!rawTitle) return "Which event's guest list should I change?";
    const addList = Array.isArray(add) ? add : [];
    const removeList = Array.isArray(remove) ? remove : [];
    if (!addList.length && !removeList.length) return 'Who should I add or remove?';
    const title = groundTitle(rawTitle);
    // Search the next 30 days for the event by title (no date param on this tool).
    const eaToday = todayInTz(tz);
    const eaEnd = (() => { const d = new Date(`${eaToday}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 30); return d.toISOString().slice(0, 10); })();
    const eaMatches = (await Promise.all(calIds.map(calId =>
      cal.events.list({ calendarId: calId, timeMin: dayRangeUtc(tz, eaToday).start.toISOString(), timeMax: dayRangeUtc(tz, eaEnd).end.toISOString(), singleEvents: true, orderBy: 'startTime' })
        .then(r => (r.data.items ?? []).map(e => ({ event: e, calId }))).catch(() => [] as { event: calendar_v3.Schema$Event; calId: string }[])
    ))).flat();
    const r = resolveEvent(eaMatches, title, tz, currentTime);
    if (r.kind === 'none') return `I couldn't find "${title}" on your upcoming calendar to change its guest list.`;
    if (r.kind === 'ambiguous') return `There are multiple "${title}" events: ${r.message}. Which one? Re-call with currentTime set to its start time.`;
    const eaName = (r.event.summary ?? '').replace(/^⚡\s*/, '');
    const eaMeta = calMeta.get(r.calId);
    if (eaMeta && !isWritable(eaMeta.accessRole)) return `"${eaName}" is on a read-only calendar — I can't change its guests from here.`;
    const origAttendees = r.event.attendees ?? [];
    const merged = mergeAttendees(origAttendees, addList, removeList);
    const patched = await cal.events.patch({ calendarId: r.calId, eventId: r.event.id!, requestBody: { attendees: merged }, sendUpdates: 'all' })
      .catch((e: unknown) => { console.error('[editEventAttendees] patch failed:', e instanceof Error ? e.message : e); return null; });
    if (!patched) return `I couldn't update the guest list for "${eaName}" just now — want me to try again?`;
    recordUndo(userId, `changed guests on "${eaName}"`, [{ type: 'patch', calId: r.calId, eventId: r.event.id!, requestBody: { attendees: origAttendees } }]);
    const parts: string[] = [];
    if (addList.length) parts.push(`added ${addList.map(a => a.name || a.email).filter(Boolean).join(', ')}`);
    if (removeList.length) parts.push(`removed ${removeList.join(', ')}`);
    return `Updated "${eaName}" — ${parts.join(' and ')}.${addList.length ? " They'll get an invite (Google accounts only)." : ''}`;

  } else if (fn === 'skipRecurringOccurrence') {
    // R13 T2 — cancel ONE occurrence of a recurring series (low-stakes → no confirm token).
    const { title: rawTitle, occurrenceDate } = args as { title?: string; occurrenceDate?: string };
    if (!rawTitle || !occurrenceDate) return 'Which recurring event should I skip, and on what date?';
    const title = groundTitle(rawTitle);
    const r = resolveEvent(await eventsOnDay(cal, calIds, occurrenceDate, tz), title, tz);
    if (r.kind === 'none') return `No "${title}" found on ${occurrenceDate} to skip.`;
    if (r.kind === 'ambiguous') return `There are multiple "${title}" events on ${occurrenceDate}: ${r.message}. Which one should I skip? Re-call with currentTime set to its start time.`;
    const skipName = (r.event.summary ?? '').replace(/^⚡\s*/, '');
    if (!r.event.recurringEventId) return `"${skipName}" on ${occurrenceDate} isn't part of a recurring series — want me to just delete it instead?`;
    const skipMeta = calMeta.get(r.calId);
    if (skipMeta && !isWritable(skipMeta.accessRole)) return `"${skipName}" is on a read-only calendar — I can't change it from here.`;
    try {
      await cal.events.delete({ calendarId: r.calId, eventId: r.event.id! });
    } catch (err) {
      console.error('[skipRecurringOccurrence] delete failed:', err instanceof Error ? err.message : err);
      return `I couldn't skip that one just now — want me to try again?`;
    }
    recordUndo(userId, `skipped "${skipName}" on ${occurrenceDate}`, [{ type: 'recreate', calId: r.calId, event: cleanForRecreate(r.event) }]);
    return `Skipped "${skipName}" on ${occurrenceDate} — the series continues as normal.`;

  } else if (fn === 'endRecurringSeries') {
    // R13 T2 — cap a recurring series by adding UNTIL to the master RRULE (no delete).
    const { title: rawTitle, occurrenceDate, endAfterDate } = args as { title?: string; occurrenceDate?: string; endAfterDate?: string };
    if (!rawTitle || !occurrenceDate || !endAfterDate) return 'Tell me which recurring event, an example date it falls on, and the date to end it after.';
    const title = groundTitle(rawTitle);
    const r = resolveEvent(await eventsOnDay(cal, calIds, occurrenceDate, tz), title, tz);
    if (r.kind === 'none') return `No "${title}" found on ${occurrenceDate}.`;
    if (r.kind === 'ambiguous') return `There are multiple "${title}" events on ${occurrenceDate}: ${r.message}. Which series? Re-call with currentTime set to its start time.`;
    if (!r.event.recurringEventId) return `"${(r.event.summary ?? '').replace(/^⚡\s*/, '')}" isn't a recurring series, so there's nothing to end.`;
    const endMeta = calMeta.get(r.calId);
    if (endMeta && !isWritable(endMeta.accessRole)) return `"${(r.event.summary ?? '').replace(/^⚡\s*/, '')}" is on a read-only calendar — I can't change it from here.`;
    const master = await cal.events.get({ calendarId: r.calId, eventId: r.event.recurringEventId }).then(g => g.data).catch(() => null);
    if (!master?.recurrence?.length) {
      console.error(`[endRecurringSeries] no master recurrence calId=${r.calId} eventId=${r.event.recurringEventId}`);
      return `I couldn't read that series' schedule to cap it — want me to try again?`;
    }
    const seriesTz = master.start?.timeZone ?? tz;
    const newRecurrence = applyRruleUntil(master.recurrence, rruleUntilUtc(endAfterDate, seriesTz));
    const origRecurrence = master.recurrence;
    const seriesName = (master.summary ?? '').replace(/^⚡\s*/, '');
    try {
      await cal.events.patch({ calendarId: r.calId, eventId: r.event.recurringEventId, requestBody: { recurrence: newRecurrence } });
    } catch (err) {
      console.error('[endRecurringSeries] patch failed:', err instanceof Error ? err.message : err);
      return `I couldn't cap that series just now — want me to try again?`;
    }
    recordUndo(userId, `ended "${seriesName}" series after ${endAfterDate}`, [{ type: 'patch', calId: r.calId, eventId: r.event.recurringEventId, requestBody: { recurrence: origRecurrence } }]);
    return `Got it — "${seriesName}" will end after ${endAfterDate}.`;

  } else if (fn === 'blockTravelTime') {
    // R13 T3 — block a travel window (timed if a departure/return time is given, else all-day)
    // and warn about anything scheduled within 90 min of departure/return.
    const { date, destination, departureTime, returnDate, returnTime } = args as {
      date?: string; destination?: string; departureTime?: string; returnDate?: string; returnTime?: string;
    };
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'What day is the travel?';
    if (!destination?.trim()) return 'Where are you traveling to?';
    const dest = destination.trim();
    const travelTitle = `✈ Travel: ${dest}`;
    const TRAVEL_MINUTES = 180; // default block length when a time is given
    const createdIds: string[] = [];
    const warnings: string[] = [];

    // Create one travel block (timed or all-day) for a leg, returning false on failure.
    const blockLeg = async (legDate: string, time: string | undefined, label: string): Promise<boolean> => {
      let rb: calendar_v3.Schema$Event;
      let anchorMs: number | null = null;
      if (time) {
        const { start, end } = bookEventTimes(legDate, resolveNaturalTime(time), TRAVEL_MINUTES);
        rb = { summary: travelTitle, start: { dateTime: start, timeZone: tz }, end: { dateTime: end, timeZone: tz }, colorId: '9' };
        anchorMs = zonedWallTimeToUtc(start, tz).getTime();
      } else {
        rb = { summary: travelTitle, start: { date: legDate }, end: { date: nextDay(legDate) }, colorId: '9' };
      }
      const ins = await cal.events.insert({ calendarId: 'primary', requestBody: rb }).catch((e: unknown) => {
        console.error(`[blockTravelTime] insert failed (${label}):`, e instanceof Error ? e.message : e);
        return null;
      });
      if (!ins?.data.id) return false;
      createdIds.push(ins.data.id);
      // Proximity warning: timed legs only (need a clock anchor).
      if (anchorMs != null) {
        const dayEvents = (await eventsOnDay(cal, calIds, legDate, tz)).map(x => x.event).filter(e => e.summary !== travelTitle);
        const near = nearbyTimedEvents(dayEvents, anchorMs, 90);
        if (near.length) warnings.push(`Around your ${label} you've got ${formatBatchPreview(near, tz)}`);
      }
      return true;
    };

    const outbound = await blockLeg(date, departureTime, 'departure');
    if (!outbound) return `I couldn't block the travel time just now — want me to try again?`;
    if (returnDate && /^\d{4}-\d{2}-\d{2}$/.test(returnDate)) {
      await blockLeg(returnDate, returnTime, 'return');
    }
    if (createdIds.length) recordUndo(userId, `blocked travel to ${dest}`, [{ type: 'deleteMany', calId: 'primary', eventIds: createdIds }]);

    const span = returnDate && returnDate !== date ? `${date}${returnDate ? ` and back ${returnDate}` : ''}` : date;
    let msg = `Blocked travel to ${dest} on ${span}.`;
    if (warnings.length) msg += ` Heads up — ${warnings.join('; ')}. Want me to move anything?`;
    return msg;

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
    // T3 (in-call memory trigger): accepts optional `topic` (entity) + `category`.
    // When topic is provided and an existing fact matches, T1 retires+inserts immediately —
    // the next briefing is already correct without waiting for sleep-time consolidation.
    const { statement, topic, category } = args as { statement: string; topic?: string; category?: string };
    if (!statement?.trim()) return "What preference should I remember? Tell me in one sentence.";
    const VALID_FACT_CATS = new Set(['preference', 'goal', 'project', 'fact']);
    const cat = VALID_FACT_CATS.has(category ?? '') ? (category as string) : 'preference';
    const ent = topic?.trim().slice(0, 200) || null;

    // Check for an existing active fact on this topic before upserting so we can
    // return a contextual "updated" vs "saved" confirmation.
    const existing = ent
      ? factQueries.getByCategory(userId, cat).find(f => f.entity?.toLowerCase() === ent.toLowerCase())
      : null;
    const isUpdate = !!(existing && existing.statement.toLowerCase() !== statement.trim().toLowerCase());

    if (isUpdate && existing) {
      // R29 — universally cumulative memory: ENRICH the existing fact instead of overwriting it, so
      // earlier details survive (e.g. Patrick's "bachelor party in Vegas" isn't lost when "grew up in
      // Dallas" is added). enrichFact merges via Haiku (concat fallback); never throws.
      const merged = await enrichFact(existing.statement, statement.trim());
      // updateFact snapshots to fact_history (reason='user-edit') before writing the merged statement.
      factQueries.updateFact(userId, existing.id, merged.slice(0, 500), ent);
      // Undo = rollback to the history entry just created (most recent for this fact).
      try {
        const hist = factHistoryQueries.getForFact(existing.id, userId);
        if (hist.length) recordUndo(userId, `updated fact${ent ? ` "${ent}"` : ''}`, [{ type: 'rollbackFact', userId, historyId: hist[0].id }]);
      } catch { /* non-critical */ }
    } else {
      factQueries.upsertFact(userId, cat, statement.trim().slice(0, 500), ent);
      // Undo = retire the newly inserted active fact (query by entity/category to find its id).
      try {
        const newFact = ent
          ? factQueries.getByCategory(userId, cat).find(f => f.entity?.toLowerCase() === ent.toLowerCase())
          : factQueries.getByCategory(userId, cat).find(f => !f.entity && f.statement.slice(0, 80).toLowerCase() === statement.slice(0, 80).toLowerCase());
        if (newFact) recordUndo(userId, `saved fact${ent ? ` "${ent}"` : ''}`, [{ type: 'retireFact', userId, factId: newFact.id }]);
      } catch { /* non-critical */ }
    }

    const topicLabel = ent ? ` "${ent}"` : '';
    return isUpdate
      ? `Got it — I've updated${topicLabel} in your memory.`
      : `Got it — I've saved${topicLabel} and will apply it going forward.`;

  } else if (fn === 'confirmFact') {
    // M4-1 / Round 6 Ticket 2: when Edge surfaces a low-confidence/stale fact and the user
    // confirms it's still true (no correction), reset its confidence so it stops being
    // flagged for reconfirmation. The model passes the topic (entity) or a statement fragment
    // it just confirmed; we resolve the active fact and reset it. Corrections go through
    // rememberPreference instead (retire + replace).
    const { topic, statement } = args as { topic?: string; statement?: string };
    const needle = (topic || statement || '').trim().toLowerCase();
    if (!needle) return "Which fact should I mark as still current?";
    let match = null as ReturnType<typeof factQueries.getAll>[number] | null;
    try {
      const active = factQueries.getAll(userId, { includeRetired: false });
      // Prefer an entity match; fall back to a statement substring match.
      match = active.find(f => f.entity?.toLowerCase() === needle)
        ?? active.find(f => f.statement.toLowerCase().includes(needle))
        ?? null;
    } catch { /* degrade */ }
    if (!match) return "I couldn't find that one to confirm — no harm, I'll keep what I have.";
    try { factQueries.confirmFact(userId, match.id); } catch { /* non-critical */ }
    return "Great — I've got that confirmed as current.";

  } else if (fn === 'getWeather') {
    // R9 T4: live weather via Open-Meteo (free, no key). Hardcoded Toronto for now;
    // degrades to a graceful line on any failure (never "I don't have weather data").
    const { getWeatherForecast } = await import('@/lib/weather');
    return await getWeatherForecast();

  } else if (fn === 'addTask') {
    // R14 T4 — create an action-item task by voice.
    const { title: rawTaskTitle, dueDate } = args as { title?: string; dueDate?: string };
    if (!rawTaskTitle?.trim()) return 'What should I add to your tasks?';
    const taskText = rawTaskTitle.trim().slice(0, 300);
    const due = dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : todayInTz(tz);
    try {
      taskQueries.create(userId, taskText, due, 'edg3');
    } catch (err) {
      console.error('[addTask] failed:', err instanceof Error ? err.message : err);
      return `I couldn't add that to your tasks just now — want me to try again?`;
    }
    return `Added to your tasks: "${taskText}"${dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? ` — due ${dueDate}` : ''}.`;

  } else if (fn === 'completeTask') {
    // R14 T4 — mark an open task done by fuzzy-matching its title.
    const { title: rawDoneTitle } = args as { title?: string };
    if (!rawDoneTitle?.trim()) return 'Which task did you finish?';
    const openTasks = (() => { try { return taskQueries.getIncomplete(userId); } catch { return []; } })();
    if (!openTasks.length) return `You don't have any open tasks right now.`;
    const { match, ambiguous } = pickTaskToComplete(openTasks.map(t => ({ id: t.id, text: t.text })), rawDoneTitle);
    if (!match) {
      if (ambiguous.length > 1) return `You have a few that could match: ${ambiguous.map(t => `"${t.text}"`).join(', ')}. Which one?`;
      return `I couldn't find an open task matching "${rawDoneTitle.trim()}".`;
    }
    try {
      taskQueries.complete(match.id, userId);
    } catch (err) {
      console.error('[completeTask] failed:', err instanceof Error ? err.message : err);
      return `I couldn't mark that done just now — want me to try again?`;
    }
    return `Done — marked "${match.text}" as complete.`;

  } else if (fn === 'recordGratitude') {
    // R20 — save the three gratitude items captured on the morning gratitude call.
    const { item1, item2, item3 } = args as { item1?: string; item2?: string; item3?: string };
    const clean = (s?: string) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, 500) : null);
    try {
      gratitudeQueries.create(userId, todayInTz(tz), clean(item1), clean(item2), clean(item3));
    } catch (err) {
      console.error('[recordGratitude] failed:', err instanceof Error ? err.message : err);
      return `I couldn't save that just now — but I heard you. Have a great day!`;
    }
    return `Saved — have a great day!`;

  } else if (fn === 'forgetFact') {
    // R14 T5 — retire stored facts matching a topic so a correction doesn't conflict with stale data.
    const { topic } = args as { topic?: string };
    if (!topic?.trim()) return 'What should I forget?';
    const activeFacts = (() => { try { return factQueries.getAll(userId); } catch { return []; } })();
    const matches = factsMatchingTopic(activeFacts.map(f => ({ id: f.id, entity: f.entity, statement: f.statement })), topic);
    if (!matches.length) return `I don't have anything stored about ${topic.trim()} — nothing to forget.`;
    let removed = 0;
    for (const m of matches) { try { factQueries.retire(userId, m.id); removed++; } catch (e) { console.error('[forgetFact] retire failed:', e instanceof Error ? e.message : e); } }
    if (!removed) return `I ran into trouble clearing that — want me to try again?`;
    const sensitive = /address|live|home|wake|name|partner|spouse/i.test(topic);
    return `Got it — I've cleared everything I knew about ${topic.trim()}.${sensitive ? " If the new one is different, just tell me and I'll remember the updated version." : ''}`;

  } else if (fn === 'searchMemory') {
    // M3-2: on-demand memory retrieval — searches facts + episodes + memories for the query.
    const { query } = args as { query?: string };
    if (!query?.trim()) return "What would you like me to look up?";
    const needle = query.trim().toLowerCase();
    const results: string[] = [];

    // 1. Search facts (all — including stale, since user explicitly asked)
    try {
      const allFacts = factQueries.getAll(userId, { includeRetired: false });
      const factHits = allFacts.filter(f =>
        f.statement.toLowerCase().includes(needle) ||
        (f.entity?.toLowerCase().includes(needle) ?? false)
      ).slice(0, 3);
      for (const f of factHits) results.push(`[${f.category}] ${f.statement}`);
    } catch { /* degrade */ }

    // 2. Search episodes (topics + commitments)
    try {
      const episodes = episodeQueries.search(userId, { topic: query.trim(), limit: 5 });
      for (const e of episodes.slice(0, 2)) {
        const d = e.occurredAt.slice(0, 10);
        if (e.commitments?.length) results.push(`[call ${d}] committed: ${e.commitments.join('; ')}`);
        else if (e.topics?.length) results.push(`[call ${d}] topics: ${e.topics.join(', ')}`);
      }
    } catch { /* degrade */ }

    // 3. Search memories (weighted notes)
    try {
      const memories = memoryQueries.getWeighted(userId, 30);
      const memHits = memories.filter(m => m.content.toLowerCase().includes(needle)).slice(0, 2);
      for (const m of memHits) results.push(`[note] ${m.content.slice(0, 120)}`);
    } catch { /* degrade */ }

    if (!results.length) return `I don't have anything on "${query}" yet — you can tell me and I'll remember it.`;
    return `Here's what I have on "${query}":\n${results.join('\n')}`;

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
        if (typeof a === 'string') return { title: a.trim().slice(0, 200), rationale: '', confidence: 'medium' as const };
        if (typeof a === 'object' && a !== null) {
          const o = a as Record<string, unknown>;
          return { title: String(o.title ?? '').trim().slice(0, 200), rationale: String(o.rationale ?? '').trim().slice(0, 500), confidence: 'medium' as const };
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

    // Idempotency: if already confirmed today with same titles, skip the write.
    const existingFocus = dailyFocusQueries.getToday(userId, date);
    if (existingFocus?.confirmed) {
      let existingAreas: { title: string }[] = [];
      try { existingAreas = JSON.parse(existingFocus.focus_areas); } catch { /* ok */ }
      const existingKey = existingAreas.map(a => a.title.trim().toLowerCase()).sort().join('|');
      const newKey = cleaned.map(a => a.title.trim().toLowerCase()).sort().join('|');
      if (existingKey === newKey) {
        const listed = cleaned.map((a, i) => `${i + 1}. ${a.title}`).join(', ');
        return `Already locked in for today: ${listed}. You're set.`;
      }
    }

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
    const [planTodayEvents, planWeekEvents, recoveryHistory, todaySleep] = await Promise.all([
      getCalendarEvents(userId).catch(() => [] as calendar_v3.Schema$Event[]),
      getWeekEvents(userId).catch(() => [] as calendar_v3.Schema$Event[]),
      getRecoveryHistory(userId, 7).catch(() => []),
      getLastSleep(userId).catch(() => null),
    ]);
    const alignment = await computeAlignment(priorities, planWeekEvents, userTz).catch(() => null);
    const openLoopsDueToday = (() => {
      try {
        return openLoopQueries.list(userId, 'open')
          .filter((l: { dueDate: string | null }) => l.dueDate === today)
          .map((l: { description: string }) => l.description);
      }
      catch { return []; }
    })();

    const fit = computeCalendarFit(alignment, priorities, recoveryHistory, todaySleep);
    const nowIso = new Date().toISOString();
    const plan = buildCalendarPlan(planTodayEvents, fit, priorities, today, userTz, alignment, recoveryHistory, openLoopsDueToday, nowIso);

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
      const newAlignment = await computeAlignment(priorities, newWeekEvts, userTz).catch(() => alignment);
      const newFit = computeCalendarFit(newAlignment, priorities, recoveryHistory, todaySleep);
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

  } else if (fn === 'setPriorities') {
    // Accept derived or user-stated priorities mid-call.
    // priorities: array of 2–3 plain-text priority strings.
    const { priorities: rawPriorities } = args as { priorities?: unknown };
    if (!Array.isArray(rawPriorities) || rawPriorities.length === 0) {
      return "What are the 2–3 priorities you want to set? Tell me in plain English.";
    }
    const { getWeekOf } = await import('@/lib/briefing');
    const weekOf = getWeekOf();
    const texts = (rawPriorities as unknown[])
      .map(p => (typeof p === 'string' ? p : String(p ?? '')).trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 3);
    if (!texts.length) return "I didn't catch those priorities — can you say them again?";

    const prevPriorities = priorityQueries.getThisWeek(userId, weekOf).map(p => ({ text: (p as { text: string }).text, rank: (p as { rank: number }).rank }));
    priorityQueries.deleteThisWeek(userId, weekOf);
    texts.forEach((text, i) => priorityQueries.create(userId, text, weekOf, i + 1));
    try { factQueries.syncPriorityFacts(userId, texts); } catch { /* non-fatal */ }
    if (prevPriorities.length) recordUndo(userId, `updated priorities (was: ${prevPriorities.map(p => p.text).join('; ')})`, [{ type: 'restorePriorities', userId, weekOf, priorities: prevPriorities }]);

    auditLogQueries.record({
      userId,
      action: 'setPriorities',
      argsJson: JSON.stringify({ count: texts.length }),
      resultText: `Set ${texts.length} priority(ies): ${texts.join('; ')}`,
      ok: true,
    });

    const listed = texts.map((t, i) => `${i + 1}. ${t}`).join(' / ');
    return `Done — I've set your priorities: ${listed}. They're live in the dashboard and I'll factor them into tomorrow's briefing.`;
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

    // R11 T2 — per-user tool-call rate limit. Guards against a runaway Vapi tool loop
    // (a misbehaving model or retry storm that would rack up Google/LLM cost or spam the
    // calendar). 60/min/user via the shared SQLite limiter. On exceed we answer in the Vapi
    // response shape with a graceful spoken message — NOT a raw 429, which would surface as a
    // hard error mid-call. The tools do NOT execute, so the loop is broken.
    const toolRl = checkRateLimit('vapiToolCall', String(briefing.user_id));
    if (!toolRl.allowed) {
      console.warn(`[tool-call] rate limit hit (60/min) for user=${briefing.user_id} — ${calls.length} call(s) refused`);
      const msg = "I'm getting a burst of requests right now — give me a few seconds and ask me that again.";
      return NextResponse.json(
        useResultsArray
          ? { results: calls.map(c => ({ toolCallId: c.id, result: msg })) }
          : { result: msg }
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

      // T4-4: Tool-call idempotency — Vapi retries the same toolCallId on timeout.
      // Claim by toolCallId (only available in the new tool-calls format where tc.id != null).
      // Legacy function-call format has tc.id = null and is not deduplicated here.
      if (tc.id && !claimToolCall(tc.id)) {
        const cached = getToolCallCached(tc.id);
        result = cached ?? 'Request already in progress — action may have completed. Please check your calendar.';
        console.log(`[tool-call] Duplicate toolCallId ${tc.id} (${tc.name}) — ${cached ? 'returning cached result' : 'in-flight'}`);
        results.push({ toolCallId: tc.id, result });
        continue;
      }

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

      // Store result for any concurrent duplicate requests waiting for this call to finish.
      if (tc.id) recordToolCallResult(tc.id, result);

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
      if (ok) {
        const argsTitle = typeof tc.args.title === 'string' ? tc.args.title : undefined;
        const firstEventTitle = Array.isArray(tc.args.events)
          ? (tc.args.events[0] as { title?: string })?.title
          : undefined;
        maybeCreateActivityNotif(briefing.user_id, tc.name, argsTitle ?? firstEventTitle ?? '');
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
