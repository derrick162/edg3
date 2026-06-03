import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { briefingQueries } from '@/lib/db';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const briefings = briefingQueries.getRecent(user.id, 10);
  return NextResponse.json({ briefings });
}
