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
