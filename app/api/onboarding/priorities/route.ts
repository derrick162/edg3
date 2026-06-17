import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { priorityQueries, memoryQueries, factQueries } from '@/lib/db';
import { getWeekOf } from '@/lib/briefing';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('onboardingPriorities', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  let body: { priorities?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { priorities } = body;
  if (!Array.isArray(priorities) || priorities.length === 0) {
    return NextResponse.json({ error: 'Priorities required' }, { status: 400 });
  }

  const weekOf = getWeekOf();

  // Capture old priorities before overwriting
  const oldPriorities = priorityQueries.getThisWeek(user.id, weekOf);
  const oldTexts = oldPriorities.map(p => p.text);
  const newTexts = priorities.slice(0, 3).map((t: string) => t?.trim()).filter(Boolean);

  priorityQueries.deleteThisWeek(user.id, weekOf);
  newTexts.forEach((text: string, i: number) => {
    priorityQueries.create(user.id, text, weekOf, i + 1);
  });

  // Record the change in memory if priorities actually changed
  const added = newTexts.filter(t => !oldTexts.includes(t));
  const removed = oldTexts.filter(t => !newTexts.includes(t));
  if (added.length > 0 || removed.length > 0) {
    const changeNote = [
      removed.length ? `Removed priorities: ${removed.join(', ')}` : '',
      added.length ? `Added priorities: ${added.join(', ')}` : '',
    ].filter(Boolean).join('. ');
    memoryQueries.create(user.id, 'calendar_note', `[PRIORITY CHANGE]: ${changeNote}`);
  }

  // Sync priorities → facts (category 'goal', source 'priority-sync') so they appear
  // in the Memory tab and flow into Edge's context. Idempotent: clears stale entries first.
  try { factQueries.syncPriorityFacts(user.id, newTexts); } catch { /* non-fatal */ }

  return NextResponse.json({ success: true });
}

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // getMostRecent returns priorities from the latest week_of regardless of the current
  // week — so the dashboard always shows something and can check week_of for staleness.
  const priorities = priorityQueries.getMostRecent(user.id);
  return NextResponse.json({ priorities });
}
