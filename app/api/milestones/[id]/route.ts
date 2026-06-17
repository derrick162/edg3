import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { focusMilestoneQueries, auditLogQueries } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('milestoneWrite', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id) || id < 1) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  let body: { done?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (typeof body.done !== 'boolean') {
    return NextResponse.json({ error: 'done (boolean) is required' }, { status: 400 });
  }

  if (body.done) {
    focusMilestoneQueries.markDone(id, user.id);
  } else {
    focusMilestoneQueries.markUndone(id, user.id);
  }
  auditLogQueries.record({ userId: user.id, action: body.done ? 'milestoneComplete' : 'milestoneUncomplete', argsJson: JSON.stringify({ milestoneId: id }), ok: true });
  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('milestoneWrite', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id) || id < 1) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  focusMilestoneQueries.remove(id, user.id);
  auditLogQueries.record({ userId: user.id, action: 'milestoneDelete', argsJson: JSON.stringify({ milestoneId: id }), ok: true });
  return NextResponse.json({ success: true });
}
