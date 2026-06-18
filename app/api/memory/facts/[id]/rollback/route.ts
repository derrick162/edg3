import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { factHistoryQueries, auditLogQueries } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('factEdit', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  const { id: idStr } = await params;
  const factId = parseInt(idStr, 10);
  if (!Number.isFinite(factId) || factId < 1) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  let body: { historyId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const historyId = typeof body.historyId === 'number' ? body.historyId : parseInt(String(body.historyId ?? ''), 10);
  if (!Number.isFinite(historyId) || historyId < 1) {
    return NextResponse.json({ error: 'historyId required' }, { status: 400 });
  }

  factHistoryQueries.rollbackFact(user.id, historyId);

  auditLogQueries.record({
    userId: user.id,
    action: 'fact_rollback',
    argsJson: JSON.stringify({ factId, historyId }),
    resultText: `Rolled back fact ${factId} to version ${historyId}`,
    ok: true,
  });

  return NextResponse.json({ ok: true });
}
