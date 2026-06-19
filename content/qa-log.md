# EDG3 QA Log
_Run the checklists in PILLAR-DAILY-CALL.md → PILLAR-MEMORY.md → PILLAR-TRUST.md after each release. Log results here. If a test fails, open a ticket in the appropriate pillar doc._

---

## How to run
1. Read the QA checklist at the bottom of each pillar doc
2. Work through each item manually — unit tests do not substitute for this
3. Log the result below: date, what passed, what failed, notes
4. Any FAIL → add a bug entry to the relevant pillar doc's bug log and route to the owning lane

---

## 2026-06-18 — Design session QA (Cam)

**Status: PARTIAL** — automated suite 1703 green; manual items below are UI-observable only.

### UX-2/3/4 post-ship verification (code review)
- ✅ People section: `isSelf` filter applied (entity lower-cased vs firstName + fullName + AI_ENTITY_NAMES set)
- ✅ People section: dedup logic collapses facts with identical first-80-char key; "N duplicate entries merged" affordance shown when dupes exist
- ✅ `cursor: pointer` rule added to `app/globals.css` covering `button:not(:disabled)`, `[role="button"]`, `a[href]`, `label[for]`, `summary`, `select`
- ✅ `collapsedMemorySections` init: `useEffect` fires on first `facts` load — collapses all but first 3 populated categories; "all expanded" path fires when <4 categories have data
- ⬜ **Live check needed:** open "What Edge knows" with real data — verify no self-references, no "Edge"/"Edg3" entities, no obvious duplicate facts in People section
- ⬜ **Live check needed:** click every header row in Memory tab — verify collapse/expand fires correctly

### Design-observable PILLAR-TRUST items
- ✅ UX-1 copy: all "Edge" → "Edg3" on public surfaces (privacy, onboarding, components sweep — 2026-06-18)
- ✅ UX-2 display layer: shipped edc52d7
- ✅ UX-3 cursor + isSelf: shipped edc52d7
- ✅ UX-4 collapsible sections: shipped edc52d7; dynamic init added
- ✅ M4-3b "updated [date]" per-fact expand: shipped — `getLatestTimestamps` bulk query, `last_updated_at` on Fact, FactRow chevron expand + Restore (rollback) button, people section last_updated_at wired
- ⬜ **Live check needed:** open Memory tab with real facts — click a fact row → verify history panel loads; click Restore → verify fact reverts to prior statement

### Derrick review tickets (post-dashboard review 2026-06-18)
- ✅ Ticket 1: Removed "Edg3 reads subject lines only — never message content." from email expand panel
- ✅ Ticket 2: Removed "Detail — Expand to see which emails Edge reviewed." from activity label builder
- ✅ Ticket 3: Priority row trend arrow — added `title=` tooltip ("Trending up/down/flat vs last week")
- ✅ Ticket 4: Milestone inline edit — pencil icon (opacity 30 → 100 on hover), inline input with Save/Cancel, Enter/Escape, PATCH `{ title }` wired
- ⬜ Ticket 5: Today's Focus contextual note — BLOCKED on Darren (data shape TBD)
- ✅ Ticket 6: "+ N more threads" changed from `<p>` to `<button>` with accent color + hover:underline

### Landing page (T3 + T5)
- ✅ T3: Memory section headline bumped to `text-4xl md:text-5xl font-black`; body replaced with 3 punchy lines
- ✅ T5: Problem section and Edg3 Score section spacing normalized to `py-24`

### Pillar sweep (Design lane exhausted as of 2026-06-18)
- ✅ PILLAR-DAILY-CALL DC3/DC4: all Phase-2-gated or Core/Security owned — no Design items actionable
- ✅ PILLAR-TRUST T3-1: shipped (UX-2/3/4 above); T3-2–T3-4 delegated to Security
- ✅ PILLAR-MEMORY: M4-3b shipped (above); M4-4 blocked on Core; no remaining Design items

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
---

# EDG3 — QA Log (Core lane)

_Log of pillar QA checklist results. Code-verifiable items verified in-session; live-call items require manual verification during a real 7am call._

---

## 2026-06-18 (overnight loop 3) — Dashboard batch + multi-account + pillar exhaustion (Core lane)

