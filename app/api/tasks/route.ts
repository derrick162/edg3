import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { taskQueries } from '@/lib/db';
import { format } from 'date-fns';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tasks = taskQueries.getRecent(user.id, 30);
  return NextResponse.json({ tasks });
}

const MAX_TASK_TEXT = 500;

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('tasksWrite', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  let body: { text?: string; date?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { text, date } = body;
  if (!text?.trim()) return NextResponse.json({ error: 'Text required' }, { status: 400 });
  if (text.trim().length > MAX_TASK_TEXT) {
    return NextResponse.json({ error: `Task text must be ${MAX_TASK_TEXT} characters or fewer` }, { status: 400 });
  }

  const today = date || format(new Date(), 'yyyy-MM-dd');
  const result = taskQueries.create(user.id, text.trim(), today, 'manual') as { lastInsertRowid: number };
  return NextResponse.json({ success: true, id: result.lastInsertRowid });
}
