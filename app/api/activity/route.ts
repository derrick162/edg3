import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { auditLogQueries, undoQueries } from '@/lib/db';
import { buildActivityItems } from '@/lib/activityLabels';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Fetch enough rows from both tables to cover the last 50 visible items.
  // Time-based undo matching happens in buildActivityItems (within ±2 s).
  const auditRows = auditLogQueries.recent(user.id, 200);
  const undoRows = undoQueries.listRecent(user.id, 200);
  const items = buildActivityItems(auditRows, undoRows, 50);

  return NextResponse.json({ items });
}
