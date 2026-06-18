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

## Status

| Item | State |
|---|---|
| Off-box replication code (Litestream) | ✅ Shipped |
| Daily snapshot push code | ✅ Shipped |
| Boot-time durability self-check | ✅ Shipped (this session) |
| Daily digest durability check | ✅ Shipped (this session) |
| Volume confirmed persistent | ⏳ **External — Kevin** |
| `LITESTREAM_S3_*` env vars set | ⏳ **External — Kevin** |
| Restore drill performed | ⏳ **External — Kevin** |
