import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

// Field-level encryption for data at rest (OAuth tokens, call transcripts).
//
// Design goals:
//  - Transparent + backward compatible: legacy plaintext rows decrypt to themselves,
//    so we can roll this out without a migration and re-encrypt lazily on next write.
//  - Fail-safe rollout: if DATA_ENCRYPTION_KEY is unset, encryptField() is a no-op
//    pass-through (nothing breaks pre-config); decryptField() still reads plaintext.
//    Once the key is set, all new writes are encrypted.
//  - AES-256-GCM (authenticated): tamper-evident, per-value random IV.
//
// Stored format:  enc:1:<base64(iv[12] || authTag[16] || ciphertext)>

const PREFIX = 'enc:1:';
const APP_SALT = 'edg3-data-at-rest-v1'; // fixed salt is fine: key material comes from the env secret

let cachedKey: Buffer | null | undefined; // undefined = not resolved yet, null = no key configured

// Derive a 32-byte AES key from a raw secret string. Accepts a 32-byte key as hex (64 chars)
// or base64; otherwise derives one via scrypt. Pure — used by both the env-key path and the
// explicit-key path (key rotation), so the two can never disagree on key material.
export function deriveKeyFromRaw(raw: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  const b64 = (() => { try { return Buffer.from(raw, 'base64'); } catch { return Buffer.alloc(0); } })();
  return b64.length === 32 ? b64 : scryptSync(raw, APP_SALT, 32);
}

function resolveKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const raw = process.env.DATA_ENCRYPTION_KEY?.trim();
  if (!raw) { cachedKey = null; return null; }
  cachedKey = deriveKeyFromRaw(raw);
  return cachedKey;
}

// ── Explicit-key variants (KEY ROTATION ONLY) ───────────────────────────────────
// These take an explicit raw key string instead of the cached env key, so a rotation
// job can decrypt with the OLD key and re-encrypt with the NEW key in one pass. Do NOT
// use these on the hot path — encryptField/decryptField (env key) are the norm.

