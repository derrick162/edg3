import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { userQueries } from '@/lib/db';
import Anthropic from '@anthropic-ai/sdk';

export async function POST() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const fullUser = userQueries.findById(user.id);
  if (!fullUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const phoneNumber = (fullUser as any).phone_number;
  if (!phoneNumber) return NextResponse.json({ error: 'No phone number on file' }, { status: 400 });

  const VAPI_API_KEY = process.env.VAPI_API_KEY;
  const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID;
  if (!VAPI_API_KEY || !VAPI_PHONE_NUMBER_ID) {
    return NextResponse.json({ error: 'Vapi not configured' }, { status: 500 });
  }

  const firstName = fullUser.name.split(' ')[0];
  const profile = fullUser.profile_summary || '';

  // Generate personalized intro using Claude
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const generated = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `You are Edg3, an AI Chief of Staff making your very first call to ${firstName}.

Write a warm, confident 45-second spoken intro. Follow this exact structure:

1. "Hey ${firstName}, I'm Edg3 — your Elite Daily Guidance Engine and personal AI Chief of Staff."
2. "Every morning I'll call you like this with a focused briefing on what actually deserves your attention that day."
3. "I've read your full profile, and here are three specific ways I'm going to help you:" — then list exactly 3 highly specific, personal things drawn directly from the profile. Reference real details — their actual goals, challenges, businesses, or patterns. DO NOT be generic. For example if they're building a startup, name it. If they have a weight goal, name the number. If they have a financial challenge, reference it directly.
4. Close with: "I already know what you're capable of, ${firstName}. Let's make the next chapter the best one yet. I'll see you tomorrow morning."

Write all numbers as words. Natural spoken language only. No bullet points or formatting — flowing speech.

PROFILE:
${profile || 'New user — give a warm generic intro about aligning priorities, tracking patterns, and accountability'}`,
    }],
  });

  const content = generated.content[0];
  const rawMessage = content.type === 'text' ? content.text : `I'm Edg3 — your Elite Daily Guidance Engine and AI Chief of Staff. Every morning I'll call you with a focused briefing on what deserves your attention that day. I'll align your priorities with your calendar, track patterns you're too close to see, and hold you accountable like a great advisor would. I already know your story. Let's make the next chapter the best one. I'll see you tomorrow morning.`;
  const firstMessage = `... ${rawMessage}`;

  const payload = {
    phoneNumberId: VAPI_PHONE_NUMBER_ID,
    customer: { number: phoneNumber },
    assistant: {
      name: 'Edg3',
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
        systemPrompt: `You are Edg3, an AI Chief of Staff. You just delivered your intro message to ${firstName}. If they respond, acknowledge warmly in one sentence then say "I'll see you tomorrow morning." and end the call. Keep the entire call under 60 seconds.`,
      },
      firstMessage,
      endCallPhrases: ["I'll see you tomorrow morning", 'see you tomorrow', 'goodbye'],
      maxDurationSeconds: 300,
      silenceTimeoutSeconds: 20,
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
