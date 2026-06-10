import Anthropic from '@anthropic-ai/sdk';
import { format, startOfWeek } from 'date-fns';
import { userQueries, priorityQueries, memoryQueries, briefingQueries, taskQueries, effectiveTimezone, User } from './db';
import { getCalendarEvents, getWeekEvents, formatEventsForBriefing, getFreeTimeSlots } from './calendar';
import { checkOutreachReplies } from './replies';

async function getWeatherSummary(timezone: string): Promise<string> {
  try {
    // Extract city from timezone e.g. "America/Vancouver" → "Vancouver"
    const city = timezone.split('/').pop()?.replace(/_/g, '+') || 'Vancouver';
    const res = await fetch(`https://wttr.in/${city}?format=j1`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return '';
    const data = await res.json();
    const current = data.current_condition?.[0];
    if (!current) return '';
    const desc = current.weatherDesc?.[0]?.value || '';
    const tempC = current.temp_C;
    const feelsC = current.FeelsLikeC;
    return `${desc}, ${tempC}°C (feels like ${feelsC}°C) in ${city.replace(/\+/g, ' ')}`;
  } catch {
    return '';
  }
}

function extractCommitments(briefings: { user_response: string | null; scheduled_for: string }[]): string {
  const withResponses = briefings.filter(b => b.user_response).slice(0, 3);
  if (!withResponses.length) return '';
  return withResponses
    .map(b => `[${format(new Date(b.scheduled_for), 'MMM d')}] They said: "${b.user_response}"`)
    .join('\n');
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function sanitizeCalendarReferences(
  briefingText: string,
  todayEvents: any[],
  weekEvents: any[],
  timezone: string
): Promise<string> {
  // Build a set of real event titles (normalised)
  const allEvents = [...todayEvents, ...weekEvents];
  const realTitles = new Set(
    allEvents.map(e => (e.summary || '').replace(/^⚡\s*/, '').toLowerCase().trim())
  );

  // Ask Claude to remove any specific calendar event references that don't exist
  const anthropic_check = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const checkResult = await anthropic_check.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `Review this briefing and remove any references to specific calendar events that are NOT in the provided event list. Replace with something neutral or just remove the sentence entirely.

ACTUAL CALENDAR EVENTS (these are the only real ones):
${realTitles.size > 0 ? Array.from(realTitles).map(t => `- ${t}`).join('\n') : 'No events today.'}

BRIEFING TO REVIEW:
${briefingText}

Rules:
- If the briefing mentions a specific event (e.g. "grocery prep", "meal prep", "morning walk", "drive to X") that is NOT in the event list above → remove that reference
- Keep all other content intact
- Do not change tone, structure, or any non-calendar content
- Return ONLY the corrected briefing text, nothing else`,
    }],
  });

  const checked = checkResult.content[0];
  if (checked.type !== 'text') return briefingText;

  const sanitized = checked.text.trim();
  if (sanitized.length < briefingText.length * 0.5) {
    // If too much was removed, something went wrong — return original
    console.log('[briefing] Sanitization removed too much, using original');
    return briefingText;
  }

  console.log('[briefing] Calendar references sanitized');
  return sanitized;
}

