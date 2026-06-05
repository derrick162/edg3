import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';

async function checkAdmin() {
  const cookieStore = await cookies();
  return cookieStore.get('edg3_admin')?.value === process.env.ADMIN_PASSWORD;
}

export async function GET(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = req.nextUrl.searchParams.get('userId');
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '10');

  const db = getDb();
  const query = userId
    ? 'SELECT id, user_id, status, scheduled_for, edge_promises, tool_actions, calendar_actions, user_response, created_at FROM briefings WHERE user_id = ? ORDER BY id DESC LIMIT ?'
    : 'SELECT id, user_id, status, scheduled_for, edge_promises, tool_actions, calendar_actions, user_response, created_at FROM briefings ORDER BY id DESC LIMIT ?';

  const briefings = userId
    ? db.prepare(query).all(userId, limit)
    : db.prepare(query).all(limit);

  return NextResponse.json({ briefings });
}
