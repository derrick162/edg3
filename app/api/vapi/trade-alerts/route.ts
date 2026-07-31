import { NextRequest, NextResponse } from 'next/server';
import { tradeAlertQueries } from '@/lib/db';

// C14 (2) — definitions feed the trade-monitor watcher polls to know which conditions to watch.
// GET /api/vapi/trade-alerts?status=active   header: x-trade-alert-key
// Returns active alert DEFINITIONS only (no user PII beyond the ticker/level): [{id,symbol,direction,level,note}].
//
// Core builds the handler; Security (S10) hardens the auth to a constant-time compare + audit log.
// Until S10 lands, this is a straight env-key check — and returns 401 whenever the key is unset,
// so it can never serve data without a configured secret.
export async function GET(req: NextRequest) {
  const expected = process.env.TRADE_ALERT_KEY;
  const provided = req.headers.get('x-trade-alert-key');
  if (!expected || !provided || provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Only 'active' is meaningful for the watcher; accept the param for forward-compat, default active.
  const status = new URL(req.url).searchParams.get('status') ?? 'active';
  if (status !== 'active') return NextResponse.json({ alerts: [] });

  let alerts: Array<{ id: number; symbol: string; type: string; direction: string | null; level: number; note: string | null }> = [];
  try {
    alerts = tradeAlertQueries.listAllActive().map(a => ({
      id: a.id, symbol: a.symbol, type: a.type, direction: a.direction, level: a.level, note: a.note,
    }));
  } catch { /* degrade to empty — never 500 the watcher's poll */ }

  return NextResponse.json({ alerts });
}
