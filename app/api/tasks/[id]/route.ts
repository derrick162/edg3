import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { taskQueries } from '@/lib/db';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  let body: { completed?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { completed } = body;
  const taskId = parseInt(id);
  if (isNaN(taskId)) return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });

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
  const taskId = parseInt(id);
  if (isNaN(taskId)) return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
  taskQueries.delete(taskId, user.id);
  return NextResponse.json({ success: true });
}
