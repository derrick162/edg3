import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { factQueries } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  let body: { statement?: string; entity?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { statement, entity } = body;
  if (!statement?.trim()) {
    return NextResponse.json({ error: 'statement required' }, { status: 400 });
  }

  factQueries.updateFact(user.id, id, statement.trim(), entity ?? null);
  // Return the updated fact so the caller can reflect the change without a full refetch.
  // updateFact also clears confidence → 'high' (removes the ⚠ verify flag).
  const updated = factQueries.getById(user.id, id);
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ ok: true, fact: updated });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  factQueries.deleteFact(user.id, id);
  return NextResponse.json({ ok: true });
}
