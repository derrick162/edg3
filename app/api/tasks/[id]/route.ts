import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { taskQueries } from '@/lib/db';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const { completed } = await req.json();
  const taskId = parseInt(id);

  if (completed) {
    taskQueries.complete(taskId, user.id);
  } else {
    taskQueries.uncomplete(taskId, user.id);
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  taskQueries.delete(parseInt(id), user.id);
  return NextResponse.json({ success: true });
}
