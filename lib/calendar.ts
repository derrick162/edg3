import { google, calendar_v3 } from 'googleapis';
import { calendarQueries, userQueries } from './db';
import { wallTimeToUtc, dayRangeUtc, todayInTz } from './time';
import { GOOGLE_SCOPES } from './google-auth';

const BRIEFING_EVENT_TITLE = 'Edg3 Morning Briefing';

// Write a post-call summary into today's "Edg3 Morning Briefing" calendar event (the daily
// reminder the user added). Each day's instance is its own event, so the summary is set per day.
// Returns false if the user has no calendar or hasn't added the daily reminder.
export async function addSummaryToTodaysBriefingEvent(userId: number, timezone: string, summary: string): Promise<boolean> {
  const tokenRow = calendarQueries.get(userId);
  if (!tokenRow) return false;
  const o = getOAuthClient();
  o.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token || undefined,
    expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined,
  });
  const cal = google.calendar({ version: 'v3', auth: o });
  const { start, end } = dayRangeUtc(timezone);
  const res = await cal.events.list({ calendarId: 'primary', timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: true, q: BRIEFING_EVENT_TITLE }).catch(() => ({ data: { items: [] as calendar_v3.Schema$Event[] } }));
  const ev = (res.data.items ?? []).find(e => e.summary === BRIEFING_EVENT_TITLE);
  if (!ev?.id) return false;
  const dateLabel = new Date().toLocaleDateString('en-US', { timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric' });
  const description = `Your daily AI Chief of Staff call.\n\n— Call summary · ${dateLabel} —\n${summary}`;
  await cal.events.patch({ calendarId: 'primary', eventId: ev.id, requestBody: { description } });
  return true;
}

// Re-exported under its historical name for existing importers (the Vapi tool-call route).
// The single implementation now lives in lib/time.ts.
export const zonedWallTimeToUtc = wallTimeToUtc;

// Scopes are owned by lib/google-auth.ts (shared by Calendar + Gmail). Adding
// gmail.compose there means existing calendar-only users will be missing it and
// must re-consent — detect via google-auth `hasGmailScope`/`missingRequiredScopes`.
const SCOPES = GOOGLE_SCOPES;

export function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/calendar/callback'
  );
}

export function getAuthUrl(userId?: number): string {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    // Incremental auth: keep previously-granted scopes when a calendar-only user
    // re-consents to add Gmail, so we never silently drop calendar access.
    include_granted_scopes: true,
    state: userId ? String(userId) : undefined,
  });
}

