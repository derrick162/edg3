import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { whoopQueries } from '@/lib/db';

export async function POST() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  whoopQueries.delete(user.id);
  return NextResponse.json({ success: true });
}
