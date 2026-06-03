import Anthropic from '@anthropic-ai/sdk';
import { format, startOfWeek } from 'date-fns';
import { userQueries, priorityQueries, memoryQueries, briefingQueries, taskQueries, User } from './db';
import { getCalendarEvents, getWeekEvents, formatEventsForBriefing } from './calendar';

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
  const [calendarEvents, weekEvents] = await Promise.all([
    getCalendarEvents(userId).catch(() => []),
    getWeekEvents(userId).catch(() => []),
  ]);
  const incompleteTasks = taskQueries.getIncomplete(userId);

  const calendarText = formatEventsForBriefing(calendarEvents);
  const weekCalendarText = weekEvents.length
    ? weekEvents.map(e => {
        const start = e.start?.dateTime
          ? new Date(e.start.dateTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
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

  const isFirstCall = recentMemories.length === 0;

  const systemPrompt = `You are EDG3, an AI Chief of Staff. You are proactive, direct, and deeply strategic.
The user's local time is currently ${localTime} in ${userTimezone}. All time references must use their local timezone.
IMPORTANT: Always open with "${greeting}, [name]." — never say "Good morning" if it is afternoon or evening.
${isFirstCall ? 'IMPORTANT: This is the first briefing. Lead with and address every stated weekly priority directly — do not substitute your own judgment for what matters most.' : ''}
You speak like Jarvis from Iron Man — confident, sharp, and always one step ahead. You are a trusted advisor, not a critic.
You know this person better than they know themselves. You believe in them deeply.
Your job is not to be a productivity app. Your job is to help them decide what deserves their attention today.
Be direct and honest, but never harsh. Call out misalignment with curiosity, not judgment. Frame challenges as opportunities. Always leave them feeling capable and motivated, not guilty.
Keep the briefing strictly under 280 words total. Every word counts. Be punchy, not exhaustive.
Speak in first person to the user. Be warm but authoritative.
IMPORTANT: Always write numbers as words so they sound natural when spoken aloud. Write "two hundred fifty thousand" not "250,000". Write "nine AM" not "9:00 AM". Write "thirty percent" not "30%". Write "one hundred thirty-five" not "135". Never write bare digits — always spell them out fully as you would say them aloud.
IMPORTANT: The user's name is spelled "Derrick" but should be pronounced "Derr-ick" — write it as "Derrick" in the text.`;

  const userPrompt = `Generate today's (${format(new Date(), 'EEEE, MMMM d, yyyy')}) morning briefing for ${user.name}.

USER PROFILE:
${user.profile_summary || 'No profile summary available.'}

THIS WEEK'S TOP PRIORITIES:
${prioritiesText}

TODAY'S CALENDAR:
${calendarText}

UPCOMING THIS WEEK:
${weekCalendarText}

MEMORY & PRIOR CONVERSATIONS:
${memoriesText}

INCOMPLETE TASKS FROM PREVIOUS DAYS:
${incompleteTasks.length ? incompleteTasks.map(t => `- [${t.date}] ${t.text}`).join('\n') : 'None.'}

RECENT CALL RESPONSES FROM USER:
${previousBriefingsText}

Generate a briefing with these sections:
1. GREETING — Start with "${greeting}, [name]." then be personal and sharp, reference something specific from their profile or recent conversations
2. TODAY'S SNAPSHOT — Key events and commitments from their calendar (2-3 sentences)
3. ALIGNMENT CHECK — Compare their stated priorities with their calendar. Call out any misalignment directly
4. LEVERAGE ACTIONS — The 3 highest-leverage things they should do today (be specific, not generic). You MUST address every stated weekly priority — do not skip or omit any of them even if you think something else is more important.
5. PATTERN RECOGNITION — One insight from their memory/conversation history that they need to hear (if applicable)
6. CALENDAR BLOCKS — Recommend 2-3 specific time blocks for today with exact start and end times (e.g. "nine AM to ten thirty AM for the gym", "two PM to four PM for Edg3 development"). Always include specific times — these will be automatically added to the calendar.
7. CLOSING QUESTION — End with: "What's the most important thing I should know before tomorrow's briefing?"

Write this as a spoken briefing — natural language, no markdown headers, flowing paragraphs.`;

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
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
