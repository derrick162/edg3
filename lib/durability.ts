/**
 * T0-1 — Boot-time data-durability self-check.
 *
 * The single biggest production risk is silent data loss: if the Railway volume
 * at /data is ephemeral AND off-box replication (Litestream) is not configured,
 * every redeploy wipes the database with zero visibility. This module converts
 * that silent risk into a LOUD, queryable signal:
 *   - logged at CRITICAL on every boot (visible in Railway logs)
 *   - written to the health_log table (surfaced by the 6am health digest)
 *
 * The off-box replication itself lives in start.sh + litestream.yml. This check
 * does NOT replace it — it verifies it's actually active and alarms if it isn't.
 *
 * `assessDurability` is pure (no I/O) so the full decision matrix is unit-tested.
 * `runStartupDurabilityCheck` gathers the real environment + DB stats and logs.
 */

import fs from 'fs';

export interface DurabilityEnv {
  /** process.env.NODE_ENV — 'production' on Railway */
  nodeEnv?: string;
  /** Resolved DB file path (DB_PATH). On Railway this is /data/edg3.db */
  dbPath: string;
  /** LITESTREAM_S3_BUCKET — continuous WAL replication (primary off-box backup) */
  litestreamBucket?: string;
  /** BACKUP_S3_BUCKET — daily snapshot push (secondary off-box backup) */
  backupS3Bucket?: string;
  /** Did the DB file exist BEFORE this process opened it? false = fresh/ephemeral volume */
  dbExistedAtBoot: boolean;
  /** users-table row count, or null if it couldn't be read */
  dbUserCount: number | null;
}

export interface DurabilityAssessment {
  level: 'ok' | 'warn' | 'critical';
  issues: string[];
  /** one-line summary for logs + health_log */
  summary: string;
}

/**
 * Pure decision matrix. Given the boot environment, classify durability risk.
 * Local dev (nodeEnv !== 'production') is always 'ok' — ephemeral local data is fine.
 */
export function assessDurability(env: DurabilityEnv): DurabilityAssessment {
  const isProd = env.nodeEnv === 'production';
  const hasOffBox = Boolean(env.litestreamBucket) || Boolean(env.backupS3Bucket);
  const looksLikeVolume = env.dbPath.startsWith('/data');

  const critical: string[] = [];
  const warn: string[] = [];

  if (!isProd) {
    return { level: 'ok', issues: [], summary: 'Local/dev environment — durability checks skipped' };
  }

  // ── CRITICAL: no off-box backup at all ─────────────────────────────────────
  // Volume loss = database AND any on-volume backup gone simultaneously.
  if (!hasOffBox) {
    critical.push(
      'NO OFF-BOX REPLICATION — LITESTREAM_S3_BUCKET and BACKUP_S3_BUCKET are both unset. ' +
      'A volume loss or ephemeral-volume redeploy means TOTAL, UNRECOVERABLE data loss.',
    );
  }

  // ── CRITICAL: fresh DB at boot in prod ─────────────────────────────────────
  // If the file didn't exist when we booted, either (a) this is the very first
  // deploy, or (b) the volume is ephemeral and we just lost everything. With
  // off-box replication, start.sh should have restored before boot — so a
  // still-missing file means restore failed or replication isn't really active.
  if (!env.dbExistedAtBoot) {
    if (hasOffBox) {
      warn.push(
        'DB file was absent at boot despite off-box replication being configured — ' +
        'Litestream restore should have run in start.sh. Verify the restore succeeded ' +
        '(check [start] logs) and that this is not silent data loss.',
      );
    } else {
      critical.push(
        'DB file was absent at boot AND no off-box replication is configured — ' +
        'if this is not the first-ever deploy, the volume is EPHEMERAL and data was just lost.',
      );
    }
  }

  // ── CRITICAL: prod DB has zero users ───────────────────────────────────────
  // A populated prod DB should never drop to zero users. Strong data-loss signal.
  if (env.dbUserCount === 0) {
    critical.push(
      'Production DB reports ZERO users — strong indicator of data loss or a fresh ephemeral volume.',
    );
  }

  // ── WARN: DB not on the expected mounted volume path ───────────────────────
  if (!looksLikeVolume) {
    warn.push(
      `DB path "${env.dbPath}" is not under /data — confirm this path is a persistent mount, ` +
      'not the ephemeral container filesystem.',
    );
  }

  if (critical.length > 0) {
    return {
      level: 'critical',
      issues: [...critical, ...warn],
      summary: `DATA DURABILITY CRITICAL — ${critical.join(' | ')}`,
    };
  }
  if (warn.length > 0) {
    return {
      level: 'warn',
      issues: warn,
      summary: `DATA DURABILITY WARNING — ${warn.join(' | ')}`,
    };
  }
  return {
    level: 'ok',
    issues: [],
    summary: 'Data durability OK — off-box replication configured, DB present and populated',
  };
}

