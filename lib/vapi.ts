// Vapi integration for outbound voice calls

export interface VapiCallRequest {
  phoneNumber: string;
  assistantId?: string;
  assistantOverrides?: {
    firstMessage?: string;
    systemPrompt?: string;
  };
}

export interface VapiCallResponse {
  id: string;
  status: string;
  phoneNumber: string;
}

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID;
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;

export async function initiateCall(
  phoneNumber: string,
  briefingContent: string,
  userName: string,
  isFirstCall: boolean = false,
  userTimezone: string = 'America/Vancouver'
): Promise<VapiCallResponse> {
  if (!VAPI_API_KEY) throw new Error('VAPI_API_KEY not configured');
  if (!VAPI_PHONE_NUMBER_ID) throw new Error('VAPI_PHONE_NUMBER_ID not configured');

  // Calculate all date references in the user's actual timezone
  const userTzNow = new Date(new Date().toLocaleString('en-US', { timeZone: userTimezone }));
  const pad = (n: number) => String(n).padStart(2, '0');
  const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const userHour = userTzNow.getHours();
  const userDay = userTzNow.getDay(); // 0=Sun, 1=Mon...

  const todayD = new Date(userTzNow); todayD.setHours(0,0,0,0);
  const todayStr = toDateStr(todayD);
  const tomorrowStr = toDateStr(new Date(todayD.getTime() + 86400000));
  const in2DaysStr = toDateStr(new Date(todayD.getTime() + 2*86400000));
  const in3DaysStr = toDateStr(new Date(todayD.getTime() + 3*86400000));

  // This week Mon-Sun
  const thisMon = new Date(todayD); thisMon.setDate(todayD.getDate() - ((userDay + 6) % 7));
  const thisSun = new Date(thisMon.getTime() + 6*86400000);
  const thisFri = new Date(thisMon.getTime() + 4*86400000);
  const thisSat = new Date(thisMon.getTime() + 5*86400000);

  // Next week Mon-Sun
  const nextMon = new Date(thisMon.getTime() + 7*86400000);
  const nextSun = new Date(nextMon.getTime() + 6*86400000);
  const nextFri = new Date(nextMon.getTime() + 4*86400000);
  const nextSat = new Date(nextMon.getTime() + 5*86400000);

  // Named days of this week
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const thisWeekDays = Array.from({length: 7}, (_, i) => `  ${dayNames[(userDay + i) % 7]} (this ${dayNames[(userDay+i)%7]}): ${toDateStr(new Date(todayD.getTime() + i*86400000))}`).join('\n');

  const systemPrompt = `You are Edge — the Elite Daily Guidance Engine — an AI Chief of Staff for ${userName}. IMPORTANT: The user's name is ${userName} — never call them by any other name under any circumstances. If asked who you are, say "I'm Edge, your Elite Daily Guidance Engine."
You already delivered the briefing as your first message. Do not repeat it. Now wait for the user to respond.

DATE & TIME REFERENCE — user's timezone: ${userTimezone}, current time: ${pad(userHour)}:${pad(userTzNow.getMinutes())}
Always use these exact YYYY-MM-DD dates in tool calls. Never calculate dates yourself.

- Today (${dayNames[userDay]}): ${todayStr}
- Tomorrow (${dayNames[(userDay+1)%7]}): ${tomorrowStr}
- In 2 days: ${in2DaysStr}
- In 3 days: ${in3DaysStr}
- This Friday: ${toDateStr(thisFri)}
- This Saturday: ${toDateStr(thisSat)}
- This weekend: ${toDateStr(thisSat)} to ${toDateStr(thisSun)}
- This week (Mon-Sun): ${toDateStr(thisMon)} to ${toDateStr(thisSun)}
- Next Monday: ${toDateStr(nextMon)}
- Next Friday: ${toDateStr(nextFri)}
- Next weekend: ${toDateStr(nextSat)} to ${toDateStr(nextSun)}
- Next week (Mon-Sun): ${toDateStr(nextMon)} to ${toDateStr(nextSun)}

Named days this week:
${thisWeekDays}

TIME AWARENESS: Current hour is ${userHour}. If user says "this afternoon" and it's already evening (after 17:00), clarify if they mean tomorrow afternoon. If they say "this morning" and it's afternoon, ask if they mean tomorrow morning.

You genuinely care about this person. You are a trusted advisor — warm, encouraging, and direct. You believe in them. You are not here to judge or criticize — you are here to help them win the day.
If they want to talk, engage warmly but keep responses short and sharp, one or two sentences max. Acknowledge what they say, validate it where genuine, then redirect toward action.
NEVER say "I'm listening" — it's a dead-end response. If someone is talking, respond to what they said. If there's silence, ask a short question.
IMPORTANT: Never tell the user to "text you", "message you", "send you a message", or contact you outside of this call. If you need information from them between calls, always direct them to the dashboard: "You can leave me a note in the dashboard — there's a 'Tell Edge Something' box and I'll read it before our next call."
IMPORTANT — SCOPE: You are a briefing and calendar management tool. Do NOT promise to research anything, find options, look things up, or prepare information for next call. If asked to do research (e.g. "find me spas", "look up restaurants", "research options"), be honest: "I can't do research — I'm focused on your calendar and briefings. You could use Google or ChatGPT for that." Stick to what you can actually do: read their calendar, book events, move events, delete events, change event colors.
IMPORTANT — MEMORY: You have full memory of all previous conversations. Never say you "don't have memory", "start fresh each call", or "can't remember" past calls. Your memory is built into every briefing. If asked, say "I have everything from our previous calls."
IMPORTANT — CALENDAR TOOLS: You have live calendar tools. Use them — but be honest about results.
- Always use readCalendar() to verify before making changes
- Use createEvent(), createRecurringEvent(), deleteEvent(), moveEvent(), colorEvent(), planWeek() as needed
- After EVERY tool call, tell the user what actually happened based on the result message
- If a tool returns an error or "no event found" → say it immediately: "I tried to move that but couldn't find the event — you'll need to do that manually in your calendar."
- If a tool returns a conflict warning → tell the user and ask what they want to do
- Never say "done" or "handled" unless the tool returned a clear success message
- If you're unsure whether it worked, say "I attempted that — worth double-checking your calendar"
- It is better to say "I can't do that" than to say "done" when it didn't work
- You cannot: research things, look up information, access the internet, or do anything outside calendar management and your briefing
IMPORTANT: Whenever you ask a question — especially the closing question — stop talking completely and wait for the user to respond. Do not continue speaking after asking a question. Give them a full 15 seconds of silence to answer before doing anything else. Do not rush them.
IMPORTANT: Never end the call abruptly mid-conversation. Always finish your thought, deliver a warm closing line, and only end after a natural pause.
${isFirstCall ? 'This is the first call, so keep it short and sweet. Around the 2 minute mark, finish your current sentence and begin closing: "I want to keep today\'s first call short and sweet — we\'ll go deeper tomorrow. Have a focused day." Then end the call.' : 'After delivering the briefing, open it up for conversation — let them respond, ask questions, or share what\'s on their mind. Keep your replies short and sharp, one or two sentences. Let the conversation flow naturally — only wrap up when the user is done or signals they want to end the call.'}
BEFORE ENDING THE CALL: When the conversation is winding down, say "I should let you go — want me to run through my action items real quick?" Then wait for their response. If they say yes or anything positive → summarize each action item clearly. If they say no, not now, I'm good, or anything dismissive → just say "Perfect. Have a focused day." and end the call. Never force the summary on them.
If the user does not respond within 15 seconds after the closing question, say "I\'ll take that as a sign you\'re ready to move. Have a focused day." and end the call.
Always end with warmth and encouragement. This person is building something — remind them of that.`;

  const payload: Record<string, unknown> = {
    phoneNumberId: VAPI_PHONE_NUMBER_ID,
    customer: {
      number: phoneNumber,
    },
    assistant: VAPI_ASSISTANT_ID ? undefined : {
      name: 'EDG3',
      voice: {
        provider: '11labs',
        voiceId: '3WqHLnw80rOZqJzW9YRB', // Daniel
        model: 'eleven_turbo_v2_5',
        stability: 0.3,
        similarityBoost: 0.75,
      },
      model: {
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        systemPrompt,
        tools: [
          {
            type: 'function',
            function: {
              name: 'readCalendar',
              description: 'Read calendar events for a date range. Use this to check what is on the calendar before making changes.',
              parameters: {
                type: 'object',
                properties: {
                  startDate: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
                  endDate: { type: 'string', description: 'End date in YYYY-MM-DD format' },
                },
                required: ['startDate', 'endDate'],
              },
            },
          },
          {
            type: 'function',
            function: {
              name: 'createEvent',
              description: 'Create a new calendar event.',
              parameters: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Event title' },
                  startDateTime: { type: 'string', description: 'Start datetime in YYYY-MM-DDTHH:MM:00 local time' },
                  endDateTime: { type: 'string', description: 'End datetime in YYYY-MM-DDTHH:MM:00 local time' },
                  timezone: { type: 'string', description: 'IANA timezone e.g. America/Toronto' },
                  color: { type: 'string', description: 'Optional color name e.g. green, orange, blue' },
                },
                required: ['title', 'startDateTime', 'endDateTime', 'timezone'],
              },
            },
          },
          {
            type: 'function',
            function: {
              name: 'deleteEvent',
              description: 'Delete a calendar event by title and date.',
              parameters: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Event title (partial match ok)' },
                  date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
                  deleteAll: { type: 'boolean', description: 'If true, delete all matching events on that date' },
                  recurringScope: { type: 'string', enum: ['this', 'thisAndFollowing', 'all'], description: 'For recurring events: delete just this one, this and future, or all occurrences' },
                },
                required: ['title', 'date'],
              },
            },
          },
          {
            type: 'function',
            function: {
              name: 'moveEvent',
              description: 'Move/reschedule a calendar event to a new time.',
              parameters: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Event title (partial match ok)' },
                  date: { type: 'string', description: 'Current date of the event YYYY-MM-DD' },
                  newStartDateTime: { type: 'string', description: 'New start datetime YYYY-MM-DDTHH:MM:00 local time' },
                  newEndDateTime: { type: 'string', description: 'New end datetime YYYY-MM-DDTHH:MM:00 local time' },
                  timezone: { type: 'string', description: 'IANA timezone e.g. America/Toronto' },
                  recurringScope: { type: 'string', enum: ['this', 'all'], description: 'For recurring events: move just this occurrence or all' },
                },
                required: ['title', 'date', 'newStartDateTime', 'newEndDateTime', 'timezone'],
              },
            },
          },
          {
            type: 'function',
            function: {
              name: 'planWeek',
              description: 'Intelligently plan the week by reading existing events and adding focus blocks aligned to the user\'s top priorities. Use when user says "plan my week", "structure my week", or "set up my week".',
              parameters: {
                type: 'object',
                properties: {
                  weekStartDate: { type: 'string', description: 'Monday of the week to plan, YYYY-MM-DD' },
                  focusHoursPerDay: { type: 'number', description: 'How many hours of focus time per day (default 2)' },
                  preferences: { type: 'string', description: 'Any specific preferences e.g. "mornings for deep work, afternoons for calls"' },
                },
                required: ['weekStartDate'],
              },
            },
          },
          {
            type: 'function',
            function: {
              name: 'createRecurringEvent',
              description: 'Create a recurring calendar event (daily, weekly on specific days, etc). Use this for habits like daily walks, weekly meetings, etc.',
              parameters: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Event title' },
                  startTime: { type: 'string', description: 'Start time HH:MM (24h)' },
                  endTime: { type: 'string', description: 'End time HH:MM (24h)' },
                  timezone: { type: 'string', description: 'IANA timezone e.g. America/Toronto' },
                  startDate: { type: 'string', description: 'First occurrence date YYYY-MM-DD' },
                  endDate: { type: 'string', description: 'Last occurrence date YYYY-MM-DD (optional)' },
                  recurrence: { type: 'string', description: 'RRULE frequency e.g. FREQ=DAILY, FREQ=WEEKLY;BYDAY=MO,WE,FR, FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR' },
                  color: { type: 'string', description: 'Optional color name' },
                },
                required: ['title', 'startTime', 'endTime', 'timezone', 'startDate', 'recurrence'],
              },
            },
          },
          {
            type: 'function',
            function: {
              name: 'colorEvent',
              description: 'Change the color of a calendar event.',
              parameters: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Event title (partial match ok)' },
                  date: { type: 'string', description: 'Date of the event YYYY-MM-DD, or "all" to color all matching events' },
                  color: { type: 'string', description: 'Color name: green, orange, red, blue, purple, yellow, teal, pink' },
                },
                required: ['title', 'date', 'color'],
              },
            },
          },
        ],
      },
      firstMessage: `... ${briefingContent}`,
      endCallMessage: "Understood. I'll factor that into tomorrow's briefing. Have a focused day.",
      silenceTimeoutSeconds: 30,
      maxDurationSeconds: 1800,
      endCallPhrases: ['have a focused day', 'have a great day', 'goodbye'],
      serverUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.edg3.ai'}/api/vapi/tool-call`,
    },
    assistantId: VAPI_ASSISTANT_ID || undefined,
    assistantOverrides: VAPI_ASSISTANT_ID ? {
      firstMessage: `... ${briefingContent}`,
      model: {
        systemPrompt,
      },
    } : undefined,
  };

  // Remove undefined keys
  const cleanPayload = JSON.parse(JSON.stringify(payload));

  const response = await fetch('https://api.vapi.ai/call/phone', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${VAPI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cleanPayload),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Vapi call failed: ${error}`);
  }

  return response.json();
}

export async function getCallDetails(callId: string) {
  if (!VAPI_API_KEY) throw new Error('VAPI_API_KEY not configured');

  const response = await fetch(`https://api.vapi.ai/call/${callId}`, {
    headers: {
      'Authorization': `Bearer ${VAPI_API_KEY}`,
    },
  });

  if (!response.ok) throw new Error('Failed to fetch call details');
  return response.json();
}

export function extractUserResponseFromTranscript(transcript: string): string | null {
  const lines = transcript.split('\n');
  const userLines = lines
    .filter(l => l.startsWith('User:') || l.startsWith('Customer:'))
    .map(l => l.replace(/^(User:|Customer:)\s*/, '').trim())
    .filter(l => l.length > 5 && !['thank you', 'thanks', 'okay', 'ok', 'bye', 'goodbye'].includes(l.toLowerCase()));

  if (!userLines.length) return null;
  // Return the longest/most substantive user response
  return userLines.sort((a, b) => b.length - a.length)[0];
}
