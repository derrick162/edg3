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
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `You are Edge, an AI Chief of Staff introducing yourself to ${firstName} for the very first time via a phone call.

Write a warm, confident 30-second spoken intro (about 80 words max). Structure:
1. Greet them by first name, introduce yourself as Edge their Elite Daily Guidance Engine
2. Say you'll call them every morning with a focused briefing
3. Based on their profile below, name exactly 3 specific ways you'll help THEM personally — be specific to their situation, not generic
4. Close warmly: "I already know your story. Let's make the next chapter the best one. I'll see you tomorrow morning."

Write numbers as words. Sound warm and human, not robotic.

PROFILE:
${profile || 'No profile yet — use generic helpful intro'}`,
    }],
  });

  const content = generated.content[0];
  const rawMessage = content.type === 'text' ? content.text : `I'm Edge — your Elite Daily Guidance Engine and AI Chief of Staff. Every morning I'll call you with a focused briefing on what deserves your attention that day. I'll align your priorities with your calendar, track patterns you're too close to see, and hold you accountable like a great advisor would. I already know your story. Let's make the next chapter the best one. I'll see you tomorrow morning.`;
  const firstMessage = `... ${rawMessage}`;

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
        systemPrompt: `You are Edge, an AI Chief of Staff. You just delivered your intro message to ${firstName}. If they respond, acknowledge warmly in one sentence then say "I'll see you tomorrow morning." and end the call. Keep the entire call under 60 seconds.`,
      },
      firstMessage,
      endCallPhrases: ["I'll see you tomorrow morning", 'see you tomorrow', 'goodbye'],
      maxDurationSeconds: 90,
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
