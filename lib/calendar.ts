import { google } from 'googleapis';
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

export function getAuthUrl(): string {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
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

export async function extractAndCreateTimeBlocks(userId: number, briefingContent: string, timezone: string) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Always book into tomorrow — morning briefing is always about the day ahead
  const targetDate = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));
  targetDate.setDate(targetDate.getDate() + 1);

  const today = targetDate.toLocaleDateString('en-CA'); // YYYY-MM-DD (tomorrow)

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Extract all specific time block recommendations from this briefing.
The target date for these blocks is ${today} (tomorrow). All times are in the ${timezone} timezone.

Return ONLY a JSON array of time blocks, nothing else. Format:
[{"title": "event name", "start": "2026-06-03T09:00:00", "end": "2026-06-03T10:30:00"}]

The datetime strings should be local time (no Z suffix, no UTC offset) — the timezone will be set separately.
If no specific times are mentioned, return an empty array [].

Briefing:
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
    let existingEvents: any[] = [];
    if (tokenRow) {
      const oauth2Client = getOAuthClient();
      oauth2Client.setCredentials({
        access_token: tokenRow.access_token,
        refresh_token: tokenRow.refresh_token || undefined,
        expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined,
      });
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      const dayStart = new Date(`${today}T00:00:00`);
      const dayEnd = new Date(`${today}T23:59:59`);
      const existing = await calendar.events.list({
        calendarId: 'primary',
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
        singleEvents: true,
        maxResults: 50,
      });
      existingEvents = existing.data.items || [];
    }

    const created = [];
    for (const block of blocks) {
      const blockStart = new Date(block.start).getTime();
      const blockEnd = new Date(block.end).getTime();

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
        return !isPlaceholder; // only block if it's a real event
      });

      if (hasRealConflict) {
        console.log('Skipping time block due to real event conflict:', block.title, block.start);
        continue;
      }

      try {
        const event = await createCalendarEvent(userId, `⚡ ${block.title}`, block.start, block.end, timezone);
        created.push(event);
      } catch (err) {
        console.error('Failed to create event:', block.title, err);
      }
    }
    return created;
  } catch {
    return [];
  }
}

export function formatEventsForBriefing(events: any[]): string {
  if (!events.length) return 'No calendar events found for today.';

  const now = new Date();
  return events.map(event => {
    const startDate = event.start?.dateTime ? new Date(event.start.dateTime) : null;
    const startStr = startDate
      ? startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
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