export interface EncryptionEnv {
  /** process.env.NODE_ENV */
  nodeEnv?: string;
  /** encryptionEnabled() — true when DATA_ENCRYPTION_KEY resolves to a usable key */
  keyConfigured: boolean;
  /** STRICT_ENCRYPTION === '1' — makes encrypted-field writes fail-closed when the key is absent */
  strictMode: boolean;
}

/**
 * T0-2 step 3 — encryption-key presence check. In prod, a missing DATA_ENCRYPTION_KEY
 * means PII (transcripts, OAuth tokens, facts) is either written as plaintext (no strict
 * mode) or write operations fail (strict mode). Either way it must alarm, not start silently.
 * Local/dev is always ok.
 */
export function assessEncryptionReadiness(env: EncryptionEnv): DurabilityAssessment {
  if (env.nodeEnv !== 'production') {
    return { level: 'ok', issues: [], summary: 'Local/dev environment — encryption check skipped' };
  }
  if (env.keyConfigured) {
    return { level: 'ok', issues: [], summary: 'Encryption key present — PII encrypted at rest' };
  }
  if (env.strictMode) {
    return {
      level: 'critical',
      issues: ['DATA_ENCRYPTION_KEY is unset in production with STRICT_ENCRYPTION=1 — encrypted-field writes will FAIL. Set the key immediately.'],
      summary: 'ENCRYPTION KEY MISSING (strict) — writes will fail',
    };
  }
  return {
    level: 'critical',
    issues: ['DATA_ENCRYPTION_KEY is unset in production — PII (transcripts, tokens, facts) is being written as PLAINTEXT. Set the key, or set STRICT_ENCRYPTION=1 to fail-closed.'],
    summary: 'ENCRYPTION KEY MISSING — PII written as plaintext',
  };
}

/**
 * S6 — build the S3 base URL Litestream replicates to, from the same env vars `litestream.yml` uses.
 * Only used for a boot-time reachability probe — the real replication is done by the litestream binary.
 */
export function litestreamS3Url(env: { bucket?: string; region?: string; endpoint?: string }): string | null {
  if (!env.bucket) return null;
  if (env.endpoint) {
    const base = env.endpoint.replace(/\/+$/, '');
    const withProto = /^https?:\/\//.test(base) ? base : `https://${base}`;
    return `${withProto}/${env.bucket}`;
  }
  const region = env.region || 'us-east-1';
  return `https://${env.bucket}.s3.${region}.amazonaws.com`;
}

/** Resolves if the host returns ANY HTTP response (even 403); rejects on network/DNS/TLS failure. */
export type ReachabilityProbe = (url: string) => Promise<void>;

const defaultProbe: ReachabilityProbe = async (url) => {
  // 5s timeout so a hung egress can't stall boot. A 403/404 still proves the host is reachable.
  await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
};

/**
 * S6 — verify the Litestream S3 target is reachable at boot. `checked=false` when no bucket is
 * configured (nothing to verify). When configured, `reachable` reflects whether the probe resolved.
 * Pure aside from the injected probe, so the decision is unit-tested deterministically.
 */
export async function checkS3Reachable(
  env: { bucket?: string; region?: string; endpoint?: string },
  probe: ReachabilityProbe = defaultProbe,
): Promise<{ checked: boolean; reachable: boolean; url: string | null; detail: string }> {
  const url = litestreamS3Url(env);
  if (!url) return { checked: false, reachable: true, url: null, detail: 'LITESTREAM_S3_BUCKET not set — nothing to verify' };
  try {
    await probe(url);
    return { checked: true, reachable: true, url, detail: 'Litestream S3 endpoint reachable' };
  } catch (e) {
    return { checked: true, reachable: false, url, detail: `Litestream S3 endpoint UNREACHABLE: ${(e as Error).message}` };
  }
}

