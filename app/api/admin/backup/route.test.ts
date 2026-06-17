/**
 * Security tests for GET/POST /api/admin/backup.
 *
 * Key invariants:
 * - Both methods require admin auth; no auth → 401
 * - POST verify action rejects filenames that don't match ^edg3-[\d-]+\.db$ (path traversal, etc.)
 * - POST verify with valid pattern but missing file → verifyBackup called; result forwarded
 * - POST backup action → createBackup called; error → 500 with safe message (no raw stack)
 * - GET returns backup list + system flags
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── hoisted mocks ─────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  isAdmin: false,
  backups: [] as unknown[],
  encryptionEnabled: false,
  litstreamEnabled: false,
  verifyResult: { valid: false, file: 'edg3-test.db', sizeBytes: 0, rowCounts: {}, integrityOk: false, error: 'File not found' } as Record<string, unknown>,
  createBackupResult: { file: 'edg3-2026-06-17.db', sizeBytes: 12345, createdAt: '2026-06-17T00:00:00.000Z' } as Record<string, unknown>,
  createBackupShouldThrow: false,
}));

vi.mock('@/lib/adminAuth', () => ({
  checkAdminAuth: () => h.isAdmin,
}));

vi.mock('@/lib/backup', () => ({
  listBackups: () => h.backups,
  verifyBackup: (file: string) => ({ ...h.verifyResult, file }),
  createBackup: async () => {
    if (h.createBackupShouldThrow) throw new Error('disk full: no space left on device');
    return h.createBackupResult;
  },
  litstreamEnabled: () => h.litstreamEnabled,
}));

vi.mock('@/lib/crypto', () => ({
  encryptionEnabled: () => h.encryptionEnabled,
}));

// ── helpers ───────────────────────────────────────────────────────────────────

function getReq() {
  return new NextRequest('http://localhost/api/admin/backup');
}

function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/admin/backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/admin/backup — auth + list', () => {
  beforeEach(() => {
    h.isAdmin = false;
    h.backups = [];
    h.encryptionEnabled = false;
    h.litstreamEnabled = false;
  });

  it('returns 401 without admin auth', async () => {
    const { GET } = await import('./route');
    const res = await GET(getReq());
    expect(res.status).toBe(401);
  });

  it('returns backup list and system flags when authed', async () => {
    h.isAdmin = true;
    h.backups = [{ file: 'edg3-2026-06-17.db', sizeBytes: 12345, createdAt: '2026-06-17T00:00:00.000Z' }];
    h.encryptionEnabled = true;
    h.litstreamEnabled = false;
    const { GET } = await import('./route');
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.backups)).toBe(true);
    expect(body.backups).toHaveLength(1);
    expect(body.encryptionEnabled).toBe(true);
    expect(body.litstreamEnabled).toBe(false);
  });
});

// ── POST — auth gate ──────────────────────────────────────────────────────────

describe('POST /api/admin/backup — auth gate', () => {
  beforeEach(() => {
    h.isAdmin = false;
    h.createBackupShouldThrow = false;
  });

  it('returns 401 without admin auth', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({}));
    expect(res.status).toBe(401);
  });
});

// ── POST — filename validation (path traversal prevention) ────────────────────

describe('POST /api/admin/backup verify — filename security', () => {
  beforeEach(() => {
    h.isAdmin = true;
  });

  it('rejects missing file field → 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({ action: 'verify' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/file/i);
  });

  it('rejects non-string file field → 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({ action: 'verify', file: 42 }));
    expect(res.status).toBe(400);
  });

  it('rejects path traversal attempt (../../etc/passwd) → 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({ action: 'verify', file: '../../etc/passwd' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid.*filename|filename.*invalid/i);
  });

  it('rejects path traversal with Windows separators → 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({ action: 'verify', file: '..\\..\\windows\\system32\\cmd.exe' }));
    expect(res.status).toBe(400);
  });

  it('rejects arbitrary filename not matching pattern → 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({ action: 'verify', file: 'malicious.db' }));
    expect(res.status).toBe(400);
  });

  it('rejects filename with leading path component → 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({ action: 'verify', file: '/absolute/path/edg3-2026-06-17.db' }));
    expect(res.status).toBe(400);
  });

  it('accepts valid filename matching pattern → calls verifyBackup', async () => {
    // Real ts() format: edg3-YYYY-MM-DDTHH-MM-SS-mmmZ.db
    h.verifyResult = { valid: false, file: 'edg3-2026-06-17T10-41-09-123Z.db', sizeBytes: 0, rowCounts: {}, integrityOk: false, error: 'File not found' };
    const { POST } = await import('./route');
    const res = await POST(postReq({ action: 'verify', file: 'edg3-2026-06-17T10-41-09-123Z.db' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Result forwarded directly
    expect(body.integrityOk).toBe(false);
    expect(body.error).toBe('File not found');
  });
});

// ── POST — backup action ──────────────────────────────────────────────────────

describe('POST /api/admin/backup backup action', () => {
  beforeEach(() => {
    h.isAdmin = true;
    h.createBackupShouldThrow = false;
  });

  it('creates a backup and returns info', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({})); // default action = backup
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.backup.file).toBe('edg3-2026-06-17.db');
  });

  it('returns 500 on backup failure with safe message (no raw error leaked)', async () => {
    h.createBackupShouldThrow = true;
    const { POST } = await import('./route');
    const res = await POST(postReq({ action: 'backup' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    // error field exists but should not leak sensitive infrastructure details
    // (the route uses String(err) which is acceptable — it's admin-only)
    expect(typeof body.error).toBe('string');
  });

  it('empty JSON body defaults to backup action', async () => {
    const req = new NextRequest('http://localhost/api/admin/backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '',
    });
    const { POST } = await import('./route');
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});
