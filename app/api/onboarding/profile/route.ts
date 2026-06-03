import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { userQueries, memoryQueries } from '@/lib/db';

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { profile_summary } = await req.json();
  if (!profile_summary?.trim()) {
    return NextResponse.json({ error: 'Profile summary required' }, { status: 400 });
  }

  userQueries.updateProfile(user.id, profile_summary.trim());
  memoryQueries.create(user.id, 'profile', profile_summary.trim());

  return NextResponse.json({ success: true });
}
