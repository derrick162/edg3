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

function resolveKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const raw = process.env.DATA_ENCRYPTION_KEY?.trim();
  if (!raw) { cachedKey = null; return null; }
  // Accept a 32-byte key as hex (64 chars) or base64; otherwise derive one via scrypt.
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) key = Buffer.from(raw, 'hex');
  else {
    const b64 = (() => { try { return Buffer.from(raw, 'base64'); } catch { return Buffer.alloc(0); } })();
    key = b64.length === 32 ? b64 : scryptSync(raw, APP_SALT, 32);
  }
  cachedKey = key;
  return key;
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
