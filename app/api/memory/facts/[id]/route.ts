import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { factQueries, auditLogQueries } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

type Params = { params: Promise<{ id: string }> };

const MAX_STATEMENT = 500;
const MAX_ENTITY    = 200;

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('factEdit', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id) || id < 1) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  let body: { statement?: unknown; entity?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { statement, entity } = body;
  if (typeof statement !== 'string' || !statement.trim()) {
    return NextResponse.json({ error: 'statement required' }, { status: 400 });
  }
  if (statement.trim().length > MAX_STATEMENT) {
    return NextResponse.json(
      { error: `statement must be ${MAX_STATEMENT} characters or fewer` },
      { status: 400 },
    );
  }
  if (entity !== null && entity !== undefined && typeof entity !== 'string') {
    return NextResponse.json({ error: 'entity must be a string or null' }, { status: 400 });
  }
  const entityStr = typeof entity === 'string' ? entity.trim().slice(0, MAX_ENTITY) || null : null;

  // Read existing fact (for audit; confirms ownership via user_id scope).
  const existing = factQueries.getById(user.id, id);
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  factQueries.updateFact(user.id, id, statement.trim(), entityStr);

  auditLogQueries.record({
    userId: user.id,
    action: 'fact_update',
    argsJson: JSON.stringify({ factId: id, category: existing.category }),
    resultText: `Updated fact in category "${existing.category}"`,
    ok: true,
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('factEdit', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id) || id < 1) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  // Read existing fact (confirms ownership + checks source).
  const existing = factQueries.getById(user.id, id);
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Priority-sync facts are managed by the priorities flow — block direct deletion.
  if (existing.source === 'priority-sync') {
    return NextResponse.json(
      { error: 'This fact comes from your priorities — update them in the Priorities tab instead.' },
      { status: 409 },
    );
  }

  factQueries.deleteFact(user.id, id);

  auditLogQueries.record({
    userId: user.id,
    action: 'fact_delete',
    argsJson: JSON.stringify({ factId: id, category: existing.category, entity: existing.entity }),
    resultText: `Deleted fact in category "${existing.category}"`,
    ok: true,
  });

  return NextResponse.json({ success: true });
}
