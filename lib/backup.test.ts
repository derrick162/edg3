/**
 * Unit tests for lib/backup.ts.
 *
 * Focuses on security-critical invariants:
 * - verifyBackup neutralizes path traversal via path.basename before joining with BACKUP_DIR
 * - verifyBackup rowCounts covers all required user-data tables
 * - litstreamEnabled reflects the env var correctly
 * - maybeDailyBackup never throws (fire-and-forget contract)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

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
// Must use `function` keyword — arrow functions don't work correctly as `new` constructors.
vi.mock('better-sqlite3', () => {
  // eslint-disable-next-line prefer-arrow-callback
  const MockDatabase = vi.fn(function () {
    return {
      prepare: (_sql: string) => ({ get: () => ({ integrity_check: 'ok', n: 0 }) }),
      exec: vi.fn(),
      close: vi.fn(),
    };
  });
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

// ── verifyBackup — table coverage ────────────────────────────────────────────
//
// Verifies that all expected user-data tables appear in rowCounts when a backup
// file physically exists (the better-sqlite3 mock returns n=0 for every query).
// Guards against regressions where a new table is added to the schema but not
// to the verification list (silent -1 in the admin endpoint).

const REQUIRED_TABLES = [
  'users', 'briefings', 'calendar_tokens', 'whoop_tokens',
  'priorities', 'focus_milestones', 'memories', 'tasks', 'facts',
  'open_loops', 'notifications', 'daily_focus', 'calendar_scores',
  'audit_log', 'waitlist',
  'energy_profile', 'event_energy_tags', 'calendar_plan_executions',
  'undo_log', 'gmail_drafts_log',
  // Newer tables — now auto-covered because verifyBackup derives its list from
  // USER_SCOPED_DELETE_ORDER. Guards against a backup silently missing recent schema.
  'episodes', 'briefing_context_packs', 'call_attempts', 'failed_webhooks',
  'background_job_failures', 'fact_history', 'support_messages',
];

describe('verifyBackup — table coverage', () => {
  const tmpDir = path.join(os.tmpdir(), 'edg3-coverage-test');
  const fileName = 'edg3-coverage.db';

  afterEach(() => {
    vi.resetModules();
    delete process.env.BACKUP_DIR;
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  });

  it('rowCounts includes all required user-data tables', async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, fileName), '');
    process.env.BACKUP_DIR = tmpDir;

    const { verifyBackup } = await import('./backup');
    const result = verifyBackup(fileName);

    for (const t of REQUIRED_TABLES) {
      expect(result.rowCounts, `expected rowCounts to include '${t}'`).toHaveProperty(t);
    }
  });

  it('rowCounts does NOT include the stale "milestones" key (table is "focus_milestones")', async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, fileName), '');
    process.env.BACKUP_DIR = tmpDir;

    const { verifyBackup } = await import('./backup');
    const result = verifyBackup(fileName);

    expect(result.rowCounts).not.toHaveProperty('milestones');
    expect(result.rowCounts).toHaveProperty('focus_milestones');
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

// ── pushBackupToObjectStorage ─────────────────────────────────────────────────
//
// Off-box backup: push DB snapshot to S3-compatible object storage.
// Implemented with manual AWS Signature V4 (no SDK dependency).

describe('pushBackupToObjectStorage — not configured', () => {
  const S3_ENV_VARS = [
    'BACKUP_S3_ENDPOINT', 'BACKUP_S3_BUCKET', 'BACKUP_S3_ACCESS_KEY', 'BACKUP_S3_SECRET_KEY',
  ];

  afterEach(() => {
    vi.resetModules();
    S3_ENV_VARS.forEach(k => delete process.env[k]);
    delete process.env.BACKUP_DIR;
  });

  it('returns ok=false with "not configured" when env vars are absent', async () => {
    S3_ENV_VARS.forEach(k => delete process.env[k]);
    const { pushBackupToObjectStorage } = await import('./backup');
    const info = { file: 'edg3-test.db', sizeBytes: 100, createdAt: new Date().toISOString() };
    const result = await pushBackupToObjectStorage(info);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not configured/i);
  });

  it('returns ok=false when the backup file does not exist on disk', async () => {
    S3_ENV_VARS.forEach(k => { process.env[k] = 'test-value'; });
    process.env.BACKUP_S3_ENDPOINT = 'https://test.r2.cloudflarestorage.com';
    process.env.BACKUP_S3_BUCKET   = 'test-bucket';
    process.env.BACKUP_DIR = path.join(os.tmpdir(), 'edg3-s3-test-nonexistent');
    vi.resetModules();
    const { pushBackupToObjectStorage } = await import('./backup');
    const info = { file: 'nonexistent.db', sizeBytes: 0, createdAt: new Date().toISOString() };
    const result = await pushBackupToObjectStorage(info);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not found/i);
  });
});

describe('pushBackupToObjectStorage — S3 PUT request', () => {
  const tmpDir = path.join(os.tmpdir(), 'edg3-s3-push-test');
  const fileName = 'edg3-push-test.db';
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, fileName), 'fake-db-content');
    process.env.BACKUP_DIR           = tmpDir;
    process.env.BACKUP_S3_ENDPOINT   = 'https://test.example.cloudflarestorage.com';
    process.env.BACKUP_S3_BUCKET     = 'edg3-backups';
    process.env.BACKUP_S3_ACCESS_KEY = 'test-access-key';
    process.env.BACKUP_S3_SECRET_KEY = 'test-secret-key-32charminimum0000';
    process.env.BACKUP_S3_REGION     = 'auto';
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 200 })
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.resetModules();
    ['BACKUP_S3_ENDPOINT', 'BACKUP_S3_BUCKET', 'BACKUP_S3_ACCESS_KEY', 'BACKUP_S3_SECRET_KEY',
     'BACKUP_S3_REGION', 'BACKUP_S3_PREFIX', 'BACKUP_DIR'].forEach(k => delete process.env[k]);
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns ok=true and calls fetch with PUT when file exists and S3 responds 200', async () => {
    const { pushBackupToObjectStorage } = await import('./backup');
    const info = { file: fileName, sizeBytes: 16, createdAt: new Date().toISOString() };
    const result = await pushBackupToObjectStorage(info);
    expect(result.ok).toBe(true);
    expect(result.message).toContain(fileName);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(fileName);
    expect(opts.method).toBe('PUT');
  });

  it('includes an AWS4-HMAC-SHA256 Authorization header', async () => {
    const { pushBackupToObjectStorage } = await import('./backup');
    const info = { file: fileName, sizeBytes: 16, createdAt: new Date().toISOString() };
    await pushBackupToObjectStorage(info);
    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers['Authorization']).toMatch(/^AWS4-HMAC-SHA256/);
    expect(headers['Authorization']).toContain('test-access-key');
    expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
  });

  it('returns ok=false when S3 returns a non-200 status', async () => {
    fetchSpy.mockResolvedValue(new Response('AccessDenied', { status: 403 }));
    const { pushBackupToObjectStorage } = await import('./backup');
    const info = { file: fileName, sizeBytes: 16, createdAt: new Date().toISOString() };
    const result = await pushBackupToObjectStorage(info);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/403/);
  });

  it('returns ok=false when fetch throws (network error)', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
    const { pushBackupToObjectStorage } = await import('./backup');
    const info = { file: fileName, sizeBytes: 16, createdAt: new Date().toISOString() };
    const result = await pushBackupToObjectStorage(info);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/ECONNREFUSED/);
  });

  it('uses the BACKUP_S3_PREFIX env var as the object key prefix', async () => {
    process.env.BACKUP_S3_PREFIX = 'prod-backups/2026/';
    vi.resetModules();
    const { pushBackupToObjectStorage } = await import('./backup');
    const info = { file: fileName, sizeBytes: 16, createdAt: new Date().toISOString() };
    await pushBackupToObjectStorage(info);
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('prod-backups/2026/');
  });
});
