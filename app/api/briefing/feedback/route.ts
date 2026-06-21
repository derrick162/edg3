import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { callFeedbackQueries } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

// R17 T2 — capture a one-tap 1–5 star rating for a completed call. User-scoped; one per briefing.
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('callFeedback', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  let body: { briefingId?: string; rating?: number; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { briefingId, rating, note } = body;
  if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'rating must be an integer 1–5' }, { status: 400 });
  }
  const bid = typeof briefingId === 'string' && briefingId.trim() ? briefingId.trim() : null;

  // One rating per briefing — idempotent: a repeat submit is accepted as a no-op.
  if (bid && callFeedbackQueries.existsForBriefing(user.id, bid)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  callFeedbackQueries.create(user.id, bid, rating, typeof note === 'string' ? note.slice(0, 1000) : null);
  return NextResponse.json({ ok: true });
}
