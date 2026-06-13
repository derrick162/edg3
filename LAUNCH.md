# Edg3 — Go-Live / Operations Runbook

The **how** behind the launch. The 30/60/90 plan sets the dates; this is the executable
playbook for actually shipping and running Edg3 with real users. Owned by PM/CTO.

---

## 0. Launch strategy (the key decision)
**Decouple the public launch from Google Gmail verification.** Launch the calendar +
daily-briefing **core** on the target date regardless. The Gmail features (email drafting,
reply tracking, notifications) roll out **"as verification clears"** — available to the
owner + test users until then. **Why:** Gmail restricted-scope verification + CASA is
Google-controlled and routinely runs 6–12+ weeks. Never gate the launch date on it.

---

## 1. Pre-launch checklist (all true before public launch)
> **Security code status (2026-06-10, PM-verified after merge `ef1d8f1`):** webhook
> enforcement, write-idempotency, hard delete-confirm, rate limiting, and Litestream
> backup are all **code-complete, wired, and green on master (117/117 tests)**. What
> remains for these is purely **ops** — flipping env vars on Railway — marked `[ops]` below.

- [ ] Core loop verified end-to-end (briefing call + calendar create/move/delete) on a real call. _(← the owner test — top gate.)_
- [ ] **Real phone number (Twilio) + Vapi on a PAID plan** sized for daily-call volume. *(The free Vapi number caps outbound calls/day — cannot serve real users.)*
- [ ] `[ops]` `DATA_ENCRYPTION_KEY` set on Railway **and backed up forever** *(lose it after data is encrypted = unrecoverable)*. Then set `STRICT_ENCRYPTION=1`. Verify with `GET /api/admin/health` → `encryption.ok: true`. _(code: encryption no-ops until set; STRICT_ENCRYPTION blocks plaintext writes once set.)_
- [ ] `[ops]` `JWT_SECRET` is a real random secret on Railway (not unset). _(code: fails closed if unset.)_
- [ ] `[ops]` `VAPI_SECRET_ENFORCE=true` + `VAPI_SERVER_SECRET` set. _(code ✅ shipped — `checkVapiSecret` enforced in both Vapi routes; runs fail-open-with-log until the flag is `true`. Watch the log 24h, then flip.)_
- [ ] `[ops]` Off-box DB backup running + **one restore drill done.** _(code ✅ shipped — `litestream.yml` + restore tooling. Needs `LITESTREAM_S3_*` env vars on Railway + run the documented drill once.)_
- [x] Write-idempotency + hard delete-confirm + rate limiting — **code ✅ shipped & active on master** (no env needed; verified wired 2026-06-10).
- [ ] `npm run check:vapi` green + CI green on master.
- [ ] Privacy Policy + Terms accurate & live. ✅
- [ ] Gmail features either verified, or cleanly gated to test users with the "unverified app" path documented for them.

---

## 2. Production env vars (Railway)
| Var | Purpose | Notes |
|---|---|---|
| `DATA_ENCRYPTION_KEY` | at-rest encryption | 64-hex; **back up forever** |
| `JWT_SECRET` | session signing | real random secret |
| `VAPI_API_KEY` | Vapi calls + tools | |
| `VAPI_PHONE_NUMBER_ID` | outbound calls | the real/Twilio number |
| `VAPI_SERVER_SECRET` + `VAPI_SECRET_ENFORCE` | webhook auth | set enforce=`true` |
| `ANTHROPIC_API_KEY` | briefings + email compose + reply understanding | |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth | |
| `TWILIO_*` | SMS/voice | when SMS lands |
| `WHOOP_CLIENT_ID` / `WHOOP_CLIENT_SECRET` | Whoop OAuth | from developer.whoop.com dev app |
| `LITESTREAM_S3_BUCKET` + `LITESTREAM_S3_ACCESS_KEY_ID` + `LITESTREAM_S3_SECRET_ACCESS_KEY` | off-box DB replication | see §10 |
| `STRICT_ENCRYPTION` | hard-guard on plaintext writes | set to `1` after confirming `DATA_ENCRYPTION_KEY` is active |

---

## 3. Deploy
- Push to `master` → Railway auto-builds + deploys (GitHub-connected). CI Action runs tsc + tests + build (+ `check:vapi` if secrets set).
- Before a risky deploy: `npm run preflight` (tsc + tests + build) **and** `npm run check:vapi`.
- A failed Railway build keeps the previous version live (no downtime).
- An env-var change triggers a **full rebuild** (~5–8 min on the current plan).

## 4. Rollback
- Railway → Deployments → last good deployment → Redeploy. Previous image is preserved.
- ⚠️ **Encryption caveat:** once `DATA_ENCRYPTION_KEY` is set and data is encrypted, do NOT roll back to a pre-encryption build or unset the key — encrypted rows become unreadable.

## 5. Post-deploy smoke test
- Homepage + `/privacy` + `/login` return 200.
- One real briefing call completes.
- `npm run check:vapi` green.
- Dashboard loads; a calendar action round-trips.

---

## 6. Capacity & cost (the plan needs this)
- **Vapi:** free number caps outbound calls/day — hard blocker for real users. Move to a Twilio number + paid Vapi plan before external users. Model: per-minute cost × users × daily calls.
- **Anthropic:** briefings + email compose + reply understanding are per-call token cost — budget at user scale.
- **DB/Railway:** single SQLite volume; fine for early scale, watch volume size + the durability item.

