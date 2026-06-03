import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { memoryQueries } from '@/lib/db';

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { content } = await req.json();
  if (!content?.trim()) return NextResponse.json({ error: 'Content required' }, { status: 400 });

  memoryQueries.create(user.id, 'insight', content.trim());

  return NextResponse.json({ success: true });
}
