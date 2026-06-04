import Anthropic from '@anthropic-ai/sdk';
import { format, startOfWeek } from 'date-fns';
import { userQueries, priorityQueries, memoryQueries, briefingQueries, taskQueries, User } from './db';
import { getCalendarEvents, getWeekEvents, formatEventsForBriefing } from './calendar';

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

export async function generateDailyBriefing(userId: number): Promise<string> {
  const user = userQueries.findById(userId);
  if (!user) throw new Error('User not found');

  const today = format(new Date(), 'yyyy-MM-dd');
  const userTimezone = user.timezone || 'America/Los_Angeles';
  const localTime = new Date().toLocaleTimeString('en-US', { timeZone: userTimezone, hour: 'numeric', minute: '2-digit', hour12: true });
  const localHour = parseInt(new Date().toLocaleString('en-US', { timeZone: userTimezone, hour: 'numeric', hour12: false }));
  const greeting = localHour >= 18 ? 'Good evening' : localHour >= 12 ? 'Good afternoon' : 'Good morning';
  const weekOf = format(startOfWeek(new Date()), 'yyyy-MM-dd');

  // Gather context
  const priorities = priorityQueries.getThisWeek(userId, weekOf);
  const recentMemories = memoryQueries.getRecent(userId, 15);
  const recentBriefings = briefingQueries.getRecent(userId, 5);
  const [calendarEvents, weekEvents, weatherSummary] = await Promise.all([
    getCalendarEvents(userId).catch(() => []),
    getWeekEvents(userId).catch(() => []),
    getWeatherSummary(userTimezone),
  ]);
  const incompleteTasks = taskQueries.getIncomplete(userId);
  // Only kudos for tasks completed since the last briefing
  const lastBriefing = recentBriefings[0];
  const lastBriefingTime = lastBriefing ? new Date(lastBriefing.created_at) : null;
  const recentlyCompletedTasks = taskQueries.getRecent(userId, 3).filter(t => {
    if (!t.completed || !t.completed_at) return false;
    if (!lastBriefingTime) return true;
    return new Date(t.completed_at) > lastBriefingTime;
  });

  const calendarText = formatEventsForBriefing(calendarEvents, userTimezone);
  const weekCalendarText = weekEvents.length
    ? weekEvents.map(e => {
        const start = e.start?.dateTime
          ? new Date(e.start.dateTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: userTimezone })
          : e.start?.date || 'All day';
        return `- ${start}: ${e.summary || 'Untitled'}`;
      }).join('\n')
    : 'No upcoming events this week.';

  const prioritiesText = priorities.length
    ? priorities.map((p, i) => `${i + 1}. ${p.text}`).join('\n')
    : 'No priorities set for this week.';

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
Be direct and honest, but never harsh or preachy. You are supportive first. If there is misalignment or an excuse, acknowledge it with empathy and move on — do not dwell on it or lecture. Frame everything as "here's what's possible today" not "here's what you've been doing wrong". Always leave them feeling capable and energized, not guilty or defensive.
Aim for a natural 3-5 minute spoken briefing. Be thorough but punchy — cover what matters, skip what doesn't. Always end with a complete sentence and flow naturally into the closing question.
Speak in first person to the user. Be warm but authoritative.
IMPORTANT: Always write numbers as words so they sound natural when spoken aloud. Write "two hundred fifty thousand" not "250,000". Write "nine AM" not "9:00 AM". Write "thirty percent" not "30%". Write "one hundred thirty-five" not "135". Never write bare digits — always spell them out fully as you would say them aloud.
IMPORTANT: The user's name is ${user.name.split(' ')[0]} — always address them by this name and no other.
IMPORTANT: The product is spelled "Edg3" but should be pronounced "Edge" — always write it as "Edge" in the text so it is spoken correctly.`;

  const userPrompt = `Generate today's (${format(new Date(), 'EEEE, MMMM d, yyyy')}) morning briefing for ${user.name}.

USER PROFILE:
${user.profile_summary || 'No profile summary available.'}

THIS WEEK'S TOP PRIORITIES:
${prioritiesText}

TODAY'S WEATHER:
${weatherSummary || 'Not available.'}

TODAY'S CALENDAR:
${calendarText}

UPCOMING THIS WEEK:
${weekCalendarText}

MEMORY & PRIOR CONVERSATIONS:
${memoriesText}

INCOMPLETE TASKS FROM PREVIOUS DAYS:
${incompleteTasks.length ? incompleteTasks.map(t => `- [${t.date}] ${t.text}`).join('\n') : 'None.'}

RECENTLY COMPLETED TASKS:
${recentlyCompletedTasks.length ? recentlyCompletedTasks.map(t => `- [${t.date}] ${t.text}`).join('\n') : 'None.'}

WHAT THEY SAID ON RECENT CALLS:
${previousBriefingsText}

Generate a briefing with these sections:
1. GREETING & CARRY-FORWARD — Start with "${greeting}, [name]." then immediately follow up on what they said on the last call. If they mentioned something specific they were going to do, ask how it went — make it feel like you remembered and you care. If recently completed tasks exist, give genuine specific kudos. If there are [USER NOTE] or [PRIORITY CHANGE] entries in memory, acknowledge them directly. Keep this warm and real.
2. TODAY'S SNAPSHOT — Key events from their calendar (2-3 sentences). ${weatherSummary ? `Weave in the weather naturally if it's relevant to their day — "${weatherSummary}". Only mention it if it actually affects something (outdoor plans, commute, mood).` : ''}
3. ALIGNMENT CHECK — Compare their stated priorities with their calendar. One sentence max, empathetic, then move on.
4. LEVERAGE ACTIONS — The 3 highest-leverage things they should do today. Be specific. Address every weekly priority. Reference incomplete tasks by name. If a completed task ties to a priority, acknowledge it and ask if they want to swap in a new one.
5. PATTERN RECOGNITION — One sharp insight from their history that they need to hear. Make it feel like only someone who's been paying close attention would notice this.
6. CALENDAR BLOCKS — Recommend 2-3 specific time blocks with exact start and end times. Always include specific times.
7. CLOSING QUESTION — Do NOT always ask the same question. Choose the most relevant one based on today's context:
   - If they mentioned something big yesterday: "How did [specific thing] go — I want to factor that into tomorrow."
   - If there's a pattern worth breaking: "What's one thing that keeps getting in the way — I want to help you remove it."
   - If they have a big upcoming event: "What do you need to feel ready for [event]?"
   - Default if nothing specific stands out: "What's the most important thing I should know before tomorrow's briefing?"
   Pick ONE and make it feel natural and specific, not generic.

Write this as a spoken briefing — natural language, no markdown headers, flowing paragraphs.`;

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1200,
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
