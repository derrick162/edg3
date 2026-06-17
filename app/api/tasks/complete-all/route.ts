import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { taskQueries } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('tasksWrite', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  let body: { ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.map(Number).filter(n => Number.isInteger(n))
    : [];
  if (!ids.length) return NextResponse.json({ error: 'No task IDs provided' }, { status: 400 });

  const completed = taskQueries.completeMany(ids, user.id);
  return NextResponse.json({ success: true, completed });
}
