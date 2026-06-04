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

RECENT CALL RESPONSES FROM USER:
${previousBriefingsText}

Generate a briefing with these sections:
1. GREETING — Start with "${greeting}, [name]." then be personal and sharp. If there are recently completed tasks, open with genuine kudos — call them out by name, be specific, make them feel the win. Keep it warm and real, not generic. IMPORTANT: If there are any [USER NOTE] or [PRIORITY CHANGE] entries in the memory, acknowledge them directly and early — these are messages the user manually sent you between calls and they expect you to have read them. For [PRIORITY CHANGE], explicitly call out what was added or removed and confirm the new priorities.
2. TODAY'S SNAPSHOT — Key events and commitments from their calendar (2-3 sentences)
3. ALIGNMENT CHECK — Compare their stated priorities with their calendar. Note any misalignment briefly and with empathy — one sentence max, then move on. Do not lecture or repeat the point.
4. LEVERAGE ACTIONS — The 3 highest-leverage things they should do today (be specific, not generic). You MUST address every stated weekly priority — do not skip or omit any of them even if you think something else is more important. If there are incomplete tasks from previous days, reference them explicitly by name — acknowledge what carried over and adjust the ask accordingly. IMPORTANT: If a recently completed task is directly related to one of their top priorities, do NOT repeat that priority as a task — instead acknowledge it's done and ask if a new priority should replace it (e.g. "You knocked out the bachelor party planning — do you want to swap that priority out for something new? Tell me at the end of the call.").
5. PATTERN RECOGNITION — One insight from their memory/conversation history that they need to hear (if applicable)
6. CALENDAR BLOCKS — Recommend 2-3 specific time blocks for today with exact start and end times (e.g. "nine AM to ten thirty AM for the gym", "two PM to four PM for Edge development"). Always include specific times — these will be automatically added to the calendar.
7. CLOSING QUESTION — End with: "What's the most important thing I should know before tomorrow's briefing?"

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
