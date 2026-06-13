import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runHealthChecks } from './healthCheck';

// DB checker stub — avoids needing a real SQLite connection.
const okDb = () => ({ ok: true, detail: 'DB reachable — 1 user(s)' });
const failDb = () => ({ ok: false, detail: 'DB error: SQLITE_CANTOPEN' });

// Helpers to set / restore env vars per test.
function setEnv(vars: Record<string, string | undefined>) {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

// Full-green env baseline.
const GREEN_ENV: Record<string, string> = {
  DATA_ENCRYPTION_KEY: 'a'.repeat(64),
  JWT_SECRET: 'test-secret',
  LITESTREAM_S3_BUCKET: 'my-bucket',
  VAPI_SECRET_ENFORCE: 'true',
};

describe('runHealthChecks', () => {
  let restore: () => void;

  beforeEach(() => { restore = setEnv(GREEN_ENV); });
  afterEach(() => restore());

  it('returns status ok when all checks pass', () => {
    const report = runHealthChecks(okDb);
    expect(report.status).toBe('ok');
    expect(Object.values(report.checks).every(c => c.ok)).toBe(true);
  });

  it('returns status critical and flags encryption when DATA_ENCRYPTION_KEY is unset', () => {
    restore(); restore = setEnv({ ...GREEN_ENV, DATA_ENCRYPTION_KEY: undefined });
    const report = runHealthChecks(okDb);
    expect(report.status).toBe('critical');
    expect(report.checks.encryption.ok).toBe(false);
    expect(report.checks.encryption.detail).toMatch(/plaintext/);
  });

  it('returns status critical when JWT_SECRET is unset', () => {
    restore(); restore = setEnv({ ...GREEN_ENV, JWT_SECRET: undefined });
    const report = runHealthChecks(okDb);
    expect(report.status).toBe('critical');
    expect(report.checks.jwtSecret.ok).toBe(false);
  });

  it('returns status critical when DB check fails', () => {
    const report = runHealthChecks(failDb);
    expect(report.status).toBe('critical');
    expect(report.checks.dbConnectivity.ok).toBe(false);
  });

  it('returns status degraded (not critical) when only replication is missing', () => {
    restore(); restore = setEnv({ ...GREEN_ENV, LITESTREAM_S3_BUCKET: undefined });
    const report = runHealthChecks(okDb);
    expect(report.status).toBe('degraded');
    expect(report.checks.replication.ok).toBe(false);
    // Critical checks still pass → not critical.
    expect(report.checks.encryption.ok).toBe(true);
    expect(report.checks.jwtSecret.ok).toBe(true);
    expect(report.checks.dbConnectivity.ok).toBe(true);
  });

  it('returns status degraded when VAPI_SECRET_ENFORCE is not "true"', () => {
    restore(); restore = setEnv({ ...GREEN_ENV, VAPI_SECRET_ENFORCE: 'false' });
    const report = runHealthChecks(okDb);
    expect(report.status).toBe('degraded');
    expect(report.checks.vapiSecretEnforce.ok).toBe(false);
  });

  it('detail message confirms encryption is active when key is set', () => {
    const report = runHealthChecks(okDb);
    expect(report.checks.encryption.detail).toMatch(/active/);
  });

  it('includes all expected check keys in the report', () => {
    const report = runHealthChecks(okDb);
    const keys = Object.keys(report.checks);
    expect(keys).toContain('encryption');
    expect(keys).toContain('jwtSecret');
    expect(keys).toContain('dbConnectivity');
    expect(keys).toContain('replication');
    expect(keys).toContain('vapiSecretEnforce');
  });
});
