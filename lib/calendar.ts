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
  weekAhead.setDate(weekAhead.getDate() + 7);

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

  // Ask Claude to extract edit/delete/move instructions from transcript
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `Read this call transcript and extract any requests to DELETE, MOVE, or RESCHEDULE existing calendar events.

EXISTING CALENDAR EVENTS (next 7 days):
${JSON.stringify(eventList, null, 2)}

TRANSCRIPT:
${transcript}

Return a JSON array of actions. Each action has:
- "action": "delete" | "move"
- "eventId": the id from the event list above (match by title/time)
- "reason": brief description of why (e.g. "duplicate breakfast")
- For "move" only: "newStart" and "newEnd" as ISO datetime strings in ${timezone} local time (no Z suffix)

Only include actions explicitly requested by the user. If nothing was requested, return [].

Example: [{"action":"delete","eventId":"abc123","reason":"duplicate breakfast event"}]`,
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
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Extract specific time block recommendations to add to the calendar.

Today's date: ${todayDate}
Tomorrow's date: ${tomorrow}
Timezone: ${timezone}

Rules:
- If the user or AI mentions something for "today", "this afternoon", "this morning", "tonight" → use date ${todayDate}
- If the user or AI mentions something for "tomorrow" or the AI is recommending blocks as part of a daily briefing → use date ${tomorrow}
- Do NOT extract events already on the calendar (existing appointments, recurring meals, sleep)
- Do NOT recreate one-time events that already happened today (court hearings, medical appointments etc.)
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

    const created = [];
    for (const block of blocks) {
      const blockStart = new Date(block.start).getTime();
      const blockEnd = new Date(block.end).getTime();

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