/** Encrypt with an explicit raw key. Same wire format as encryptField. */
export function encryptWithKey(plain: string, rawKey: string): string {
  if (plain == null || plain === '') return plain;
  if (isEncrypted(plain)) return plain; // already encrypted — don't double-wrap
  const key = deriveKeyFromRaw(rawKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

/** Decrypt with an explicit raw key. Plaintext (legacy) values pass through unchanged. */
export function decryptWithKey(value: string, rawKey: string): string {
  if (value == null || !isEncrypted(value)) return value;
  const key = deriveKeyFromRaw(rawKey);
  const buf = Buffer.from(value.slice(PREFIX.length), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export function isEncrypted(value: string): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

// Encrypt a value for storage. No-op (returns plaintext) when no key is configured,
// UNLESS STRICT_ENCRYPTION=1 — in which case a missing key is a hard error so a
// misconfigured prod deploy cannot silently persist plaintext.
export function encryptField(plain: string): string {
  if (plain == null || plain === '') return plain;
  if (isEncrypted(plain)) return plain; // already encrypted — don't double-wrap
  const key = resolveKey();
  if (!key) {
    if (process.env.STRICT_ENCRYPTION === '1') {
      throw new Error('STRICT_ENCRYPTION=1 but DATA_ENCRYPTION_KEY is not set — refusing to write plaintext.');
    }
    return plain;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

// Decrypt a stored value. Plaintext (legacy / pre-key) values pass through unchanged.
export function decryptField(value: string): string {
  if (value == null || !isEncrypted(value)) return value;
  const key = resolveKey();
  if (!key) throw new Error('DATA_ENCRYPTION_KEY is required to read encrypted data but is not set.');
  const buf = Buffer.from(value.slice(PREFIX.length), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

// Convenience for nullable columns.
export function encryptNullable(v: string | null | undefined): string | null {
  return v == null ? null : encryptField(v);
}
export function decryptNullable(v: string | null | undefined): string | null {
  return v == null ? null : decryptField(v);
}

// True when encryption is actually active (key configured). For diagnostics/health.
export function encryptionEnabled(): boolean {
  return resolveKey() !== null;
}

// Safe read for content fields in the briefing path. Logs the error prominently
// but returns empty string instead of throwing, so a missing/rotated key produces
// an empty fact/memory rather than a crashed 7am call. Do NOT use for auth secrets
// (OAuth tokens) — those should still throw to surface misconfiguration clearly.
export function safeDecryptField(value: string, field = 'unknown'): string {
  try { return decryptField(value); }
  catch (err) {
    console.error(`[crypto] DECRYPT_FAILURE field="${field}" — DATA_ENCRYPTION_KEY missing or rotated? ${err}`);
    return '';
  }
}

export function safeDecryptNullable(value: string | null | undefined, field = 'unknown'): string | null {
  if (value == null) return null;
  try { return decryptField(value); }
  catch (err) {
    console.error(`[crypto] DECRYPT_FAILURE field="${field}" (nullable) — DATA_ENCRYPTION_KEY missing or rotated? ${err}`);
    return null;
  }
}

// ── Key rotation (R11 T3) ───────────────────────────────────────────────────────
// Re-encrypt every encrypted-at-rest field from `oldKey` to `newKey`. Use when
// DATA_ENCRYPTION_KEY must change (leak, audit). See content/durability-runbook.md
// "Key Rotation". Iterates the authoritative ENCRYPTED_COLUMNS inventory in lib/db.ts —
// a missed column there would be permanently unreadable after the key swap, so that list
// is the single source of truth (guarded by lib/key-rotation.test.ts).
//
// Safety properties:
//  - Per-USER transaction: each user's cells re-key atomically (all-or-nothing per user).
//  - RESUMABLE: a cell that no longer decrypts with oldKey but DOES decrypt with newKey is
//    treated as already-rotated and skipped — so a re-run after a partial failure is safe.
//  - FAIL-LOUD: a cell that decrypts with NEITHER key aborts the run (possible corruption);
//    nothing for that user is written. Never silently drops data.
//  - dryRun: reads + verifies decryptability but writes nothing; returns the same summary.

export interface ReEncryptSummary {
  users: number;
  cellsReKeyed: number;
  cellsAlreadyRotated: number;
  cellsSkipped: number;             // null/empty/legacy-plaintext
  byColumn: Record<string, number>; // "table.column" → cells re-keyed
  dryRun: boolean;
}

function reKeyCell(
  value: string,
  oldKey: string,
  newKey: string,
): { next: string | null; status: 'rekeyed' | 'already' | 'skipped' } {
  if (value == null || value === '' || !isEncrypted(value)) return { next: null, status: 'skipped' };
  let plain: string;
  try {
    plain = decryptWithKey(value, oldKey);
  } catch {
    // Didn't decrypt with the old key — maybe this cell was already rotated (resumable re-run).
    try { decryptWithKey(value, newKey); return { next: null, status: 'already' }; }
    catch { throw new Error('cell decrypts with neither the old nor the new key — aborting (possible corruption or wrong keys)'); }
  }
  return { next: encryptWithKey(plain, newKey), status: 'rekeyed' };
}

export async function reEncryptAllUserData(
  oldKey: string,
  newKey: string,
  opts: { dryRun?: boolean } = {},
): Promise<ReEncryptSummary> {
  const dryRun = opts.dryRun ?? false;
  if (!oldKey || !newKey) throw new Error('reEncryptAllUserData: both oldKey and newKey are required');
  // Dynamic import avoids a static cycle (db.ts imports crypto.ts at module load).
  const { getDb, ENCRYPTED_COLUMNS } = await import('./db');
  const db = getDb();

  const userIds = (db.prepare('SELECT id FROM users ORDER BY id').all() as Array<{ id: number }>).map(u => u.id);
  const summary: ReEncryptSummary = {
    users: userIds.length, cellsReKeyed: 0, cellsAlreadyRotated: 0, cellsSkipped: 0, byColumn: {}, dryRun,
  };

  for (const userId of userIds) {
    console.log(`[key-rotation]${dryRun ? ' DRY-RUN' : ''} Re-encrypting user ${userId}...`);
    // Build all writes for this user first (the decrypt step throws BEFORE any write if a key
    // is wrong), then commit them in one transaction.
    const writes: Array<() => void> = [];
    for (const spec of ENCRYPTED_COLUMNS) {
      for (const col of spec.columns) {
        const rows = db.prepare(
          `SELECT ${spec.idColumn} AS id, ${col} AS val FROM ${spec.table} WHERE user_id = ? AND ${col} IS NOT NULL`
        ).all(userId) as Array<{ id: number | string; val: string }>;
        for (const row of rows) {
          const { next, status } = reKeyCell(row.val, oldKey, newKey);
          if (status === 'skipped') { summary.cellsSkipped++; continue; }
          if (status === 'already') { summary.cellsAlreadyRotated++; continue; }
          const k = `${spec.table}.${col}`;
          summary.byColumn[k] = (summary.byColumn[k] ?? 0) + 1;
          summary.cellsReKeyed++;
          const table = spec.table, idCol = spec.idColumn, id = row.id, value = next!;
          writes.push(() => { db.prepare(`UPDATE ${table} SET ${col} = ? WHERE ${idCol} = ?`).run(value, id); });
        }
      }
    }
    if (!dryRun && writes.length) {
      const tx = db.transaction(() => { for (const w of writes) w(); });
      tx();
    }
  }

  console.log(
    `[key-rotation]${dryRun ? ' DRY-RUN' : ''} complete — ${summary.cellsReKeyed} cells re-keyed, ` +
    `${summary.cellsAlreadyRotated} already-rotated, ${summary.cellsSkipped} skipped across ${summary.users} users`
  );
  return summary;
}
