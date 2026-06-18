import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { factHistoryQueries } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id) || id < 1) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const history = factHistoryQueries.getForFact(id, user.id);
  return NextResponse.json({ history });
}