export async function exchangeCode(code: string) {
  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

// Disconnect a user's Google Calendar: revoke the grant at Google, then delete the
// stored tokens. Best-effort on the Google side — even if revoke fails (e.g. token
// already expired), we always remove the local tokens so the app treats it as disconnected.
export async function disconnectCalendar(userId: number): Promise<void> {
  const tokenRow = calendarQueries.get(userId);
  if (tokenRow) {
    const tokenToRevoke = tokenRow.refresh_token || tokenRow.access_token;
    if (tokenToRevoke) {
      try {
        await getOAuthClient().revokeToken(tokenToRevoke);
      } catch (err) {
        console.error(`[calendar] Google token revoke failed for user ${userId} (deleting locally anyway):`, err);
      }
    }
  }
  calendarQueries.delete(userId);
}

export async function getCalendarEvents(userId: number) {
  const tokenRow = calendarQueries.get(userId);
  if (!tokenRow) return [];

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token || undefined,
    expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined,
  });

  // Auto-refresh token if needed
  oauth2Client.on('tokens', (tokens) => {
    if (tokens.access_token) {
      calendarQueries.upsert(
        userId,
        tokens.access_token,
        tokens.refresh_token || tokenRow.refresh_token || '',
        tokens.expiry_date?.toString() || ''
      );
    }
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  // Compute "today" in the user's timezone (not the server's UTC), so an evening call
  // doesn't pull tomorrow's early events into today's briefing.
  const tz = userQueries.findById(userId)?.timezone || 'America/Los_Angeles';
  const { start: startOfDay, end: endOfDay } = dayRangeUtc(tz);

  // Fetch from all calendars
  const calendarList = await calendar.calendarList.list({ minAccessRole: 'reader' });
  const calendarIds = (calendarList.data.items || [])
    .filter(c => !c.hidden)
    .map(c => c.id!)
    .filter(Boolean);

  const allEvents = await Promise.all(
    calendarIds.map(calendarId =>
      calendar.events.list({
        calendarId,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        showHiddenInvitations: true,
        orderBy: 'startTime',
        maxResults: 20,
      }).then(r => r.data.items || []).catch(() => [])
    )
  );

  return allEvents.flat().sort((a, b) => {
    const aTime = a.start?.dateTime || a.start?.date || '';
    const bTime = b.start?.dateTime || b.start?.date || '';
    return aTime.localeCompare(bTime);
  });
}

export async function getWeekEvents(userId: number) {
  const tokenRow = calendarQueries.get(userId);
  if (!tokenRow) return [];

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token || undefined,
    expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined,
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const now = new Date();
  const endOfWeek = new Date();
  endOfWeek.setDate(now.getDate() + 7);

  // Fetch from all calendars, not just primary
  const calendarList = await calendar.calendarList.list({ minAccessRole: 'reader' });
  const calendarIds = (calendarList.data.items || [])
    .filter(c => !c.hidden)
    .map(c => c.id!)
    .filter(Boolean);

  // Fetch events from all calendars in parallel
  const allEvents = await Promise.all(
    calendarIds.map(calendarId =>
      calendar.events.list({
        calendarId,
        timeMin: now.toISOString(),
        timeMax: endOfWeek.toISOString(),
        singleEvents: true,
        showHiddenInvitations: true,
        orderBy: 'startTime',
        maxResults: 50,
      }).then(r => r.data.items || []).catch(() => [])
    )
  );

  // Merge and sort by start time
  const merged = allEvents.flat().sort((a, b) => {
    const aTime = a.start?.dateTime || a.start?.date || '';
    const bTime = b.start?.dateTime || b.start?.date || '';
    return aTime.localeCompare(bTime);
  });

  return merged;
}

/**
 * Fetch ALL events for the current Mon–Sun week in the user's timezone.
 * Unlike getWeekEvents (timeMin=now), this includes events that have already
 * completed earlier this week — needed for accurate per-priority hour totals.
 */
export async function getFullWeekEvents(userId: number, tz: string): Promise<calendar_v3.Schema$Event[]> {
  const tokenRow = calendarQueries.get(userId);
  if (!tokenRow) return [];

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token || undefined,
    expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined,
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  // Compute Mon–Sun boundaries in the user's timezone.
  // todayInTz gives "YYYY-MM-DD" in the user's local timezone.
  // Using noon UTC on that date string to get a reliable UTC day-of-week
  // (avoids edge cases where T00:00:00Z crosses midnight in far-east TZs).
  const todayStr = todayInTz(tz);
  const todayMidpoint = new Date(`${todayStr}T12:00:00Z`);
  const dow = todayMidpoint.getUTCDay(); // 0=Sun, 1=Mon, …, 6=Sat
  const daysSinceMonday = (dow + 6) % 7;  // Mon→0, Tue→1, …, Sun→6
  const mondayMidpoint = new Date(todayMidpoint.getTime() - daysSinceMonday * 86400000);
  const sundayMidpoint = new Date(mondayMidpoint.getTime() + 6 * 86400000);
  const mondayStr = mondayMidpoint.toISOString().slice(0, 10);
  const sundayStr = sundayMidpoint.toISOString().slice(0, 10);

  const { start: weekStart } = dayRangeUtc(tz, mondayStr);
  const { end: weekEnd } = dayRangeUtc(tz, sundayStr);

  const calendarList = await calendar.calendarList.list({ minAccessRole: 'reader' });
  const calendarIds = (calendarList.data.items || [])
    .filter(c => !c.hidden)
    .map(c => c.id!)
    .filter(Boolean);

  const allEvents = await Promise.all(
    calendarIds.map(calendarId =>
      calendar.events.list({
        calendarId,
        timeMin: weekStart.toISOString(),
        timeMax: weekEnd.toISOString(),
        singleEvents: true,
        showHiddenInvitations: true,
        orderBy: 'startTime',
        maxResults: 100,
      }).then(r => r.data.items || []).catch(() => [])
    )
  );

  return allEvents.flat().sort((a, b) => {
    const aTime = a.start?.dateTime || a.start?.date || '';
    const bTime = b.start?.dateTime || b.start?.date || '';
    return aTime.localeCompare(bTime);
  });
}

// Fetch events for the next `days` days (defaults to 7). Used by the admin
// CoS calendar API — supports arbitrary day windows, not just today or this week.
export async function getUpcomingEvents(userId: number, days: number = 7) {
  const tokenRow = calendarQueries.get(userId);
  if (!tokenRow) return [];

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token || undefined,
    expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined,
  });

  oauth2Client.on('tokens', (tokens) => {
    if (tokens.access_token) {
      calendarQueries.upsert(
        userId,
        tokens.access_token,
        tokens.refresh_token || tokenRow.refresh_token || '',
        tokens.expiry_date?.toString() || ''
      );
    }
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const now = new Date();
  const timeMax = new Date(now.getTime() + days * 86400000);

  const calendarList = await calendar.calendarList.list({ minAccessRole: 'reader' });
  const calendarIds = (calendarList.data.items || [])
    .filter(c => !c.hidden)
    .map(c => c.id!)
    .filter(Boolean);

  const allEvents = await Promise.all(
    calendarIds.map(calendarId =>
      calendar.events.list({
        calendarId,
        timeMin: now.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        showHiddenInvitations: true,
        orderBy: 'startTime',
        maxResults: 50,
      }).then(r => r.data.items || []).catch(() => [])
    )
  );

  return allEvents.flat().sort((a, b) => {
    const aTime = a.start?.dateTime || a.start?.date || '';
    const bTime = b.start?.dateTime || b.start?.date || '';
    return aTime.localeCompare(bTime);
  });
}

/**
 * Fetch timed events from the past `days` calendar days.
 * Returns one entry per local calendar date in `timezone`, with the end-hour
 * (decimal, 0–24) of the latest timed event that day — or null if no timed events.
 * Used by the Whoop correlation analysis to correlate "late meetings" with next-day recovery.
 */
export async function getPastCalendarDays(
  userId: number,
  days: number,
  timezone: string,
): Promise<{ date: string; latestEndHour: number | null }[]> {
  const tokenRow = calendarQueries.get(userId);
  if (!tokenRow) return [];

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token || undefined,
    expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined,
  });

  oauth2Client.on('tokens', (tokens) => {
    if (tokens.access_token) {
      calendarQueries.upsert(
        userId,
        tokens.access_token,
        tokens.refresh_token || tokenRow.refresh_token || '',
        tokens.expiry_date?.toString() || ''
      );
    }
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const now = new Date();
  const timeMax = now;
  const timeMin = new Date(now.getTime() - days * 86400000);

  const calendarList = await calendar.calendarList.list({ minAccessRole: 'reader' });
  const calendarIds = (calendarList.data.items || [])
    .filter(c => !c.hidden)
    .map(c => c.id!)
    .filter(Boolean);

  const allEvents = await Promise.all(
    calendarIds.map(calId =>
      calendar.events.list({
        calendarId: calId,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        showHiddenInvitations: true,
        orderBy: 'startTime',
        maxResults: 200,
      }).then(r => r.data.items || []).catch(() => [])
    )
  );

  // Group timed events by local calendar date; track the latest end hour per day
  const dayMap = new Map<string, number>(); // date → latest end hour (decimal)
  for (const event of allEvents.flat()) {
    if (!event.end?.dateTime) continue; // skip all-day events
    const endDate = new Date(event.end.dateTime);
    const localDate = endDate.toLocaleDateString('en-CA', { timeZone: timezone }); // 'YYYY-MM-DD'
    const localHour = endDate.toLocaleTimeString('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: false,
    });
    const [h, m] = localHour.split(':').map(Number);
    const decimalHour = h + (m || 0) / 60;
    const current = dayMap.get(localDate);
    if (current === undefined || decimalHour > current) {
      dayMap.set(localDate, decimalHour);
    }
  }

  // Build result: one entry per day in the window (days with no events → latestEndHour: null)
  const result: { date: string; latestEndHour: number | null }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const date = d.toLocaleDateString('en-CA', { timeZone: timezone });
    result.push({ date, latestEndHour: dayMap.get(date) ?? null });
  }
  return result;
}

