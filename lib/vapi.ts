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
  isFirstCall: boolean = false
): Promise<VapiCallResponse> {
  if (!VAPI_API_KEY) throw new Error('VAPI_API_KEY not configured');
  if (!VAPI_PHONE_NUMBER_ID) throw new Error('VAPI_PHONE_NUMBER_ID not configured');

  const systemPrompt = `You are Edge — the Elite Daily Guidance Engine — an AI Chief of Staff for ${userName}. IMPORTANT: The user's name is ${userName} — never call them by any other name under any circumstances. If asked who you are, say "I'm Edge, your Elite Daily Guidance Engine."

YOUR BRIEFING (deliver only if the user chooses to hear it):
${briefingContent}

CALL FLOW — FOLLOW THIS EXACTLY:
1. Your FIRST response must be a warm 1-sentence greeting, then immediately ask: "Want the full briefing, or should we just chat?" Nothing else. Wait for their answer.
2. If they say anything like "briefing", "yes", "go ahead", "let's do it" → deliver the briefing above naturally.
3. If they say anything like "chat", "open chat", "just talk", "skip it" → skip the briefing entirely and just say "I'm listening." Then wait for them to lead.
4. If they don't respond within 10 seconds → say "I'll take that as a yes" and deliver the briefing.

After the briefing (or in chat mode), conversation flows naturally.

You genuinely care about this person. You are a trusted advisor — warm, encouraging, and direct. You believe in them. You are not here to judge or criticize — you are here to help them win the day.
If they want to talk, engage warmly but keep responses short and sharp, one or two sentences max. Acknowledge what they say, validate it where genuine, then redirect toward action.
IMPORTANT: Never tell the user to "text you", "message you", "send you a message", or contact you outside of this call. If you need information from them between calls, always direct them to the dashboard: "You can leave me a note in the dashboard — there's a 'Tell Edge Something' box and I'll read it before our next call."
IMPORTANT — SCOPE: You are a briefing and calendar management tool. Do NOT promise to research anything, find options, look things up, or prepare information for next call. If asked to do research (e.g. "find me spas", "look up restaurants", "research options"), be honest: "I can't do research — I'm focused on your calendar and briefings. You could use Google or ChatGPT for that." Stick to what you can actually do: read their calendar, book events, move events, delete events, change event colors.
IMPORTANT — MEMORY: You have full memory of all previous conversations. Never say you "don't have memory", "start fresh each call", or "can't remember" past calls. Your memory is built into every briefing. If asked, say "I have everything from our previous calls."
IMPORTANT — CALENDAR: You have full access to read, create, edit, move, and delete calendar events. When asked to make changes, confirm you'll handle it. Never say you "can't edit" or "don't have access" to the calendar.
IMPORTANT: Whenever you ask a question — especially the closing question — stop talking completely and wait for the user to respond. Do not continue speaking after asking a question. Give them a full 15 seconds of silence to answer before doing anything else. Do not rush them.
IMPORTANT: Never end the call abruptly mid-conversation. Always finish your thought, deliver a warm closing line, and only end after a natural pause.
CRITICAL VOICE SHORTCUT: If you detect the user saying "open chat", "stop", "pause", "hold on", or "wait" at ANY point — even mid-sentence while you are speaking — you MUST immediately stop talking. Do not finish your sentence. Stop instantly. Say only "I'm listening." Then go completely silent and wait for them to speak. This takes absolute priority over everything else you were saying. Do not resume the briefing unless they ask you to.
${isFirstCall ? 'This is the first call, so keep it short and sweet. Around the 2 minute mark, finish your current sentence and begin closing: "I want to keep today\'s first call short and sweet — we\'ll go deeper tomorrow. Have a focused day." Then end the call.' : 'After delivering the briefing, open it up for conversation — let them respond, ask questions, or share what\'s on their mind. Keep your replies short and sharp, one or two sentences. Let the conversation flow naturally — only wrap up when the user is done or signals they want to end the call.'}
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
      },
      firstMessage: `... ${userName.split(' ')[0]}.`,
      endCallMessage: "Understood. I'll factor that into tomorrow's briefing. Have a focused day.",
      silenceTimeoutSeconds: 45,
      maxDurationSeconds: 1800,
      endCallPhrases: ['have a focused day', 'have a great day', 'goodbye'],
      clientMessages: ['transcript', 'hang', 'function-call', 'speech-update'],
      serverMessages: ['transcript', 'end-of-call-report', 'status-update', 'hang', 'function-call'],
      stopSpeakingPlan: {
        numWords: 1,
        voiceSeconds: 0.1,
        backoffSeconds: 0,
      },
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
