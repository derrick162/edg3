import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { userQueries } from '@/lib/db';
import Anthropic from '@anthropic-ai/sdk';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const fullUser = userQueries.findById(user.id);
  if (!fullUser?.profile_summary) return NextResponse.json({ priorities: [] });

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const result = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Based on this person's profile, suggest their top 3 most important priorities for this week.
Each priority should be specific, action-oriented, and directly tied to something real in their profile.
Return ONLY a JSON array of exactly 3 short strings (under 10 words each). No explanation.

PROFILE:
${fullUser.profile_summary}

Example format: ["Launch landing page for startup", "Hit gym 4x this week", "Call 3 potential investors"]

Priorities:`,
      }],
    });

    const text = result.content[0].type === 'text' ? result.content[0].text : '[]';
    const match = text.match(/\[[\s\S]*\]/);
    const priorities: string[] = match ? JSON.parse(match[0]) : [];
    return NextResponse.json({ priorities: priorities.slice(0, 3) });
  } catch {
    return NextResponse.json({ priorities: [] });
  }
}
