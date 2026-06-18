# EDG3 QA Log
_Run the checklists in PILLAR-DAILY-CALL.md → PILLAR-MEMORY.md → PILLAR-TRUST.md after each release. Log results here. If a test fails, open a ticket in the appropriate pillar doc._

---

## How to run
1. Read the QA checklist at the bottom of each pillar doc
2. Work through each item manually — unit tests do not substitute for this
3. Log the result below: date, what passed, what failed, notes
4. Any FAIL → add a bug entry to the relevant pillar doc's bug log and route to the owning lane

---

## 2026-06-18 — Pre-launch baseline (PM/Kevin)

**Status: PARTIAL** — automated test suite green (1703 tests); manual end-to-end QA not yet run. Items marked ✅ were verified via code review or automated tests; items marked ⬜ are pending live-call verification.

### PILLAR-TRUST QA

**Memory pipeline**
- ⬜ Make a call → transcript stored in briefings within 5 min
- ⬜ Make a call, say something new → appears in "What Edge knows" by next call
- ⬜ Contradict an existing fact → old fact retired, new fact active
- ⬜ After every call: episode record exists
- ⬜ Sleep-time consolidation ran after last call (check Railway logs)

**Accuracy**
- ⬜ Open "What Edge knows" → every fact accurate (manual review)
- ⬜ Make a call where Edge references a fact → stated accurately
- ⬜ Force tool failure → Edge gives honest explanation
- ⬜ Last 5 briefings → no false claims

**Data protection**
- ✅ Connect Google → calendar + Gmail work (verified in dogfooding)
- ⬜ Disconnect Google → tokens removed from DB
- ✅ Audit log after calendar mutation → action logged with correct userId (code review)
- ✅ Another user's data via direct API call → 404 (code review: every query has AND user_id = ?)

**Reliability**
- ⬜ Railway logs last 24h → any 500 errors?
- ⬜ Vapi dashboard → all scheduled calls connected?
- ⬜ failed_webhooks table → any entries?
- ⬜ health_log table → 6am digest ran? Status: OK or DEGRADED?
- ⬜ **Restore drill** — restore from backup snapshot, verify app reads correctly. NEVER DONE YET.
- ✅ npm run preflight → 1703 green (2026-06-18)

**Transparency**
- ⬜ Activity tab → shows every action from last 7 days
- ⬜ "What Edge knows" → can see, edit, and delete every fact
- ⬜ Settings → Account → Export → export contains all data
- ⬜ Settings → Privacy → consent setting displayed correctly

**★ End-to-end smoke test**
- ✅ `tests/e2e/call-to-briefing.test.ts` exists and passes (T0-3 shipped 6bec403)
- ⬜ Live 7am path: trigger call → transcript stored within 5 min → fact extracted → next briefing references it
- ⬜ Correction path: say "actually X is Y" → next briefing has corrected fact
- ⬜ Rollback path: find fact in fact_history, roll back, verify previous version active

---

### PILLAR-DAILY-CALL QA

**Flywheel integrity**
- ⬜ Complete a call → within 30 min: episode exists, ≥1 fact extracted, any commitment in tasks
- ⬜ Complete a call at 10pm → facts appear in NEXT MORNING's briefing
- ⬜ Make a commitment on a call → it opens the next call before anything else

**Connection reliability**
- ⬜ call_attempts log → every scheduled call in last 7 days connected?
- ⬜ Any failed calls → user receive notification?
- ⬜ Schedule test call 2 min from now → fires within 60 seconds?

**Briefing quality**
- ⬜ Last 3 briefings → each opened with something the user needed Edge to know?
- ⬜ How long did each run? Under 5 minutes?
- ⬜ ≥3 user-specific facts per briefing (not generic calendar)?
- ⬜ Outstanding commitments from yesterday opened the briefing?

**Call experience**
- ⬜ Edge sounds consistent call-to-call? Same energy, anchor phrases?
- ⬜ Pause 15 seconds mid-call → Edge checks in warmly rather than timing out?
- ⬜ Force tool failure → Edge gives honest explanation?

**★ End-to-end flywheel test**
- ⬜ Call 1: say "my new priority is X" → Call 2: Edge references X in briefing
- ⬜ Call 2: commit "I'll do Y today" → Call 3: Edge opens by asking if Y happened

---

### PILLAR-MEMORY QA

**Storage**
- ⬜ Complete call → within 1 hr: episode exists, ≥3 facts, transcript in briefings
- ⬜ Tell Edge something new → appears in correct category in "What Edge knows"
- ⬜ Contradict known fact → old fact retired (valid_until set), new one active
- ⬜ fact_history after fact update → old value preserved
- ⬜ Row count in episodes = number of calls made

