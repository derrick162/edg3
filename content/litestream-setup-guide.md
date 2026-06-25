# Litestream activation guide (S6)

**Goal:** turn on continuous off-box replication of the SQLite DB so a lost/replaced Railway
volume is never a data-loss event. The replication code (T0-1) is already shipped in
`litestream.yml` + `scripts/start.sh`; this guide is the **one-time Railway activation** + a
proof-of-recovery drill. ~20 minutes.

> Until this is done, every boot logs `[durability] 🚨 NO OFF-BOX REPLICATION` and the 6am health
> digest reports DEGRADED. Once active, boot also probes S3 reachability and pushes an alert
> (S2) if the bucket is set but unreachable.

---

## 1. Create a persistent Railway volume at `/data`
Railway → service → **Volumes** → add a volume mounted at **`/data`**.
- If there is **no** volume at `/data`, the DB is on the ephemeral container filesystem and is
  **wiped on every redeploy** — this is the single most important step.
- The app's `DB_PATH` defaults to `/data/edg3.db`.

## 2. Create an S3-compatible bucket
Any S3 API works — AWS S3, Backblaze B2, Cloudflare R2, MinIO. Create:
- a **private** bucket (e.g. `edg3-prod-db-backups`),
- an access key / secret with **`s3:GetObject`, `s3:PutObject`, `s3:ListBucket`, `s3:DeleteObject`**
  scoped to that bucket.

## 3. Set the env vars on Railway
Required:
| Var | Value |
|---|---|
| `LITESTREAM_S3_BUCKET` | your bucket name |
| `LITESTREAM_S3_ACCESS_KEY_ID` | the IAM key |
| `LITESTREAM_S3_SECRET_ACCESS_KEY` | the IAM secret |

Optional:
| Var | Default | When to set |
|---|---|---|
| `LITESTREAM_S3_REGION` | `us-east-1` | non-default region |
| `LITESTREAM_S3_PATH` | `edg3` | bucket prefix |
| `LITESTREAM_S3_ENDPOINT` | _(AWS)_ | **required** for B2 / R2 / MinIO (their S3 endpoint host) |

## 4. Verify with the activation script
From the Railway shell (or locally with the vars exported):
```bash
bash scripts/activate-litestream.sh
```
It prints PASS/FAIL per step (env vars → DB path → litestream binary → live S3 auth/write) and
exits non-zero on any failure. Get a clean PASS before trusting the backup.

## 5. Run a restore drill — *"a backup you've never restored is not a backup."*
Prove recovery end-to-end from a real snapshot:
```bash
litestream restore -config /app/litestream.yml /data/edg3-restored.db
sqlite3 /data/edg3-restored.db "SELECT COUNT(*) FROM users;"
# The count should match production. Then remove the test copy:
rm /data/edg3-restored.db
```
If the count matches, replication + restore are verified.

## 6. Confirm the live signal after the next deploy
Redeploy and check the Railway logs for:
- `[durability] Data durability OK` (volume + replication active), and
- `[durability] Litestream S3 endpoint reachable`.

Any `🚨` line is an action item. The boot check also writes the result to `health_log`, so the
6am digest + `/api/admin/health` reflect it, and a set-but-unreachable bucket triggers a push.

---

### Rollback / disabling
Unset `LITESTREAM_S3_BUCKET` to stop replication (the app keeps running on the local volume;
durability check reverts to the "no off-box replication" warning). No data migration needed.
