import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    call_time: user.call_time,
    timezone: user.timezone,
    onboarding_complete: user.onboarding_complete === 1,
    has_profile: !!user.profile_summary,
  });
}
