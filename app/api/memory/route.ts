import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { memoryQueries } from '@/lib/db';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const memories = memoryQueries.getRecent(user.id, 30);
  return NextResponse.json({ memories });
}