/**
 * Fetch raw calendar events from the past `days` days across all non-hidden calendars.
 * Intended for analysis workloads (e.g. focus recommendation). Returns unsorted raw events,
 * capped at 250 per calendar to stay within Google API limits.
 */
export async function getPastCalendarEvents(
  userId: number,
  days: number,
): Promise<calendar_v3.Schema$Event[]> {
  const tokenRow = calendarQueries.get(userId);
  if (!tokenRow) return [];

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token || undefined,
    expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined,
  });
  oauth2Client.on('tokens', (tokens) => {
    if (tokens.access_token) {
      calendarQueries.upsert(
        userId,
        tokens.access_token,
        tokens.refresh_token || tokenRow.refresh_token || '',
        tokens.expiry_date?.toString() || ''
      );
    }
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const now = new Date();
  const timeMax = now.toISOString();
  const timeMin = new Date(now.getTime() - days * 86400000).toISOString();

  const calendarList = await calendar.calendarList.list({ minAccessRole: 'reader' });
  const calendarIds = (calendarList.data.items || [])
    .filter(c => !c.hidden)
    .map(c => c.id!)
    .filter(Boolean);

  const allEvents = await Promise.all(
    calendarIds.map(calId =>
      calendar.events.list({
        calendarId: calId,
        timeMin,
        timeMax,
        singleEvents: true,
        maxResults: 250,
      }).then(r => r.data.items || []).catch(() => [])
    )
  );

  return allEvents.flat();
}

export async function createCalendarEvent(
  userId: number,
  title: string,
  startTime: string,
  endTime: string,
  timezone: string = 'America/New_York',
  description?: string
) {
  const tokenRow = calendarQueries.get(userId);
  if (!tokenRow) throw new Error('No calendar connected');

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token || undefined,
    expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined,
  });

  oauth2Client.on('tokens', (tokens) => {
    if (tokens.access_token) {
      calendarQueries.upsert(
        userId,
        tokens.access_token,
        tokens.refresh_token || tokenRow.refresh_token || '',
        tokens.expiry_date?.toString() || ''
      );
    }
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const event = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: title,
      description: description || 'Scheduled by EDG3 — your AI Chief of Staff',
      start: { dateTime: startTime, timeZone: timezone },
      end: { dateTime: endTime, timeZone: timezone },
      colorId: '9', // Blueberry — distinct from other events
    },
  });

  return event.data;
}

const COLOR_MAP: Record<string, string> = {
  green: '10', sage: '2', grape: '3', pink: '4', flamingo: '4',
  yellow: '5', banana: '5', orange: '6', tangerine: '6',
  teal: '7', peacock: '7', blue: '8', blueberry: '8', navy: '8',
  red: '11', tomato: '11', purple: '3', lavender: '1',
};

export function getColorId(colorName: string): string {
  return COLOR_MAP[colorName.toLowerCase()] || '9';
}

export async function colorCalendarEvent(userId: number, eventId: string, colorName: string) {
  const tokenRow = calendarQueries.get(userId);
  if (!tokenRow) throw new Error('No calendar connected');

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token || undefined,
    expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined,
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  await calendar.events.patch({
    calendarId: 'primary',
    eventId,
    requestBody: { colorId: getColorId(colorName) },
  });
}

export async function deleteCalendarEvent(userId: number, eventId: string) {
  const tokenRow = calendarQueries.get(userId);
  if (!tokenRow) throw new Error('No calendar connected');

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token || undefined,
    expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined,
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  await calendar.events.delete({ calendarId: 'primary', eventId });
}

export async function moveCalendarEvent(
  userId: number,
  eventId: string,
  newStart: string,
  newEnd: string,
  timezone: string
) {
  const tokenRow = calendarQueries.get(userId);
  if (!tokenRow) throw new Error('No calendar connected');

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token || undefined,
    expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined,
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  await calendar.events.patch({
    calendarId: 'primary',
    eventId,
    requestBody: {
      start: { dateTime: newStart, timeZone: timezone },
      end: { dateTime: newEnd, timeZone: timezone },
    },
  });
}

