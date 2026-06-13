// Production health checks for the /api/admin/health endpoint.
// Logic lives here (not in the route) so it's unit-testable with relative imports.
//
// Checks are tiered:
//   critical  — encryption, JWT secret, DB connectivity (app fundamentally broken without these)
//   high      — replication, Vapi secret enforcement (data/security risks if absent)
//
// runHealthChecks() accepts an optional dbChecker injection so tests don't need a real DB.

import { getDb } from './db';

export interface HealthCheck { ok: boolean; detail: string }

export interface HealthReport {
  status: 'ok' | 'degraded' | 'critical';
  checks: Record<string, HealthCheck>;
}

// Default DB checker — runs a cheap count on the live DB.
function defaultDbCheck(): HealthCheck {
  try {
    const row = getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    return { ok: true, detail: `DB reachable — ${row.n} user(s)` };
  } catch (err) {
    return { ok: false, detail: `DB error: ${String(err)}` };
  }
}

export function runHealthChecks(
  dbChecker: () => HealthCheck = defaultDbCheck,
): HealthReport {
  const checks: Record<string, HealthCheck> = {};

  // [CRITICAL] At-rest encryption
  const encOn = !!process.env.DATA_ENCRYPTION_KEY?.trim();
  checks.encryption = {
    ok: encOn,
    detail: encOn
      ? 'DATA_ENCRYPTION_KEY is set — at-rest encryption active'
      : '⚠ DATA_ENCRYPTION_KEY not set — new writes stored as plaintext',
  };

  // [CRITICAL] Session signing
  const jwtOk = !!process.env.JWT_SECRET?.trim();
  checks.jwtSecret = {
    ok: jwtOk,
    detail: jwtOk ? 'JWT_SECRET is set' : '⚠ JWT_SECRET not set — sessions cannot be signed',
  };

  // [CRITICAL] DB connectivity
  checks.dbConnectivity = dbChecker();

  // [HIGH] Off-box replication
  const lsOn = !!process.env.LITESTREAM_S3_BUCKET?.trim();
  checks.replication = {
    ok: lsOn,
    detail: lsOn
      ? 'LITESTREAM_S3_BUCKET is set — Litestream S3 replication active'
      : '⚠ LITESTREAM_S3_BUCKET not set — no off-box backup running',
  };

  // [HIGH] Vapi webhook secret enforcement
  const vapiOk = process.env.VAPI_SECRET_ENFORCE === 'true';
  checks.vapiSecretEnforce = {
    ok: vapiOk,
    detail: vapiOk
      ? 'VAPI_SECRET_ENFORCE=true — Vapi webhook auth enforced'
      : '⚠ VAPI_SECRET_ENFORCE not "true" — Vapi webhook in fail-open mode',
  };

  const CRITICAL = new Set(['encryption', 'jwtSecret', 'dbConnectivity']);
  const critical  = [...CRITICAL].some(k => !checks[k]?.ok);
  const anyFail   = Object.values(checks).some(c => !c.ok);
  const status    = critical ? 'critical' : anyFail ? 'degraded' : 'ok';

  return { status, checks };
}
