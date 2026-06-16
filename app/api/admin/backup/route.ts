import { NextRequest, NextResponse } from 'next/server';
import { createBackup, listBackups, verifyBackup, litstreamEnabled } from '@/lib/backup';
import { encryptionEnabled } from '@/lib/crypto';
import { checkAdminAuth } from '@/lib/adminAuth';

// GET — list snapshots + system durability status.
// Returns:
//   backups          — on-volume snapshots (newest first)
//   encryptionEnabled — at-rest encryption active (DATA_ENCRYPTION_KEY set)
//   litstreamEnabled — off-box S3 replication active (LITESTREAM_S3_BUCKET set)
export async function GET(req: NextRequest) {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({
    backups: listBackups(),
    encryptionEnabled: encryptionEnabled(),
    litstreamEnabled: litstreamEnabled(),
  });
}

// POST — trigger an on-volume snapshot or verify an existing one.
//
// Body: { action?: 'backup' | 'verify'; file?: string }
//   action='backup' (default) — create a fresh snapshot now.
//   action='verify', file='edg3-2026-...db' — open the snapshot read-only, run
//     integrity_check, and return row counts. Use this for the restore drill:
//     trigger a backup, then verify it to confirm it's restorable.
export async function POST(req: NextRequest) {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { action?: string; file?: string } = {};
  try { body = await req.json(); } catch { /* empty body = default action */ }

  if (body.action === 'verify') {
    const file = body.file;
    if (!file || typeof file !== 'string') {
      return NextResponse.json({ error: 'file is required for verify action' }, { status: 400 });
    }
    // Reject filenames that don't match the backup naming pattern (defense-in-depth
    // alongside verifyBackup's path.basename guard).
    if (!/^edg3-[\d-]+\.db$/.test(file)) {
      return NextResponse.json({ error: 'Invalid backup filename' }, { status: 400 });
    }
    const result = verifyBackup(file);
    return NextResponse.json(result);
  }

  // Default: take a fresh snapshot.
  try {
    const info = await createBackup();
    return NextResponse.json({ success: true, backup: info });
  } catch (err) {
    console.error('[admin/backup] Failed:', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
