import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { patternCacheQueries } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('meetingContext', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  const raw = patternCacheQueries.get(user.id);
  const patterns = raw ? JSON.parse(raw) : [];

  return NextResponse.json({ patterns });
}