/**
 * Gather the real boot environment + DB stats, assess, and log loudly.
 * Best-effort: never throws — a durability check must never crash the app boot.
 *
 * IMPORTANT: call this at the very start of instrumentation register(), before
 * anything else opens the DB, so dbExistedAtBoot reflects the true pre-boot state.
 */
export async function runStartupDurabilityCheck(): Promise<DurabilityAssessment> {
  try {
    // Lazy import to avoid any import-order coupling with the durability module.
    const { DB_PATH, getDb, healthLogQueries } = await import('./db');

    // Capture existence BEFORE getDb() can create the file.
    let dbExistedAtBoot = true;
    try {
      dbExistedAtBoot = fs.existsSync(DB_PATH);
    } catch {
      dbExistedAtBoot = true; // unknown — don't false-alarm
    }

    let dbUserCount: number | null = null;
    try {
      const row = getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number } | undefined;
      dbUserCount = row ? row.n : null;
    } catch {
      dbUserCount = null; // table may not exist yet on genuine first boot
    }

    const assessment = assessDurability({
      nodeEnv: process.env.NODE_ENV,
      dbPath: DB_PATH,
      litestreamBucket: process.env.LITESTREAM_S3_BUCKET,
      backupS3Bucket: process.env.BACKUP_S3_BUCKET,
      dbExistedAtBoot,
      dbUserCount,
    });

    if (assessment.level === 'critical') {
      console.error(`[durability] 🚨 ${assessment.summary}`);
      for (const issue of assessment.issues) console.error(`[durability]   - ${issue}`);
    } else if (assessment.level === 'warn') {
      console.warn(`[durability] ⚠️  ${assessment.summary}`);
      for (const issue of assessment.issues) console.warn(`[durability]   - ${issue}`);
    } else {
      console.log(`[durability] ${assessment.summary}`);
    }

    // T0-2 step 3 — encryption-key presence check (separate concern from storage durability).
    try {
      const { encryptionEnabled } = await import('./crypto');
      const enc = assessEncryptionReadiness({
        nodeEnv: process.env.NODE_ENV,
        keyConfigured: encryptionEnabled(),
        strictMode: process.env.STRICT_ENCRYPTION === '1',
      });
      if (enc.level === 'critical') {
        console.error(`[durability] 🚨 ${enc.summary}`);
        for (const issue of enc.issues) console.error(`[durability]   - ${issue}`);
        try { healthLogQueries.write('degraded', `STARTUP: ${enc.summary}`); } catch { /* best-effort */ }
      } else if (enc.level === 'ok' && enc.summary.includes('present')) {
        console.log(`[durability] ${enc.summary}`);
      }
    } catch { /* encryption check is best-effort — never blocks boot */ }

    // S6 step 3 — if Litestream is configured, verify the S3 target is actually reachable from this
    // box. A set-but-unreachable bucket means replication is silently failing (RPO → ∞) — CRITICAL,
    // and push it so Derrick sees it without reading logs (S2). Best-effort; never blocks boot.
    try {
      const s3 = await checkS3Reachable({
        bucket: process.env.LITESTREAM_S3_BUCKET,
        region: process.env.LITESTREAM_S3_REGION,
        endpoint: process.env.LITESTREAM_S3_ENDPOINT,
      });
      if (s3.checked && !s3.reachable) {
        console.error(`[durability] 🚨 ${s3.detail} (${s3.url})`);
        try { healthLogQueries.write('degraded', `STARTUP: ${s3.detail}`); } catch { /* best-effort */ }
        try {
          const { sendPushToAllSubscribers } = await import('./push');
          await sendPushToAllSubscribers({ title: 'Edg3: backup replication unreachable', body: s3.detail.slice(0, 180) });
        } catch { /* push best-effort */ }
      } else if (s3.checked) {
        console.log(`[durability] ${s3.detail}`);
      }
    } catch { /* S3 reachability is best-effort — never blocks boot */ }

    // Persist to health_log so the 6am digest and admin health endpoint surface it.
    try {
      healthLogQueries.write(assessment.level === 'ok' ? 'ok' : 'degraded', `STARTUP: ${assessment.summary}`);
    } catch { /* health_log is best-effort */ }

    return assessment;
  } catch (err) {
    // A durability self-check must never break boot.
    console.error('[durability] startup check failed (non-fatal):', err);
    return { level: 'ok', issues: [], summary: 'durability check errored — skipped' };
  }
}
