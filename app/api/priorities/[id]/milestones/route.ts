import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { focusMilestoneQueries } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: idStr } = await params;
  const priorityId = parseInt(idStr, 10);
  if (!priorityId) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const milestones = focusMilestoneQueries.listForPriority(user.id, priorityId);
  return NextResponse.json({ milestones });
}

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: idStr } = await params;
  const priorityId = parseInt(idStr, 10);
  if (!priorityId) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  let body: { title?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const title = (body.title || '').trim();
  if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 });

  const result = focusMilestoneQueries.create(user.id, priorityId, title) as { lastInsertRowid: number };
  const milestones = focusMilestoneQueries.listForPriority(user.id, priorityId);
  return NextResponse.json({ success: true, id: result.lastInsertRowid, milestones }, { status: 201 });
}
