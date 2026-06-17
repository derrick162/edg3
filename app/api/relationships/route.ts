import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { peopleProfileQueries } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('meetingContext', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  const profiles = peopleProfileQueries.listForUser(user.id);
  return NextResponse.json({ profiles });
}
