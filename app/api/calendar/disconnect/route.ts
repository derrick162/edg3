import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { disconnectCalendar } from '@/lib/calendar';

export async function POST() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await disconnectCalendar(user.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Calendar disconnect error:', err);
    return NextResponse.json({ error: 'Failed to disconnect calendar' }, { status: 500 });
  }
}
