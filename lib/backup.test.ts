/**
 * Unit tests for lib/backup.ts.
 *
 * Focuses on security-critical invariants:
 * - verifyBackup neutralizes path traversal via path.basename before joining with BACKUP_DIR
 * - litstreamEnabled reflects the env var correctly
 * - maybeDailyBackup never throws (fire-and-forget contract)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';

// ── hoisted mocks ─────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  backupShouldThrow: false,
}));

// Mock @/lib/db so backup.ts can load without a real DB file.
vi.mock('@/lib/db', () => ({
  DB_PATH: '/tmp/edg3-unit-test.db',
  getDb: () => ({
    backup: async (_dest: string) => {
      if (h.backupShouldThrow) throw new Error('ENOSPC: no space left on device');
    },
  }),
}));

// Mock better-sqlite3 (used by verifyBackup when opening a snapshot).
vi.mock('better-sqlite3', () => {
  const MockDatabase = vi.fn(() => ({
    prepare: (_sql: string) => ({ get: () => ({ integrity_check: 'ok', n: 0 }) }),
    exec: vi.fn(),
    close: vi.fn(),
  }));
  return { default: MockDatabase };
});

// ── path traversal guard ──────────────────────────────────────────────────────
//
// The security contract: verifyBackup uses path.basename(fileName) before joining
// with BACKUP_DIR. A traversal like "../../etc/passwd" becomes "passwd" which does
// not exist in BACKUP_DIR → returns { valid: false, error: 'File not found' }.

describe('verifyBackup — path traversal neutralization', () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env.BACKUP_DIR;
    delete process.env.LITESTREAM_S3_BUCKET;
  });

  it('strips path components from ../../etc/passwd → File not found', async () => {
    process.env.BACKUP_DIR = path.join(os.tmpdir(), 'edg3-traversal-test-1');
    const { verifyBackup } = await import('./backup');
    const result = verifyBackup('../../etc/passwd');
    // path.basename strips the traversal; 'passwd' doesn't exist in BACKUP_DIR
    expect(result.valid).toBe(false);
    expect(result.error).toBe('File not found');
    expect(result.sizeBytes).toBe(0);
  });

  it('strips Windows-style separators too', async () => {
    process.env.BACKUP_DIR = path.join(os.tmpdir(), 'edg3-traversal-test-2');
    const { verifyBackup } = await import('./backup');
    const result = verifyBackup('..\\..\\windows\\system32\\cmd.exe');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('File not found');
  });

  it('returns File not found for a nonexistent well-formed filename', async () => {
    process.env.BACKUP_DIR = path.join(os.tmpdir(), 'edg3-traversal-test-3');
    const { verifyBackup } = await import('./backup');
    const result = verifyBackup('edg3-2026-06-17T10-00-00-000Z.db');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('File not found');
    expect(result.integrityOk).toBe(false);
  });

  it('result always includes all expected fields (never throws)', async () => {
    process.env.BACKUP_DIR = path.join(os.tmpdir(), 'edg3-traversal-test-4');
    const { verifyBackup } = await import('./backup');
    const result = verifyBackup('edg3-missing.db');
    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('file');
    expect(result).toHaveProperty('sizeBytes');
    expect(result).toHaveProperty('rowCounts');
    expect(result).toHaveProperty('integrityOk');
    expect(result).toHaveProperty('error');
  });
});

// ── litstreamEnabled ──────────────────────────────────────────────────────────

describe('litstreamEnabled — reflects env var', () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env.LITESTREAM_S3_BUCKET;
  });

  it('returns false when LITESTREAM_S3_BUCKET is not set', async () => {
    delete process.env.LITESTREAM_S3_BUCKET;
    const { litstreamEnabled } = await import('./backup');
    expect(litstreamEnabled()).toBe(false);
  });

  it('returns true when LITESTREAM_S3_BUCKET is set to any non-empty value', async () => {
    process.env.LITESTREAM_S3_BUCKET = 'my-backup-bucket';
    vi.resetModules();
    const { litstreamEnabled } = await import('./backup');
    expect(litstreamEnabled()).toBe(true);
  });
});

// ── maybeDailyBackup — fire-and-forget contract ───────────────────────────────

describe('maybeDailyBackup — never throws', () => {
  afterEach(() => {
    vi.resetModules();
    h.backupShouldThrow = false;
    delete process.env.BACKUP_DIR;
  });

  it('does not throw when the underlying backup fails (disk full scenario)', async () => {
    h.backupShouldThrow = true;
    // Point to an empty temp dir so listBackupFiles() returns [] → maybeDailyBackup tries createBackup
    process.env.BACKUP_DIR = path.join(os.tmpdir(), 'edg3-empty-backup-dir-for-test');
    const { maybeDailyBackup } = await import('./backup');
    await expect(maybeDailyBackup()).resolves.toBeUndefined();
  });

  it('succeeds silently when there are no existing backups', async () => {
    h.backupShouldThrow = false;
    process.env.BACKUP_DIR = path.join(os.tmpdir(), 'edg3-no-backup-dir');
    const { maybeDailyBackup } = await import('./backup');
    await expect(maybeDailyBackup()).resolves.toBeUndefined();
  });
});
