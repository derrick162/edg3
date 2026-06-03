import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { userQueries } from '@/lib/db';

export async function POST() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const fullUser = userQueries.findById(user.id);
  if (!fullUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const phoneNumber = (fullUser as any).phone_number;
  if (!phoneNumber) return NextResponse.json({ error: 'No phone number on file' }, { status: 400 });

  const firstName = fullUser.name.split(' ')[0];

  const VAPI_API_KEY = process.env.VAPI_API_KEY;
  const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID;
  if (!VAPI_API_KEY || !VAPI_PHONE_NUMBER_ID) {
    return NextResponse.json({ error: 'Vapi not configured' }, { status: 500 });
  }

  const firstMessage = `Hey ${firstName}! I'm Edge — your Elite Daily Guidance Engine. Think of me as your personal AI Chief of Staff. Every morning I'll call you just like this, and in about three to five minutes I'll tell you exactly what deserves your attention that day. Here's how I'll help you: first, I'll align your calendar with your actual priorities so you stop drifting. Second, I'll track patterns in your life that you're too close to see yourself. And third, I'll hold you accountable — not harshly, but honestly, like a great advisor would. I already know your story, ${firstName}. Let's make sure the next chapter is the best one yet. I'll see you tomorrow morning.`;

  const payload = {
    phoneNumberId: VAPI_PHONE_NUMBER_ID,
    customer: { number: phoneNumber },
    assistant: {
      name: 'Edge',
      voice: {
        provider: '11labs',
        voiceId: '3WqHLnw80rOZqJzW9YRB',
        model: 'eleven_turbo_v2_5',
        stability: 0.3,
        similarityBoost: 0.75,
      },
      model: {
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        systemPrompt: `You are Edge, an AI Chief of Staff. You just delivered your intro message. The user may respond — if they do, acknowledge warmly in one sentence then say "I'll see you tomorrow morning." and end the call. Keep the entire call under 45 seconds.`,
      },
      firstMessage,
      endCallPhrases: ["I'll see you tomorrow morning", 'see you tomorrow', 'goodbye'],
      maxDurationSeconds: 60,
      silenceTimeoutSeconds: 10,
    },
  };

  const response = await fetch('https://api.vapi.ai/call/phone', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${VAPI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    return NextResponse.json({ error: `Vapi call failed: ${error}` }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
