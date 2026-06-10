import { NextRequest, NextResponse } from 'next/server';
import { auditLogQueries } from '@/lib/db';
import { checkAdminAuth } from '@/lib/adminAuth';

// GET /api/admin/audit
// Query params:
//   userId  — filter to a specific user (optional)
//   limit   — max rows to return (default 100, max 500)
//   action  — filter to a specific action name (optional)
//   failures — "1" to show only failed actions (ok=0)
export async function GET(req: NextRequest) {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const userId = params.get('userId') ? Number(params.get('userId')) : null;
  const limitRaw = Math.min(Number(params.get('limit') || '100'), 500);
  const limit = isNaN(limitRaw) || limitRaw <= 0 ? 100 : limitRaw;
  const action = params.get('action') || null;
  const failuresOnly = params.get('failures') === '1';

  try {
    let rows = userId
      ? auditLogQueries.recent(userId, limit)
      : auditLogQueries.recentAll(limit);

    if (action) rows = rows.filter(r => r.action === action);
    if (failuresOnly) rows = rows.filter(r => r.ok === 0);

    return NextResponse.json({ count: rows.length, entries: rows });
  } catch (err) {
    console.error('[admin/audit] Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