- [x] **Derrick dashboard-review batch — 9/10 shipped** (tickets 1-7, 9, 10). Ticket 8 (consolidate dup priority sections) DEFERRED to a Core+Design structural call.
- [x] **Multi-account Google linking UI (P1)** — two sidebar slots (Calendar + Gmail) on Vijay's `GET /api/auth/accounts`; connect/disconnect Gmail wired.
- [x] **Pillar status re-audited against current files:** PILLAR-DAILY-CALL — all DC0-DC3 ✅ LIVE/FIXED; only DC4-1/2/3 remain (Phase-2 **gated**: needs 50 daily-call users). PILLAR-MEMORY — all M1-M4-2 + M4-3b ✅ LIVE (incl. fact-history/rollback API **and** "What Edge knows" UI with expand-to-previous-version); only M4-3 (**gated**: 30+ calls) + M4-4 (**blocked**: people-data cleanup) + M2-3#4 stress-precursors (no overwhelm signal) remain. **Core feature backlog is genuinely exhausted** — remaining items are all gated/blocked, not skipped.
- [x] **QA-rule E2E/route coverage added** for recently-shipped, previously-untested routes: `GET /api/priorities/history` (6 tests) + `POST /api/memory/facts/[id]/rollback` (6 tests — covers the PILLAR-MEMORY "rollback path" checklist item as an automated test). 1869/1869 green.
- [ ] **MANUAL (live call / live data) — cannot automate here:** the ★ 7am live-path, mid-call correction path, 30+-day fact reconfirmation, and the gated DC4/M4-3/M4-4 items. Listed for Derrick's live verification.

---

## 2026-06-18 (overnight loop 2) — Pillar loop additions (Core lane)

- [x] **M2-3 Pattern #5 — Priority drift detection** shipped. `detectPriorityDriftPattern()` in `lib/patternMemory.ts` — week-over-week Jaccard similarity on 8 weeks of priority history. STABLE signal (one priority anchored ≥70% of weeks, still current) → positive reinforcement in briefing. CHURN signal (avg sim < 0.34, no anchor) → one-line anchor invitation. Null on thin data (<3 weeks) or ambiguous middle band. `priorityQueries.getRecentWeeks()` added to `lib/db.ts`. Wired into `generateDailyBriefing` alongside the 4 existing calendar patterns. 10 new tests. 1747/1747.
- [x] **M2-4 — Context pack wiring** complete. `generateDailyBriefing` reads `briefing_context_packs` at call time, logs `[M2-4] context pack HIT/MISS`. When live Whoop fetch fails (all three null) and pack has HEALTH DATA section: uses pack's Whoop data as fallback, labeled "(using last night's context pack data)". Addresses DC2-3b edge case where token expires between 11pm pack-build and 7am call.
- [x] **UX-4 / T2-3 — 403 friendlyError** improved. Old: "reconnect your calendar." New: acknowledges BOTH causes (expired token OR organizer restriction). Applies to deleteEvent, editEvent, and all other mutation tools that hit `friendlyError`.
- [ ] **MANUAL (live call):** priority drift needs 3+ weeks of weekly priority rows to fire — verify once data accumulates.

---

## 2026-06-18 (overnight loop 1) — Pillar loop additions (Core lane)

