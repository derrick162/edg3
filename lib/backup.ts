import path from 'node:path';
import fs from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
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

// ── Off-box backup: push DB snapshot to S3-compatible object storage ──────────
//
// Activated by setting four env vars (see below). Compatible with AWS S3,
// Cloudflare R2, and any S3-compatible endpoint.
//
// Required env vars:
//   BACKUP_S3_ENDPOINT  — e.g. "https://s3.amazonaws.com" or
//                         "https://<accountId>.r2.cloudflarestorage.com"
//   BACKUP_S3_BUCKET    — bucket name
//   BACKUP_S3_ACCESS_KEY — S3/R2 access key ID
//   BACKUP_S3_SECRET_KEY — S3/R2 secret access key
//
// Optional:
//   BACKUP_S3_REGION    — defaults to "auto" (correct for R2; use "us-east-1" for S3)
//   BACKUP_S3_PREFIX    — object key prefix, defaults to "backups/"
//
// Restore steps (documented here so Kevin can execute in an emergency):
//   1. Download the latest object from the bucket: `aws s3 cp s3://<bucket>/backups/edg3-<ts>.db ./restore.db`
//      (or via the R2 dashboard if AWS CLI unavailable)
//   2. Stop the Railway service.
//   3. Replace data/edg3.db with restore.db on the Railway volume.
//   4. Restart the Railway service.
//   5. Run `npm run preflight` locally against a copy to verify integrity before cutover.

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function hexEncode(buf: Buffer): string {
  return buf.toString('hex');
}

export async function pushBackupToObjectStorage(info: BackupInfo): Promise<{ ok: boolean; message: string }> {
  const endpoint  = process.env.BACKUP_S3_ENDPOINT?.replace(/\/$/, '');
  const bucket    = process.env.BACKUP_S3_BUCKET;
  const accessKey = process.env.BACKUP_S3_ACCESS_KEY;
  const secretKey = process.env.BACKUP_S3_SECRET_KEY;
  const region    = process.env.BACKUP_S3_REGION ?? 'auto';
  const prefix    = process.env.BACKUP_S3_PREFIX ?? 'backups/';

  if (!endpoint || !bucket || !accessKey || !secretKey) {
    return { ok: false, message: 'Off-box backup not configured (set BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY, BACKUP_S3_SECRET_KEY)' };
  }

  const filePath = path.join(BACKUP_DIR, info.file);
  if (!fs.existsSync(filePath)) {
    return { ok: false, message: `Backup file not found: ${info.file}` };
  }
  const body = fs.readFileSync(filePath);
  const objectKey = `${prefix}${info.file}`;
  const host = new URL(endpoint).host;
  const urlPath = `/${bucket}/${objectKey}`;

  // AWS Signature V4 — standard signing flow
  const now = new Date();
  const dateStr   = now.toISOString().slice(0, 10).replace(/-/g, '');   // YYYYMMDD
  const datetimeStr = now.toISOString().replace(/[:-]/g, '').slice(0, 15) + 'Z'; // YYYYMMDDTHHmmssZ
  const bodyHash  = createHash('sha256').update(body).digest('hex');

  const sortedHeaders = ([
    ['content-type',            'application/octet-stream'],
    ['host',                    host],
    ['x-amz-content-sha256',    bodyHash],
    ['x-amz-date',              datetimeStr],
  ] as [string, string][]).sort(([a], [b]) => a.localeCompare(b));

  const signedHeaderNames = sortedHeaders.map(([k]) => k).join(';');
  const canonicalHeaders  = sortedHeaders.map(([k, v]) => `${k}:${v}`).join('\n') + '\n';
  const canonicalRequest  = ['PUT', urlPath, '', canonicalHeaders, signedHeaderNames, bodyHash].join('\n');
  const scope = `${dateStr}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    datetimeStr,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const signingKey = hmacSha256(
    hmacSha256(hmacSha256(hmacSha256(`AWS4${secretKey}`, dateStr), region), 's3'),
    'aws4_request',
  );
  const signature = hexEncode(hmacSha256(signingKey, stringToSign));
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaderNames}, Signature=${signature}`;

  try {
    const res = await fetch(`${endpoint}${urlPath}`, {
      method: 'PUT',
      headers: {
        'Authorization':        authorization,
        'Content-Type':         'application/octet-stream',
        'Host':                 host,
        'x-amz-content-sha256': bodyHash,
        'x-amz-date':           datetimeStr,
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, message: `S3 PUT failed: HTTP ${res.status} — ${text.slice(0, 200)}` };
    }
    return { ok: true, message: `Pushed ${info.file} (${info.sizeBytes} bytes) to ${bucket}/${objectKey}` };
  } catch (err) {
    return { ok: false, message: `S3 PUT error: ${err}` };
  }
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
    const tables = [
      'users', 'briefings', 'calendar_tokens', 'whoop_tokens',
      'priorities', 'focus_milestones', 'memories', 'tasks', 'facts',
      'open_loops', 'notifications', 'daily_focus', 'calendar_scores',
      'audit_log', 'waitlist',
      'energy_profile', 'event_energy_tags', 'calendar_plan_executions',
      'undo_log', 'gmail_drafts_log',
    ];
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

// Fire-and-forget: on-volume snapshot at most once per ~20h, then off-box push.
// Safe to call from the 3am cron; no-ops if a fresh backup already exists and never throws.
export async function maybeDailyBackup(): Promise<void> {
  try {
    const newest = listBackupFiles()[0];
    if (newest) {
      const ageMs = Date.now() - new Date(newest.createdAt).getTime();
      if (ageMs < 20 * 60 * 60 * 1000) {
        // On-volume backup is fresh — still attempt off-box push in case prior push failed.
        const offBox = await pushBackupToObjectStorage(newest);
        if (offBox.ok) console.log(`[backup] Off-box push (existing): ${offBox.message}`);
        else if (offBox.message.includes('not configured')) {/* silently skip */}
        else console.error(`[backup] Off-box push failed: ${offBox.message}`);
        return;
      }
    }
    const info = await createBackup();
    console.log(`[backup] Daily snapshot created: ${info.file} (${info.sizeBytes} bytes)`);
    // Push to object storage immediately after creating the snapshot.
    const offBox = await pushBackupToObjectStorage(info);
    if (offBox.ok) console.log(`[backup] Off-box push: ${offBox.message}`);
    else if (offBox.message.includes('not configured')) {/* silently skip — env vars not set */}
    else console.error(`[backup] Off-box push failed: ${offBox.message}`);
  } catch (err) {
    console.error('[backup] Daily snapshot failed:', err);
  }
}