export async function generateDailyBriefing(userId: number): Promise<string> {
  const user = userQueries.findById(userId);
  if (!user) throw new Error('User not found');

  const userTimezone = effectiveTimezone(user);
  const now = new Date();
  // Compute "today" in the USER's timezone, not the server's (Railway runs UTC). Otherwise a
  // late-evening call rolls the date forward and tomorrow's events get briefed as today's.
  const today = now.toLocaleDateString('en-CA', { timeZone: userTimezone });
  const todayLabel = now.toLocaleDateString('en-US', { timeZone: userTimezone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const localTime = now.toLocaleTimeString('en-US', { timeZone: userTimezone, hour: 'numeric', minute: '2-digit', hour12: true });
  const localHour = parseInt(now.toLocaleString('en-US', { timeZone: userTimezone, hour: 'numeric', hour12: false }));
  const greeting = localHour >= 18 ? 'Good evening' : localHour >= 12 ? 'Good afternoon' : 'Good morning';
  const weekOf = format(startOfWeek(new Date()), 'yyyy-MM-dd');

  // Gather context
  const priorities = priorityQueries.getThisWeek(userId, weekOf);
  const recentMemories = memoryQueries.getWeighted(userId, 20);
  const recentBriefings = briefingQueries.getRecent(userId, 5);
  const [calendarEvents, weekEvents] = await Promise.all([
    getCalendarEvents(userId).catch(() => []),
    getWeekEvents(userId).catch(() => []),
  ]);
  const incompleteTasks = taskQueries.getIncomplete(userId);
  // Email-reply tracking: new replies to the outreach Edge drafted (only its own threads).
  // Degrades to [] if Gmail read access isn't granted yet or anything errors.
  const outreachReplies = await checkOutreachReplies(userId).catch(() => []);
  // Only kudos for tasks completed since the last briefing
  const lastBriefing = recentBriefings[0];
  const lastBriefingTime = lastBriefing ? new Date(lastBriefing.created_at) : null;
  const recentlyCompletedTasks = taskQueries.getRecent(userId, 3).filter(t => {
    if (!t.completed || !t.completed_at) return false;
    if (!lastBriefingTime) return true;
    return new Date(t.completed_at) > lastBriefingTime;
  });

  const calendarText = formatEventsForBriefing(calendarEvents, userTimezone);
  const freeTimeText = getFreeTimeSlots([...calendarEvents, ...weekEvents], userTimezone, 7);
  const weekCalendarText = weekEvents.length
    ? weekEvents.map(e => {
        let start: string;
        if (e.start?.dateTime) {
          start = new Date(e.start.dateTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: userTimezone });
        } else if (e.start?.date) {
          // All-day event — format the date clearly with day of week
          start = new Date(e.start.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) + ' (all day)';
        } else {
          start = 'All day';
        }
        return `- ${start}: ${e.summary || 'Untitled'}`;
      }).join('\n')
    : 'No upcoming events this week.';

  const prioritiesText = priorities.length
    ? priorities.map((p, i) => `${i + 1}. ${p.text}`).join('\n')
    : 'No priorities set for this week.';

  const repliesText = outreachReplies.length
    ? outreachReplies.map(r => `- ${r.recipient}${r.eventTitle ? ` (re: ${r.eventTitle})` : ''}: ${r.summary} → Suggested next step: ${r.suggestedAction}`).join('\n')
    : 'No new replies to your outreach.';

  const memoriesText = recentMemories.length
    ? recentMemories.map(m => `[${m.type} - ${format(new Date(m.created_at), 'MMM d')}]: ${m.content}`).join('\n')
    : 'No prior conversation memory.';

  const previousBriefingsText = recentBriefings
    .filter(b => b.user_response)
    .slice(0, 3)
    .map(b => `[${format(new Date(b.scheduled_for), 'MMM d')}] User said: "${b.user_response}"`)
    .join('\n') || 'No prior call responses.';

  const commitmentsText = extractCommitments(recentBriefings);
  const lastCallResponse = recentBriefings.find(b => b.user_response);

  const isFirstCall = recentMemories.length === 0;

  const systemPrompt = `You are EDG3, an AI Chief of Staff. You are proactive, direct, and deeply strategic.
The user's local time is currently ${localTime} in ${userTimezone}. All time references must use their local timezone.
IMPORTANT: Always open with "${greeting}, [name]." — never say "Good morning" if it is afternoon or evening.
${isFirstCall ? 'IMPORTANT: This is the first briefing. Lead with and address every stated weekly priority directly — do not substitute your own judgment for what matters most.' : ''}
You speak like Jarvis from Iron Man — confident, sharp, and always one step ahead. You are a trusted advisor, not a critic.
You know this person better than they know themselves. You believe in them deeply.
Your job is not to be a productivity app. Your job is to help them decide what deserves their attention today.
TONE: Be warm, direct, and encouraging — never harsh, never preachy, never critical of the person's character or patterns in a negative way. Do NOT say things like "you tend to..." or "you have a pattern of..." or "you often..." in a critical tone. If there is misalignment, acknowledge it briefly with empathy ("I notice your calendar is light on X — worth a thought") and move on immediately. One sentence max. Never dwell, never lecture. Always frame as possibility, never as failure. Leave them feeling capable and energized.
Aim for exactly 2 minutes spoken — about 300 words total. One punchy sentence per section. Cut anything not directly actionable. Always end with: "What's the most important thing I should know before tomorrow's briefing?"
Speak in first person to the user. Be warm but authoritative.
IMPORTANT: Write times naturally as they would be spoken. "1:30 PM" → "one thirty PM". "9:00 AM" → "nine AM". "10:53 AM" → "ten fifty-three AM". Never round times — say the exact time. Never spell out time digits individually. For money: "two hundred fifty thousand dollars". For percentages: "thirty percent". For weights: "lbs" → "pounds", "kg" → "kilograms". For other numbers: spell out fully. Never write bare digits or abbreviations that won't be spoken correctly.
IMPORTANT: Always write full day names — never abbreviate. "Mon" → "Monday", "Tue" → "Tuesday", "Wed" → "Wednesday", "Thu" → "Thursday", "Fri" → "Friday", "Sat" → "Saturday", "Sun" → "Sunday".
IMPORTANT: Use memory context to make the briefing relevant and personal, but do NOT open with references to previous calls or what was said last time. Get straight to today.
IMPORTANT — MEMORY: You have full memory of every previous conversation with this person. It is provided to you in the briefing data. Never say you "don't have memory", "start fresh", or "can't remember" previous calls. If asked, say "I have everything from our previous calls — it's all here." You remember everything they've told you.
IMPORTANT — CALENDAR CAPABILITIES: You can read, create, edit, move, and delete calendar events. When the user asks you to make calendar changes during the call, confirm you'll handle it and it will be done after the call. Never say you "can't edit" or "don't have access" to their calendar. You have full calendar access.
IMPORTANT: The user's name is ${user.name.split(' ')[0]} — always address them by this name and no other.
IMPORTANT: The product is spelled "Edg3" but should be pronounced "Edge" — always write it as "Edge" in the text so it is spoken correctly.`;

  const userPrompt = `Generate today's (${todayLabel}) morning briefing for ${user.name}.

USER PROFILE:
${user.profile_summary || 'No profile summary available.'}

THIS WEEK'S TOP PRIORITIES:
${prioritiesText}

TODAY'S CALENDAR:
${calendarText}

UPCOMING THIS WEEK:
${weekCalendarText}

FREE TIME SLOTS (next 7 days, 8am–8pm):
${freeTimeText}

REPLIES TO YOUR OUTREACH (Edge drafted these emails for the user and they were sent; these are the contacts' replies. If any are present, RAISE them in the briefing and OFFER to take the suggested next step — e.g. "Wilmec replied, they can come Thursday at two PM — want me to book it?". If "No new replies", do not mention this section at all.):
${repliesText}

MEMORY & PRIOR CONVERSATIONS:
${memoriesText}

INCOMPLETE TASKS FROM PREVIOUS DAYS:
${incompleteTasks.length ? incompleteTasks.map(t => `- [${t.date}] ${t.text}`).join('\n') : 'None.'}

RECENTLY COMPLETED TASKS:
${recentlyCompletedTasks.length ? recentlyCompletedTasks.map(t => `- [${t.date}] ${t.text}`).join('\n') : 'None.'}

Generate a briefing with these sections:
CRITICAL RULE — CALENDAR VERIFICATION: The ONLY source of truth for what is on the calendar is TODAY'S CALENDAR and UPCOMING THIS WEEK sections above. This includes flights, drives, appointments, meetings — everything. If a flight, drive, or any travel event does NOT appear in the calendar data above, do NOT mention it. Memory, conversation history, and past call transcripts are NOT reliable sources for current calendar events — they may be outdated. Before mentioning ANY event (grocery run, gym, flight, meeting, meal prep, drive, etc.) you MUST confirm it appears in the calendar data above. If it does not appear there, do NOT mention it. Do not say things like "I see you have a grocery run Friday" or "you have your drive to Blue Mountain" unless those exact events appear in the calendar sections above. Treat memory references to calendar events as historical only — not current facts.

1. GREETING — Start with "${greeting}, [name]." then immediately make a sharp, specific observation about something happening RIGHT NOW or that happened TODAY based on the calendar. Examples: if there's a current event ("I see you're in early dinner"), if something significant just finished ("You just wrapped up your foreclosure hearing this morning"), if there's something notable coming up later today. Make it feel like you're actually watching their day in real time — one punchy sentence that earns their attention. If there are [USER NOTE] or [PRIORITY CHANGE] entries in memory, acknowledge them after.
2. TODAY'S SNAPSHOT — Key events from their calendar (2-3 sentences). Only reference events that appear in the calendar data above.
3. ALIGNMENT CHECK — Compare their stated priorities with their calendar. One sentence max, empathetic, then move on.
4. ACTION ITEMS — The 3 highest-leverage things they should do today. Call them "action items". Be specific. Address every weekly priority. Reference incomplete tasks by name.
5. CALENDAR BLOCKS — Recommend 2-3 specific time blocks using the FREE TIME SLOTS above. Only suggest times that appear as free. Always include exact start and end times.
6. CLOSING QUESTION — Do NOT always ask the same question. Choose the most relevant one based on today's context:
   - If they have a big upcoming event: "What do you need to feel ready for [event]?"
   - Default: "What's the most important thing I should know before tomorrow's briefing?"
   Pick ONE and make it feel natural and specific.

Write this as a spoken briefing — natural language, no markdown headers, flowing paragraphs.`;

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 450,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type');

  // Post-process: verify calendar references against actual calendar data
  const briefingText = content.text;
  return sanitizeCalendarReferences(briefingText, calendarEvents, weekEvents, userTimezone);
}

export async function generatePreviewBriefing(userId: number): Promise<string> {
  const user = userQueries.findById(userId);
  if (!user) throw new Error('User not found');
  if (!user.onboarding_complete) throw new Error('Onboarding not complete');

  const userTimezone = effectiveTimezone(user);
  const weekOf = format(startOfWeek(new Date()), 'yyyy-MM-dd');
  const firstName = user.name.split(' ')[0];

  const priorities = priorityQueries.getMostRecent(userId);
  const prioritiesText = priorities.length
    ? priorities.map((p, i) => `${i + 1}. ${p.text}`).join('\n')
    : 'No priorities set yet.';

  // Calendar is optional — degrade gracefully if not connected or fetch fails.
  let calendarText = '';
  try {
    const events = await getWeekEvents(userId);
    if (events.length) {
      calendarText = events.slice(0, 8).map(e => {
        let start: string;
        if (e.start?.dateTime) {
          start = new Date(e.start.dateTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: userTimezone });
        } else if (e.start?.date) {
          start = new Date(e.start.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) + ' (all day)';
        } else {
          start = 'All day';
        }
        return `- ${start}: ${e.summary || 'Untitled'}`;
      }).join('\n');
    }
  } catch {
    // No calendar connected or fetch failed — priorities-only mode.
  }

  const systemPrompt = `You are Edge, an AI Chief of Staff. You are warm, confident, and direct.
Write this as natural spoken text — no markdown headers, no bullet-point sections, flowing paragraphs.
Keep it to 150–200 words. This is a "Day-1 preview" moment — the user just finished onboarding and is seeing Edge for the first time. Make it feel like Edge already knows them and is ready to help them win their week.`;

  const userPrompt = `Generate a Day-1 preview briefing for ${firstName}.

THEIR TOP PRIORITIES:
${prioritiesText}

THEIR UPCOMING CALENDAR THIS WEEK:
${calendarText || 'Calendar not connected yet — no events available.'}

Write a short, personal, energizing preview (150–200 words) that:
1. Opens by addressing ${firstName} by name and acknowledging they've just set up Edge
2. Directly references their stated priorities — show you already know what matters to them
3. If calendar is available: briefly mention 1–2 upcoming events that relate to their priorities
4. If no calendar: acknowledge it's not connected yet and offer a teaser of what Edge will do once it is
5. Closes with warmth and a forward-looking line — e.g. "Your first briefing call is scheduled for [call_time]. I'll have everything ready." (use their call time: ${user.call_time} ${userTimezone})

Do NOT use headers. Do NOT format as bullet points. Write like you're speaking — flowing, personal, confident.`;

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type');
  return content.text;
}

