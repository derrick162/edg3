import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { generatePreviewBriefing } from '@/lib/briefing';
import { previewBriefingQueries } from '@/lib/db';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!user.onboarding_complete) {
    return NextResponse.json({ error: 'Onboarding not complete' }, { status: 403 });
  }

  // Return existing preview without re-running the LLM.
  const existing = previewBriefingQueries.get(user.id);
  if (existing) {
    return NextResponse.json({ content: existing.content, cached: true });
  }

  try {
    const content = await generatePreviewBriefing(user.id);
    previewBriefingQueries.create(user.id, content);
    return NextResponse.json({ content, cached: false });
  } catch (err) {
    console.error('[preview] Generation failed:', err);
    return NextResponse.json({ error: 'Failed to generate preview' }, { status: 500 });
  }
}
