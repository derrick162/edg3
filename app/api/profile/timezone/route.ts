import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { userQueries } from '@/lib/db';

// Set or clear the user's "current timezone" travel override. Pass a null/empty
// current_timezone to clear it (back to home timezone).
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { current_timezone?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const tz = body.current_timezone;
  // Basic guard: must look like an IANA zone (contains "/") or be a clear "clear" signal.
  if (tz && (typeof tz !== 'string' || !tz.includes('/'))) {
    return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 });
  }

  userQueries.setCurrentTimezone(user.id, tz || null);
  return NextResponse.json({ success: true, current_timezone: tz || null });
}
