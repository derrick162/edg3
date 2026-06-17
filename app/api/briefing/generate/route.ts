import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { generateDailyBriefing } from '@/lib/briefing';
import { briefingQueries } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

export async function POST() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('briefingGenerate', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  try {
    const content = await generateDailyBriefing(user.id);
    const result = briefingQueries.create(user.id, content, new Date().toISOString()) as any;

    return NextResponse.json({ success: true, briefingId: result.lastInsertRowid, content });
  } catch (err) {
    console.error('Briefing generation error:', err);
    return NextResponse.json({ error: 'Failed to generate briefing' }, { status: 500 });
  }
}