**Learning**
- ⬜ Railway logs → sleep-time consolidation ran after last call? How many facts updated?
- ⬜ Mid-call correction ("actually X is Y") → corrected by NEXT call
- ⬜ After 7+ calls → facts table has pattern-category rows?
- ⬜ briefing_context_packs table → pack for today's date?

**Retrieval**
- ⬜ Ask Edge "what do you know about my gym schedule?" → answers correctly
- ⬜ Ask Edge "what did I say about fundraising?" → surfaces right history
- ⬜ Outstanding commitments in FIRST section of briefing
- ⬜ No facts older than 90 days stated as current truth without hedging

**Compounding**
- ⬜ Fact not confirmed in 60+ days → Edge hedges it in next briefing
- ⬜ Commit 3 calls in a row, don't complete → Edge's language softens
- ⬜ If 30+ calls: facts table has category='semantic' rows?
- ✅ npm run preflight → 1703 green (2026-06-18)

---

_Template: PILLAR-TRUST.md, PILLAR-DAILY-CALL.md, PILLAR-MEMORY.md QA sections._
_Next full manual QA run: schedule for first week with 5 design partners on the product._

---

# EDG3 — QA Log (Security & Reliability lane)

**Maintained by:** Security (Vijay) · **Started:** 2026-06-18 (overnight)

Per the pillar QA rule: a green unit-test suite and a broken production path are
fully compatible. This log maps each pillar QA item to its **automated coverage**
(the test that actually guards it) or marks it **EXTERNAL** — needing a live call,
the Railway dashboard, or Derrick/Kevin. It is honest about what code *cannot* prove.

Legend: ✅ automated · 🔁 partial (logic tested, live path not) · ⚠️ EXTERNAL (human/live) · 🛠️ other lane

---

## ⚠️ Morning action list (Derrick / Kevin) — consolidated

These are the only things blocking a "Trust Tier 0 fully closed" sign-off. None can
be done from code; all the supporting code is shipped and waiting.

1. **Confirm `/data` is a persistent Railway volume.** Dashboard → service → Volumes.
   If there's no volume at `/data`, it's ephemeral and data is being lost on every
   redeploy — a live incident. Details + fix: `content/durability-runbook.md`.
2. **Set `LITESTREAM_S3_BUCKET` + `LITESTREAM_S3_ACCESS_KEY_ID` + `LITESTREAM_S3_SECRET_ACCESS_KEY`**
   on Railway to activate off-box replication. Until then the 6am digest + every boot
   log will report `DATA DURABILITY CRITICAL`.
3. **Verify `DATA_ENCRYPTION_KEY` is set on Railway AND backed up** to a second secure
   location (it has no recovery if lost). Boot now logs `ENCRYPTION KEY MISSING` if unset.
4. **Run the restore drill** once (proves the backup): `content/durability-runbook.md` §4.
5. **After next deploy, check Railway logs** for `[durability] Data durability OK` and
   `[durability] Encryption key present`. Any `🚨` line is an action item.

---

## Trust Tier 0 — automated coverage

