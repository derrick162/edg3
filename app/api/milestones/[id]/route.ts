import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { focusMilestoneQueries } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

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
  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  focusMilestoneQueries.remove(id, user.id);
  return NextResponse.json({ success: true });
}
