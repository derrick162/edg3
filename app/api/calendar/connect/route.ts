import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getAuthUrl } from '@/lib/calendar';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!process.env.GOOGLE_CLIENT_ID) {
    return NextResponse.json({ error: 'Google Calendar not configured' }, { status: 503 });
  }

  const url = getAuthUrl();
  return NextResponse.json({ url });
}
