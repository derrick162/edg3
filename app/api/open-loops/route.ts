import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { openLoopStubQueries } from '@/lib/openLoops';
import type { OpenLoopType } from '@/lib/openLoops';

// GET /api/open-loops
// Returns all open loops for the authenticated user, organised into three buckets.
export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const allOpen = openLoopStubQueries.getOpen(user.id);

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

  const changed = action === 'resolve'
    ? openLoopStubQueries.resolve(user.id, id)
    : openLoopStubQueries.dismiss(user.id, id);

  if (!changed) {
    return NextResponse.json({ error: 'Loop not found or already closed' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id, action });
}
