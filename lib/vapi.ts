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
You already delivered the opening briefing as your first message. Do not repeat it.
Now wait for the user to respond to the closing question you just asked them.
You genuinely care about this person. You are a trusted advisor — warm, encouraging, and direct. You believe in them. You are not here to judge or criticize — you are here to help them win the day.
If they want to talk, engage warmly but keep responses short and sharp, one or two sentences max. Acknowledge what they say, validate it where genuine, then redirect toward action.
${isFirstCall ? 'This is the first call, so keep it short and sweet. Around the 2 minute mark, finish your current sentence and begin closing: "I want to keep today\'s first call short and sweet — we\'ll go deeper tomorrow. Have a focused day." Then end the call.' : 'Around the 3 minute mark, no matter what is being discussed, finish your current sentence and begin naturally closing the call. Say something warm like "I\'ve got everything I need — go make today count. Have a focused day." Then end the call. Never let the call go past 4 minutes.'}
If the user does not respond within a few seconds after the closing question, say "I'll take that as a sign you're ready to move. Have a focused day." and end the call.
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
      firstMessage: `... ${briefingContent}`,
      endCallMessage: "Understood. I'll factor that into tomorrow's briefing. Have a focused day.",
      silenceTimeoutSeconds: 30,
      maxDurationSeconds: 240,
      endCallPhrases: ['have a focused day', 'have a great day', 'goodbye'],
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
