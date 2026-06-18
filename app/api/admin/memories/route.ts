import { NextRequest, NextResponse } from 'next/server';
import { getDb, userQueries } from '@/lib/db';
import { checkAdminAuth } from '@/lib/adminAuth';
import { cleanupGoalFacts, cleanupPeopleFacts } from '@/lib/facts';

export async function DELETE(req: NextRequest) {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { keyword, userId } = await req.json();
  if (!keyword) return NextResponse.json({ error: 'keyword required' }, { status: 400 });

  const db = getDb();
  const query = userId
    ? "DELETE FROM memories WHERE user_id = ? AND content LIKE ?"
    : "DELETE FROM memories WHERE content LIKE ?";
  const params = userId ? [userId, `%${keyword}%`] : [`%${keyword}%`];
  const result = db.prepare(query).run(...params);

  return NextResponse.json({ deleted: result.changes });
}

export async function POST(req: NextRequest) {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { userId, type, content } = await req.json();
  if (!userId || !content) return NextResponse.json({ error: 'userId and content required' }, { status: 400 });

  const db = getDb();
  const result = db.prepare(
    'INSERT INTO memories (user_id, type, content) VALUES (?, ?, ?)'
  ).run(userId, type || 'calendar_note', content);

  return NextResponse.json({ id: result.lastInsertRowid });
}

// PATCH — run fact dedup cleanup for a user (goals + people consolidation).
// Called once to fix existing duplicate goal facts (e.g. "30-60-90 plan" × N).
export async function PATCH(req: NextRequest) {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { userId, userName } = await req.json();
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
  const user = userQueries.findById(userId);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const goalResult = cleanupGoalFacts(userId);
  const peopleResult = await cleanupPeopleFacts(userId, userName ?? user.name);
  return NextResponse.json({ goalsRemoved: goalResult.removed, peopleRemoved: peopleResult.removed });
}

export async function GET(req: NextRequest) {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const keyword = req.nextUrl.searchParams.get('keyword') || '';
  const userId = req.nextUrl.searchParams.get('userId');

  const db = getDb();
  const query = userId
    ? "SELECT id, user_id, type, content, created_at FROM memories WHERE user_id = ? AND content LIKE ? ORDER BY created_at DESC LIMIT 50"
    : "SELECT id, user_id, type, content, created_at FROM memories WHERE content LIKE ? ORDER BY created_at DESC LIMIT 50";
  const params = userId ? [userId, `%${keyword}%`] : [`%${keyword}%`];
  const memories = db.prepare(query).all(...params);

  return NextResponse.json({ memories });
}
