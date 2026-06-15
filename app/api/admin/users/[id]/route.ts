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

    // Delete all user-related data before removing the user row.
    // Order: leaf tables first (no outbound FKs), users last.
    db.prepare('DELETE FROM calendar_plan_executions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM daily_focus WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM event_energy_tags WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM calendar_scores WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM energy_profile WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM focus_milestones WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM energy_log WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM whoop_tokens WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM calendar_tokens WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM gmail_drafts_log WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM watched_threads WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM audit_log WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM facts WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM briefings WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM preview_briefings WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM memories WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM priorities WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM tasks WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM undo_log WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM event_dedupe_keys WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM delete_confirm_tokens WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Admin delete user error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
