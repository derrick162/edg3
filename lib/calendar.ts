import { google, calendar_v3 } from 'googleapis';
import { calendarQueries } from './db';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

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
    state: userId ? String(userId) : undefined,
  });
}

export async function exchangeCode(code: string) {
  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
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

  const now = new Date();
  // Start from beginning of day so we can show past events as context
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 20,
  });

  return response.data.items || [];
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

  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: endOfWeek.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 50,
  });

  return response.data.items || [];
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

  const existing = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: weekAhead.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 100,
  });

  const events = existing.data.items || [];
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
Timezone: ${timezone}

EXISTING CALENDAR EVENTS (next 14 days):
${JSON.stringify(eventList, null, 2)}

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

SPECIFIC DAY PATTERNS:
- "Move X to Monday" → find next Monday, keep same time
- "Reschedule to this Friday" → calculate correct date

Return a JSON array of actions. Each action has:
- "action": "delete" | "move"
- "eventId": the id from the event list above (match by title/time/day)
- "reason": brief description
- For "move": "newStart" and "newEnd" as local datetime strings (no Z suffix, format: YYYY-MM-DDTHH:MM:00)

Only include actions explicitly requested by the user. If nothing was requested, return [].

Example: [{"action":"delete","eventId":"abc123","reason":"duplicate"},{"action":"move","eventId":"def456","newStart":"2026-06-09T09:00:00","newEnd":"2026-06-09T10:00:00","reason":"pushed back 1 hour"}]`,
    }],
  });

  const content = response.content[0];
  if (content.type !== 'text') return [];

  try {
    const match = content.text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const actions: { action: string; eventId: string; reason: string; newStart?: string; newEnd?: string }[] = JSON.parse(match[0]);

    const results = [];
    for (const action of actions) {
      try {
        if (action.action === 'delete' && action.eventId) {
          const event = events.find(e => e.id === action.eventId);
          await deleteCalendarEvent(userId, action.eventId);
          results.push({ type: 'deleted', title: event?.summary || action.eventId, reason: action.reason });
          console.log(`[calendar] Deleted event: ${event?.summary} (${action.reason})`);
        } else if (action.action === 'move' && action.eventId && action.newStart && action.newEnd) {
          const event = events.find(e => e.id === action.eventId);
          await moveCalendarEvent(userId, action.eventId, action.newStart, action.newEnd, timezone);
          results.push({ type: 'moved', title: event?.summary || action.eventId, newStart: action.newStart, reason: action.reason });
          console.log(`[calendar] Moved event: ${event?.summary} to ${action.newStart}`);
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
Timezone: ${timezone}

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
- Only extract new blocks being explicitly requested or recommended

Return ONLY a JSON array of time blocks, nothing else. Format:
[{"title": "event name", "start": "YYYY-MM-DDTHH:MM:00", "end": "YYYY-MM-DDTHH:MM:00"}]

Datetime strings must be local time (no Z suffix, no UTC offset).
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
    const blocks: { title: string; start: string; end: string }[] = JSON.parse(jsonMatch[0]);

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

      // Skip if an event with the same (or very similar) title already exists on the same day
      const blockDay = block.start.slice(0, 10); // YYYY-MM-DD
      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const blockTitleNorm = normalize(block.title);
      const hasDuplicate = existingEvents.some(ev => {
        const evDay = (ev.start?.dateTime || ev.start?.date || '').slice(0, 10);
        if (evDay !== blockDay) return false;
        const evTitle = normalize(ev.summary?.replace(/^⚡\s*/, '') || '');
        // Match if titles are identical or one contains the other (handles minor wording diffs)
        return evTitle === blockTitleNorm || evTitle.includes(blockTitleNorm) || blockTitleNorm.includes(evTitle);
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
        const event = await createCalendarEvent(userId, `⚡ ${block.title}`, block.start, block.end, timezone);
        created.push({ title: block.title, start: block.start, end: block.end, eventId: event.id });
      } catch (err) {
        console.error('Failed to create event:', block.title, err);
      }
    }
    return created;
  } catch {
    return [];
  }
}

export function formatEventsForBriefing(events: calendar_v3.Schema$Event[], timezone?: string): string {
  if (!events.length) return 'No calendar events found for today.';

  const now = new Date();
  return events.map(event => {
    const startDate = event.start?.dateTime ? new Date(event.start.dateTime) : null;
    const startStr = startDate
      ? startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone || 'America/Vancouver' })
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