- [x] **M4-1 / Round 6 T2 — mid-call reconfirmation** shipped. `lib/factConfidence.ts` (25 tests) consumes Security's `confidence_score`/`last_confirmed_at`; briefing injects ONE RECONFIRM block (category-weighted: goals first); `confirmFact` tool resets confidence on confirmation. Dual signal (score < 0.3 OR not-confirmed 30+ days) so it works before decay-categories align. **Note:** dormant for fresh accounts (correct — nothing stale yet); activates as facts age.
- [x] **DC0-2 — call-to-briefing latency** measured via `Promise.allSettled` over the 5 post-call memory jobs → `post_call_ms` on learning_status + `[DC0-2] HEALTH:` warn past 2 min.
- [x] **UX-4 — no false hedging** rule added to vapi + briefing prompts (state known facts plainly; only RECONFIRM facts hedged). **This is the item most likely to make tomorrow's call sharper.**
- [x] **DC2-0 verified airtight** (NO PREAMBLE + 2-sentence Part 1). **DC2-3b verified** (inline WHOOP STATUS block; removed my earlier duplicate). **DC0-1b verified** (extraction categories correct; auto-fetches calendar names for grounding).
- [x] **Flaky preflight FIXED** — `facts.test.ts` + `call-to-briefing.test.ts` now mock `./calendar` so `extractAndUpsertFacts`' auto event-fetch is deterministic. 3 consecutive clean full runs at 1737/1737.
- [ ] ⚠️ **Security flag:** `lib/scheduler.ts` decay-job categories don't match the `facts` CHECK constraint → decay updates 0 rows (detail in ROADMAP-CORE changelog). Reconfirmation still works via recency path.
- [ ] **MANUAL (live call):** reconfirmation won't fire until a fact is 30+ days unconfirmed; verify once data ages. confirmFact needs the Vapi dashboard tool created first.

---

## 2026-06-18 — Round 6 / Pillar Pass (Core lane)

### PILLAR-MEMORY — Code-level verification

**Storage**
- [x] episode insertion wired in webhook handler — `episodeQueries.insert` called after every call
- [x] fact extraction pipeline correct — categories (goal/person/project/preference/fact) with entity grounding, self-entity filter, assistant-entity filter, activity-word filter
- [x] bi-temporal conflict: upsertFact retires old + inserts new on statement change; verified in `lib/db-facts.test.ts`
- [x] `fact_history` audit trail: every fact write (created/retired/user-edit/extraction-update) logged; verified in db-facts tests
- [ ] **MANUAL: Complete a call → verify within 30 min: episode record in DB, ≥1 fact extracted, commitment in tasks table**
- [ ] **MANUAL: Tell Edge something new → Open "What Edge knows" → verify correct category**
- [ ] **MANUAL: Contradict a known fact → verify old fact retired (valid_until set), new one active**

**Learning**
- [x] sleep-time consolidation: duplicate active fact reconciliation (same entity+category) shipped (M2-1)
- [x] in-call memory trigger: updateFact always writes even for high-confidence facts (M2-2)
- [x] `extractAndUpsertFacts` returns count; 0 facts flags call for sleep-time review (DC0-1)
- [ ] **MANUAL: Check Railway logs for sleep-time consolidation after last call**
- [ ] **MANUAL: Mid-call correction ("actually X is Y now") → verify next briefing reflects Y**

**Retrieval**
- [x] 90-day hard cutoff in topFacts (filterStale: true) — stale facts no longer auto-inject into briefing (M3-1)
- [x] `searchMemory` Vapi tool wired (M3-2) — searches facts + episodes + memories on-demand
- [x] commitment tracking: 7-day window, oldest-first (M3-3) — most overdue commitment opens briefing
- [x] stale fact hedging: `[UNCONFIRMED >90d]` tag + "last I heard…" instruction (T2-2)
- [ ] **MANUAL: Ask Edge "what do you know about my gym schedule?" — verify correct answer**
- [ ] **MANUAL: Check briefing — outstanding commitments in first section?**

**Compounding**
- [x] `rollbackFact(userId, historyId)` added to `factHistoryQueries` — restores historical version (M4-3b)
- [x] every fact INSERT logs 'created' row to `fact_history` (M4-3b)
- [x] outcome-weighted reliability signal + commitment language calibration (M4-2)
- [x] `rememberPreference` undo: retireFact (new insert) / rollbackFact (update) wired (T4-5)
- [ ] **BLOCKED: M4-1 (confidence decay) — waiting on Security Round 6 T2 (confidence column)**
- [ ] **GATED: M4-3 (episodic-to-semantic) — needs 30+ calls of data**
- [ ] **BLOCKED: M4-4 (social mental models) — waiting on people-data cleanup**

---

### PILLAR-TRUST — Code-level verification

**User-facing trust basics**
- [x] UX-1: Landing page copy correct — "Edg3" throughout, "3 minutes" (not 5) — verified in `app/page.tsx`
- [x] UX-2: Duplicate contacts/facts guarded — entity grounding filter + 7 new tests (self, Edge, Edg3, activity words, repeated fact)
- [x] UX-3: Name spelling — STT correction in `lib/facts.ts` + userName hint in extraction prompt
- [ ] **MANUAL: Open dashboard → scan for any loading spinner that never resolves or stale data**

