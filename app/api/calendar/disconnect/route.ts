import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { disconnectCalendar } from '@/lib/calendar';
import { auditLogQueries } from '@/lib/db';
import { checkRateLimit, rateLimitResponse, getClientIP } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('calendarDisconnect', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  try {
    await disconnectCalendar(user.id);
    auditLogQueries.record({ userId: user.id, action: 'calendarDisconnect', argsJson: '{}', ok: true });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Calendar disconnect error:', err);
    auditLogQueries.record({ userId: user.id, action: 'calendarDisconnect', argsJson: '{}', ok: false, resultText: String(err) });
    return NextResponse.json({ error: 'Failed to disconnect calendar' }, { status: 500 });
  }
}
