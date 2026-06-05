import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { userQueries } from '@/lib/db';
import { deduplicateCalendarEvents } from '@/lib/calendar';

async function checkAdmin() {
  const cookieStore = await cookies();
  return cookieStore.get('edg3_admin')?.value === process.env.ADMIN_PASSWORD;
}

export async function POST(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { userId } = await req.json();
  const user = userQueries.findById(userId);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const deleted = await deduplicateCalendarEvents(userId, user.timezone);
  return NextResponse.json({ deleted, count: deleted.length });
}
