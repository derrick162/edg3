import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { briefingQueries } from '@/lib/db';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const briefings = briefingQueries.getRecent(user.id, 10);
    return NextResponse.json({ briefings });
  } catch (err) {
    console.error('Failed to fetch briefing history:', err);
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
  }
}
