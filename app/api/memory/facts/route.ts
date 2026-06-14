import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { factQueries } from '@/lib/db';

export async function PATCH(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { id?: number; statement?: string; entity?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { id, statement, entity } = body;
  if (!id || !statement?.trim()) {
    return NextResponse.json({ error: 'id and statement required' }, { status: 400 });
  }

  factQueries.updateFact(user.id, id, statement.trim(), entity ?? null);
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { id?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { id } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  factQueries.deleteFact(user.id, id);
  return NextResponse.json({ success: true });
}
