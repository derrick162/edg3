import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { userQueries, memoryQueries } from '@/lib/db';
import { isValidTimeZone } from '@/lib/time';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

const MAX_PROFILE_SUMMARY = 2000;

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const fullUser = userQueries.findById(user.id);
  return NextResponse.json({
    profile_summary: fullUser?.profile_summary || '',
    call_time: fullUser?.call_time || '07:00',
    timezone: fullUser?.timezone || 'America/Vancouver',
    current_timezone: isValidTimeZone(fullUser?.current_timezone) ? fullUser!.current_timezone : null,
    data_consent: fullUser?.data_consent ?? 'privacy',
  });
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('profileUpdate', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  let body: { profile_summary?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { profile_summary } = body;
  const summary = profile_summary?.trim().slice(0, MAX_PROFILE_SUMMARY);
  if (!summary) return NextResponse.json({ error: 'Profile required' }, { status: 400 });

  userQueries.updateProfile(user.id, summary);
  memoryQueries.create(user.id, 'profile', `Profile updated: ${summary}`);

  return NextResponse.json({ success: true });
}
