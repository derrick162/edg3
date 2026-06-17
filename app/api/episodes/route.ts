import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { episodeQueries } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('meetingContext', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const episodes = episodeQueries.search(user.id, { since, limit: 10 });

  return NextResponse.json({ episodes });
}
