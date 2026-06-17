import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { priorityQueries, memoryQueries, factQueries } from '@/lib/db';
import { getWeekOf } from '@/lib/briefing';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

const MAX_PRIORITY_TEXT = 200;

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('priorityAccept', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  let body: { priorities?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const texts = (body.priorities ?? [])
    .map((t: string) => t?.trim().slice(0, MAX_PRIORITY_TEXT))
    .filter(Boolean)
    .slice(0, 3);

  if (!texts.length) {
    return NextResponse.json({ error: 'At least one priority required' }, { status: 400 });
  }

  const weekOf = getWeekOf();
  priorityQueries.deleteThisWeek(user.id, weekOf);
  texts.forEach((text: string, i: number) => {
    priorityQueries.create(user.id, text, weekOf, i + 1);
  });

  memoryQueries.create(
    user.id,
    'calendar_note',
    `[PRIORITY CHANGE]: Edge proposed — accepted: ${texts.join(', ')}`,
  );

  try { factQueries.syncPriorityFacts(user.id, texts); } catch { /* non-fatal */ }

  return NextResponse.json({ ok: true });
}
