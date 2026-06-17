import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { revokeWhoopAccess } from '@/lib/whoop';
import { auditLogQueries } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('whoopDisconnect', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  try {
    await revokeWhoopAccess(user.id);
    auditLogQueries.record({ userId: user.id, action: 'whoopDisconnect', argsJson: '{}', ok: true });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Whoop disconnect error:', err);
    auditLogQueries.record({ userId: user.id, action: 'whoopDisconnect', argsJson: '{}', ok: false, resultText: String(err) });
    return NextResponse.json({ error: 'Failed to disconnect Whoop' }, { status: 500 });
  }
}