export async function analyzeUserResponse(userId: number, response: string): Promise<void> {
  const user = userQueries.findById(userId);
  const name = user?.name || 'the user';

  const [insight, tasksResult] = await Promise.all([
    anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Extract the key insight or information from this response. Refer to the person by name as "${name}", never as "the user" or "they".
Be concise (1-2 sentences). Focus on what matters most.
${name} said: "${response}"
Key insight:`
      }]
    }),
    anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Extract any action items or tasks ${name} is requesting from their AI Chief of Staff.
Return ONLY a JSON array of short task strings (max 8 words each). Only include explicit requests, not general conversation.
If no tasks requested, return [].
${name} said: "${response}"
Tasks:`
      }]
    }),
  ]);

  const insightContent = insight.content[0];
  if (insightContent.type === 'text') {
    memoryQueries.create(userId, 'transcript', response);
    memoryQueries.create(userId, 'insight', insightContent.text);
  }

  const tasksContent = tasksResult.content[0];
  if (tasksContent.type === 'text') {
    try {
      const match = tasksContent.text.match(/\[[\s\S]*\]/);
      if (match) {
        const tasks: string[] = JSON.parse(match[0]);
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toLocaleDateString('en-CA');
        for (const text of tasks.slice(0, 5)) {
          if (text?.trim()) taskQueries.create(userId, text.trim(), tomorrowStr, 'edg3');
        }
      }
    } catch {
      // ignore parse errors
    }
  }
}

export function getWeekOf(): string {
  return format(startOfWeek(new Date()), 'yyyy-MM-dd');
}
