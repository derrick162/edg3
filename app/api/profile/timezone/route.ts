import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { userQueries, auditLogQueries } from '@/lib/db';
import { isValidTimeZone } from '@/lib/time';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

// Set or clear the user's "current timezone" travel override. Pass a null/empty
// current_timezone to clear it (back to home timezone).
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('profileTimezone', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  let body: { current_timezone?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const tz = body.current_timezone;
  if (tz && !isValidTimeZone(tz)) {
    return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 });
  }

  userQueries.setCurrentTimezone(user.id, tz || null);
  auditLogQueries.record({ userId: user.id, action: 'updateTimezone', argsJson: JSON.stringify({ current_timezone: tz || null }), ok: true });
  return NextResponse.json({ success: true, current_timezone: tz || null });
}