export async function deduplicateCalendarEvents(userId: number, timezone: string) {
  const tokenRow = calendarQueries.get(userId);
  if (!tokenRow) return [];

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token || undefined,
    expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined,
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));
  const twoWeeks = new Date(now);
  twoWeeks.setDate(twoWeeks.getDate() + 30);

  // Fetch from all calendars
  const calList = await calendar.calendarList.list({ minAccessRole: 'reader' });
  const calIds = (calList.data.items || []).filter(c => !c.hidden).map(c => c.id!).filter(Boolean);

  const allEvts = await Promise.all(
    calIds.map(calId =>
      calendar.events.list({ calendarId: calId, timeMin: now.toISOString(), timeMax: twoWeeks.toISOString(), singleEvents: true, showHiddenInvitations: true, maxResults: 200 })
        .then(r => (r.data.items || []).map(e => ({ ...e, _calId: calId }))).catch(() => [])
    )
  );

  const events = allEvts.flat() as (calendar_v3.Schema$Event & { _calId: string })[];

  // Group by normalised title + day (strip ⚡ prefix, lowercase, trim)
  const normalizeTitle = (s: string) => s.replace(/^⚡\s*/, '').toLowerCase().trim();
  const groups = new Map<string, typeof events>();
  for (const ev of events) {
    const day = (ev.start?.dateTime || ev.start?.date || '').slice(0, 10);
    const title = normalizeTitle(ev.summary || '');
    const key = `${day}::${title}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(ev);
  }

  const deleted: string[] = [];
  for (const [, group] of groups) {
    if (group.length <= 1) continue;
    // Sort by start time, keep earliest, delete the rest
    group.sort((a, b) => (a.start?.dateTime || a.start?.date || '').localeCompare(b.start?.dateTime || b.start?.date || ''));
    const toDelete = group.slice(1);
    for (const ev of toDelete) {
      try {
        await calendar.events.delete({ calendarId: ev._calId, eventId: ev.id! });
        deleted.push(ev.summary || ev.id!);
        console.log(`[calendar] Dedup deleted: "${ev.summary}" on ${(ev.start?.dateTime || ev.start?.date || '').slice(0, 10)}`);
      } catch (err) {
        console.error(`[calendar] Dedup delete failed for ${ev.id}:`, err);
      }
    }
  }

  return deleted;
}

/** @deprecated RETIRED — the post-call "second writer". No longer called: the live in-call tools
 * are the single source of truth. Re-creating events from the transcript here caused duplicates.
 * Do not re-wire. Safe to physically delete in a follow-up. */
export async function processCalendarEdits(userId: number, transcript: string, timezone: string) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Get the next 7 days of events to work with
  const tokenRow = calendarQueries.get(userId);
  if (!tokenRow) return [];

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token || undefined,
    expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined,
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));
  const weekAhead = new Date(now);
  weekAhead.setDate(weekAhead.getDate() + 14);

  const calList = await calendar.calendarList.list({ minAccessRole: 'reader' });
  const editCalendarIds = (calList.data.items || []).filter(c => !c.hidden).map(c => c.id!).filter(Boolean);

  const allCalEvents = await Promise.all(
    editCalendarIds.map(calId =>
      calendar.events.list({ calendarId: calId, timeMin: now.toISOString(), timeMax: weekAhead.toISOString(), singleEvents: true, showHiddenInvitations: true, maxResults: 50 })
        .then(r => r.data.items || []).catch(() => [])
    )
  );

  const events = allCalEvents.flat();
  const eventCalendarMap = new Map<string, string>(); // eventId → calendarId
  editCalendarIds.forEach((calId, idx) => {
    (allCalEvents[idx] || []).forEach((e: calendar_v3.Schema$Event) => {
      if (e.id) eventCalendarMap.set(e.id, calId);
    });
  });
  const eventList = events.map(e => ({
    id: e.id,
    title: e.summary,
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
  }));

  const nowStr = now.toISOString().slice(0, 10);

  // Ask Claude to extract edit/delete/move instructions from transcript
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `Read this call transcript and extract any requests to DELETE, MOVE, or RESCHEDULE existing calendar events.

Today's date: ${nowStr}
User's home timezone: ${timezone}

TIMEZONE REFERENCE:
- "Pacific" / "PST" / "PDT" / "PT" / "Vancouver" / "LA" → America/Vancouver
- "Mountain" / "MST" / "MDT" / "Denver" / "Calgary" → America/Denver
- "Central" / "CST" / "CDT" / "Chicago" / "Dallas" → America/Chicago
- "Eastern" / "EST" / "EDT" / "Toronto" / "New York" / "Blue Mountain" / "Ontario" → America/Toronto
- "Atlantic" / "AST" / "Halifax" → America/Halifax
- "GMT" / "London" / "UK" → Europe/London
- "CET" / "Paris" / "Berlin" → Europe/Paris
- "IST" / "India" → Asia/Kolkata
- "JST" / "Tokyo" → Asia/Tokyo
- "AEST" / "Sydney" → Australia/Sydney
- "HKT" / "Hong Kong" / "Singapore" → Asia/Hong_Kong

EXISTING CALENDAR EVENTS (next 14 days):
${JSON.stringify(eventList, null, 2)}

NOTE: Events created by Edge are prefixed with "⚡". When matching user requests to events, ignore the "⚡" prefix. e.g. "change breakfast to green" should match "⚡ Breakfast" events.
NOTE: All-day events have a date-only start (e.g. "2026-06-08") instead of a datetime. "Remove the morning walk all day event" should match events with title containing "morning walk" that have date-only starts. Treat these the same as any other event for delete/move/color operations.

TRANSCRIPT:
${transcript}

Handle ALL of these natural language patterns:

BULK OPERATIONS — generate one action per matching event:
- "Delete all X this week" → find every event matching X this week, delete each
- "Cancel everything on Friday" → find all Friday events, delete each
- "Move all afternoon meetings to morning" → find each, move each individually
- "Delete all duplicates" → find duplicate titles on same day, keep earliest, delete rest

RELATIVE TIMING — calculate actual times from context:
- "Push X back 30 minutes" → add 30 min to both start and end
- "Move X to right after Y" → newStart = Y's end time, newEnd = newStart + X's duration
- "Swap X and Y" → X gets Y's time, Y gets X's time
- "Move to first thing in the morning" → use 07:00 same day
- "Move to end of day" → use 17:00 same day

TIMEZONE CONVERSION — move events to show at same clock time in a different timezone:
- "Move X from PST to EST" or "X should be EST not PST" → the displayed time stays the same but shifts by the timezone offset. PST is UTC-8 (or UTC-7 PDT), EST is UTC-5 (or UTC-4 EDT). Moving from PST to EST means the event UTC time moves 3 hours EARLIER (e.g. 12:00 PST = 20:00 UTC → 12:00 EST = 17:00 UTC, so newStart = original time minus 3 hours in UTC). Use action "move" with adjusted newStart/newEnd and include "timezone":"America/Toronto" field.
- "Move all meals to Toronto time" → apply timezone conversion to each matching event

SPECIFIC DAY PATTERNS:
- "Move X to Monday" → find next Monday, keep same time
- "Reschedule to this Friday" → calculate correct date

Return a JSON array of actions. Each action has:
- "action": "delete" | "move" | "color" | "rename"
- "eventId": the id from the event list above (match by title/time/day)
- "reason": brief description
- For "move": "newStart" and "newEnd" as local datetime strings (no Z suffix, format: YYYY-MM-DDTHH:MM:00)
- For "color": "color" as a color name (e.g. "green", "orange", "red", "blue", "purple", "yellow", "teal", "pink")
- For "rename": "newTitle" as the new event name

BULK COLOR: If user says "make all meals orange" or "color all X events green", return one action per matching event.
BULK RENAME: If user says "rename all X to Y", return one action per matching event.

Only include actions explicitly requested by the user. If nothing was requested, return [].

Example: [{"action":"color","eventId":"abc123","color":"green","reason":"MVP goal"},{"action":"color","eventId":"def456","color":"orange","reason":"meal event"}]`,
    }],
  });

  const content = response.content[0];
  if (content.type !== 'text') return [];

  console.log(`[calendar] processCalendarEdits raw response: ${content.text.slice(0, 500)}`);

  try {
    const match = content.text.match(/\[[\s\S]*\]/);
    if (!match) { console.log('[calendar] No JSON array found in response'); return []; }
    const actions: { action: string; eventId: string; reason: string; newStart?: string; newEnd?: string; color?: string; newTitle?: string }[] = JSON.parse(match[0]);
    console.log(`[calendar] Extracted ${actions.length} actions:`, JSON.stringify(actions.slice(0, 3)));

    const results = [];
    for (const action of actions) {
      try {
        // Try mapped calendar first, fall back to trying all calendars
        const calId = eventCalendarMap.get(action.eventId) || 'primary';
        const calIdsToTry = calId === 'primary'
          ? ['primary', ...editCalendarIds.filter(id => id !== 'primary')]
          : [calId];
        if (action.action === 'delete' && action.eventId) {
          const event = events.find(e => e.id === action.eventId);
          await deleteCalendarEvent(userId, action.eventId);
          results.push({ type: 'deleted', title: event?.summary || action.eventId, reason: action.reason });
          console.log(`[calendar] Deleted event: ${event?.summary} (${action.reason})`);
        } else if (action.action === 'move' && action.eventId && action.newStart && action.newEnd) {
          const event = events.find(e => e.id === action.eventId);
          const oac = getOAuthClient();
          oac.setCredentials({ access_token: tokenRow.access_token, refresh_token: tokenRow.refresh_token || undefined, expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined });
          const cal = google.calendar({ version: 'v3', auth: oac });
          const moveTimezone = (action as any).timezone || timezone;
          const requestBody: Record<string, unknown> = {
            start: { dateTime: action.newStart, timeZone: moveTimezone },
            end: { dateTime: action.newEnd, timeZone: moveTimezone },
          };
          // Preserve the original color if set
          if (event?.colorId) requestBody.colorId = event.colorId;
          await cal.events.patch({ calendarId: calId, eventId: action.eventId, requestBody });
          results.push({ type: 'moved', title: event?.summary || action.eventId, newStart: action.newStart, reason: action.reason });
          console.log(`[calendar] Moved event: ${event?.summary} to ${action.newStart} (color preserved: ${event?.colorId || 'default'})`);
        } else if (action.action === 'color' && action.eventId && action.color) {
          const event = events.find(e => e.id === action.eventId);
          const oac = getOAuthClient();
          oac.setCredentials({ access_token: tokenRow.access_token, refresh_token: tokenRow.refresh_token || undefined, expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined });
          const cal = google.calendar({ version: 'v3', auth: oac });
          let colored = false;
          for (const tryCalId of calIdsToTry) {
            try {
              await cal.events.patch({ calendarId: tryCalId, eventId: action.eventId, requestBody: { colorId: getColorId(action.color) } });
              console.log(`[calendar] Colored event: ${event?.summary} → ${action.color} on calendar ${tryCalId}`);
              colored = true;
              break;
            } catch { continue; }
          }
          if (colored) results.push({ type: 'colored', title: event?.summary || action.eventId, color: action.color, reason: action.reason });
          else console.error(`[calendar] Failed to color event ${action.eventId} on any calendar`);
        } else if (action.action === 'rename' && action.eventId && action.newTitle) {
          const event = events.find(e => e.id === action.eventId);
          const oac = getOAuthClient();
          oac.setCredentials({ access_token: tokenRow.access_token, refresh_token: tokenRow.refresh_token || undefined, expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined });
          const cal = google.calendar({ version: 'v3', auth: oac });
          let renamed = false;
          for (const tryCalId of calIdsToTry) {
            try {
              await cal.events.patch({ calendarId: tryCalId, eventId: action.eventId, requestBody: { summary: action.newTitle } });
              renamed = true; break;
            } catch { continue; }
          }
          if (renamed) { results.push({ type: 'renamed', title: event?.summary || action.eventId, newTitle: action.newTitle, reason: action.reason }); console.log(`[calendar] Renamed: "${event?.summary}" → "${action.newTitle}"`); }
          else console.error(`[calendar] Failed to rename event ${action.eventId}`);
        }
      } catch (err) {
        console.error(`[calendar] Failed to ${action.action} event ${action.eventId}:`, err);
      }
    }
    return results;
  } catch {
    return [];
  }
}

/** @deprecated RETIRED — the post-call "second writer". No longer called: the live in-call tools
 * are the single source of truth. Re-creating events from the transcript here caused duplicates.
 * Do not re-wire. Safe to physically delete in a follow-up. */
export async function extractAndCreateTimeBlocks(userId: number, briefingContent: string, timezone: string) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const localNow = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));
  const todayDate = localNow.toLocaleDateString('en-CA'); // YYYY-MM-DD
  const tomorrowDate = new Date(localNow);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = tomorrowDate.toLocaleDateString('en-CA');

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `Extract specific time block recommendations to add to the calendar.

Today's date: ${todayDate} (${new Date(todayDate).toLocaleDateString('en-US', { weekday: 'long' })})
Tomorrow's date: ${tomorrow} (${new Date(tomorrow).toLocaleDateString('en-US', { weekday: 'long' })})
User's home timezone: ${timezone}

TIMEZONE REFERENCE (use for any timezone mention, spoken or abbreviated):
- "Pacific" / "PST" / "PDT" / "PT" / "Vancouver" / "LA" / "Seattle" / "San Francisco" → America/Vancouver
- "Mountain" / "MST" / "MDT" / "MT" / "Denver" / "Calgary" → America/Denver
- "Central" / "CST" / "CDT" / "CT" / "Chicago" / "Dallas" / "Houston" → America/Chicago
- "Eastern" / "EST" / "EDT" / "ET" / "Toronto" / "New York" / "NYC" / "Blue Mountain" / "Ontario" → America/Toronto
- "Atlantic" / "AST" / "ADT" / "Halifax" → America/Halifax
- "GMT" / "UTC" / "London" / "UK" → Europe/London
- "CET" / "Paris" / "Berlin" / "Rome" → Europe/Paris
- "IST" / "India" / "Mumbai" → Asia/Kolkata
- "JST" / "Tokyo" / "Japan" → Asia/Tokyo
- "AEST" / "Sydney" / "Australia" → Australia/Sydney
- "HKT" / "Hong Kong" / "Singapore" / "SGT" → Asia/Hong_Kong

IMPORTANT — TRAVEL TIMEZONE DETECTION:
First, check if the user mentions being in a different location or timezone anywhere in the content.
If they mention a different location/timezone, use THAT timezone for ALL bookings in this session unless a specific event has its own timezone override.
If no travel location is mentioned, use the home timezone: ${timezone}

Calculate upcoming weekday dates from today:
${Array.from({length: 14}, (_, i) => {
  const d = new Date(todayDate);
  d.setDate(d.getDate() + i + 1);
  return `  ${d.toLocaleDateString('en-US', { weekday: 'long' })}: ${d.toLocaleDateString('en-CA')}`;
}).join('\n')}

Rules:
- "today", "this afternoon", "this morning", "tonight" → use ${todayDate}
- "tomorrow" or AI briefing recommendations → use ${tomorrow}
- "every day next week" → create one entry for EACH of Mon–Fri next week (5 entries)
- "every weekday this week" → create one entry for each remaining weekday this week
- "every Monday and Wednesday" → create entries for each Mon and Wed in the next 2 weeks
- "every day for the next X days" → create X entries on consecutive days
- "every morning this week" → one entry per remaining weekday this week
- "for the next 2 weeks" → create entries for each specified day across 2 weeks
- "first thing in the morning" → 07:00 local time
- "end of day" / "late afternoon" → 16:00–17:00 local time
- "block off 2 hours for X" → use a sensible time (e.g. 09:00–11:00) if no time given
- Do NOT extract events already on the calendar
- Do NOT recreate one-time events that already happened (court hearings, medical appointments)
- CRITICAL: If the request is to MOVE, RESCHEDULE, or CHANGE TIME of an existing event (e.g. "move lunch to 12pm", "reschedule dinner to 7pm", "change breakfast to 9am") — do NOT create a new event. These are handled separately.
- EXCEPTION: If the user explicitly says "delete [event] and create a new one at [time]" or "replace it with a new event at [time]" — DO create the new event. The explicit "create a new one" instruction overrides the move restriction.
- WEEK PROPOSALS: If asked to "structure my week", "propose my week", or "design my schedule", treat recurring habits (walks, gym, meals, focus time) as DAILY entries — create one per day Mon–Fri (or Mon–Sun if weekend included). A "nature walk every day" = 5–7 entries.
- Only extract truly NEW blocks being explicitly requested or recommended

Return ONLY a JSON array of time blocks, nothing else. Format:
[{"title": "event name", "start": "YYYY-MM-DDTHH:MM:00", "end": "YYYY-MM-DDTHH:MM:00", "timezone": "optional — only include if a specific timezone was mentioned"}]

TIMEZONE OVERRIDE: If the user specifies a timezone for an event (e.g. "4pm Eastern", "9am London time", "3pm EST", "noon Pacific"), include a "timezone" field with the correct IANA timezone:
- Eastern / EST / EDT → "America/New_York"
- Pacific / PST / PDT → "America/Vancouver"
- Central / CST / CDT → "America/Chicago"
- Mountain / MST / MDT → "America/Denver"
- GMT / London → "Europe/London"
- CET / Paris / Berlin → "Europe/Paris"
- IST / India → "Asia/Kolkata"
- JST / Tokyo → "Asia/Tokyo"
- AEST / Sydney → "Australia/Sydney"
If no timezone is mentioned, omit the "timezone" field and use the user's default.

Datetime strings are the clock time as stated by the user (no Z suffix, no UTC offset).
If no clear new time blocks are mentioned, return [].

Content:
${briefingContent}`,
    }],
  });

  const content = response.content[0];
  if (content.type !== 'text') return [];

  try {
    const text = content.text.trim();
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const blocks: { title: string; start: string; end: string; timezone?: string }[] = JSON.parse(jsonMatch[0]);

    // Fetch existing events for tomorrow to avoid conflicts
    const tokenRow = (await import('./db')).calendarQueries.get(userId);
    let existingEvents: calendar_v3.Schema$Event[] = [];
    if (tokenRow) {
      const oauth2Client = getOAuthClient();
      oauth2Client.setCredentials({
        access_token: tokenRow.access_token,
        refresh_token: tokenRow.refresh_token || undefined,
        expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined,
      });
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      // Fetch events for both today and tomorrow to check conflicts
      const dayStart = new Date(`${todayDate}T00:00:00`);
      const dayEnd = new Date(`${tomorrow}T23:59:59`);
      const existing = await calendar.events.list({
        calendarId: 'primary',
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
        singleEvents: true,
        showHiddenInvitations: true,
        maxResults: 100,
      });
      existingEvents = existing.data.items || [];
    }

    // Helper: convert a local datetime string (no timezone) to UTC ms using the user's timezone
    // e.g. "2026-06-06T09:00:00" in "America/Vancouver" → correct UTC ms
    const localToUtcMs = (localStr: string): number => {
      const asIfUtc = new Date(localStr + 'Z'); // parse as UTC first
      // Find what the target timezone displays for this UTC moment
      const localDisplay = asIfUtc.toLocaleString('en-CA', {
        timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      }).replace(',', '').replace(' ', 'T');
      const localAsUtc = new Date(localDisplay + 'Z');
      const tzOffset = asIfUtc.getTime() - localAsUtc.getTime();
      return asIfUtc.getTime() + tzOffset;
    };

    const created = [];
    for (const block of blocks) {
      // Parse block times as local timezone (not UTC)
      const blockStart = localToUtcMs(block.start);
      const blockEnd = localToUtcMs(block.end);

      // Skip if an event with the same title AND same start time already exists
      const blockDay = block.start.slice(0, 10); // YYYY-MM-DD
      const blockHour = block.start.slice(11, 16); // HH:MM
      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const blockTitleNorm = normalize(block.title);
      const hasDuplicate = existingEvents.some(ev => {
        const evDay = (ev.start?.dateTime || ev.start?.date || '').slice(0, 10);
        if (evDay !== blockDay) return false;
        const evTitle = normalize(ev.summary?.replace(/^⚡\s*/, '') || '');
        const titleMatches = evTitle === blockTitleNorm || evTitle.includes(blockTitleNorm) || blockTitleNorm.includes(evTitle);
        if (!titleMatches) return false;
        // Same title — only skip if it's also at the same time (allow multiple sessions per day)
        const evHour = (ev.start?.dateTime || '').slice(11, 16);
        return evHour === blockHour;
      });

      if (hasDuplicate) {
        console.log(`[calendar] Skipping duplicate: "${block.title}" on ${blockDay}`);
        continue;
      }

      // Skip if overlaps with a real (non-placeholder) event
      const hasRealConflict = existingEvents.some(ev => {
        const evStart = ev.start?.dateTime ? new Date(ev.start.dateTime).getTime() : null;
        const evEnd = ev.end?.dateTime ? new Date(ev.end.dateTime).getTime() : null;
        if (!evStart || !evEnd) return false;
        const overlaps = blockStart < evEnd && blockEnd > evStart;
        if (!overlaps) return false;
        const title = ev.summary || '';
        const isPlaceholder =
          ev.status === 'tentative' ||
          title.endsWith('?') ||
          /\b(maybe|tentative|possible|tbd|placeholder|block|hold|reminder|personal)\b/i.test(title);
        return !isPlaceholder;
      });

      if (hasRealConflict) continue;

      try {
        const eventTimezone = block.timezone || timezone;
        const event = await createCalendarEvent(userId, `⚡ ${block.title}`, block.start, block.end, eventTimezone);
        created.push({ title: block.title, start: block.start, end: block.end, eventId: event.id, timezone: eventTimezone });
      } catch (err) {
        console.error('Failed to create event:', block.title, err);
      }
    }
    return created;
  } catch {
    return [];
  }
}

// ─── Briefing reminder helpers ────────────────────────────────────────────────

export const BRIEFING_REMINDER_TITLE = 'Edg3 Morning Briefing';

/**
 * Build the Google Calendar event requestBody for the recurring "Edg3 Morning Briefing"
 * reminder. Pure — no I/O. Pass `now` to override the current instant (useful in tests).
 */
export function buildBriefingReminderBody(
  callTime: string,
  timezone: string,
  now: Date = new Date(),
): {
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end:   { dateTime: string; timeZone: string };
  colorId: string;
  recurrence: string[];
  reminders: { useDefault: boolean; overrides: { method: string; minutes: number }[] };
} {
  const [hours, minutes] = callTime.split(':').map(Number);
  // Compute "right now" as local wall-clock values in the target timezone.
  const localNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const startLocal = new Date(localNow);
  startLocal.setHours(hours, minutes, 0, 0);
  if (startLocal <= localNow) startLocal.setDate(startLocal.getDate() + 1);
  const endLocal = new Date(startLocal);
  endLocal.setMinutes(endLocal.getMinutes() + 15);
  const pad = (n: number) => String(n).padStart(2, '0');
  const toLocalISO = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  return {
    summary: BRIEFING_REMINDER_TITLE,
    description:
      'Your daily AI Chief of Staff call. Edge calls you at this time every morning and adds a summary of each call here afterward.',
    start: { dateTime: toLocalISO(startLocal), timeZone: timezone },
    end:   { dateTime: toLocalISO(endLocal),   timeZone: timezone },
    colorId: '9',
    recurrence: ['RRULE:FREQ=DAILY'],
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 2 }] },
  };
}

async function getBriefingCal(userId: number): Promise<calendar_v3.Calendar | null> {
  const tokenRow = calendarQueries.get(userId);
  if (!tokenRow) return null;
  const o = getOAuthClient();
  o.setCredentials({
    access_token:  tokenRow.access_token,
    refresh_token: tokenRow.refresh_token || undefined,
    expiry_date:   tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined,
  });
  return google.calendar({ version: 'v3', auth: o });
}

/** Find recurring "Edg3 Morning Briefing" master event IDs on the user's primary calendar. */
export async function findBriefingReminderMasters(cal: calendar_v3.Calendar): Promise<string[]> {
  const res = await cal.events.list({
    calendarId: 'primary', q: BRIEFING_REMINDER_TITLE, singleEvents: false, maxResults: 50,
  }).catch(() => ({ data: { items: [] as calendar_v3.Schema$Event[] } }));
  return (res.data.items ?? [])
    .filter(e => e.summary === BRIEFING_REMINDER_TITLE && (e.recurrence?.length || e.recurringEventId))
    .map(e => e.id!)
    .filter(Boolean);
}

/**
 * Re-sync the "Edg3 Morning Briefing" recurring reminder to the user's current call_time.
 * ONLY-IF-EXISTS: if the user never set up the reminder this is a no-op — we never force-create.
 * Called fire-and-forget from the call-time route after updateCallTime.
 */
export async function resyncBriefingReminder(userId: number): Promise<void> {
  const cal = await getBriefingCal(userId);
  if (!cal) return;
  const existingIds = await findBriefingReminderMasters(cal);
  if (!existingIds.length) return;
  const user = userQueries.findById(userId);
  if (!user) return;
  await Promise.all(existingIds.map(id =>
    cal.events.delete({ calendarId: 'primary', eventId: id }).catch(() => undefined),
  ));
  await cal.events.insert({
    calendarId: 'primary',
    requestBody: buildBriefingReminderBody(user.call_time || '07:00', user.timezone || 'America/Vancouver'),
  });
}

// ─── Free-time slots ──────────────────────────────────────────────────────────

export function getFreeTimeSlots(events: calendar_v3.Schema$Event[], timezone: string, daysAhead: number = 7): string {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));
  const workdayStart = 8; // 8am
  const workdayEnd = 20;  // 8pm
  const minSlotMinutes = 30;

  const slots: string[] = [];

  for (let d = 0; d < daysAhead; d++) {
    const day = new Date(now);
    day.setDate(day.getDate() + d);
    const dayStr = day.toLocaleDateString('en-CA');

    // Get all events on this day sorted by start time
    const dayEvents = events
      .filter(e => {
        const start = e.start?.dateTime || e.start?.date || '';
        return start.startsWith(dayStr);
      })
      .map(e => ({
        start: e.start?.dateTime ? new Date(e.start.dateTime) : null,
        end: e.end?.dateTime ? new Date(e.end.dateTime) : null,
        title: e.summary || '',
      }))
      .filter(e => e.start && e.end)
      .sort((a, b) => a.start!.getTime() - b.start!.getTime());

    // Workday boundaries → UTC via the canonical helper.
    const dayStart = wallTimeToUtc(`${dayStr}T${String(workdayStart).padStart(2, '0')}:00:00`, timezone);
    const dayEnd = wallTimeToUtc(`${dayStr}T${String(workdayEnd).padStart(2, '0')}:00:00`, timezone);
    // For today, never offer slots that have already passed — start from the current moment.
    let cursor = d === 0 ? Math.max(dayStart.getTime(), Date.now()) : dayStart.getTime();

    for (const ev of dayEvents) {
      const evStart = ev.start!.getTime();
      if (evStart > cursor) {
        const gapMins = (evStart - cursor) / 60000;
        if (gapMins >= minSlotMinutes) {
          const from = new Date(cursor).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone });
          const to = new Date(evStart).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone });
          const dayLabel = day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone });
          slots.push(`${dayLabel}: ${from}–${to} (${Math.round(gapMins / 30) * 30}min free)`);
        }
      }
      cursor = Math.max(cursor, ev.end!.getTime());
    }

    // Gap after last event
    if (cursor < dayEnd.getTime()) {
      const gapMins = (dayEnd.getTime() - cursor) / 60000;
      if (gapMins >= minSlotMinutes) {
        const from = new Date(cursor).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone });
        const to = new Date(dayEnd).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone });
        const dayLabel = day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone });
        slots.push(`${dayLabel}: ${from}–${to} (${Math.round(gapMins / 30) * 30}min free)`);
      }
    }
  }

  return slots.length ? slots.join('\n') : 'No significant free slots found.';
}

export function formatEventsForBriefing(events: calendar_v3.Schema$Event[], timezone?: string): string {
  if (!events.length) return 'No calendar events found for today.';

  const now = new Date();
  return events.map(event => {
    const startDate = event.start?.dateTime ? new Date(event.start.dateTime) : null;
    const startStr = startDate
      ? startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone || 'America/Vancouver' })
      : event.start?.date
        ? new Date(event.start.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) + ' (all day)'
        : 'All day';
    const isPast = startDate && startDate < now;
    const title = event.summary || 'Untitled event';

    // Detect tentative/placeholder events
    const isTentative =
      event.status === 'tentative' ||
      title.endsWith('?') ||
      /\b(maybe|tentative|possible|tbd|placeholder|block|hold|reminder|personal)\b/i.test(title);

    const flags = [
      isPast ? '[ALREADY HAPPENED]' : '',
      isTentative ? '[TENTATIVE/PLACEHOLDER — not a firm commitment]' : '',
    ].filter(Boolean).join(' ');

    return `- ${startStr}: ${title}${flags ? ' ' + flags : ''}`;
  }).join('\n');
}

// Find open slots of at least `minMinutes` between startDate and endDate (inclusive), within
// an 8am–8pm window in the user's timezone. Never suggests times that have already passed today.
// `events` should already be the user's events across that range.
export function findFreeSlots(
  events: calendar_v3.Schema$Event[],
  timezone: string,
  startDate: string,
  endDate: string,
  minMinutes = 30,
): string {
  const workdayStart = 8;
  const workdayEnd = 20;
  const now = Date.now();
  const slots: string[] = [];

  const dStart = new Date(`${startDate}T00:00:00Z`);
  const dEnd = new Date(`${endDate}T00:00:00Z`);
  if (isNaN(dStart.getTime()) || isNaN(dEnd.getTime())) return 'I need a valid start and end date to check availability.';

  for (const day = new Date(dStart); day <= dEnd; day.setUTCDate(day.getUTCDate() + 1)) {
    const dayStr = day.toISOString().slice(0, 10);

    const dayEvents = events
      .filter(e => e.start?.dateTime && e.end?.dateTime &&
        new Date(e.start.dateTime).toLocaleDateString('en-CA', { timeZone: timezone }) === dayStr)
      .map(e => ({ start: new Date(e.start!.dateTime!).getTime(), end: new Date(e.end!.dateTime!).getTime() }))
      .filter(e => !isNaN(e.start) && !isNaN(e.end))
      // Ignore day-spanning timed events (e.g. a 00:00–23:59 "all-day" block) — they're context,
      // not real busy time, and would otherwise make a whole day look fully booked.
      .filter(e => e.end - e.start < 23 * 3600000)
      .sort((a, b) => a.start - b.start);

    const dayEndUtc = wallTimeToUtc(`${dayStr}T${String(workdayEnd).padStart(2, '0')}:00:00`, timezone).getTime();
    // Start at 8am local, but never before "now" (so today's past hours aren't offered).
    let cursor = Math.max(wallTimeToUtc(`${dayStr}T${String(workdayStart).padStart(2, '0')}:00:00`, timezone).getTime(), now);

    const label = new Date(`${dayStr}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    const pushGap = (from: number, to: number) => {
      const mins = (to - from) / 60000;
      if (mins >= minMinutes) {
        const f = new Date(from).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone });
        const t = new Date(to).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone });
        slots.push(`${label}: ${f}–${t} (${Math.floor(mins / 30) * 30} min free)`);
      }
    };

    for (const ev of dayEvents) {
      if (ev.start > cursor) pushGap(cursor, ev.start);
      cursor = Math.max(cursor, ev.end);
    }
    if (cursor < dayEndUtc) pushGap(cursor, dayEndUtc);
  }

  if (!slots.length) return `No open blocks of at least ${minMinutes} minutes between ${startDate} and ${endDate} (within 8am–8pm).`;
  const shown = slots.slice(0, 14);
  const more = slots.length > shown.length ? `\n…and ${slots.length - shown.length} more.` : '';
  return `Open time (at least ${minMinutes} minutes, 8am–8pm):\n${shown.join('\n')}${more}`;
}