## 7. Incident playbook (things that have actually bitten us)
- **"All calls failing / anthropic-400-validation-failed":** a Vapi tool has a bad schema. Run `npm run check:vapi` — it pinpoints the tool. *(Past causes: a trailing space in a param key; an empty-string default on a boolean; a missing tool Server URL.)*
- **"Tool returns no result" mid-call:** that tool is missing its **Server URL** in Vapi.
- **Slow dashboard load:** it's client-side data fetching — already decoupled (renders on auth; the slow Google Calendar checks load async). If it regresses, check `/api/auth/me`.
- **"Edge can't use Gmail":** the user needs to reconnect Google (re-consent) — the read/draft scopes weren't granted.

## 8. Gmail verification
See `docs/google-verification.md` (scopes, justifications, demo-video shot-list, CASA notes).
Restricted scopes need Google verification + CASA (weeks). The owner can dogfood via the
"unverified app → Advanced → Continue" path meanwhile. **Start CASA ASAP — it's the long pole.**

---

## 9. Encryption ops — DATA_ENCRYPTION_KEY rollout

### How field-level encryption works
`lib/crypto.ts` encrypts sensitive columns (OAuth tokens, call transcripts, health PII) using
AES-256-GCM with a random IV per value. The stored format is `enc:1:<base64(iv||tag||ct)>`.
Legacy plaintext rows **pass through unchanged on read** — rollout is safe without a data migration.

### Setting DATA_ENCRYPTION_KEY on Railway
1. Generate a 32-byte key as 64 lowercase hex chars:
   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. Set `DATA_ENCRYPTION_KEY=<64-hex>` in Railway → Variables.
3. **Back it up immediately and forever** — losing it after data is encrypted makes those rows
   unreadable. Store it in a password manager or a secrets vault (not just Railway).
4. Redeploy. All new writes are now encrypted. Old plaintext rows are re-encrypted lazily on next
   write (no bulk migration needed).

### STRICT_ENCRYPTION=1 mode
Once `DATA_ENCRYPTION_KEY` is set on Railway, also set `STRICT_ENCRYPTION=1`. This makes
`encryptField()` throw immediately if `DATA_ENCRYPTION_KEY` is somehow missing, rather than
silently writing plaintext. It acts as a hard guard against misconfigured deploys.

**Do NOT set `STRICT_ENCRYPTION=1` until `DATA_ENCRYPTION_KEY` is confirmed set** — otherwise
all token writes fail.

### Verify encryption is active after deploy
Hit the health endpoint (admin-gated):
```sh
curl -b 'edg3_admin=<your-admin-cookie>' https://www.edg3.ai/api/admin/health
```
Expected response when all is well:
```json
{ "status": "ok", "checks": { "encryption": { "ok": true, ... }, ... } }
```
A `"critical"` status with `encryption.ok: false` means `DATA_ENCRYPTION_KEY` is not reaching
the app — check Railway variables + trigger a redeploy.

---

## 10. Litestream restore drill

### What it proves
That off-box S3 replication is actually streaming data and that a fresh Railway volume could
be populated from S3 — the entire durability guarantee for Railway volume loss.

### Pre-requisites
- `LITESTREAM_S3_BUCKET`, `LITESTREAM_S3_ACCESS_KEY_ID`, `LITESTREAM_S3_SECRET_ACCESS_KEY`
  set on Railway (coordinate with PM for credentials).
- App has been running with `LITESTREAM_S3_BUCKET` set for at least a few minutes so S3 has data.

### How to run
From the Railway **shell** (Deployments → active deploy → Shell):
```sh
sh scripts/restore-drill.sh
```
The script:
1. Downloads the Litestream binary (cached between runs).
2. Calls `litestream restore` to restore the latest snapshot + WAL frames to `/tmp/edg3-drill-*.db`.
3. Opens the restored DB with `better-sqlite3`, runs `PRAGMA integrity_check`, and prints row counts.
4. Exits 0 (PASS) or 1 (FAIL) with a clear summary.

**Expected PASS output:**
```
[PASS]  Required env vars present (bucket: edg3-prod)
[PASS]  Litestream v0.3.13 downloaded.
[PASS]  Restore complete: 1234567 bytes
[PASS]  PRAGMA integrity_check: ok
[PASS]  Row counts — users: 1, briefings: 42

═══════════════════════════════════════════════════════════
  RESTORE DRILL: PASS
  integrity: ok | users: 1 | briefings: 42
═══════════════════════════════════════════════════════════
```

### Restore drill log (record each run here)
| Date | Operator | Result | users | briefings | Notes |
|---|---|---|---|---|---|
| _(not yet run — awaiting Railway S3 creds)_ | | | | | |

### Manual restore (if needed in a real incident)
In a real volume-loss incident, `scripts/start.sh` performs the restore automatically before
the app boots — no manual steps needed if the env vars are set. For a manual restore or
to restore to a specific point in time:
```sh
# Restore to a specific timestamp (PITR within the 72h WAL retention window):
litestream restore -config litestream.yml -timestamp 2026-06-13T08:00:00Z /data/edg3.db

# Restore latest (same as what start.sh does):
litestream restore -config litestream.yml -if-replica-exists /data/edg3.db
```
After restore, redeploy so the app picks up the restored file.
