import { NextRequest, NextResponse } from 'next/server';
import { userQueries } from '@/lib/db';
import { deduplicateCalendarEvents } from '@/lib/calendar';
import { checkAdminAuth } from '@/lib/adminAuth';

export async function POST(req: NextRequest) {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { userId } = await req.json();
  const user = userQueries.findById(userId);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const deleted = await deduplicateCalendarEvents(userId, user.timezone);
  return NextResponse.json({ deleted, count: deleted.length });
}
