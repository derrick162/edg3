import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { checkAdminAuth } from '@/lib/adminAuth';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const userId = parseInt(id, 10);
    if (isNaN(userId)) {
      return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
    }

    const db = getDb();

    // Delete all related data
    db.prepare('DELETE FROM briefings WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM memories WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM priorities WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM tasks WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM calendar_tokens WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Admin delete user error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
