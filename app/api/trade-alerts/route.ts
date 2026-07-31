import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tradeAlertQueries } from '@/lib/db';

// C14 (5) — read-only feed for the dashboard "Active alerts" sidebar card. Voice-only management,
// so this is GET-only; there are no mutate routes here (set/cancel happen by voice).
export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let alerts: Array<{ id: number; symbol: string; direction: string; level: number; note: string | null; created_at: string }> = [];
  try {
    alerts = tradeAlertQueries.listActive(user.id).map(a => ({
      id: a.id, symbol: a.symbol, direction: a.direction, level: a.level, note: a.note, created_at: a.created_at,
    }));
  } catch { /* degrade to empty */ }
  return NextResponse.json({ alerts });
}
