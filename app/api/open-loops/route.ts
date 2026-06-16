import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { openLoopQueries } from '@/lib/db';
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
// Body: { id: number, action: 'resolve' | 'dismiss' }
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('openLoops', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  const body = await req.json().catch(() => ({}));
  const { id, action } = body as { id?: unknown; action?: unknown };

  if (typeof id !== 'number' || (action !== 'resolve' && action !== 'dismiss')) {
    return NextResponse.json({ error: 'Provide id (number) and action ("resolve" | "dismiss")' }, { status: 400 });
  }

  const existing = openLoopQueries.list(user.id, 'open').find(l => l.id === id);
  if (!existing) {
    return NextResponse.json({ error: 'Loop not found or already closed' }, { status: 404 });
  }

  if (action === 'resolve') openLoopQueries.resolve(user.id, id);
  else openLoopQueries.dismiss(user.id, id);

  return NextResponse.json({ ok: true, id, action });
}