| QA item | Status | Evidence |
|---|---|---|
| Off-box backup exists in a different failure domain (T0-1) | ✅ code / ⚠️ activation | Litestream (`scripts/start.sh`, `litestream.yml`) + snapshot push (`lib/backup.ts`). Boot self-check `lib/durability.test.ts` (16 tests). Activation = env vars (#2 above). |
| Ephemeral-volume risk is visible, not silent (T0-1) | ✅ | `lib/durability.ts` `assessDurability` → CRITICAL log + `health_log`; 6am digest re-checks daily. `lib/durability.test.ts`. |
| Encryption key custody: graceful degrade + alarm if missing (T0-2) | ✅ | `safeDecryptField` (`lib/crypto.ts`), `assessEncryptionReadiness` (`lib/durability.ts`), rotation doc `content/encryption-key-rotation.md`. Key backup = ⚠️ #3 above. |
| Scheduler resilience: no double-dial across replicas (T0-4) | ✅ | `scheduler_lock` + `schedulerLockQueries` (`lib/db.ts`), real-DB tests `lib/scheduler-lock.test.ts` (7 tests). |
| Scheduler resilience: missed-call catch-up after restart (T0-4) | ✅ | `CALL_GRACE_MINUTES=120` catch-up + DB-flagged `retry_after` (`lib/scheduler.ts`). Tests in `lib/scheduler.test.ts` (DC1-3). |
| End-to-end "7am path" smoke test (T0-3) | 🛠️ Core | Owned by Darren — `tests/e2e/call-to-briefing.test.ts`. Not started in Security lane. |
| Restore drill performed | ⚠️ | Human step — `content/durability-runbook.md` §4. |

## Trust Tier 1 — automated coverage

| QA item | Status | Evidence |
|---|---|---|
| Webhook retry + dead-letter queue (T1-1) | ✅ | `failed_webhooks` + `failedWebhookQueries`, `lib/failure-logging.test.ts` (20 tests). |
| Per-call health check: transcript + facts + episode (T1-2) | ✅ | `backgroundJobFailureQueries` wired to all 4 post-call jobs; transcript check in `runHealthDigest`. `lib/health-digest.test.ts`. |
| Observability: 6am health digest (T1-3) | ✅ | `runHealthDigest` → `health_log`; `lib/health-digest.test.ts` (OK + degraded paths). |
| Encryption-at-rest coverage map (T1-4) | ✅ | `content/data-protection.md` coverage map; `lib/db-encryption.test.ts`, `lib/db.encryption.test.ts`. |
| Rate-limit coverage on all mutations (T1-5) | ✅ | Full sweep documented in `content/security-audit.md`; route tests across `app/api/**`. |
| Write-idempotency on retries (T4-4) | ✅ | `webhook_dedup_keys` + `tool_call_dedup_keys`; `lib/idempotency.test.ts`. |

## Data protection QA (from PILLAR-TRUST checklist)

| QA item | Status | Evidence |
|---|---|---|
| Cross-user data access returns 404 | ✅ | `app/api/memory/facts/[id]/route.test.ts` (fact owned by user 2 → user 1 gets 404); `app/api/account/account.test.ts`. |
| Calendar mutation logged with correct userId | ✅ | `lib/auditLog.test.ts`; T3-2 route audit adds (tasks/profile/focus). |
| OAuth tokens removed on disconnect | 🔁 | Logic in `app/api/calendar/disconnect` + `whoop/disconnect` (audited). Live-grant verification = ⚠️. |
| Account deletion removes all user rows | ✅ | `lib/db-account-deletion.test.ts` — real-DB cascade + **drift guard** (every `user_id` table must be in `USER_SCOPED_DELETE_ORDER`). Caught + fixed 2 gaps (`support_messages`, `fact_history`) that would have 500'd deletion under `foreign_keys=ON`. |
| Data export completeness + omits secrets | ✅ | T3-3 review; `GET /api/account/export` omits `password_hash`/OAuth tokens, includes `dataConsent`. |

## Reliability QA

| QA item | Status | Evidence |
|---|---|---|
| `failed_webhooks` / `background_job_failures` surfaced | ✅ | 3am cron + 6am digest log counts; `lib/failure-logging.test.ts`. |
| `health_log` written daily (OK vs DEGRADED) | ✅ | `runHealthDigest`; `lib/health-digest.test.ts`. |
| Scheduled call fires within ~60s of call_time | 🔁 | Logic + timing-delta log tested (`lib/scheduler.test.ts` DC1-3). Live wall-clock = ⚠️. |
| `npm run preflight` green | ✅ | 90 files / 1707 tests green as of this entry. |
| Backup is genuinely restorable (data survives) | ✅ | `lib/backup-restore-drill.test.ts` — real SQLite create→snapshot→reopen→data-matches round-trip (the live Railway-volume drill is still ⚠️ external, but the mechanism is now proven automatically). |

## Items that require a live call / live infra (cannot be automated here)

These are genuinely ⚠️ EXTERNAL — they need a real Vapi call, a real Whoop grant, or
the Railway shell. Logged so they are not mistaken for "covered":

- Live 7am call connects and produces transcript within 5 min.
- Pause 15s mid-call → Edge checks in rather than hanging up (DC3-2 / messagePlan).
- Force a tool failure mid-call → Edge gives an honest spoken message (DC3-3, Core).
- Whoop data present on a live call when connected (DC2-3b, Core+Security).
- Restore drill from a real S3 snapshot (T0-1 §4).

---

## Run history

- **2026-06-18 (overnight, Vijay):** Trust Tier 0 (Security) closed in code — T0-1 durability
  self-check, T0-4 scheduler lock, T0-2 startup key check. Tier 1 (Security) verified complete.
  QA coverage mapped above. 5 external items handed to Derrick/Kevin (top of file). 1697 green.
- **2026-06-18 (overnight, Vijay — cont'd):** Esther dispatch items #4/#5. **Found + fixed a real
  account-deletion bug:** `support_messages` + `fact_history` were missing from the deletion route
  (FK constraint under `foreign_keys=ON` → deletion 500 for affected users). Added a real-DB
  cascade + drift-guard test (`lib/db-account-deletion.test.ts`) so this class of gap can't recur.
  Scheduler dispatch lock now logs a warning naming the holder on a refused acquire. M2-4 context
  packs skip caching empty results. 1705 green.
