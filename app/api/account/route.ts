import { NextRequest, NextResponse } from 'next/server';
import { getSession, clearSessionCookie } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

const CONFIRM_PHRASE = 'delete my account';

// Permanently deletes the authenticated user's account and all associated data.
// Requires { "confirm": "delete my account" } in the request body — an explicit
// contract so Core's UI must collect an intentional confirmation before calling this.
export async function DELETE(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('accountDelete', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

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
    // Explicit deletes are belt-and-suspenders: CASCADE handles most tables, but
    // briefing_context_packs has no ON DELETE CASCADE so it MUST be deleted explicitly
    // or the users DELETE will fail (foreign_keys = ON is active).
    db.prepare('DELETE FROM open_loops WHERE user_id = ?').run(userId);
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
    db.prepare('DELETE FROM oauth_state WHERE user_id = ?').run(userId);
    // Tables added after initial deletion route — must be explicit (briefing_context_packs
    // has no ON DELETE CASCADE; others cascade but are listed for completeness).
    db.prepare('DELETE FROM briefing_context_packs WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM episodes WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM people_profiles WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM pattern_cache WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM failed_webhooks WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM background_job_failures WHERE user_id = ?').run(userId);
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
