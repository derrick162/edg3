import { NextRequest, NextResponse } from 'next/server';
import { getDb, decryptBriefingRow } from '@/lib/db';
import { checkAdminAuth } from '@/lib/adminAuth';

export async function GET(req: NextRequest) {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = req.nextUrl.searchParams.get('userId');
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '10');
  const failedOnly = req.nextUrl.searchParams.get('failed') === '1';

  const db = getDb();
  const SELECT = 'SELECT id, user_id, status, scheduled_for, edge_promises, tool_actions, calendar_actions, user_response, learning_status, created_at FROM briefings';
  const FAIL_CLAUSE = `(learning_status LIKE '%_ok":false%')`;

  let query: string;
  let params: unknown[];
  if (userId && failedOnly) {
    query = `${SELECT} WHERE user_id = ? AND ${FAIL_CLAUSE} ORDER BY id DESC LIMIT ?`;
    params = [userId, limit];
  } else if (userId) {
    query = `${SELECT} WHERE user_id = ? ORDER BY id DESC LIMIT ?`;
    params = [userId, limit];
  } else if (failedOnly) {
    query = `${SELECT} WHERE ${FAIL_CLAUSE} ORDER BY id DESC LIMIT ?`;
    params = [limit];
  } else {
    query = `${SELECT} ORDER BY id DESC LIMIT ?`;
    params = [limit];
  }

  const briefings = db.prepare(query).all(...params) as Array<{ user_response?: string | null }>;

  // Decrypt the encrypted PII column (user_response) at rest before returning.
  return NextResponse.json({ briefings: briefings.map(decryptBriefingRow) });
}
