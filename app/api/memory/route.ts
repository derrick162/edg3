import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { memoryQueries, factQueries } from '@/lib/db';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const memories = memoryQueries.getRecent(user.id, 30);
  const facts = factQueries.getAll(user.id);
  return NextResponse.json({ memories, facts });
}
