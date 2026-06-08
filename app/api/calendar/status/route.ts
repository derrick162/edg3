import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { calendarQueries } from '@/lib/db';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tokenRow = calendarQueries.get(user.id);
  return NextResponse.json({ connected: !!tokenRow });
}
