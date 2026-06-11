import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { taskQueries } from '@/lib/db';
import { format } from 'date-fns';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tasks = taskQueries.getRecent(user.id, 30);
  return NextResponse.json({ tasks });
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { text?: string; date?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { text, date } = body;
  if (!text?.trim()) return NextResponse.json({ error: 'Text required' }, { status: 400 });

  const today = date || format(new Date(), 'yyyy-MM-dd');
  const result = taskQueries.create(user.id, text.trim(), today, 'manual') as { lastInsertRowid: number };
  return NextResponse.json({ success: true, id: result.lastInsertRowid });
}
