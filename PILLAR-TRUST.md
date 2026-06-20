# 🔒 PILLAR: TRUST
_Permanent backlog. If your dispatch is exhausted, work through this in order. If this is exhausted too, run the QA checklist at the bottom._

> **The thesis:** Every user of Edge is sharing their goals, relationships, calendar, health, and voice. Trust isn't a feature — it's the product. If Edge gets something wrong, loses data, or behaves unexpectedly, the user leaves and never comes back. Every item in this pillar makes Edge more trustworthy. Ship them in order.

**Lane ownership:** Security (Vijay) leads. Core (Darren) contributes accuracy + error-message items. Design (Cam) contributes data-transparency UI items.

---

## 🎯 User-facing trust basics — the things that make or break daily trust

> These are not infrastructure items. They are the moment-to-moment product experience that makes a user feel Edge is reliable, smart, and on their side. A user who sees their name spelled wrong, gets a duplicate notification, or hits a stale button loses trust faster than any server outage.

### UX-1 — No stale or wrong UI copy anywhere (Core + Design) — ✅ **LIVE (Darren)**
**Shipped:** `app/page.tsx` — all "Edge" → "Edg3" on public-facing surfaces; "5 minutes" → "3 minutes" (hero, section heading, "How it works" step 1, features list, mock UI chip). Async note box references removed. 1652/1652 green.
**Known bugs (log here as found):**
- ~~`'📅 Book a time'` button on every notification~~ — **FIXED f1e1943**
- ~~Landing page "5 minutes" → "3 minutes"~~ — **FIXED Darren**
- ~~Landing page "Edge" → "Edg3"~~ — **FIXED Darren**
- **Process:** when Derrick flags a copy bug, fix it same-session. No ticket needed. Copy bugs are trust destroyers.

### UX-2 — No duplicate contacts, facts, or events (Core ✅ + Design ✅) — ✅ **SHIPPED (Design: edc52d7 + 195d849)**
**Core side DONE:** `isSelfEntity()` + `isAssistantEntity()` guards in `lib/facts.ts` block user's own name + "edge"/"edg3"/etc. from person facts; 80-char prefix dedup in `factQueries.upsertFact`; 4 verification tests added to `lib/facts.test.ts` (2026-06-18 session).
**Design side SHIPPED (2026-06-19):** Self-filter applied at two display layers — (1) person-category structured facts: entity field matched against user first/last name (case-insensitive), hidden when match found; (2) M2 People profiles: first-name token of `canonical_name` matched against user first/last name, filtered before render. Near-identical facts (first 80 chars) deduped per entity with "N duplicate entries merged" affordance. Logged in `content/qa-log.md`.
**The trust issue:** Derrick sees "Jim (gym)" appear twice in "What Edge knows." He sees the same event on his calendar twice. He sees himself listed as a contact. Each one signals Edge doesn't have it together.
- Duplicate contacts: people-extraction must check for existing people facts before inserting (fuzzy name match, case-insensitive). Entity grounding filter: block user's own name, "Edge", "Edg3", generic nouns.
- Duplicate facts: before inserting any fact, check if an identical or near-identical (80-char prefix match) active fact exists — skip if yes, update `last_seen_at` only.
- Duplicate events: `cleanupDuplicates` tool is live. Verify it runs correctly and that the morning briefing flags duplicate-heavy weeks proactively.
- Test: run extraction on a transcript that mentions the user, Edge, and a repeated fact — verify none produce duplicates.

### UX-3 — Name spelled correctly everywhere (Core ✅ + Design ✅) — ✅ **SHIPPED (Design: edc52d7)**
**Core side DONE:** `groundProperNouns` + STT correction wired in `lib/facts.ts`; `firstName` from profile drives all Edge addressing in `lib/vapi.ts`; 3 name-spelling tests added to `lib/facts.test.ts`. `correctRecipientNames()` in `lib/outreach.ts` handles email.
**Design side SHIPPED (2026-06-18):** `cursor: pointer` global CSS rule added to `app/globals.css` covering `button:not(:disabled)`, `[role="button"]:not([aria-disabled="true"])`, `a[href]`, `label[for]`, `summary`, `select`, `.clickable`; `cursor: not-allowed` on disabled states. Self/Edge/Edg3 entity filter applied in People section render. Profile `user.name` drives display-name references in dashboard copy.

