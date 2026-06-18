import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { checkAdminAuth, checkAdminSecretAuth } from '@/lib/adminAuth';

function isAuthed(req: NextRequest): boolean {
  return checkAdminAuth(req) || checkAdminSecretAuth(req);
}

/**
 * GET /api/admin/facts?userId=<id>
 *
 * Diagnosis endpoint: returns total / active / retired fact counts + the 20 most
 * recently-retired facts. Use this to determine whether missing facts are:
 *   (a) soft-deleted (valid_until set) → recoverable via POST restore
 *   (b) hard-deleted (total=0) → need rebuild from transcripts / fact_history
 *
 * Also returns fact_history row count as a recovery data-point.
 */
export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = req.nextUrl.searchParams.get('userId');
  const email   = req.nextUrl.searchParams.get('email');

  if (!userId && !email)
    return NextResponse.json({ error: 'userId or email required' }, { status: 400 });

  const db = getDb();

  // Resolve userId from email if needed.
  let uid: number | null = userId ? Number(userId) : null;
  if (!uid && email) {
    const row = db.prepare(
      "SELECT id FROM users WHERE email = ? OR name LIKE ? LIMIT 1"
    ).get(email, `%${email.split('@')[0]}%`) as { id: number } | undefined;
    if (!row) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    uid = row.id;
  }

  const total   = (db.prepare('SELECT COUNT(*) as n FROM facts WHERE user_id=?').get(uid) as { n: number }).n;
  const active  = (db.prepare('SELECT COUNT(*) as n FROM facts WHERE user_id=? AND valid_until IS NULL').get(uid) as { n: number }).n;
  const retired = (db.prepare('SELECT COUNT(*) as n FROM facts WHERE user_id=? AND valid_until IS NOT NULL').get(uid) as { n: number }).n;
  const historyCount = (db.prepare('SELECT COUNT(*) as n FROM fact_history WHERE user_id=?').get(uid) as { n: number }).n;

  // 20 most recently-retired facts (unencrypted entity/category for diagnosis; statement stays encrypted).
  const recentRetired = db.prepare(
    `SELECT id, category, entity, valid_until, valid_from, confidence, learned_at
     FROM facts WHERE user_id=? AND valid_until IS NOT NULL
     ORDER BY valid_until DESC LIMIT 20`
  ).all(uid) as Array<{ id: number; category: string; entity: string | null; valid_until: string; valid_from: string | null; confidence: string; learned_at: string }>;

  // Earliest and latest retirement timestamps (to bracket the incident window).
  const retireWindow = db.prepare(
    `SELECT MIN(valid_until) as earliest, MAX(valid_until) as latest
     FROM facts WHERE user_id=? AND valid_until IS NOT NULL`
  ).get(uid) as { earliest: string | null; latest: string | null } | undefined;

  return NextResponse.json({
    userId: uid,
    counts: { total, active, retired },
    historyCount,
    retireWindow,
    recentRetired,
    diagnosis: total === 0
      ? 'HARD_DELETED — facts truly gone; rebuild from fact_history or transcripts'
      : active === 0 && retired > 0
        ? 'ALL_RETIRED — all facts have valid_until set; POST /restore with windowHours to un-retire'
        : active < total
          ? `PARTIAL_RETIRED — ${active} active, ${retired} retired`
          : 'HEALTHY — no issue detected',
  });
}

/**
 * POST /api/admin/facts/restore
 * Body: { userId: number, windowHours?: number (default 48), dryRun?: boolean }
 *
 * Un-retires facts that were retired within the last `windowHours` hours by clearing
 * their valid_until. Safe to call multiple times (idempotent on already-active facts).
 *
 * dryRun=true shows what WOULD be restored without committing changes.
 */
export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { userId, windowHours = 48, dryRun = false } = await req.json() as {
    userId: number;
    windowHours?: number;
    dryRun?: boolean;
  };
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  const db = getDb();
  // Clamp to [1, 720] and coerce to a number, then BIND it as a parameter rather than
  // interpolating into SQL — defensive even though the clamp already prevents injection.
  const wh = Math.max(1, Math.min(720, Number(windowHours) || 48));

  const candidates = db.prepare(
    `SELECT id, category, entity, valid_until FROM facts
     WHERE user_id=? AND valid_until IS NOT NULL AND valid_until >= datetime('now', ?)
     ORDER BY valid_until DESC`
  ).all(userId, `-${wh} hours`) as Array<{ id: number; category: string; entity: string | null; valid_until: string }>;

  if (dryRun) {
    return NextResponse.json({ dryRun: true, wouldRestore: candidates.length, candidates });
  }

  if (candidates.length === 0) {
    return NextResponse.json({ restored: 0, message: `No facts retired in the last ${windowHours} hours` });
  }

  const ids = candidates.map(c => c.id);
  // Un-retire: clear valid_until so they become active again.
  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(
    `UPDATE facts SET valid_until = NULL WHERE user_id=? AND id IN (${placeholders})`
  ).run(userId, ...ids);

  console.log(`[admin/facts] Restored ${result.changes} facts for user ${userId} (window: ${windowHours}h)`);

  return NextResponse.json({
    restored: result.changes,
    windowHours,
    restoredIds: ids,
  });
}
