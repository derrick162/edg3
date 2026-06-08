import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { userQueries, memoryQueries } from '@/lib/db';
import { isValidTimeZone } from '@/lib/time';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const fullUser = userQueries.findById(user.id);
  return NextResponse.json({
    profile_summary: fullUser?.profile_summary || '',
    call_time: fullUser?.call_time || '07:00',
    timezone: fullUser?.timezone || 'America/Vancouver',
    current_timezone: isValidTimeZone(fullUser?.current_timezone) ? fullUser!.current_timezone : null,
  });
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { profile_summary?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { profile_summary } = body;
  if (!profile_summary?.trim()) return NextResponse.json({ error: 'Profile required' }, { status: 400 });

  userQueries.updateProfile(user.id, profile_summary.trim());
  memoryQueries.create(user.id, 'profile', `Profile updated: ${profile_summary.trim()}`);

  return NextResponse.json({ success: true });
}
