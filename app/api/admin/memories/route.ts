import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';

async function checkAdmin() {
  const cookieStore = await cookies();
  const adminCookie = cookieStore.get('edg3_admin');
  return adminCookie?.value === process.env.ADMIN_PASSWORD;
}

export async function DELETE(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

export async function GET(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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