### UX-4 — No bugs that make users uncertain (Core + Design — ongoing) — ✅ **SHIPPED (Design: edc52d7)**
**Shipped (Design 2026-06-18):** `content/cam-dispatch-ux-trust.md` UX-4 — collapsible memory category sections shipped: all section headers are `<button>` with `aria-expanded` + count badge + ▸/▾ chevron. `collapsedMemorySections` Set state + data-driven init: `useEffect` on first facts load collapses all but first 3 populated categories when ≥4 categories have data. Routes to Cam (Design) — Core side (honest failure messages) tracked separately as T2-3.
**The standard:** If Derrick has to wonder "did that work?" — it's a bug. Every mutation should produce a clear, honest confirmation. Every failure should produce a clear, honest explanation. No silent successes. No misleading errors.
- Audit every tool-call response in `app/api/vapi/tool-call/route.ts` — does every success say what happened? Does every failure say why?
- Audit the dashboard: any loading state that never resolves? Any button that does nothing? Any section that shows stale data?
- **Bug log (add here as found):** _(empty — log format: `[date] description — fixed in [commit] or open`)_

---

## 🚨 Tier 0 — Critical (do before anything else tonight)

### T0-1 — DB durability: off-box backup replication (Security — URGENT)
**The risk:** `lib/backup.ts` stores backups on the SAME Railway volume as the database. Volume loss = database AND backups gone simultaneously. The entire memory moat — every fact, episode, pattern ever learned — lives in one SQLite file with no off-box copy. We also don't know if the Railway volume is persistent or ephemeral. If ephemeral, data may already be resetting on redeploys.
- **Step 1:** Verify Railway volume type — persistent or ephemeral? Check Railway dashboard → Volume settings. If ephemeral, this is a production data-loss incident happening right now.
- **Step 2:** Stand up Litestream → object storage replication (Railway's object storage or R2/S3). Litestream streams WAL pages continuously so RPO is seconds, not hours. The backup must live in a different failure domain than the DB.
- **Step 3:** Move the backup trigger OFF the webhook handler — backups must run as a scheduled cron (e.g., every 15 minutes), not triggered by an incoming call. A backup firing inside a webhook is fragile and blocks the response path.
- **Step 4:** Add a **Restore Drill** item to the Trust QA checklist — backups you've never restored from are not backups. Vijay should do one restore from a real snapshot before marking this complete.
- Test: simulate volume replacement, restore from off-box snapshot, verify data is intact and app works

### T0-2 — Encryption key custody: backup + graceful fallback + rotation protocol (Security) — ✅ **FIXED 29373e1**
**Shipped:** `safeDecryptField` returns null on failure (no crash); `content/encryption-key-rotation.md` written; startup health check logs CRITICAL if key missing. Key backed up to secondary Railway secret.
~~**The risk:** `DATA_ENCRYPTION_KEY` has no backup and no versioning. If the key is lost, rotated, or accidentally changed on Railway, every encrypted field in the database becomes permanently unreadable. Currently `decryptField` throws on key mismatch — which would crash reads across the entire app simultaneously.~~
- **Step 1:** Back up `DATA_ENCRYPTION_KEY` to a second secure location (Railway secret + an external vault). Document the backup location in `content/security-audit.md` (the location, not the key itself).
- **Step 2:** Make `decryptField` degrade gracefully — if decryption fails, return `null` and log the failure rather than throwing. Callers already handle null. A null is recoverable. A crash is not.
- **Step 3:** Add a key-presence health check on app startup — if `DATA_ENCRYPTION_KEY` is missing, log a critical error and disable write operations rather than starting in a broken state.
- **Step 4:** Write a one-page `content/encryption-key-rotation.md` doc: **never rotate the key without first running a re-encryption migration** (read every encrypted field, decrypt with old key, re-encrypt with new key, write back). Without this doc, whoever touches the key next will silently corrupt all data.
- Test: temporarily remove the key, verify app degrades gracefully rather than crashing; restore key, verify reads resume

### T0-3 — End-to-end smoke test: the "7am path" (Core) — ✅ **FIXED 6bec403**
**Shipped:** `tests/e2e/call-to-briefing.test.ts` written and green — simulates webhook → verifies transcript stored, fact extracted, episode created, briefing context includes extracted fact. Runs as part of preflight.
~~**The risk:** 1,407 unit tests verify individual functions. None of them verify the full production path: call connects → transcript stored → facts extracted → sleep-time consolidation runs → next morning's briefing has accurate context. This path has never been automatically tested. It could be silently broken.~~
- Write a `tests/e2e/call-to-briefing.test.ts` smoke test that:
  1. Simulates a completed call (posts a mock webhook payload)
  2. Verifies transcript is stored in the briefings table
  3. Verifies at least one fact is extracted and stored in the facts table
  4. Verifies episode record is created
  5. Calls the briefing builder and verifies the new fact appears in the output
- This test runs as part of preflight. If the 7am path breaks, this catches it before deploy.
- Note: this is an integration test, not a unit test — it hits the real database layer

### T0-4 — In-process scheduler resilience (Security)
**The risk:** The morning call scheduler runs as an in-process `setTimeout`. If Railway restarts the app (redeploy, crash, memory limit), the scheduled call drops silently. The user wakes up, no call, no explanation.
- Move scheduled jobs to a persistent queue rather than in-memory setTimeout — at minimum, write the next scheduled call time to the database on startup and restore it on restart
- On app startup: check if any scheduled calls were missed in the last 2 hours (comparing `call_time` to `now()`). If yes, trigger immediately rather than waiting until tomorrow.
- Test: restart the app 10 minutes before a scheduled call, verify the call still fires

---

## Tier 1 — Foundation (hardening the path data travels)

### T1-1 — Webhook reliability: retry + dead-letter queue (Security)
**The risk:** If the Vapi → webhook → memory pipeline fails silently, a call happens and nothing is learned. The user doesn't know. Edge doesn't know. The moat leaks.
- Add retry logic (3 attempts, exponential backoff) to the webhook handler in `app/api/vapi/webhook/route.ts`
- If all retries fail: write a `failed_webhooks` record (userId, callId, failedAt, error) for diagnosis
- Add a daily check: any failed webhooks in the last 24h? Log a warning to Railway so it's visible
- Test: simulate a webhook failure mid-processing, verify retry fires, verify failure is logged

### T1-2 — End-to-end call health check (Security + Core) — ✅ **CORE SIDE LIVE (DC0-1)**
**Core side shipped:** Webhook handler tracks `{facts_ok, facts_extracted, episode_ok, flagged_for_review}` via `briefingQueries.updateLearningStatus` — covers all three DC0-1 checks (transcript stored on call-end, facts extracted, episode created). Zero-facts calls set `flagged_for_review: true`. **Security side** (`call_health_events` table + weekly summary) owned by Vijay.
~~**The risk:** A call can "succeed" in Vapi but fail to produce a briefing, a transcript, or a memory update.~~

### T1-3 — Observability: single alert path + daily admin health digest (Security) — ✅ **FIXED 29373e1**
**Shipped:** 6am health digest cron writes to `health_log` table + emits "HEALTH: OK"/"HEALTH: DEGRADED" log line; `background_job_failures` table logs every failed background job with error; `call_health_events` table logs post-call verification results; Railway log-based alerts fire on HEALTH: DEGRADED.
~~**The risk:** Today every failure hits only `console.error` — invisible in production. A 7am call fail, a backup fail, a decrypt error, an extraction fail: all silent. There is no way to know Edge is degraded without the user noticing first.~~
- **Single alert path:** implement one outbound alert channel (Railway log-based alert → email/Slack/webhook) triggered by any of: 7am call failed to connect, backup cron failed, `decryptField` error, memory extraction failed for a call. The channel doesn't matter — one reliable signal is the goal.
- **Daily admin health digest:** a 6am cron (runs before the 7am call) that checks: backup ran successfully in the last 24h? Any calls failed yesterday? Any extraction failures? Any decrypt errors? Write result to a `health_log` table and emit one summary log line. Derrick can check Railway logs for "HEALTH: OK" vs "HEALTH: DEGRADED (reason)".
- Wrap every background job (sleep-time consolidation, pattern detection, predictive context loading) in try/catch with structured error logging
- Failed jobs: log `{job, userId, failedAt, error}` to a `background_job_failures` table
- Test: force a failure in the sleep-time consolidation job, verify it's logged, verify the alert path fires, verify the next call isn't broken

### T1-4 — Encryption audit: verify all sensitive fields (Security) — ✅ **FIXED 2026-06-18**
**Shipped:** Full encryption coverage map in `content/data-protection.md` (Security reference section). All HIGH tables confirmed encrypted; 3 accepted plaintext gaps documented (priorities.text, undo_log.payload, people_profiles canonical_name — tracked for future pass). Cipher: AES-256-GCM per-value random IV.
~~**The risk:** New tables have been added across Core and Security over many sessions. Not all of them have been confirmed encrypted at rest.~~
- Audit every table in `lib/db.ts` that stores user-generated content
- For each: confirm it calls `encryptField()` on write and `decryptField()` on read
- Tables most likely to be missing: `briefing_context_packs`, `background_job_failures`, `call_health_events`, `people_models` (when shipped)
- Document the full encryption coverage map — add a section to `content/data-protection.md`

### T1-5 — Rate limit coverage sweep (Security) — ✅ **FIXED 0eed8a8**
**Shipped:** All POST/PATCH/DELETE routes audited; missing rate limits added; inventory updated in `content/security-audit.md`.
~~**The risk:** Core has added new routes since the last rate-limit sweep. Unprotected mutation endpoints are an attack surface.~~
- Scan every `POST`/`PATCH`/`DELETE` in `app/api/**` added since the last audit
- Add `rateLimit()` to any unprotected mutation route
- Update the rate-limit inventory in `content/security-audit.md`

---

## Tier 2 — Accuracy (Edge says true things)

### T2-1 — Fact grounding: no hallucinated entities (Core) — ✅ **LIVE (Round 5)**
**Shipped:** `lib/facts.ts` has `isSelfEntity`, `isAssistantEntity`, `isActivityEntity` guards; M2 contact grounding drops low-confidence people with no real contact match when profile data exists; `factQueries.upsertFact` deduplicates by (category, entity) + 80-char prefix match; `consolidateFacts` post-pass cleans residual near-dups. Tests cover blocking "Edge", "Jim (gym)", self-reference. See `lib/facts.test.ts`.
~~**The risk:** People-extraction has produced hallucinated contacts (Jim-from-gym appearing as a person, Edge itself appearing as a contact, duplicate Pfizer entries). These corrupt memory and produce wrong briefings.~~

### T2-2 — Stale fact surfacing in briefings (Core) — ✅ **FIXED ecd6901**
**Shipped:** Briefing builder hedges facts older than 90 days with "last I heard…"; pairs with confidence decay (Round 6 T2) for automated scoring.
~~**The risk:** Edge mentions a fact that was true 3 months ago but hasn't been confirmed since. It sounds confident. It's wrong. The user loses trust instantly.~~
- In the briefing builder: when injecting facts older than 90 days with no reconfirmation, add a soft hedge: "last I heard..." rather than stating it as current
- Pair with the confidence decay column (Round 6 T2) when it lands: facts below 0.5 confidence get hedged; below 0.3 get flagged for reconfirmation
- Test: inject a 91-day-old fact, verify briefing text hedges it

### T2-3 — Honest failure messages across all tool-call handlers (Core) — ✅ **FIXED 014bd70**
**Shipped (Loop 7):** `friendlyError` updated — 403 now offers "Want me to draft a message to the organizer instead?" (draftEmail path); added rate-limit (429 → "Google Calendar is temporarily rate-limiting") + timeout (ETIMEDOUT/ECONNRESET → "The request timed out") cases. `FAILURE_RE` updated to match new messages. 1816/1816 green.
~~**Partial progress:** 2026-06-13 NEVER PUNT changes removed "do it yourself" language. Two remaining rough edges (2026-06-18): generic catch-all + 403 message for non-moveEvent organizer restrictions.~~

### T2-4 — Briefing accuracy regression test (Core) — ✅ **LIVE (Darren + Kevin)**
**Shipped:** `buildBriefingContext(user, data, today?)` pure function extracted from `lib/briefing.ts` — all assembly rules in one testable export (commitment ordering, stale filter, calendar deprioritization, relationship scoping, personalization floor, confidence hedging, 16k cap). 10 spec-driven regression assertions added to `lib/briefing.test.ts` covering every rule. Prior regression guards (composite signal, fallback brand, Whoop format) still green. 1828/1828 green.
~~**The risk:** Changes to the briefing builder silently degrade briefing quality — missing facts, wrong priorities, stale context.~~

---

## Tier 3 — Transparency (user can see and control everything)

### T3-1 — "What Edge knows" completeness audit (Core + Design) — 📋 **AUDITED 2026-06-18**
**Audit result:** DB CHECK constraint at `lib/db.ts:251` allows: `('person','project','goal','preference','fact')`. Dashboard CATEGORY_META + ORDER include all 5 plus `'pattern'`.
**Gap:** `'pattern'` category appears in the dashboard ORDER/render (`app/dashboard/page.tsx:2589`) and TypeScript types, but is NOT in the DB CHECK constraint. `lib/factPatterns.ts` stores pattern facts as category=`'fact'` + `source='historical-pattern'` — so the Patterns section will always be empty. Fix: add `'pattern'` to the DB CHECK constraint via migration in `lib/db.ts` and update `factPatterns.ts` to store as category=`'pattern'`. Route to Vijay (DB constraint) + Darren (factPatterns.ts).
**The risk:** The Memory tab shows some facts but may not show all of them. Users can't correct what they can't see.
- Audit every fact category stored in the `facts` table: are all categories rendered in the Memory tab?
- If any category is missing from the UI: add it
- Test: insert a fact in every category via a test call, verify all appear in the dashboard

### T3-2 — Activity log completeness (Security) — ✅ **DOCUMENTED (content/security-audit.md)**
**Status:** Full audit_log coverage map written to `content/security-audit.md` "Audit Log Coverage" section (78 routes reviewed 2026-06-17/18). All HIGH mutations covered; intentional non-logged routes documented with justification. Spot-check any routes added after the sweep date against the coverage map.
**The risk:** The audit log may not cover all user-triggered mutations. Users can't trust the Activity tab if it's incomplete.
- Audit every `POST`/`PATCH`/`DELETE` route: does it write to `audit_log`?
- Add logging to any missing route
- Document full coverage in `content/security-audit.md`

### T3-3 — Data export accuracy (Security) — 📥 **DISPATCHED 2026-06-18**
**Audit written:** `content/export-audit.md` — full gap analysis of `app/api/account/export/route.ts`. Route to Vijay (Security).
**Missing from current export (v1):** `episodes` (call ground-truth records — HIGH), `audit_log` (every action Edge took — HIGH), `fact_history` (versioned memory audit trail — MEDIUM), `undo_history` (LOW). Also: facts export should include retired facts with status + retiredAt; confidence_score + last_confirmed_at should be included per fact; version bump to '2'.
**The risk:** The data export (Settings → Account → Export) may not include everything Edge stores, or may include it in an unreadable format.
- Audit the export endpoint: does it include facts, memories, episodes, call transcripts, priorities, tasks, activity log, and the user's current privacy setting?
- If anything is missing: add it
- Test: create a complete user account with data in every category, export, verify completeness

### T3-4 — Account deletion completeness (Security) — ✅ **FIXED 0eed8a8**
**Shipped:** Deletion handler audited and updated to cover all tables including episodes, briefing_context_packs, call_health_events, background_job_failures, people_models (pre-emptive), fact_history, pattern_cache.
~~**The risk:** When a user deletes their account, some data may be left behind in tables added after the deletion route was written.~~
- Audit the deletion handler: does it delete from every table that stores user data?
- Tables most likely to be missing: `briefing_context_packs`, `call_health_events`, `background_job_failures`, `people_models`, `episodes`
- Test: create a user, populate all tables, delete, verify no rows remain anywhere

---

## Tier 4 — Resilience (Edge keeps working when things go wrong)

### T4-1 — Google token refresh reliability (Security) — ✅ **FIXED 29373e1**
**Shipped:** `lib/google-auth.ts` handles refresh failures gracefully; 3 consecutive failures write a reconnect flag to user record; next briefing surfaces "reconnect Google" notice.
~~**The risk:** OAuth tokens expire. If the refresh fails silently, all calendar/Gmail operations fail for that user until they manually reconnect.~~
- Audit `lib/google-auth.ts`: does it handle refresh failures gracefully? Does it surface a clear error rather than a silent 401?
- If token refresh fails 3+ times: write a flag to the user record so the next briefing can tell them to reconnect
- Test: force a token expiry, verify refresh fires, verify failure is surfaced

### T4-2 — Vapi connection resilience (Security) — ✅ **FIXED 82e2f6f**
**Shipped:** Pre-call health ping 5 minutes before scheduled call; if unhealthy, dashboard notification fires immediately ("Edge couldn't reach you this morning — we'll try again tomorrow").
~~**The risk:** If Vapi is unavailable, calls fail with no user notification. The user wakes up, no call, no explanation.~~
- Implement a pre-call health check: 5 minutes before a scheduled call, ping Vapi status. If unhealthy, send the user a dashboard notification: "Edge couldn't reach you this morning — we'll try again tomorrow. Check your connection settings."
- Test: simulate Vapi unavailability, verify notification fires

### T4-3 — SQLite concurrency + write-lock behavior under load (Security) — ✅ **FIXED 0eed8a8**
**Shipped:** `PRAGMA journal_mode=WAL` and `PRAGMA busy_timeout=5000` added to `getDb()` in `lib/db.ts`; `scheduler_lock` table added so second replica skips the call rather than double-dialing.
~~**The risk:** SQLite on Railway can hit locking issues under concurrent write load. Background jobs (sleep-time consolidation, pattern detection, predictive context loading) running simultaneously with incoming webhooks could produce write contention. Untested at multi-user scale — will bite as users grow.~~
- Audit `lib/db.ts` `getDb()`: is WAL mode enabled? Is `busy_timeout` set?
- Add `PRAGMA journal_mode=WAL` and `PRAGMA busy_timeout=5000` if not present
- Add a single-instance scheduler lock: if Edge ever scales beyond 1 Railway replica, the 7am call must not fire twice (double-dial). Implement a `scheduler_lock` table row that the scheduler claims before dialing and releases after — second instance sees the lock and skips.
- Test: simulate concurrent writes from 5 simultaneous webhook calls, verify no locking errors or dropped writes

### T4-4 — Write-idempotency sweep (Security + Core) — ✅ **FIXED 5655b88**
**Shipped:** `webhook_dedup_keys` and `tool_call_dedup_keys` tables added; atomic claim gates on all Vapi webhook + tool-call handlers; `confirmFocus` already had idempotency from earlier; 10 new dedup tests green.
~~**The risk:** The `confirmFocus` duplicate-call bug class — a webhook fires twice (Vapi retry, network retry, double-tap) and a mutation runs twice. Every write endpoint should be safe to call twice with the same payload.~~
- Audit every `POST`/`PATCH`/`DELETE` in `app/api/**` — does it have idempotency protection?
- Priority endpoints: `app/api/vapi/webhook/route.ts` (call end), `app/api/tasks/**`, `app/api/memory/**`, all `tool-call` handlers
- Pattern: accept an optional `idempotencyKey` on write endpoints; if a key has been seen in the last 24h, return the cached result rather than re-executing
- Test: POST the same payload twice to a mutation endpoint, verify the mutation only happens once

### T4-5 — Undo coverage: every mutation must be reversible (Core) — ✅ **FIXED 2026-06-18**
**Audit result (2026-06-18):** All non-calendar gaps now closed.
- **`planWeek`** ✅ — already had `recordUndo` at `tool-call/route.ts:787` (prior audit note was stale).
- **`setPriorities`** ✅ **FIXED 2026-06-18** — snapshots previous priorities + calls `recordUndo` with new `restorePriorities` op; `lib/undo.ts` `executeUndo` handles it. 3 new tests in `lib/undo.test.ts`.
- **`rememberPreference`** ⚠️ — fact upsert has no undo, but bi-temporal `fact_history` provides reversibility via dashboard (acceptable — no calendar surface).
- **`setMyTimezone` / `setEnergyLevel` / `confirmFocus`** — low priority; reversible by re-calling; not needed for undoLastAction.
**Covered:** editEvent ✅, researchToEvent ✅, createEvent ✅, createRecurringEvent ✅, deleteEvent ✅, moveEvent ✅, colorEvent ✅, colorEventsByEnergy ✅, copyDayEvents ✅, draftEmail ✅, cleanupEvents ✅, cleanupDuplicates ✅, applyCalendarPlan ✅, planWeek ✅, setPriorities ✅.
**The risk:** Undo was added for calendar mutations. But later mutations (email drafts, memory updates, task completions, episode inserts) may not be covered.
- Audit every mutation in `app/api/vapi/tool-call/route.ts`: does it call `recordUndo`?
- Add `recordUndo` to any handler that's missing it
- Test: trigger every tool-call mutation, verify an undo record exists in the `undo_log` table, verify undo actually reverses the action

---

## QA Checklist — run when pillar backlog is exhausted

> **QA rule (Kevin):** When this backlog is exhausted, the lane writes and runs END-TO-END tests for each pillar item — not unit tests. Unit tests verify code. End-to-end tests verify the live path. A green unit test suite and a broken production path are fully compatible.

Work through each item manually. Log the result (pass/fail/partial) in a `content/qa-log.md` file with date and notes.

### Memory pipeline
- [ ] Make a call. Verify transcript is stored in the briefings table within 5 minutes
- [ ] Make a call where Derrick says something new ("my new goal is X"). Verify it appears in "What Edge knows" by the next call
- [ ] Make a call where Derrick contradicts an existing fact ("actually my gym is now at 7am"). Verify the old fact is retired and the new one is active
- [ ] Check the episode store: after every call, a new episode record should exist
- [ ] Verify sleep-time consolidation ran after the last call (check logs)

### Accuracy
- [ ] Open "What Edge knows." Read every fact. Are any of them wrong or outdated?
- [ ] Make a call where Edge references a fact. Does Edge state it accurately?
- [ ] Make a call where a tool fails (e.g., try to move a read-only calendar event). Does Edge give an honest explanation?
- [ ] Check the last 5 briefings. Did Edge mention anything that wasn't true?

### Data protection
- [ ] Connect a new Google account. Verify calendar and Gmail access work
- [ ] Disconnect Google. Verify the OAuth tokens are removed from the database
- [ ] Check the audit log after a calendar mutation. Is the action logged with the correct userId?
- [ ] Attempt to access another user's data via a direct API call. Verify it returns 404

### ★ End-to-end smoke test — run this first, every time
- [ ] **★ 7am live-path test:** trigger a call → verify transcript stored in `briefings` table within 5 min → verify at least 1 fact extracted and in `facts` table → verify next morning's briefing references that fact. This is the single most important thing to verify. 1592 unit tests do NOT cover this path. If this fails, everything else is secondary.
- [ ] Run `tests/e2e/call-to-briefing.test.ts` if it exists (Darren owns writing it — T0-3)

### Reliability
- [ ] Check Railway logs for the last 24h. Any 500 errors? Any failed background jobs?
- [ ] Check Vapi dashboard: did all scheduled calls connect? Any failures?
- [ ] Check the failed_webhooks table. Any entries?
- [ ] Check the `health_log` table — did the 6am health digest run? Status: OK or DEGRADED?
- [ ] **Restore drill:** take a recent backup snapshot, restore it to a test DB, verify the app reads from it correctly. "Backups you've never restored are not backups."
- [ ] Run `npm run preflight`. Should be green

### Transparency
- [ ] Open Activity tab. Does it show every action Edge has taken in the last 7 days?
- [ ] Open "What Edge knows." Can you see, edit, and delete every fact?
- [ ] Go to Settings → Account → Export. Does the export contain all your data?
- [ ] Go to Settings → Privacy. Is your current consent setting displayed correctly?
