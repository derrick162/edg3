import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { openLoopQueries, auditLogQueries } from '@/lib/db';
import type { OpenLoopType } from '@/lib/openLoops';

// GET /api/open-loops
// Returns all open loops for the authenticated user, organised into three buckets.
export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const allOpen = openLoopQueries.list(user.id, 'open');

  const buckets: Record<OpenLoopType, typeof allOpen> = {
    commitment_made: [],
    awaiting_you:   [],
    deadline:       [],
  };
  for (const loop of allOpen) {
    buckets[loop.type].push(loop);
  }

  return NextResponse.json({
    commitment_made: buckets.commitment_made,
    awaiting_you:   buckets.awaiting_you,
    deadline:       buckets.deadline,
    total:          allOpen.length,
  });
}

// POST /api/open-loops
// Body: { id: number, action: 'resolve' | 'dismiss' | 'snooze', until?: string }
// snooze requires until: YYYY-MM-DD (hides loop until that date)
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('openLoops', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  const body = await req.json().catch(() => ({}));
  const { id, action, until } = body as { id?: unknown; action?: unknown; until?: unknown };

  if (typeof id !== 'number' || (action !== 'resolve' && action !== 'dismiss' && action !== 'snooze')) {
    return NextResponse.json({ error: 'Provide id (number) and action ("resolve" | "dismiss" | "snooze")' }, { status: 400 });
  }

  if (action === 'snooze') {
    if (typeof until !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
      return NextResponse.json({ error: 'snooze requires until: YYYY-MM-DD' }, { status: 400 });
    }
    const today = new Date().toISOString().slice(0, 10);
    if (until <= today) {
      return NextResponse.json({ error: 'until must be a future date' }, { status: 400 });
    }
  }

  const existing = openLoopQueries.list(user.id, 'open', { includeSnoozed: true }).find(l => l.id === id);
  if (!existing) {
    return NextResponse.json({ error: 'Loop not found or already closed' }, { status: 404 });
  }

  if (action === 'resolve') openLoopQueries.resolve(user.id, id);
  else if (action === 'dismiss') openLoopQueries.dismiss(user.id, id);
  else openLoopQueries.snooze(user.id, id, until as string);

  auditLogQueries.record({
    userId: user.id,
    briefingId: null,
    action: `loop_${action}`,
    argsJson: JSON.stringify({ id, description: existing.description?.slice(0, 80), until: action === 'snooze' ? until : undefined }),
    resultText: `Open loop ${action}d`,
    ok: true,
    snapshotBefore: null,
    snapshotAfter: null,
  });

  return NextResponse.json({ ok: true, id, action, until: action === 'snooze' ? until : undefined });
}
