/**
 * Tests for T0-1 boot-time data-durability self-check (assessDurability).
 * The pure decision matrix is fully exercised here; the runner is best-effort I/O.
 */
import { describe, it, expect } from 'vitest';
import { assessDurability, assessEncryptionReadiness, DurabilityEnv } from './durability';

// A healthy prod baseline: off-box replication on, DB present + populated, on /data.
const healthyProd: DurabilityEnv = {
  nodeEnv: 'production',
  dbPath: '/data/edg3.db',
  litestreamBucket: 'edg3-prod-backups',
  backupS3Bucket: undefined,
  dbExistedAtBoot: true,
  dbUserCount: 12,
};

describe('assessDurability — local/dev', () => {
  it('returns ok and skips all checks when not production', () => {
    const r = assessDurability({ ...healthyProd, nodeEnv: 'development', litestreamBucket: undefined, dbExistedAtBoot: false, dbUserCount: 0 });
    expect(r.level).toBe('ok');
    expect(r.issues).toHaveLength(0);
    expect(r.summary).toContain('Local');
  });

  it('treats undefined nodeEnv as non-production', () => {
    const r = assessDurability({ ...healthyProd, nodeEnv: undefined, litestreamBucket: undefined, dbUserCount: 0 });
    expect(r.level).toBe('ok');
  });
});

describe('assessDurability — healthy prod', () => {
  it('returns ok when off-box replication is on and DB is populated', () => {
    const r = assessDurability(healthyProd);
    expect(r.level).toBe('ok');
    expect(r.issues).toHaveLength(0);
  });

  it('accepts BACKUP_S3_BUCKET as a valid off-box backup (no litestream)', () => {
    const r = assessDurability({ ...healthyProd, litestreamBucket: undefined, backupS3Bucket: 'edg3-snapshots' });
    expect(r.level).toBe('ok');
  });
});

describe('assessDurability — CRITICAL paths', () => {
  it('flags critical when no off-box replication is configured at all', () => {
    const r = assessDurability({ ...healthyProd, litestreamBucket: undefined, backupS3Bucket: undefined });
    expect(r.level).toBe('critical');
    expect(r.summary).toContain('CRITICAL');
    expect(r.issues.join(' ')).toContain('NO OFF-BOX REPLICATION');
  });

  it('flags critical when DB was absent at boot AND no replication', () => {
    const r = assessDurability({ ...healthyProd, litestreamBucket: undefined, backupS3Bucket: undefined, dbExistedAtBoot: false });
    expect(r.level).toBe('critical');
    expect(r.issues.join(' ')).toContain('EPHEMERAL');
  });

  it('flags critical when prod DB reports zero users', () => {
    const r = assessDurability({ ...healthyProd, dbUserCount: 0 });
    expect(r.level).toBe('critical');
    expect(r.issues.join(' ')).toContain('ZERO users');
  });

  it('combines multiple critical issues', () => {
    const r = assessDurability({
      ...healthyProd,
      litestreamBucket: undefined,
      backupS3Bucket: undefined,
      dbExistedAtBoot: false,
      dbUserCount: 0,
    });
    expect(r.level).toBe('critical');
    // no off-box + absent DB + zero users = 3 critical signals
    expect(r.issues.length).toBeGreaterThanOrEqual(3);
  });
});

describe('assessDurability — WARN paths', () => {
  it('warns (not critical) when DB absent at boot but replication is configured', () => {
    const r = assessDurability({ ...healthyProd, dbExistedAtBoot: false });
    expect(r.level).toBe('warn');
    expect(r.issues.join(' ')).toContain('Litestream restore');
  });

  it('warns when DB path is not under /data in prod', () => {
    const r = assessDurability({ ...healthyProd, dbPath: '/app/edg3.db' });
    expect(r.level).toBe('warn');
    expect(r.issues.join(' ')).toContain('not under /data');
  });

  it('critical takes precedence over warn', () => {
    // not on /data (warn) + no off-box (critical) → overall critical
    const r = assessDurability({ ...healthyProd, dbPath: '/app/edg3.db', litestreamBucket: undefined, backupS3Bucket: undefined });
    expect(r.level).toBe('critical');
  });
});

describe('assessDurability — null user count', () => {
  it('does not flag zero-users when count is null (table absent on first boot)', () => {
    // null count + replication on + DB existed → ok (genuine cold start handled gracefully)
    const r = assessDurability({ ...healthyProd, dbUserCount: null });
    expect(r.level).toBe('ok');
  });
});

describe('assessEncryptionReadiness — T0-2 step 3', () => {
  it('skips the check in local/dev', () => {
    const r = assessEncryptionReadiness({ nodeEnv: 'development', keyConfigured: false, strictMode: false });
    expect(r.level).toBe('ok');
    expect(r.summary).toContain('skipped');
  });

  it('is ok in prod when the key is configured', () => {
    const r = assessEncryptionReadiness({ nodeEnv: 'production', keyConfigured: true, strictMode: false });
    expect(r.level).toBe('ok');
    expect(r.summary).toContain('present');
  });

  it('is critical in prod when key missing (no strict) — plaintext risk', () => {
    const r = assessEncryptionReadiness({ nodeEnv: 'production', keyConfigured: false, strictMode: false });
    expect(r.level).toBe('critical');
    expect(r.summary).toContain('plaintext');
    expect(r.issues.join(' ')).toContain('PLAINTEXT');
  });

  it('is critical in prod when key missing with strict mode — writes will fail', () => {
    const r = assessEncryptionReadiness({ nodeEnv: 'production', keyConfigured: false, strictMode: true });
    expect(r.level).toBe('critical');
    expect(r.summary).toContain('writes will fail');
  });
});
