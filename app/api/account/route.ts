import { NextRequest, NextResponse } from 'next/server';
import { getSession, clearSessionCookie } from '@/lib/auth';
import { getDb } from '@/lib/db';

const CONFIRM_PHRASE = 'delete my account';

// Permanently deletes the authenticated user's account and all associated data.
// Requires { "confirm": "delete my account" } in the request body — an explicit
// contract so Core's UI must collect an intentional confirmation before calling this.
export async function DELETE(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { body = {}; }

  if (!body || typeof body !== 'object' || (body as Record<string, unknown>)['confirm'] !== CONFIRM_PHRASE) {
    return NextResponse.json(
      { error: `Missing confirmation. Send { "confirm": "${CONFIRM_PHRASE}" } to proceed.` },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    const userId = user.id;

    // Delete leaf tables first (no outbound FK dependencies to users), users row last.
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

    // Clear the session cookie — the user no longer exists.
    const response = NextResponse.json({ success: true });
    response.cookies.set(clearSessionCookie());
    return response;
  } catch (err) {
    console.error('Account deletion error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
