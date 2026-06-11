import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { memoryQueries, factQueries } from '@/lib/db';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Show real depth — each call produces several memory rows, so a small cap made the
  // Memory tab floor out after a couple of days (reported: "only goes back to June 8").
  const memories = memoryQueries.getRecent(user.id, 200);
  const facts = factQueries.getAll(user.id);
  return NextResponse.json({ memories, facts });
}