**Foundation**
- [x] T0-3: End-to-end smoke test `lib/call-to-briefing.test.ts` — 18 tests covering post-call chain
- [ ] **DELEGATED: T0-1 (DB backup off-box), T0-2 (encryption key custody), T0-4 (scheduler resilience) → Security lane**

**Accuracy**
- [x] T2-1: Fact grounding — extraction prompt + entity filters prevent hallucinated contacts
- [x] T2-2: Stale fact hedging in briefings (>90 days → [UNCONFIRMED] + "last I heard…")
- [x] T2-3: Honest failure messages — all tool-call failure paths audited; copyEvents vague message fixed
- [x] T2-4: Briefing accuracy regression suite — 6 tests covering Whoop signal, brand names, word count

**Transparency**
- [x] T3-1: "What Edge knows" completeness — all 5 DB categories (goal/project/person/preference/fact) rendered; pattern forward-compat
- [ ] **DELEGATED: T3-2 (activity log completeness), T3-3 (data export), T3-4 (account deletion) → Security lane**

**Resilience**
- [x] T4-5: Undo coverage — `planWeek` now records `deleteMany`; `rememberPreference` records `retireFact`/`rollbackFact`; new UndoOp types in `lib/undo.ts`
- [ ] **DELEGATED: T4-1–T4-4 (token refresh, Vapi resilience, SQLite concurrency, write-idempotency) → Security lane**

---

### PILLAR-DAILY-CALL — Code-level verification

**Flywheel integrity**
- [x] DC0-1: Per-call learning_status — `updateLearningStatus` tracks facts_ok/facts_extracted/extraction_ms/flagged_for_review
- [x] DC0-1b: Commitment extraction wired — `extractTasksFromTranscript` creates tasks with `source='edg3'` and due date; people + goal extraction categories correct in `extractFactsFromTranscript`
- [x] DC0-2: Timing log live — `[briefing] parallel-fetch Xms | whoop={...}` in Railway logs; fact extraction_ms in briefings table
- [ ] **MANUAL: Complete a call at 10pm → verify facts appear in next morning's briefing**

**Briefing quality**
- [x] DC2-0: No-preamble rule enforced — `CRITICAL — NO PREAMBLE` in briefing.ts; `OPENER RULE (DC2-0)` in vapi.ts
- [x] DC2-1: Opener skips routine events — breakfast/lunch/gym/meal-prep explicitly excluded from GREETING instruction
- [x] DC2-2: Personalization signal — `buildPersonalizationPromptBlock` closes with personal-context question when <3 stored facts
- [x] DC2-3: Commitment surfacing — `edg3Commitment` (oldest unresolved, 7-day window) moves into Part 1 before Edge Score
- [x] DC2-3b: Whoop honest acknowledgment — when connected but data null, briefing injects `WHOOP CONNECTED BUT DATA UNAVAILABLE` instruction
- [x] DC2-4: Briefing length calibration — "2 sentences MAX" Part 1, "3–4 sentences MAX" Part 2, 290 max_tokens, word-count warning at 250+

**Call experience**
- [x] DC3-3 (T2-3): Honest failure mid-call — tool-call failures return specific honest messages; no silent success/failure

---

### Items requiring live-call validation (run on next morning call)

Priority order:
1. **★ 7am live-path test**: call → say something new → verify in DB within 5 min → verify in next morning's briefing
2. Commitment test: say "I'll do X by Friday" → verify task with source='edg3' and dueDate in tasks table
3. People test: "I'm meeting Sarah tomorrow" → verify person-category fact created
4. Correction test: "actually my gym is now at 7am" → verify old fact retired, new one active
5. Memory retrieval test: "what do you know about my priorities?" → verify searchMemory returns correct results
6. Whoop test: with Whoop connected, run briefing → verify recovery score in Part 1
7. Undo test: "undo that" → verify last calendar mutation reversed
8. Rollback test: find a fact in fact_history, rollback, verify previous version now active
