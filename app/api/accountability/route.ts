import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { taskQueries, openLoopQueries } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { buildAccountabilitySnapshot } from '@/lib/accountabilityMemory';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('meetingContext', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  const today = new Date().toISOString().slice(0, 10);
  const recentTasks = taskQueries.getRecent(user.id, 7);
  const loops = [
    ...openLoopQueries.list(user.id, 'open'),
    ...openLoopQueries.list(user.id, 'done'),
  ];

  const snapshot = buildAccountabilitySnapshot(recentTasks, loops, today, 7);
  return NextResponse.json({ snapshot });
}
