import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The key is resolved once and cached per module instance, so each test that needs a
// different key state resets the module registry and re-imports with the env it wants.
const KEY = 'a'.repeat(64); // 32 bytes as hex

async function load(key?: string) {
  vi.resetModules();
  if (key === undefined) delete process.env.DATA_ENCRYPTION_KEY;
  else process.env.DATA_ENCRYPTION_KEY = key;
  return import('./crypto');
}

afterEach(() => { delete process.env.DATA_ENCRYPTION_KEY; });

describe('crypto field encryption', () => {
  it('round-trips a value with a key set', async () => {
    const { encryptField, decryptField, isEncrypted } = await load(KEY);
    const plain = 'ya29.secret-google-token';
    const enc = encryptField(plain);
    expect(enc).not.toBe(plain);
    expect(isEncrypted(enc)).toBe(true);
    expect(decryptField(enc)).toBe(plain);
  });

  it('produces a different ciphertext each time (random IV) but same plaintext', async () => {
    const { encryptField, decryptField } = await load(KEY);
    const a = encryptField('hello');
    const b = encryptField('hello');
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe('hello');
    expect(decryptField(b)).toBe('hello');
  });

  it('passes plaintext through unchanged when no key is configured', async () => {
    const { encryptField, decryptField, isEncrypted, encryptionEnabled } = await load(undefined);
    expect(encryptionEnabled()).toBe(false);
    const plain = 'no-key-plaintext';
    expect(encryptField(plain)).toBe(plain);
    expect(isEncrypted(encryptField(plain))).toBe(false);
    expect(decryptField(plain)).toBe(plain); // legacy plaintext still readable
  });

  it('reads legacy plaintext transparently even when a key IS set', async () => {
    const { decryptField } = await load(KEY);
    expect(decryptField('legacy-plaintext-value')).toBe('legacy-plaintext-value');
  });

  it('does not double-encrypt an already-encrypted value', async () => {
    const { encryptField } = await load(KEY);
    const once = encryptField('abc');
    expect(encryptField(once)).toBe(once);
  });

  it('detects tampering via the GCM auth tag', async () => {
    const { encryptField, decryptField } = await load(KEY);
    const enc = encryptField('integrity-matters');
    // Flip a character in the base64 body to corrupt the ciphertext/tag.
    const body = enc.slice('enc:1:'.length);
    const tampered = 'enc:1:' + (body[0] === 'A' ? 'B' : 'A') + body.slice(1);
    expect(() => decryptField(tampered)).toThrow();
  });

  it('handles empty and nullable values', async () => {
    const { encryptField, encryptNullable, decryptNullable } = await load(KEY);
    expect(encryptField('')).toBe('');
    expect(encryptNullable(null)).toBe(null);
    expect(decryptNullable(null)).toBe(null);
    const enc = encryptNullable('x')!;
    expect(decryptNullable(enc)).toBe('x');
  });

  it('derives a key from a non-hex/base64 passphrase', async () => {
    const { encryptField, decryptField, encryptionEnabled } = await load('my-long-passphrase-secret');
    expect(encryptionEnabled()).toBe(true);
    const enc = encryptField('derived-key-test');
    expect(decryptField(enc)).toBe('derived-key-test');
  });
});

describe('STRICT_ENCRYPTION mode', () => {
  afterEach(() => {
    delete process.env.DATA_ENCRYPTION_KEY;
    delete process.env.STRICT_ENCRYPTION;
  });

  it('passes plaintext through when STRICT_ENCRYPTION is unset and no key configured', async () => {
    vi.resetModules();
    delete process.env.DATA_ENCRYPTION_KEY;
    delete process.env.STRICT_ENCRYPTION;
    const { encryptField } = await import('./crypto');
    expect(encryptField('sensitive')).toBe('sensitive');
  });

  it('throws when STRICT_ENCRYPTION=1 and DATA_ENCRYPTION_KEY is not set', async () => {
    vi.resetModules();
    delete process.env.DATA_ENCRYPTION_KEY;
    process.env.STRICT_ENCRYPTION = '1';
    const { encryptField } = await import('./crypto');
    expect(() => encryptField('sensitive')).toThrow(/STRICT_ENCRYPTION/);
  });

  it('encrypts normally when STRICT_ENCRYPTION=1 and key IS set', async () => {
    vi.resetModules();
    process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.STRICT_ENCRYPTION = '1';
    const { encryptField, isEncrypted } = await import('./crypto');
    expect(isEncrypted(encryptField('sensitive'))).toBe(true);
  });
});

// ── safeDecryptField — graceful degradation ───────────────────────────────────
//
// The briefing path uses safeDecryptField so a missing/rotated DATA_ENCRYPTION_KEY
// returns an empty string rather than crashing the 7am call.

describe('safeDecryptField — graceful degradation', () => {
  afterEach(() => {
    delete process.env.DATA_ENCRYPTION_KEY;
    delete process.env.STRICT_ENCRYPTION;
  });

  it('decrypts normally when the key matches', async () => {
    const { encryptField, safeDecryptField } = await load(KEY);
    const enc = encryptField('hello');
    expect(safeDecryptField(enc, 'test.field')).toBe('hello');
  });

  it('returns empty string instead of throwing when key is missing on encrypted data', async () => {
    // Encrypt with a key, then reload WITHOUT the key → decryption fails gracefully.
    const { encryptField } = await load(KEY);
    const enc = encryptField('sensitive-value');

    vi.resetModules();
    delete process.env.DATA_ENCRYPTION_KEY;
    const { safeDecryptField } = await import('./crypto');
    expect(safeDecryptField(enc, 'fact.statement')).toBe('');
  });

  it('returns empty string when key is rotated (different key) on encrypted data', async () => {
    const { encryptField } = await load(KEY);
    const enc = encryptField('sensitive-value');

    vi.resetModules();
    process.env.DATA_ENCRYPTION_KEY = 'b'.repeat(64); // different key
    const { safeDecryptField } = await import('./crypto');
    expect(safeDecryptField(enc, 'memory.content')).toBe('');
  });

  it('passes through plaintext without error', async () => {
    const { safeDecryptField } = await load(KEY);
    expect(safeDecryptField('legacy-plaintext', 'test.field')).toBe('legacy-plaintext');
  });

  it('returns empty string for empty input', async () => {
    const { safeDecryptField } = await load(KEY);
    expect(safeDecryptField('', 'test.field')).toBe('');
  });
});

describe('safeDecryptNullable — graceful degradation', () => {
  afterEach(() => { delete process.env.DATA_ENCRYPTION_KEY; });

  it('returns null for null input', async () => {
    const { safeDecryptNullable } = await load(KEY);
    expect(safeDecryptNullable(null, 'test.field')).toBe(null);
  });

  it('returns null for undefined input', async () => {
    const { safeDecryptNullable } = await load(KEY);
    expect(safeDecryptNullable(undefined, 'test.field')).toBe(null);
  });

  it('decrypts a non-null value normally', async () => {
    const { encryptField, safeDecryptNullable } = await load(KEY);
    const enc = encryptField('nullable-value');
    expect(safeDecryptNullable(enc, 'test.field')).toBe('nullable-value');
  });

  it('returns null instead of throwing when key is missing on encrypted nullable data', async () => {
    const { encryptField } = await load(KEY);
    const enc = encryptField('nullable-sensitive');

    vi.resetModules();
    delete process.env.DATA_ENCRYPTION_KEY;
    const { safeDecryptNullable } = await import('./crypto');
    expect(safeDecryptNullable(enc, 'episode.content_raw')).toBe(null);
  });
});
