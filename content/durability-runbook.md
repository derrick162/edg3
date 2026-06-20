# T0-1 — Data Durability Runbook

**Owner:** Security (Vijay) · **Last updated:** 2026-06-18 (overnight)

The entire memory moat — every fact, episode, pattern, transcript — lives in one
SQLite file at `/data/edg3.db` on Railway. This runbook covers how that file is
protected and the **external steps a human must take** to confirm it.

---

## The risk (why this is Tier 0)

If the Railway volume at `/data` is **ephemeral** (not a persisted volume), then
every redeploy/restart silently wipes the database. On-volume backups (`lib/backup.ts`
snapshots written next to the DB) do NOT help — they die with the volume. The only
real protection is **off-box replication to object storage in a different failure
domain.**

---

## What is coded and shipped ✅

1. **Litestream continuous replication** (`scripts/start.sh` + `litestream.yml`)
   - Streams WAL frames to S3-compatible storage at ~1s RPO.
   - On a fresh/empty volume, restores the DB from S3 **before the app boots**.
   - Activates only when `LITESTREAM_S3_BUCKET` is set — otherwise plain `npm start`.

2. **Daily snapshot push** (`lib/backup.ts` `pushBackupToObjectStorage`)
   - Secondary off-box copy via AWS SigV4 (no SDK). Activates on `BACKUP_S3_*`.

3. **Boot-time durability self-check** (`lib/durability.ts`, wired in `instrumentation.ts`) — **NEW**
   - Runs first thing on every boot, before anything opens the DB.
   - Logs **CRITICAL** to Railway logs if: no off-box replication configured, OR the
     DB file was absent at boot with no replication, OR the prod DB has zero users.
   - Writes the result to `health_log` (`STARTUP: ...`) so it's queryable.

4. **Daily durability check in the 6am health digest** (`lib/scheduler.ts` `runHealthDigest`) — **NEW**
   - Marks the digest **DEGRADED** every morning if off-box replication is unset in prod.

So even if the volume is ephemeral, **data survives as long as `LITESTREAM_S3_BUCKET`
is set.** The self-check guarantees that a misconfiguration screams in the logs instead
of failing silently.

---

## ⚠️ External steps a human MUST do (cannot be done from code)

These require the Railway dashboard / shell — flagged for Kevin/Derrick:

1. **Confirm the volume is persistent.**
   Railway dashboard → the service → **Volumes**. There must be a volume mounted at
   `/data`. If there is **no volume**, `/data` is ephemeral and data is being lost on
   every redeploy **right now** — this is a live incident. Fix: add a persistent volume
   mounted at `/data`.

2. **Set the Litestream env vars** (activates off-box replication):
   - `LITESTREAM_S3_BUCKET`
   - `LITESTREAM_S3_ACCESS_KEY_ID`
   - `LITESTREAM_S3_SECRET_ACCESS_KEY`
   - (optional) `LITESTREAM_S3_REGION`, `LITESTREAM_S3_ENDPOINT` (for R2/B2), `LITESTREAM_S3_PATH`

3. **Verify after deploy.** Check Railway logs for one of:
   - `[durability] Data durability OK ...` → replication is configured. ✅
   - `[durability] 🚨 DATA DURABILITY CRITICAL ...` → fix the flagged issue immediately.

4. **Restore drill** (prove recovery — "backups you've never restored are not backups"):
   ```sh
   # From a Railway shell:
   litestream restore -config /app/litestream.yml /data/edg3-restored.db
   sqlite3 /data/edg3-restored.db "SELECT COUNT(*) FROM users;"
   # If the count matches production, restore is verified. Delete the test file after.
   ```

---

## Key Rotation (DATA_ENCRYPTION_KEY)

`DATA_ENCRYPTION_KEY` encrypts every sensitive field at rest (AES-256-GCM). If it must change
(suspected leak, audit requirement, or routine rotation), follow this procedure. **The re-encrypt
runs BEFORE the key swap, so there is zero downtime and no window where data is unreadable.**

> ⚠️ **Take a backup snapshot first** (Litestream snapshot or `verifyBackup`). Rotation rewrites
> every encrypted cell; a verified restore point is the safety net.

**The tool:** `reEncryptAllUserData(oldKey, newKey, { dryRun? })` in `lib/crypto.ts`. It walks the
authoritative `ENCRYPTED_COLUMNS` inventory (`lib/db.ts`), decrypts each cell with the old key and
re-encrypts with the new key, in **one transaction per user**. It is **resumable** (a cell already
on the new key is detected and skipped) and **fail-loud** (a cell that decrypts with neither key
aborts the run — nothing is silently dropped).

**Steps:**

1. **Generate the new key** (32 bytes, hex):
   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. **Set it as a SECOND env var** on Railway — `DATA_ENCRYPTION_KEY_NEXT` — leaving the live
   `DATA_ENCRYPTION_KEY` unchanged for now.
3. **Dry-run first** (reads + verifies decryptability, writes nothing) from a one-off Railway job /
   `node` REPL with both env vars present:
   ```js
   const { reEncryptAllUserData } = require('./lib/crypto');
   await reEncryptAllUserData(process.env.DATA_ENCRYPTION_KEY, process.env.DATA_ENCRYPTION_KEY_NEXT, { dryRun: true });
   // Review the logged summary: cellsReKeyed / cellsAlreadyRotated / cellsSkipped per column.
   ```
4. **Run it for real** (per-user transactions; safe to re-run if interrupted):
   ```js
   await reEncryptAllUserData(process.env.DATA_ENCRYPTION_KEY, process.env.DATA_ENCRYPTION_KEY_NEXT);
   ```
5. **Swap the key:** set `DATA_ENCRYPTION_KEY` to the new value and **remove** `DATA_ENCRYPTION_KEY_NEXT`.
   Redeploy (clears the in-process key cache).
6. **Verify** a decrypt round-trip after deploy — open the dashboard Memory tab (reads decrypt facts)
   or check logs for any `[crypto] DECRYPT_FAILURE`. None = success.

**If interrupted** (deploy died mid-run): just re-run step 4 — already-rotated cells are detected and
skipped, only the remainder is processed.

> **Never** change `DATA_ENCRYPTION_KEY` without running the re-encrypt first — doing so makes every
> encrypted field permanently unreadable. (`safeDecryptField` would degrade content reads to empty,
> and OAuth-token reads would throw.)

> **Inventory drift:** if a new encrypted column is added anywhere, it MUST be added to
> `ENCRYPTED_COLUMNS` in `lib/db.ts` or rotation will skip it (→ unreadable after a swap). The
> cross-reference test in `lib/key-rotation.test.ts` guards table/column existence.

---

## Status

| Item | State |
|---|---|
| Off-box replication code (Litestream) | ✅ Shipped |
| Daily snapshot push code | ✅ Shipped |
| Boot-time durability self-check | ✅ Shipped (this session) |
| Daily digest durability check | ✅ Shipped (this session) |
| Key-rotation utility + runbook (`reEncryptAllUserData`) | ✅ Shipped (R11 T3) |
| Volume confirmed persistent | ⏳ **External — Kevin** |
| `LITESTREAM_S3_*` env vars set | ⏳ **External — Kevin** |
| Restore drill performed | ⏳ **External — Kevin** |
