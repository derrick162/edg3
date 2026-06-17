import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { getDb, DB_PATH } from './db';

// On-volume SQLite snapshots with rotation.
//
// Scope + honesty: this protects against the common failures — DB corruption, an
// accidental bad migration, a fat-fingered delete — by keeping consistent, restorable
// point-in-time copies. It does NOT protect against losing the whole Railway volume,
// because the snapshots live on that same volume. Off-box continuous replication
// (Litestream → object storage) remains the ops follow-up for volume-loss durability;
// see ROADMAP "SQLite durability". This is the code-side half we can ship today.

export const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), 'backups');
const KEEP = Math.max(1, parseInt(process.env.BACKUP_KEEP || '14', 10) || 14);

function ts(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export interface BackupInfo { file: string; sizeBytes: number; createdAt: string; }

// Take a consistent snapshot of the live DB (better-sqlite3's online backup handles WAL).
export async function createBackup(): Promise<BackupInfo> {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const dest = path.join(BACKUP_DIR, `edg3-${ts()}.db`);
  // .backup() is added by better-sqlite3; types lag, so call via an indexed cast.
  await (getDb() as unknown as { backup: (p: string) => Promise<unknown> }).backup(dest);
  rotate();
  const stat = fs.statSync(dest);
  return { file: path.basename(dest), sizeBytes: stat.size, createdAt: stat.mtime.toISOString() };
}

// Keep only the newest KEEP snapshots; delete the rest.
function rotate(): void {
  const files = listBackupFiles();
  for (const f of files.slice(KEEP)) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, f.file)); } catch { /* best effort */ }
  }
}

function listBackupFiles(): BackupInfo[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('edg3-') && f.endsWith('.db'))
    .map(f => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return { file: f, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest first
}

export function listBackups(): BackupInfo[] {
  return listBackupFiles();
}

// Returns true when off-box Litestream replication is configured (LITESTREAM_S3_BUCKET set).
// Used by the admin endpoint to show replication status without revealing the secret.
export function litstreamEnabled(): boolean {
  return !!process.env.LITESTREAM_S3_BUCKET;
}

export interface VerifyResult {
  valid: boolean;
  file: string;
  sizeBytes: number;
  rowCounts: Record<string, number>;
  integrityOk: boolean;
  error?: string;
}

// Open a backup snapshot as a SEPARATE read-only connection (never touching the live DB)
// and verify it's a coherent, queryable database. Safe to call while the app is running.
//
// Used by the admin endpoint to confirm a backup is restorable before a drill or failover.
// The row counts here should roughly match the live DB — a significant mismatch signals
// the backup is stale or corrupt.
export function verifyBackup(fileName: string): VerifyResult {
  const filePath = path.join(BACKUP_DIR, path.basename(fileName)); // basename = no path traversal
  const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  if (!stat) {
    return { valid: false, file: fileName, sizeBytes: 0, rowCounts: {}, integrityOk: false, error: 'File not found' };
  }

  let bdb: Database.Database | null = null;
  try {
    bdb = new Database(filePath, { readonly: true });

    // SQLite integrity check — catches corruption, truncation, page errors.
    const integrityRow = bdb.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    const integrityOk = integrityRow.integrity_check === 'ok';

    // Row counts on key tables — gives a sanity-check signal for restore viability.
    const tables = ['users', 'briefings', 'calendar_tokens', 'whoop_tokens', 'priorities', 'memories', 'tasks', 'facts', 'open_loops', 'audit_log', 'waitlist'];
    const rowCounts: Record<string, number> = {};
    for (const t of tables) {
      try {
        const row = bdb.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number };
        rowCounts[t] = row.n;
      } catch {
        rowCounts[t] = -1; // table missing in old schema backup
      }
    }

    return { valid: integrityOk, file: fileName, sizeBytes: stat.size, rowCounts, integrityOk };
  } catch (err) {
    return { valid: false, file: fileName, sizeBytes: stat.size, rowCounts: {}, integrityOk: false, error: String(err) };
  } finally {
    bdb?.close();
  }
}

// Fire-and-forget: snapshot at most once per ~20h. Safe to call on every daily
// trigger; it no-ops if a recent backup already exists and never throws.
export async function maybeDailyBackup(): Promise<void> {
  try {
    const newest = listBackupFiles()[0];
    if (newest) {
      const ageMs = Date.now() - new Date(newest.createdAt).getTime();
      if (ageMs < 20 * 60 * 60 * 1000) return; // a fresh-enough backup already exists
    }
    const info = await createBackup();
    console.log(`[backup] Daily snapshot created: ${info.file} (${info.sizeBytes} bytes)`);
  } catch (err) {
    console.error('[backup] Daily snapshot failed:', err);
  }
}
