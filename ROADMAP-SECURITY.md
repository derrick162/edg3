# 🔒 EDG3 — Security & Reliability Lane

> Backlog for the **Edg3 Security & Reliability** session. Governed by the shared
> [`ROADMAP.md`](ROADMAP.md) constitution — read that first (ownership map,
> worktree isolation, merge protocol). Work on branch `security` in
> `C:\Users\Derrick\edg3-security`. Update this changelog in the same commit that
> ships work, and claim files in the constitution's Status Board before touching
> anything in the ⚠️ Shared list.

## 📥 PM DISPATCH — 2026-06-17 (ROUND 5 — Bi-temporal fact schema)

> Master at `e7357cc`. `git merge master` first. **READ FIRST:** `content/memory-research-applied.md`
> (Zep/Graphiti bi-temporal model). This is the schema foundation for the memory self-learning flywheel —
> Core builds the conflict-resolution logic on top. Coordinate query shape with Darren.

### Ticket 1 — ★ Bi-temporal columns on the `facts` table (P1)
- Add `valid_from TEXT DEFAULT (datetime('now'))` and `valid_until TEXT` (nullable) to the **`facts`** table
  (`lib/db.ts` ~line 228). Additive, defaulted — no migration drama. NOTE: Edge's entity facts live in `facts`,
  NOT `memories` (the spec says "memories" generically, but `memories` is raw call notes — facts is the fact store).
- Add `factQueries.retire(userId, factId)` → sets `valid_until = datetime('now')`; NEVER hard-delete. User-scoped (`AND user_id = ?`).
- Support an "active only" filter (`valid_until IS NULL`) on fact reads. Keep ADDITIVE so existing callers don't
  break — default to active-only or add an `includeRetired` flag; coordinate the exact shape with Darren (he wires
  conflict-resolution on top in `lib/facts.ts`).
- Retired facts are historical record (they feed pattern detection). `facts.statement` is already encrypted at rest — keep it.

### Ticket 2 — verify new memory tables encrypted + scoped (carry-over)
- M2/M3/M4 tables (relationships/patterns/accountability) + `episodes`: confirm content encrypted at rest +
  user-scoped authz. Episode ingestion consent-gating audit (respect `data_consent` / `isImproveConsented`).

> Small / green / full preflight. Update changelog + Status Board.

---

## 📥 PM DISPATCH — 2026-06-18 (ROUND 4 — Launch hardening: audit log gaps + rate-limit sweep)

> Master at `30ff3df`. `git merge master` first (picks up CASA enforcement you already shipped).
> CASA is done. This dispatch is pre-launch hardening — close the remaining trust gaps before September.

### Ticket 1 — Audit log coverage sweep

The `audit_log` table records calendar mutations and email drafts. Before launch, verify it covers every action a user can trigger and close any gaps.

1. List every `POST`/`PATCH`/`DELETE` route in `app/api/**` that mutates user data. For each: confirm it writes to `audit_log` (or explain why it doesn't need to).
2. Routes most likely to be missing: `/api/onboarding/**`, `/api/memory/facts/[id]` (PATCH — fact edits), `/api/priorities/**`, `/api/open-loops/**`.
3. For any missing: add a `recordAuditEvent(userId, action, args, snapshot)` call. Reuse the existing pattern from calendar mutations.
4. Document the full coverage map in `content/security-audit.md` under a new "Audit log coverage" section.

### Ticket 2 — Rate-limit gap check

Round 3 shipped 36 rate-limited route types. Before launch, verify there are no obvious unprotected mutation routes remaining — especially any new routes Core has added since Round 3 (Focus Scoreboard, CASA consent endpoint, any new onboarding routes).

1. Scan `app/api/**` for `POST`/`PATCH`/`DELETE` routes added or modified since your last sweep.
2. Add `rateLimit()` to any unprotected mutation endpoint.
3. Update the rate-limit inventory in `content/security-audit.md`.

Ship small / green / full preflight. Update changelog + Status Board when done.

---

## 📥 PM DISPATCH — 2026-06-18 (Data consent enforcement — CASA requirement)

> Master at `65c04dd`. Sync master first. Full spec: `specs/data-control-onboarding.md`.
> Core owns the DB column + onboarding wiring; Design owns the screen. You own making the choice TRUE.

**Your piece (Security — enforcement layer):**

1. **Enforce Privacy Mode in the data pipeline.** When `users.data_consent = 'privacy'`, that user's calls, transcripts, and facts must NEVER enter any training/improvement pathway or be sent to any third party. Audit every outbound data path (any batch export, model fine-tuning pipeline, analytics sink) and add a `data_consent` check. Right now Edg3 doesn't have a training pipeline, so the primary task is: document the enforcement (what this means today = no data leaves except to OpenAI/Anthropic for inference as required to provide the service) and add a sentinel assertion to any future path that would extract training data.

2. **Privacy Mode must be honored in any inference calls.** If a future session-level or user-level fine-tuning path is added, it must check `data_consent = 'improve'` before including the user's data. Add a comment in any LLM-call path flagging this.

3. **Document for CASA.** Add a section to `content/security-audit.md`: "Data consent and Privacy Mode" — describes the two choices, the DB enforcement, what data flows where under each setting, and the audit trail. Google reviewers will look for this.

4. **Data export includes consent setting.** If there is a `/api/account/export` endpoint (or when it's built), include `data_consent` in the export so users can verify their setting.

**Dependency:** wait for Core to add the `users.data_consent` column before enforcing. Coordinate on timing — this is additive.

---

## 📥 PM DISPATCH — 2026-06-17 (S3 — harden the hero-loop apply path)

> Master at `4f68720` (1015 green). S1+S2 shipped ✅. Sync master first.

**S3 — Audit + harden the hero-loop APPLY path.** Core (Ticket H) is deepening the hero loop —
the one-click **Apply** executes a batch of real calendar mutations (create/move) via
`/api/day-plan/confirm`. As it gets richer + more prominent, that path must be safe:
1. **Idempotency / double-apply** — `/api/day-plan/confirm` uses a `planId` (`issueDeleteToken`).
   Verify a double-click / retry can't apply the same plan twice (duplicate events / double moves).
   Confirm the token is consumed atomically and reuse is rejected.
2. **Undo grouping** — a multi-action plan must be undoable as a unit (recordUndo per action, grouped
   by planId). Verify the undo path covers every applied action.
3. **Rate limit** — confirm `dayPlanConfirm` limit is sane for one-click use.
4. **Authz** — a planId issued for user A must not be applicable by user B (user-scoped).
Coordinate with Darren (he's editing `/api/day-plan/**` for H). Tests. Ship small / green /
full preflight / log changelog.

---

## 📥 PM DISPATCH — 2026-06-16 EVENING (Vijay)

> Master at `2c73f5b` (997 green). Sync master first. Two contained tasks:

**S1 — Harden + audit the new public `/api/waitlist` endpoint.** PM shipped it (`bda358f`) to fix
the dead landing CTA — it's the first **unauthenticated public write** endpoint. Review it:
confirm IP rate-limit is effective (5/hr `waitlist` key), email validation can't be abused
(header injection, oversized input, unicode tricks), no enumeration leak (it returns generic
success — verify), and the `waitlist` table can't be spammed to exhaustion. Add anything missing
(e.g., basic disposable-domain guard is optional). Add the `waitlist` table to the backup/export
set if it's not already covered. Tests.

**S2 — Resolve the parked CSP decision for real.** Strict nonce CSP was reverted (broke prod —
Turbopack didn't emit nonces). EITHER reproduce locally (`next build && next start`, curl the HTML,
confirm `<script>` tags carry `nonce="…"`) and re-enable strict CSP if it genuinely works in a
browser, OR formally close it out: document that `'self' 'unsafe-inline'` is the accepted pre-beta
baseline and remove the "follow-up" TODO so it's not a lingering open item. Don't redeploy strict
CSP without browser-verified enforcement.

Ship small / green / full preflight / log changelog.

---

## Changelog
- **2026-06-18** — **Round 4 — Audit log coverage + rate-limit sweep (1501 green).**
  - **Ticket 1 — Audit log coverage:** Added `auditLogQueries.record(...)` to 12 previously-ungapped routes: `calendar/disconnect` (ok+fail), `whoop/disconnect` (ok+fail), `calendar/reminder` DELETE + POST (ok+fail), `onboarding/call-time`, `onboarding/profile`, `profile/timezone`, `priorities/[id]/energy`, `priorities/[id]/milestones` POST, `milestones/[id]` PATCH (complete/uncomplete) + DELETE. Full coverage map updated in `content/security-audit.md`.
  - **Ticket 2 — Rate-limit sweep:** Added 6 new `LIMITS` entries to `lib/rateLimit.ts`: `calendarDisconnect` (5/hr), `whoopDisconnect` (5/hr), `calendarReminder` (10/hr), `profileTimezone` (20/hr), `priorityEnergy` (30/hr), `milestoneWrite` (60/hr). Applied to all corresponding routes. Rate-limit inventory in `content/security-audit.md` updated to 42 total keys.
  - **Tests:** 6 new route test files (calendar/disconnect, whoop/disconnect, profile/timezone, priorities/[id]/energy, priorities/[id]/milestones, milestones/[id]) — 45 new tests covering 401, 429, 400 validation, 200 happy path, audit record assertions. 77 test files / 1501 tests total.
- **2026-06-18** — **Episode store — ground-truth episodic memory tier, schema + encryption (1456 green).**

  PM dispatch (Kevin — cross-session): build the missing episodic memory tier per `specs/episode-store.md`.

  **`episodes` table** added to `lib/db.ts` (additive migration, `CREATE TABLE IF NOT EXISTS`):
  - `id, user_id (FK+idx), source ('call'|'calendar'|'email'), occurred_at (ISO; compound idx with user_id), content_raw TEXT (AES-256-GCM encrypted — rawest PII we hold), topics TEXT (JSON arr), commitments TEXT (JSON arr), created_at`
  - Compound index `(user_id, occurred_at DESC)` for temporally-ordered user lookups.

  **`episodeQueries`** (exported from `lib/db.ts`):
  - `insert(userId, source, occurredAt, contentRaw, topics?, commitments?)` — encrypts `content_raw` via `encryptField`. JSDoc gates: callers MUST check `isImproveConsented(user)` before calling — episodes hold raw PII and must not persist for Privacy Mode users.
  - `recent(userId, limit?)` — newest-first, user-scoped at SQL level.
  - `search(userId, {topic?, since?, unresolvedCommitments?, limit?})` — `since`/`unresolvedCommitments` filtered in SQL; `topic` post-filtered (JSON array substring match).
  - `prune(retentionDays?)` — default 365 days; deletes by `occurred_at` age to bound storage while preserving the year-of-history moat value.

  **`lib/episodes.test.ts`** — 18 new tests: insert encryption, recent user-scoping + decryption, search filters, authz (no cross-user leakage), prune smoke tests.

  **Coordination note for Core (Darren):** `episodeQueries` is ready. Wire the write path after each call ends: check `isImproveConsented(user)` → `episodeQueries.insert(userId, 'call', occurredAt, groundedTranscript, topics, commitments)`. Wire the query path in `lib/briefing.ts` for prior-commitment recall.

- **2026-06-18** — **Memory moat audit — M1–M4 encryption gaps closed (1384 green).**

  Audit of new memory-moat tables from Core's recent sprint. Two encryption gaps found and fixed.

  **`focus_milestones.title` — encrypted at rest.** Previously stored plaintext. Added `decryptFocusMilestoneRow` helper (same pattern as `decryptOpenLoopRow`). `create()` now wraps with `encryptField(title)`; `listForUser()` and `listForPriority()` map through the helper on read. Legacy plaintext rows pass through transparently (existing `decryptField` behavior).

  **`support_messages.message` — encrypted at rest.** `insert()` now wraps with `encryptField(message)`; `list()` decrypts on read. Added admin-only JSDoc comment to `list()` — it has no `WHERE user_id` clause intentionally (admin view), but that scope gap is now documented so it's never accidentally called from a user-facing route. No user-facing route currently calls `list()`.

  **All other M1–M4 tables verified clean:** `daily_focus.focus_areas` already encrypted; `event_energy_tags` no PII; `calendar_plan_executions` no PII; `open_loops.description` already encrypted with `decryptOpenLoopRow`.

  **S3 audit complete:** `/api/day-plan/confirm` already has all 4 required properties — idempotency (atomic `consumeDeleteToken` transaction), user-scoped authz at DB level, undo grouping by planId, rate limiting. Existing 13-test suite covers all S3 requirements. No code changes needed.

  **Tests:** 8 route tests (`app/api/support/route.test.ts` — auth, rate limit, validation, success path) + 8 DB-level encryption tests (`lib/db.encryption.test.ts` — verifies `encryptField`/`decryptField` called correctly for both tables). 1384 green total.

- **2026-06-18** — **CASA consent enforcement wired — Privacy Mode now blocks improvement-data storage (1368 green).**

  PM dispatch (Kevin — Round 4 continuation): wire `isImproveConsented(user)` into the actual LLM improvement paths.

  **What changed:**

  1. **`lib/briefing.ts` — enforcement gate.** `analyzeUserResponse()` now gates the two post-call memory writes on `isImproveConsented(user)`:
     - `memoryQueries.create(userId, 'transcript', ...)` — raw grounded call transcript
     - `memoryQueries.create(userId, 'insight', ...)` — LLM-extracted insight from the call
     - Both are omitted for Privacy Mode users. The briefing generation itself (all Anthropic inference calls) still runs for both modes — the product still works. Only the long-term improvement-data corpus is gated.
     - Added `import { isImproveConsented } from './consent'` to briefing.ts imports.
     - Updated the module-level comment to document that enforcement is now live at `analyzeUserResponse`.

  2. **`lib/facts.ts` + `lib/outreach.ts` — sentinel comments clarified.** Both were carrying "DATA CONSENT SENTINEL" markers left by the prior session. Replaced with clear explanatory comments: these paths are inference-only (no improvement-data storage), so there's nothing to gate here. The sentinel meaning is preserved (future callers who store must check consent), but the ambiguous language is gone.

  3. **`lib/briefing.consent.test.ts`** — 6 new tests proving the gate works:
     - Privacy Mode (`data_consent: 'privacy'`) → `transcript` + `insight` memory NOT written
     - Null consent (new-user default) → same as Privacy Mode (opt-IN required)
     - Undefined consent → same as Privacy Mode
     - Improve-consented (`data_consent: 'improve'`) → BOTH memories ARE written
     - Improve-consented → transcript content matches the grounded user response
     - Privacy Mode + tasks → tasks still extracted (tasks are not improvement data; gate is narrow)
     - Key fix discovered: vitest mock paths must match the actual import specifier used in the tested module (`'./db'` not `'@/lib/db'` for relative imports in `lib/briefing.ts`).

  **Privacy Mode trade-off (documented):** Privacy Mode users still receive a full briefing — all LLM inference runs, the `facts` table still accumulates structured knowledge, and all calendar/task operations still work. The only difference: their raw call transcripts and extracted insights are not written to the `memories` table. Edge's in-context memory of past calls is slightly less rich for Privacy Mode users, but the product remains fully functional.

  1368/1368 green, tsc clean, next build clean.

- **2026-06-18** — **Audit log coverage sweep — Round 4 Ticket 1 complete (1362 green).**

  PM dispatch: verify audit_log covers every user-triggered mutation and close gaps.

  **Code changes:**
  - `POST /api/onboarding/priorities` → `priorities_set` audit entry (includes added/removed diff vs prior week)
  - `POST /api/priorities/derive/accept` → `priorities_accepted` audit entry
  - `POST /api/open-loops` (resolve/dismiss/snooze) → `loop_resolve` / `loop_dismiss` / `loop_snooze` audit entries
  - Fixed `app/api/priorities/derive/route.test.ts` mock (was missing `auditLogQueries` → 3 tests failed)

  **Documentation** (`content/security-audit.md`):
  - New "Audit Log Coverage" section: 12 action types covered, 17 routes intentionally not logged (with justification each)
  - Rate-limit gap check for routes added since Round 3 sweep
  - Readiness Summary: updated audit-log bullet + test count (64 files / 1362 tests)
  - CASA section: consent_update audit now confirmed live

  **Intentionally not logged (top decisions):**
  - `DELETE /api/account` — GDPR: cascade deletes audit_log records as part of the deletion; server log provides operator visibility
  - Auth events (login/signup/logout) — session_version tracks invalidation; not Activity-tab data
  - Minor state operations (notifications markRead, energy log, milestone toggles, reminder setup/teardown)

  1362/1362 green, tsc clean, next build clean.

- **2026-06-18** — **Backup coverage fix + consent route + data_consent migration (1340 green).**

  Three hardening tasks shipped in one session:

  1. **`lib/backup.ts` — bug fix + expanded table coverage.**
     - **Bug**: `verifyBackup` was checking `'milestones'` (always returned `-1`) but the
       actual table is `'focus_milestones'`. Fixed.
     - Added 5 missing user-data tables to the verification list: `energy_profile`,
       `event_energy_tags`, `calendar_plan_executions`, `undo_log`, `gmail_drafts_log`.
     - 2 new tests: asserts all 20 required tables appear in `rowCounts`; confirms
       the stale `'milestones'` key is gone and `'focus_milestones'` is present.
     - Fixed `better-sqlite3` mock to use `function` keyword (required for `new` constructor calls in vitest).

  2. **`POST /api/auth/consent`** — new route for users to switch between Privacy Mode and Help-improve-Edg3.
     - Auth-gated (`getSession()` → 401), rate-limited (`consentUpdate`: 10/hr per user).
     - Validates input strictly: only `'improve'` | `'privacy'` accepted → 400 otherwise.
     - Calls `userQueries.updateConsent(userId, consent)` + writes `consent_update` audit log entry with `prev` and `new` consent values.
     - 7 tests: 401 unauthenticated, 400 invalid value, 400 missing field, 200 `privacy`, 200 `improve`, audit record shape, 429 rate limit.

  3. **`data_consent` column migration** (`lib/db.ts`):
     - Added `ALTER TABLE users ADD COLUMN data_consent TEXT CHECK(data_consent IN ('improve', 'privacy'))` to the migrations array.
     - Safe and idempotent (wrapped in try-catch per existing pattern).
     - Unblocks CASA enforcement — column is now live on startup; the `/api/auth/consent` route can write to it immediately. No Core deploy required for the column to exist.

  1340/1340 green, tsc clean, next build clean.

- **2026-06-18** — **Memory encryption + consent helper + memory authz tests (1331 green).**

  PM dispatch: memory is the moat — every memory field encrypted, user-scoped, consent-gated.

  1. **`memories.content` encrypted at rest** (`lib/db.ts`): Critical gap closed — `memories` table previously stored call insights, profile context, and transcripts as plaintext. Added `decryptMemoryRow()` helper; `memoryQueries.create()` now writes `encryptField(content)`; all three read paths (`getRecent`, `getWeighted`, `getByType`) now map through `decryptMemoryRow`. Legacy plaintext rows pass through transparently on decryption (zero migration needed). `getWeighted` converted from SQL LIKE on content to JS filter after decryption (LIKE can't search encrypted data).

  2. **`lib/consent.ts`** — consent enforcement helper. `isImproveConsented(user)` / `isPrivacyMode(user)`. Safe default: null/undefined data_consent → Privacy Mode (false from `isImproveConsented`). This means every future fine-tuning path that calls this helper will fail-safe to privacy mode until the user explicitly opts in. 11 unit tests in `lib/consent.test.ts`.

  3. **Memory authz integration tests** (`app/api/memory/route.test.ts`) — 9 tests verifying: unauthenticated → 401, user A cannot see user B's memories or facts (cross-user leakage), empty memories return [] not cross-user bleed, response shape includes memories + facts arrays.

  4. **`content/data-protection.md`** updated: new "You control how your data is used" section with the two-setting table; "What Edge remembers" section naming the 5 memory layers in plain language; encrypted fields list now includes `memories.content`; export note includes consent setting; "What we don't do" updated to "without your explicit opt-in."

  5. **`content/security-audit.md`** updated: `memories.content` added to encrypted-fields table; consent helper + memory authz added to Readiness Summary; test count updated to 61 files / 1331 tests.

  1331/1331 green, tsc clean, next build clean.

- **2026-06-18** — **Data consent enforcement — CASA requirement (1267 green).**

  PM dispatch: enforce Privacy Mode and document for CASA / Google OAuth verification.
  Core hasn't landed `users.data_consent` yet — all changes are additive and forward-compatible.

  1. **`User` interface** (`lib/db.ts`): Added `data_consent?: 'improve' | 'privacy' | null` — optional field so reads are safe before Core adds the DB column. `SELECT *` returns it automatically once the column exists.

  2. **Data export** (`app/api/account/export/route.ts`): Added `dataConsent: profile.data_consent ?? null` to the export payload under `profile`. Returns null until Core adds the column; works automatically after the column is added. Users can verify their own consent setting in the export.

  3. **Sentinel comments** — added to the three highest-volume LLM call sites:
     - `lib/briefing.ts` (module-level — covers all briefing-generation calls)
     - `lib/facts.ts` (transcript fact extraction)
     - `lib/outreach.ts` (email drafting)
     Each sentinel states: inference-only use today; any future fine-tuning path MUST gate on `user.data_consent === 'improve'`.

  4. **CASA documentation** (`content/security-audit.md`): New section "Data consent and Privacy Mode" — two-setting table, data-flow inventory (Anthropic inference, Google Calendar OAuth, Vapi voice), enforcement state (no training pipeline today), sentinel comment locations, audit trail, and a CASA/Google OAuth verification checklist.

  No code-path enforcement added yet — that's Core's column + Security's DB check when the column lands.
  1267/1267 green, tsc clean, next build clean.

- **2026-06-17** — **Auth login tests — anti-enumeration + brute-force (1263 green).**

  10 new tests in `app/api/auth/login/route.test.ts`. Key security invariants verified:
  - Rate limit 10/15min per IP → 429 (brute-force prevention)
  - Unknown email + wrong password both return `401 'Invalid credentials'` — same status, same message (anti-enumeration)
  - Direct assertion that both paths produce identical error text
  - Successful login → 200 + session cookie set
  - `onboarding_complete` flag forwarded correctly
  - `verifyPassword` throw → generic 500, bcrypt error string not exposed to client
  1263/1263 green, tsc clean, next build clean.

- **2026-06-17** — **Integration test sweep — signup + backup route + backup lib (1253 green).**

  Closed the three largest remaining test gaps:

  1. **`POST /api/auth/signup`** (18 new tests, `app/api/auth/signup/route.test.ts`) — all pre-beta audit fixes verified: password > 128 chars → 400 (bcrypt DoS cap), password < 8 → 400, name > 100 → 400, email > 254 → 400 (RFC 5321), missing fields → 400, duplicate email → 409 (no account detail leaked), DB error → generic 500 (SQLITE_CONSTRAINT not exposed), rate-limit → 429, successful signup → 200 + session cookie.

  2. **`GET,POST /api/admin/backup`** (14 new route tests, `app/api/admin/backup/route.test.ts`) — auth gate (GET+POST → 401 without admin cookie), filename regex path-traversal prevention (`../../etc/passwd` → 400, Windows separators → 400, non-matching pattern → 400, leading path → 400), valid pattern accepted → verifyBackup called, createBackup error → 500 with safe message, empty body defaults to backup action.

  3. **`lib/backup.ts`** (7 new lib tests, `lib/backup.test.ts`) — verifyBackup path traversal neutralization (`../../etc/passwd` strips to `passwd` via `path.basename` → File not found — no escape from BACKUP_DIR), `litstreamEnabled` env-var reflection, `maybeDailyBackup` fire-and-forget (disk-full error swallowed; no throw propagated to caller).

  **Bug fix**: `admin/backup` route filename regex was `^edg3-[\d-]+\.db$` which rejected ALL valid backup filenames — they contain `T` and `Z` from ISO8601 format. Fixed to `^edg3-[0-9TZ-]+\.db$` matching the actual `ts()` output `edg3-YYYY-MM-DDTHH-MM-SS-mmmZ.db`.

  **Security audit doc** updated with full "✅ Covered" bullet list reflecting LLM-output caps, header injection fix, backup path traversal guard, activation moment review, and current test coverage count.

  1253/1253 green, tsc clean, next build clean.

- **2026-06-17** — **Activation Moment security review — 13 fresh-account tests (1214 green).**

  PM dispatch: review the onboarding + priority-derive path for the Activation Moment feature.
  All routes PASS — no code changes needed.

  **`GET /api/priorities/derive`**: auth ✅ rate-limit 5/hr `priorityDerive` ✅ all reads via `user.id` (no URL param exposure) ✅ `derivePriorities()` full try/catch → null (never throws to caller) ✅ graceful null response with safe human-readable reason (no stack/key leak) ✅ parallel `.catch(() => [])` guards on calendar + email signal ✅

  **`POST /api/priorities/derive/accept`**: auth ✅ rate-limit 20/hr `priorityAccept` ✅ `MAX_PRIORITY_TEXT=200` cap ✅ all writes scoped to `user.id` ✅ empty body → 400 ✅ malformed JSON → 400 ✅ excess priorities (>3) silently truncated ✅

  **`lib/priorityDerivation.ts derivePriorities()`**: full `try/catch` returns null ✅ output bounds `text.slice(0,120)`, `rationale.slice(0,300)`, `evidenceTags.slice(0,4)`, `summaryLine.slice(0,200)` ✅

  **`lib/calendar.ts getPastCalendarEvents`**: user-scoped ✅ returns `[]` when no token (fresh-account graceful) ✅

  New test file: `app/api/priorities/derive/route.test.ts` — 13 tests covering unauthenticated/rate-limited/fresh-account/thin-data/successful-derivation/internals-not-leaked/accept-authz/input-cap/empty-body/malformed-JSON/excess-priorities paths.

  1214/1214 green, tsc clean, next build clean.

- **2026-06-17** — **Round 7: confirmFocus input caps + final LLM-output sweep (1201 green).**

  Continued sweep of LLM-extracted content paths in `app/api/vapi/tool-call/route.ts`:
  - **`confirmFocus` handler**: `title` capped at 200 chars, `rationale` at 500 chars before `dailyFocusQueries.upsert`. Consistent with all other LLM → DB paths.
  - **Full sweep completed**: all `taskQueries.create`, `memoryQueries.create`, `factQueries.upsertFact`, `openLoopQueries.insert`, `dailyFocusQueries.upsert` paths now uniformly capped. No uncapped LLM-generated DB writes remain.
  1201/1201 green, tsc clean, next build clean.

- **2026-06-17** — **S3 audit: hero-loop apply path — PASS, no changes (1201 green).**

  Audited `/api/day-plan/confirm` across all four PM-dispatched dimensions:

  1. **Idempotency / double-apply** ✅ — `consumeDeleteToken(user.id, planId)` (in `lib/idempotency.ts`) wraps the token consume in `db.transaction()`: reads token → verifies owner + expiry + unused → marks used atomically. A second call within the TTL sees `used=1` and returns false → route rejects with 400 "Invalid or expired plan ID". Double-click cannot apply twice.
  2. **Undo grouping** ✅ — `recordUndo(userId, ..., undoOps, planId)` calls `undoQueries.recordForPlan` which stores `plan_id` on each undo_log row. `undoPlan()` calls `getByPlanId(userId, planId)` ordered `id DESC` (most recent first = correct undo order) then `markPlanUndone(userId, planId)` — all three queries filter by `(user_id, plan_id)`. Full batch undo is user-scoped.
  3. **Rate limit** ✅ — `dayPlanConfirm` 5/hr/user. Appropriate for one-click use.
  4. **Authz** ✅ — `deleteConfirmQueries.consume(token, userId)` explicitly checks `row.user_id !== userId` — rejects cross-user token reuse. User A cannot apply User B's planId.

  No code changes required. Confirmed green baseline.

- **2026-06-17** — **Round 6: email header injection fix + remaining LLM-output storage caps (1201 green).**

  1. **Email header injection** — `lib/gmail.ts` `buildRawMessage`: `to`/`cc`/`bcc`/`subject` now strip `\r\n\t` via `sh()` before interpolation into MIME headers. A CRLF in `to` could inject extra headers (e.g. `Bcc:`). Security owns this primitive; the fix ensures no LLM-generated or user-supplied value can split into a separate header. 1 new test.
  2. **`lib/briefing.ts` `analyzeUserResponse` task path** — LLM-extracted task text now capped at 500 chars before `taskQueries.create` (3rd instance; webhook.ts had 2 already).
  3. **`app/api/onboarding/priorities`** — priority text now capped at 200 chars (`.slice(0, 200)`) to match `derive/accept` route's existing `MAX_PRIORITY_TEXT`. Ensures user-submitted priorities don't store unbounded content and the priority-change memory note stays bounded.
  4. **Security audit doc** — email header injection section added.
  1201/1201 green, tsc clean, next build clean.

- **2026-06-17** — **Round 4: LLM-output storage caps — task text + missed-promises memory note (1200 green).**

  Closed two remaining paths where LLM-extracted content was written to the DB without a length cap.

  1. **Task text cap** — `app/api/vapi/webhook/route.ts`: both `extractTasksFromBriefing` and `extractTasksFromTranscript` now call `.slice(0, 500)` on LLM-extracted task text before `taskQueries.create`. Matches the existing 500-char cap on `POST /api/tasks` (user-created tasks). Prevents unbounded task rows if the model returns overly long text.
  2. **Missed-promises memory cap** — `lib/verifyPromises.ts`: the `memoryQueries.create` call that stores the missed-promises calendar_note now caps the content at 2000 chars. Matches the established policy for all memory content from LLM paths (`briefing.ts` memory caps set in Round 3).
  3. **Security audit doc updated** — two new rows in Input Validation Fixes table.
  1200/1200 green, tsc clean, next build clean.

- **2026-06-17** — **Round 3: additional hardening sweep — rate limits, error leaks, input caps (1200 green).**

  Continued security hardening after Round 2 integration tests shipped. Focused on closing remaining low/medium gaps in rate-limit coverage, error-detail exposure, and input-size caps.

  1. **Rate limits — 8 more unprotected routes covered** (36 total limit types):
     - `GET /api/onboarding/suggest-priorities` (5/hr): was an unguarded LLM (Haiku) call
     - `DELETE /api/account` (3/hr): destructive cascade, confirm-phrase alone insufficient
     - `GET /api/account/export` (5/hr): decrypts all user PII on every call
     - `POST /api/onboarding/priorities` (10/hr): writes to 3 tables (priorities + memory + facts)
     - `POST /api/priorities/keep` (20/hr): delete + re-insert priorities
     - `POST /api/onboarding/profile` (5/hr): profile flows into LLM prompts
     - `POST /api/onboarding/call-time` (10/hr): triggers Google Calendar API resync
     - `POST /api/profile` (10/hr): same LLM input concern as onboarding/profile
  2. **Error leak fixes** — removed raw `err.message` / `String(err).slice(0,120)` from user-facing responses; replaced with safe generic messages. All details still logged to console for ops. Routes: `calendar/book`, `briefing/call`, `briefing/open-call`, `briefing/retry-call`.
  3. **Input size caps** — `profile_summary` capped at 2000 chars on `POST /api/onboarding/profile` and `POST /api/profile` (both flow into LLM prompts). `rememberPreference` tool handler in `vapi/tool-call` now caps fact `statement` at 500 chars, matching the PATCH route's existing cap.
  4. **Post-merge fix** — removed stale `WhoopFlag` re-export from `components/ui/index.ts` after Design's latest merge removed it from `RecoveryCard.tsx` (broke tsc).
  5. **Security audit doc** — updated route tables, rate-limit additions table, error-leak section, readiness summary. 36 rate-limit types now documented.
  1200/1200 green, tsc clean, next build clean.

- **2026-06-17** — **Round 2: security integration tests + backup coverage + trust content (1200 green).**

  1. **Security integration tests (22 new in `lib/auth.test.ts`):** JWT round-trip, tamper detection, expired/wrong-secret token, session_version revocation (stale token → null), legacy token grandfathering, cookie flags (httpOnly, sameSite:lax, maxAge 30d), bcrypt round-trip. Route-level authz tests already existed for facts, email-receipt, and day-plan confirm.
  2. **Backup table coverage expanded** (`lib/backup.ts`): `verifyBackup` now checks 15 tables (added `milestones`, `notifications`, `daily_focus`, `calendar_scores`) giving a fuller restore sanity-check signal.
  3. **Trust content finalized:** `content/how-edge-protects-you.md` §1-4 verified accurate — Gmail format:metadata confirmed code-level, Whoop token revocation confirmed, Google revocation confirmed, encryption list updated with daily focus + open loops. Tagged ready for Cam + legal review.
  4. **Rate-limit tuning review:** all 28 keys reviewed. Limits appropriate for pre-beta. Note for post-launch: `briefingGenerate` (5/hr) and `dayPlanConfirm` (5/hr) may need raising under real traffic.
  5. **Security audit doc updated:** backlog marked ✅ complete; integration test table added.
  1200/1200 green, tsc clean, next build clean.

- **2026-06-17** — **Post-flagship backlog: undo audit gap + encryption verification + session/auth review + npm audit (1133 green).**

  1. **Undo audit gap CLOSED** — `POST /api/undo` now writes `action='undo_applied'` to `audit_log` after every reversal (success or partial-failure). Every calendar mutation including reversals now has a full audit trail.
  2. **Encryption-at-rest verified** — all `encryptField`/`encryptNullable` call sites in `lib/db.ts` + `lib/gmail.ts` confirmed comprehensive: `calendar_tokens`, `whoop_tokens`, `briefings`, `facts`, `gmail_drafts_log`, `watched_threads`, `notifications`, `daily_focus`, `open_loops`, `audit_log` email-signal subjects. Documented in `content/security-audit.md`. Known-unencrypted fields accepted: `users.email` (index key), `users.name`, `users.profile_summary` (LLM hot-path), `users.phone_number` (Vapi scheduling).
  3. **Session/auth hardening review — PASS** — JWT fail-closed, bcrypt cost 12, session versioning with logout invalidation, cookie flags (httpOnly + secure + sameSite:lax), brute-force RL, OAuth CSRF state tokens. No gaps found.
  4. **npm audit — 2 moderate transitive vulns (accepted)** — `postcss <8.5.10` in Next.js's internal build tooling; fix requires downgrading Next.js to 9.3.3 (breaking change). Build-time-only exposure; not pre-beta blocker. Documented in `content/security-audit.md`.
  5. **`content/data-protection.md` updated** — added missing encrypted fields (email draft recipients/subjects, notification messages, daily focus plans, open loops) to the "What's encrypted at rest" section. Ready for Esther's copy polish.
  6. **New Core route hardened on merge** — `POST /api/priorities/derive/accept` was missing a rate limit and per-priority text length cap. Added `priorityAccept` (20/hr) to `lib/rateLimit.ts`; capped priority text at 200 chars. `GET /api/priorities/derive` was already clean.
  1156/1156 green, tsc clean, next build clean.

- **2026-06-17** — **Flagship: full pre-beta security audit + hardening — all 78 routes reviewed (1133 green).**

  Systematically audited every `app/api/**` route across 6 dimensions: authn/authz, rate-limit, input validation, SQL/prompt injection, idempotency, audit-log coverage. All HIGH and MEDIUM findings fixed. Readiness report in `content/security-audit.md`.

  **Rate limit gaps closed (10 new types, 15 route files patched):**
  - `briefingGenerate` 5/hr — `POST /api/briefing/generate` (LLM)
  - `briefingIntro` 3/hr — `POST /api/briefing/intro` (live Vapi call)
  - `calendarBook` 20/hr — `POST /api/calendar/book` (calendar mutation)
  - `energyToday` 30/hr — `POST /api/energy/today`
  - `meetingContext` 30/hr — `GET /api/meeting-context` (Google + email)
  - `notifications` 30/hr — `POST /api/notifications` ("check" hits Gmail)
  - `tasksWrite` 60/hr — `POST /api/tasks`, `PATCH/DELETE /api/tasks/[id]`, `POST /api/tasks/complete-all`
  - `undoPost` 20/hr — `POST /api/undo` (calendar mutations)

  **Input validation fixes (9 route files patched):**
  - `POST /api/auth/signup`: max password 128 chars (bcrypt DoS); max name 100 chars; max email 254 chars
  - `GET /api/briefing/[id]`: id < 1 now rejected (was only `isNaN`)
  - `PATCH/DELETE /api/milestones/[id]`, `PATCH /api/priorities/[id]/energy`, `GET,POST /api/priorities/[id]/milestones`, `PATCH/DELETE /api/tasks/[id]`: id validation upgraded to `Number.isFinite(id) && id >= 1` (was `!id` or bare `isNaN`)
  - `POST /api/onboarding/call-time`: `call_time` must match `HH:MM`, `timezone` validated via `isValidTimeZone()`, `phone_number` type + length check (≤20)
  - `POST /api/profile/timezone`: upgraded from "must contain /" to `isValidTimeZone()`
  - `POST /api/tasks`: text capped at 500 chars (was unbounded)

  **Confirmed-clean (no changes needed):**
  - All authn gates: 78/78 routes properly gated or exempt (waitlist = public, callbacks = CSRF state token)
  - All DB queries: every `SELECT/UPDATE/DELETE` filtered by `user_id` — no cross-user leakage possible
  - SQL injection: better-sqlite3 prepared statements everywhere, no string interpolation
  - Error-leak: no stack traces in user-facing responses across all 78 routes
  - OAuth CSRF: calendar + Whoop flows both use `oauthStateQueries` crypto state tokens
  - Vapi integrity: `checkVapiSecret` + fail-closed enforce flag + admin mismatch monitor
  - 1133/1133 green, tsc clean, next build clean.

- **2026-06-17** — **Overnight queue: trust endpoint hardening + audit sweep + retention + prompt-injection defense + trust content (1090 green).**

  **1. Trust endpoint hardening:**
  - **`PATCH/DELETE /api/memory/facts/[id]`** (Core shipped T1, Security hardens):
    - Added `factEdit` rate limit (20/hr per user) to both PATCH and DELETE.
    - Fixed id validation: `parseInt` → `Number.isFinite(id) && id > 0` (rejects negative IDs, NaN, 0).
    - PATCH: statement max 500 chars enforced; entity type-checked (string or null); entity capped at 200 chars.
    - PATCH: reads existing fact before update (confirms ownership via `user_id` scope; returns 404 if not found instead of silent no-op).
    - PATCH + DELETE: audit logged to `audit_log` (`fact_update` / `fact_delete`, category + entity recorded, user-scoped).
    - DELETE: reads fact first; blocks `source='priority-sync'` facts with 409 + clear message ("update them in the Priorities tab instead"); does NOT call `deleteFact` for priority-sync facts.
    - New `factQueries.getById(userId, id)` in `lib/db.ts` — user-scoped single-fact read (decrypts statement via `decryptFactRow`).
  - **`GET /api/activity/email-receipt/[id]`** (S4 endpoint): added `emailReceipt` rate limit (60/hr per user). User-scoping was already enforced at the `getEmailSignalSubjects` layer.
  - **New rate limit keys** in `lib/rateLimit.ts`: `factEdit` (20/hr), `emailReceipt` (60/hr).

  **2. Audit-coverage sweep:**
  - ✅ Calendar create/move/delete (via `tool-call/route.ts`): audited + confirm-token gated.
  - ✅ Calendar book (`/api/calendar/book`): audited + idempotent (`claimEventCreate`).
  - ✅ Day-plan apply (`/api/day-plan/confirm`): audited + planId token (S3).
  - ✅ Fact edit/delete: NOW audited (this session).
  - ✅ Waitlist: `ON CONFLICT DO NOTHING` + table-level record; pre-account, no user_id audit needed.
  - ⚠️ **Gap noted (future):** `POST /api/undo` reverses calendar events but doesn't write an `audit_log` entry — only marks the undo-table row as undone. Low risk (undo table tracks state), but a future hardening pass could add `undo_applied` audit entries.

  **3. Retention/TTL for encrypted email subjects:**
  - `auditLogQueries.pruneEmailSubjects(days = 90)` added to `lib/db.ts` — runs `UPDATE ... SET snapshot_after = NULL WHERE action = 'email_signal_fetch' AND created_at < datetime('now', '-90 days')`. The "N threads reviewed" audit record survives; only the encrypted subject content is cleared.
  - Wired into the nightly 3am cron in `lib/scheduler.ts` alongside the existing `openLoopQueries.prune()` / `oauthStateQueries.prune()` passes.
  - Privacy policy already says "subjects retained for 90 days then automatically deleted" (S4); this makes the deletion deterministic (not relying solely on the 1%-chance row-level prune).

  **4. Prompt-injection hardening (grounding layer):**
  - **`lib/alignment.ts`**: Added `sanitize(s, maxLen)` helper — strips `\r\n\t` (newline injection), collapses whitespace, caps length. Applied to event `title` (cap 100) and `description` (cap 200) before LLM injection. Calendar event titles can be set by meeting organizers, not just the user — a malicious title with embedded newlines could break the classifier prompt structure.
  - **`lib/calendar.ts`** (`formatEventsForBriefing`): same newline-strip applied to `event.summary` before injection into the briefing prompt. Minimal one-liner change; no behavior change for normal titles.
  - Risk level is LOW (output is parsed as structured JSON; main briefing doesn't exfiltrate to external systems), but defense-in-depth is cheap here.
  - 2 new alignment tests: newline-injection stripping verified, title length cap verified.

  **5. Trust/security self-audit + content:**
  - `content/data-protection.md` (new) — plain-English "How Edge protects your data" draft for Esther to polish. Covers: what's encrypted, what Edge can/can't do per source, retention table (inbox subjects 90d, audit 90d), user-scoped query guarantee, user controls (edit/delete facts, see receipts, export, disconnect). Tagged for Esther.
  - **Security page** (`app/privacy/page.tsx`): already fully updated in S4 (accurate Gmail inbox signal language, Google Limited Use bullets updated). No further changes needed.
  - 45 new tests total across all items.
  - 1090/1090 green, tsc clean, next build clean.

- **2026-06-17** — **S4 Activity email receipts — encrypted subject storage + read path (1045 green).**
  - **Decision:** store reviewed thread subjects encrypted at rest on the `email_signal_fetch` audit entry so users can see exactly which emails Edge reviewed in the Activity tab. No schema change — repurposes the existing `audit_log.snapshot_after` column (already TEXT, already used for calendar state). Subjects stored as `{"subjects":[...]}` JSON encrypted with `encryptField` (AES-256-GCM). Bodies, senders, and snippets are never stored.
  - **`lib/gmail.ts` changes:**
    - Added `getDb`, `auditLogQueries`, `encryptField`, `decryptField` imports.
    - `getRecentEmailSignal`: `auditLogQueries.record()` call updated — `snapshotAfter` now stores `encryptField(JSON.stringify({ subjects: items.map(i => i.subject) }))` when threads exist, `null` when no threads. `argsJson` unchanged (thread count only — no subjects in plaintext anywhere).
    - New exported `getEmailSignalSubjects(userId, auditId): string[] | null` — user-scoped read (`WHERE id = ? AND user_id = ? AND action = 'email_signal_fetch'`), decrypts + parses on read, fails silently (returns null) on any error (missing row, wrong user, bad JSON, key rotation). Core calls this via the new API endpoint.
  - **`app/api/activity/email-receipt/[id]/route.ts`** (new) — `GET` handler for Core to fetch subjects for a given audit entry. Auth-gated (`getSession`), validates numeric id ≥ 1, returns 401/400/404/200. `getEmailSignalSubjects` enforces `user_id` scoping — no cross-user leakage possible even if the route validation is bypassed.
  - **Privacy policy + FAQ updated:** `app/privacy/page.tsx` (two locations: inbox-signal bullet + Google Limited Use list), `content/faq.md` (three locations: Gmail description, encryption bullet, "does Edge read every email" answer). All now accurately state: "Thread subject lines are stored encrypted at rest (AES-256-GCM) for 90 days; senders, snippets, and bodies are never stored."
  - **Tests (15 new — total 1045):**
    - `lib/gmail.test.ts`: `getEmailSignalSubjects` — valid entry, wrong user (undefined row), null snapshot, malformed JSON, missing subjects field, non-string entries filtered, userId+auditId param order verified. Updated existing audit test to assert `snapshotAfter` is set (was "no email content"). Added null-snapshot test for empty-thread case.
    - `app/api/activity/email-receipt/[id]/route.test.ts` (new, 7 tests): 401 unauthenticated, 400 non-numeric id, 400 id=0, 400 negative id, 404 not-found, 200 with subjects, 200 empty array.
  - 1045/1045 green, tsc clean, next build clean.

- **2026-06-17** — **S3 hero-loop APPLY path hardened (1030 green).**
  - **Audit findings:**
    - ✅ **Idempotency / double-apply**: `consumeDeleteToken(userId, planId)` runs inside a SQLite transaction (atomic read+mark-used). Double-click or retry gets 400 "Invalid or expired plan ID" immediately. Confirmed clean.
    - ✅ **Authz**: `consumeDeleteToken` checks `row.user_id !== userId` — user B's session cannot consume user A's token. Calendar mutations use `calendarQueries.get(user.id)` — all ops scoped to the authenticated user. Confirmed clean.
    - ✅ **Rate limit**: `dayPlanConfirm` — 5/hr per user. Sane for one-click use.
    - 🐛 **Undo grouping (BUG — fixed)**: `recordUndo()` was called without `planId`, so undo entries had no `plan_id` in the DB. `undoPlan(userId, planId, cal)` calls `undoQueries.getByPlanId()` which returns empty — the whole plan could not be undone as a unit. **Fix:** pass `planId` as the 4th arg to `recordUndo()`.
    - 🐛 **Execution tracking (gap — fixed)**: `calendarPlanQueries.markApplied()` was never called. The `calendar_plan_executions` table row was never written, so `undoPlan` had nothing to `markReverted` and Core couldn't idempotency-check via `calendarPlanQueries.get()`. **Fix:** call `calendarPlanQueries.markApplied(user.id, planId, doneDescs.length)` after ops complete.
  - **Files changed:** `app/api/day-plan/confirm/route.ts` (2-line fix: pass `planId` to `recordUndo`, add `markApplied` call), `app/api/day-plan/confirm/route.test.ts` (new, 15 tests).
  - **Tests added (15):** auth gate (401), rate limit (429), double-submit rejected (400), token for wrong user rejected (400), planId passed to recordUndo, no recordUndo when no actions, markApplied called on success, markApplied not called on bad token, markApplied called even on partial success, calendar-not-connected (400), full success path (200, ok+count).
  - 1030/1030 green, tsc clean, next build clean.

- **2026-06-16** — **S1 waitlist hardening + S2 CSP decision closed (1015 green).**
  - **[S1] `/api/waitlist` audit + hardening — COMPLETE:**
    - Audited rate-limiting (5/hr per IP via `waitlist` key, rightmost XFF — spoofing-resistant), email validation (254-char cap, `EMAIL_RE`, header-injection characters blocked by the regex), and idempotency (`ON CONFLICT DO NOTHING` + generic `{ ok: true }` on duplicate — no enumeration leak). All clean; no additional hardening required.
    - `waitlist` added to `verifyBackup()` table list in `lib/backup.ts` (alongside existing 10 tables) — snapshots now cover the waitlist.
    - `waitlist` intentionally **excluded** from `/api/account/export`: entries are pre-account (no `user_id`), so there's nothing user-specific to export.
    - 18 new tests in `app/api/waitlist/route.test.ts`: valid email → 200, trimming, source truncation at 60 chars, duplicate → 200 (no enumeration), DB-throw → 200 (graceful degrade), invalid emails (missing, empty, no-@, no-domain, >254 chars, non-string, newline header-injection), rate-limit → 429, non-JSON body → 400.
  - **[S2] CSP decision — FORMALLY CLOSED:**
    - Tested locally: `next build && next start --port 3999`; curled the served HTML. **Confirmed: Turbopack emits `nonce="$undefined"` in RSC JSON and NO nonce attribute on actual `<script>` tags** in the page HTML. Under `'strict-dynamic'`, this blocks every framework script → blank page (exactly the production failure).
    - **Accepted pre-beta baseline: `script-src 'self' 'unsafe-inline'`.** Cross-origin script injection is blocked; same-origin scripts run. `'unsafe-inline'` is required for Next.js bootstrap chunks until Turbopack gains nonce emission.
    - `proxy.ts` comment updated: follow-up TODO removed; decision documented with test evidence and revisit conditions (re-attempt only if Turbopack adds `experimental.nonce` support AND browser-verified).
    - See prior hotfix entry below for root-cause detail.
  - 1015/1015 green, tsc clean, next build clean.

- **2026-06-16** — **CSP decision: park strict nonce; `'self' 'unsafe-inline'` is the right baseline. Audit of new Core routes — all clean.**
  - **CSP decision (final, no code change):**
    - PM hotfix (`e2370e3`) reverted `'strict-dynamic'` nonce to `script-src 'self' 'unsafe-inline'` after production-down incident.
    - **Decision: stay on `'self' 'unsafe-inline'` for the pre-beta period.** Rationale:
      1. `'self'` blocks all cross-origin script loading — the primary attack vector for a deployed web app.
      2. `'unsafe-inline'` allows Next.js bootstrap scripts and Tailwind/React inline styles — removing it without verified nonce support causes a blank page (confirmed in production).
      3. Our actual XSS exposure is low: no user-generated HTML is rendered as raw HTML; all output is JSON → React components.
      4. `'unsafe-inline'` for `script-src` is only exploitable if an attacker can inject HTML into our pages — which requires a pre-existing vulnerability this CSP can't prevent anyway.
    - **Strict nonce path is NOT abandoned — it's parked until testable:**
      - Next.js 16 + Turbopack does not emit per-request nonces on its framework `<script>` tags in the configuration tested. The docs claim it does; production proved otherwise.
      - **Before re-attempting:** reproduce locally with `next build && next start` (NOT dev), curl the served HTML, and confirm framework `<script>` tags actually carry `nonce="…"`. If they do, the original `proxy.ts` approach was correct and just needs a re-verify. If they don't, the hash-based SRI approach (experimental, `next.config.ts`) is the next option.
      - **Who unblocks this:** Next.js 16 release notes for nonce support, or a confirmed local test. Not a code task until then.
  - **Audit of new Core routes (from master `303a3c9` merge):**
    - `/api/scores/route.ts` — ✅ auth-gated (`getSession`), rate-limited (`calendarScores` 20/hr), all DB reads user-scoped via `user.id`. No SQL injection risk (parameterized queries). No cross-user leakage.
    - `/api/focus/recommend/route.ts` — ✅ auth-gated, rate-limited (`focusRecommend` 20/hr), user-scoped reads. `forceRefresh` boolean from query params is safe (no injection vector). Caching guard correctly checks `!existing.confirmed` before overwriting.
    - `app/page.tsx` (landing page) — ✅ no `dangerouslySetInnerHTML`, no `eval`, no stored XSS vectors. Client-only fetches to `/api/auth/me` and `/api/waitlist`. **⚠️ NOTE for Core:** `/api/waitlist` route does not exist — waitlist form submits will 404 (HTTP 404 silently, form shows no error). Core should implement the route or handle the 404 gracefully.
    - All 14 admin routes verified to have `checkAdminAuth` or `checkAdminSecretAuth` gates — all 14 confirmed ✅.
    - `/api/notifications/route.ts` — ✅ user-scoped (`listRecent(user.id)`, `markRead(id, user.id)` with `AND user_id = ?`). Clean.
    - `/api/support/route.ts` — ✅ auth-gated, rate-limited (`support` 10/hr), input validated (type enum + 2000-char body limit).
  - No code changes — audit-only session.

- **2026-06-16** — **⚠️ PM HOTFIX — CSP nonce broke production (site down); strict-dynamic reverted.**
  - **Symptom:** `https://www.edg3.ai` rendered HTML but never hydrated (blank page) after the CSP-nonce deploy.
  - **Root cause:** `script-src 'self' 'nonce-…' 'strict-dynamic'` was set, but **Next.js 16 + Turbopack did NOT emit the per-request nonce onto its framework `<script>` tags.** Under `'strict-dynamic'` the browser ignores `'self'`, so every un-nonced script was blocked → no JS ran. The "Next 16 auto-propagates the nonce" assumption in the original comment was false for this Turbopack build.
  - **Fix (PM, `e2370e3`):** `proxy.ts` reverted to `script-src 'self' 'unsafe-inline'` (same-origin scripts + Next's inline bootstrap; blocks cross-origin injection). Removed nonce/strict-dynamic + the `x-nonce` request-header plumbing. Verified live: CSP updated, `/` and `/dashboard` both 200, scripts now allowed. 989 green.
  - **✅ Vijay follow-up (CLOSED 2026-06-16):** Reproduced locally with `next build && next start`, curled the HTML — confirmed Turbopack does NOT emit nonces on framework `<script>` tags. Decision: `'self' 'unsafe-inline'` is the accepted pre-beta baseline. See S1/S2 changelog entry above.
- **2026-06-16** — **H3 OAuth CSRF state, M7 session revocation, CSP nonce, FAQ §3 accuracy, backup + prune coverage (989 green).**
  - **[H3] OAuth CSRF state — COMPLETE:**
    - New `oauth_state` table (`initSchema`): `state TEXT PK`, `user_id`, `flow (calendar|whoop)`, `expires_at` (10-min TTL).
    - `oauthStateQueries`: `create(state, userId, flow)`, `consume(state)` (atomic read+delete, prevents replay), `prune()`.
    - `getAuthUrl` signatures updated in `lib/calendar.ts` (was `(userId?: number)`) and `lib/whoop.ts` (was `(userId: number)`) — both now `(state: string)`. Callers generate the state.
    - Connect routes (`/api/calendar/connect`, `/api/whoop/connect`) generate `randomBytes(20).toString('hex')` state, bind to user+flow via `oauthStateQueries.create()`, pass to `getAuthUrl()`.
    - Callback routes: if state present → `consume()` and verify `flow` match; invalid/expired → reject with `oauth_invalid_state` (CSRF defense); absent → session fallback (backward compat). Previous `parseInt(stateParam)` userId path eliminated.
    - `oauth_state` included in account deletion (`app/api/account/route.ts`).
    - `oauthStateQueries.prune()` wired into nightly 3am cron (`lib/scheduler.ts`).
    - `lib/whoop.test.ts` `getAuthUrl` tests updated to pass string state.
  - **[M7] JWT/session revocation — COMPLETE:**
    - `session_version INTEGER NOT NULL DEFAULT 1` migration on `users` table.
    - `User` interface + `userQueries.incrementSessionVersion(id)` added to `lib/db.ts`.
    - `createToken(userId, sessionVersion)` embeds `ver` in JWT payload; `verifyToken` returns `{ userId, ver? }`.
    - `getSession()` rejects tokens where `payload.ver !== user.session_version` (legacy tokens without `ver` grandfathered — no surprise logout for Derrick).
    - Logout (`/api/auth/logout`) increments `session_version` → all prior tokens invalidated instantly.
    - Login/signup pass `session_version` to `createToken`. No user-facing change; old sessions survive until next logout.
  - **[CSP] Nonce-based Content-Security-Policy — COMPLETE:**
    - `proxy.ts` (new file, Next.js 16 Proxy API — replaces deprecated `middleware.ts`):
      generates per-request `crypto.randomUUID() → base64` nonce; sets strict CSP header with
      `script-src 'self' 'nonce-{nonce}' 'strict-dynamic'` (+ `'unsafe-eval'` in dev);
      `style-src 'self' 'unsafe-inline'` (dashboard inline styles); `connect-src 'self'`;
      forwards nonce as `x-nonce` request header; matcher excludes `_next/static`, `_next/image`, favicon, prefetch requests.
    - Callback routes (`/api/calendar/callback`, `/api/whoop/callback`) read `x-nonce` and attach `nonce="{nonce}"` to inline `<script>` tags.
    - Next.js 16 automatically applies the nonce from the CSP header to its framework scripts (no layout change needed — dynamic rendering).
  - **[FAQ §3] Privacy claims verified + fixed:**
    - INACCURATE: "Health data (Whoop) gets an additional layer of encryption" — Both Whoop tokens and calendar tokens use the same AES-256-GCM `encryptField`. Fixed: replaced with accurate statement that credentials and tokens are encrypted at rest.
    - CLARIFIED: calendar events are fetched live from Google, not stored; the encrypted items are the OAuth access/refresh tokens.
    - CONFIRMED ACCURATE: call transcripts ✅ (`ENCRYPTED_BRIEFING_FIELDS`), facts ✅ (`encryptField(statement)`), email signals not stored ✅, data deletion covers all tables ✅.
  - **Backup coverage extended:**
    - `verifyBackup()` in `lib/backup.ts` now checks: `whoop_tokens`, `facts`, `open_loops`, `audit_log` alongside existing 6 tables.
  - 989/989 green, tsc clean, next build clean.
  - **⚠️ PM / user action required:**
    - CSP nonce forces dynamic rendering — verify dashboard loads correctly in production before beta launch (build was clean; no static-render regression observed in build output).
    - No user-facing changes to OAuth flow (CSRF fix is transparent).
    - Derrick will NOT be logged out — legacy tokens grandfathered; revocation only activates on next logout.

- **2026-06-15** — **Pre-beta security gap assessment + quick-win hardening (827 green).**
  - **Assessment scope:** secrets management, session/auth, rate-limit coverage, input validation,
    email/Whoop/open-loops data paths, CSRF + security headers, admin-route protection. Findings
    documented below by severity; quick wins fixed tonight; bigger items flagged for PM.

  **FIXED — HIGH:**
  - **[H2] Unauthenticated `/api/vapi/verify-promises` endpoint.** Any caller could POST
    `{briefingId: N}` to read any user's decrypted transcript, trigger unbounded Anthropic Haiku
    costs, and write to any user's memory.
    - **Fix (preferred path):** Extracted `runPromiseVerification(briefing, user)` to
      `lib/verifyPromises.ts`. Webhook (`app/api/vapi/webhook/route.ts`) now calls it directly
      via dynamic import — no self-HTTP round-trip, attack surface eliminated.
    - **Fix (defense-in-depth):** `app/api/vapi/verify-promises/route.ts` now gates on
      `checkVapiSecret` — unauthenticated callers get 401.

  **FIXED — MEDIUM:**
  - **[M3] `clearSessionCookie()` missing security flags.** Cookie cleared on logout/delete had
    no `httpOnly`, `secure`, or `sameSite` — differed from the set-cookie flags. Fixed in
    `lib/auth.ts`: added `httpOnly: true`, `secure: NODE_ENV==='production'`, `sameSite: 'lax'`.
  - **[M4] `postMessage('...', '*')` in OAuth callbacks.** Calendar and Whoop popup callbacks
    broadcast to any origin. Fixed: replaced `'*'` with `'${base}'` (interpolated server-side
    from `NEXT_PUBLIC_APP_URL`) in both `app/api/calendar/callback/route.ts` and
    `app/api/whoop/callback/route.ts`.
  - **[M5] No rate limit on `/api/briefing/call` and `/api/briefing/retry-call`.** A user could
    hammer "Call me now" / "Retry" to rack up Vapi call costs. Fixed: added `briefingCall` bucket
    (3 / 10 min per user) to `lib/rateLimit.ts`; wired `checkRateLimit('briefingCall', ...)` in
    both routes.
  - **[M6] Email not normalized in login/signup.** Mixed-case or trailing-space emails could create
    duplicate accounts or block login. Fixed: `email = rawEmail.trim().toLowerCase()` applied at
    the top of both `app/api/auth/login/route.ts` and `app/api/auth/signup/route.ts`.

  **FIXED — LOW:**
  - **[L4] Vapi secret comparison used `===` (timing side-channel).** `checkVapiSecret` in
    `lib/vapi.ts` compared strings with `===`. Fixed: added `timingSafeEqual` from Node `crypto`;
    comparison now uses constant-time buffer comparison (same pattern as `adminAuth.ts`).
  - **[L5] Backup filename not validated before `verifyBackup`.** Admin route accepted any string;
    `verifyBackup` used `path.basename` but route had no pattern guard. Fixed: added
    `/^edg3-[\d-]+\.db$/` regex check in `app/api/admin/backup/route.ts` before calling
    `verifyBackup` — defense-in-depth alongside the existing `path.basename` protection.
  - **[L6] `parseInt(stateParam)` without radix in calendar OAuth callback.** Fixed:
    `parseInt(backupUid, 10)` and `parseInt(stateParam, 10)` in
    `app/api/calendar/callback/route.ts` (whoop/callback already had radix 10).

  **ADDED — security content page:**
  - `content/security.md` — honest non-technical write-up for beta trust. Covers: AES-256-GCM
    encryption at rest (fields listed), bcrypt passwords, session security (HttpOnly/Secure/Lax),
    OAuth (no password storage), data minimization, retention prune, never-sell policy, rate
    limiting, audit logging, admin auth, on-volume backups + off-box roadmap, secret handling,
    export/deletion rights. Cam builds the page UI from this.

  **ADDED — security headers (next.config.ts):**
  - `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `X-XSS-Protection: 1; mode=block`,
    `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera/mic/geo=()`,
    `HSTS` (production only, 2-year preload). CSP omitted — nonce strategy required for
    Next.js SSR inline scripts; flagged for PM as follow-up.

  **NOT FIXED TONIGHT — flag for PM:**
  - **[H3] OAuth state/CSRF:** State param is last-resort fallback after session + backup cookie.
    Quick fix = remove the `stateParam` fallback (raises the bar for CSRF); full fix = bind state
    to a DB nonce. Recommendation: remove the fallback for now (1-line change) and add nonce in
    pre-launch sprint. ⚠️ Requires PM go-ahead (breaks flows where session cookie is missing
    at callback time).
  - **[M7] JWT revocation:** 30-day sessions, no server-side revocation. Account deletion clears
    cookie but an intercepted token is valid until expiry. Fix = short-lived JWTs + refresh
    tokens, or a server-side token blocklist. Pre-launch nice-to-have; post-launch required.
  - **[CSP] Content-Security-Policy:** Requires nonce injection for Next.js SSR inline `<script>`
    tags. Needs middleware + `nonce` in every rendered page. Medium-effort; worth adding in
    pre-launch sprint.
  - **[M1/M2] SameSite=Lax (not a bug — assessment note):** Assessment flagged SameSite=Lax as
    CSRF-vulnerable. This is INCORRECT for POST requests — SameSite=Lax blocks all cross-site
    POSTs (only permits top-level GET navigations). Strict would break email-link UX. Keep Lax.

  - 827 green, tsc clean, next build clean.
- **2026-06-15** — **facts.statement encryption; open-call reliability; nightly backup (827 green).**
  - **Item 1 — Encrypt `facts.statement` at rest (PM decision GO):**
    - `factQueries` in `lib/db.ts`: `encryptField(statement)` on all writes (`upsertFact`,
      `updateFact`, `syncPriorityFacts`); `decryptFactRow()` helper; `getAll()`/`getByCategory()`
      decrypt on read. No-entity dedup changed from SQL `LOWER(SUBSTR(...))` to in-memory
      comparison of decrypted values (encrypted text can't be SQL-compared).
    - `dailyFocusQueries`: `encryptField(areasJson)` on upsert, `decryptField(focus_areas)` on read.
    - `openLoopQueries.existsSimilar()`: new in-memory dedup helper (description decrypt before compare).
    - `openLoopQueries.resolve()`/`dismiss()`: return `boolean`, add `AND status = 'open'` guard.
    - **Stub swap**: removed Darren's self-managed DB STUB from `lib/openLoops.ts` and replaced
      `openLoopStubQueries` with a thin camelCase→snake_case adapter over the encrypted
      `openLoopQueries` from `lib/db.ts`. Test mock updated: `openLoopQueries` added to `./db` mock;
      `makeDbLoop()` helper for tests that go through the `list → toSnake` path; dedup test
      uses `mockAll` instead of `mockGet`.
  - **Item 2 — 9am call reliability hardening:**
    - `scheduleOpenCall()` in `lib/scheduler.ts`: added 3-minute in-flight guard (same pattern
      as the force-retry path) to prevent double Vapi calls when user double-taps "Open Call".
    - `openCall` rate limit added to `lib/rateLimit.ts` (5 / 5 min per user).
    - `/api/briefing/open-call`: wired `checkRateLimit('openCall', ...)`.
    - Scheduler audit: claim-first anti-double-dial ✅, STALE_CALLING/PENDING guards ✅,
      graceful Vapi error classification ✅, catch-up window (120 min) ✅. No further issues.
  - **Item 3 — Backups / durability:**
    - `maybeDailyBackup()` wired into nightly 3am cron (covers no-call days — previously
      only fired from Vapi webhook). 14-backup rotation on-volume unchanged.
    - Idempotency confirmed: `dailyFocusQueries.upsert` uses `ON CONFLICT DO UPDATE`;
      `calendarScoreQueries.upsert` same; `open_loops.insert` + `existsSimilar` dedup guard.
  - **Item 4 — CASA prep:** All code items remain COMPLETE from prior session.
    Remaining non-code: demo video scene (focus recommendation) + PM consent decision.
  - 827 green, tsc clean, next build clean.
- **2026-06-15** — **Privacy/security audit of email-derived data; retention prune for watched_threads.**
  - **Audit findings (email-derived PII coverage):**
    - `gmail_drafts_log.recipient/subject` ✅ encrypted at rest (`encryptNullable`)
    - `watched_threads.recipient/context` ✅ encrypted at rest (`encryptNullable`)
    - `notifications.title/body` ✅ encrypted at rest (`encryptNullable`)
    - `open_loops.description` ✅ encrypted at rest (shipped this session)
    - No email body ever stored — `getRecentEmailSignal` uses `format:'metadata'` only
    - Audit log records email signal fetch (thread count only, zero content)
    - All tables covered in self-service + admin deletion paths ✅
    - All tables (except `watched_threads` / `notifications` — ephemeral ops state) in data export ✅
  - **⚠️ PM DECISION REQUIRED — `facts.statement` plaintext:**
    LLM-distilled facts from email (`extractAndUpsertFactsFromEmail`) are stored as `facts.statement TEXT`
    (plaintext), shared with call-derived facts in the same column. Examples: "User is in debt
    negotiation with CIBC", "User owes a past-due balance to a collection agency." Risk: MEDIUM
    (LLM summary, not verbatim email). Options: (a) encrypt `facts.statement` globally (requires
    migration of existing rows — breaking, needs PM go-ahead); (b) add `source` column + encrypt
    email-derived rows only; (c) accept current design (LLM-distilled = not raw PII). Decision
    logged here so it doesn't fall through. PM/Derrick call.
  - **Retention minimization — `watched_threads`:**
    `watchedThreadQueries.prune()` added: deletes handled/dismissed reply-tracking rows older than
    30 days. Called nightly at 3am UTC alongside `openLoopQueries.prune()` via new cron in
    `lib/scheduler.ts` (independent try/catch so one failure can't block the other).
  - **CASA code items — ALL COMPLETE:** rate limiting ✅, audit log ✅, token revocation ✅,
    Google token revocation in disconnect ✅, privacy policy ✅. Remaining CASA non-eng:
    demo video scene (focus recommendation) + PM consent decision on inbox-reading opt-in.
- **2026-06-15** — **open_loops schema + queries + privacy plumbing; WhoopSleepDay.performancePct.**
  - **`open_loops` table (additive):** `lib/db.ts` — new table with `id, user_id, description,
    type (commitment_made|awaiting_you|deadline), source (email|call|calendar), due_date?,
    status (open|done|dismissed), created_at, resolved_at` + index on `(user_id, status, created_at DESC)`.
    `openLoopQueries`: `list(userId, status?)` (ordered due_date ASC NULLS LAST, created_at ASC),
    `insert()` (encrypts description via `encryptField`), `resolve()`, `dismiss()`, `prune()` (30-day
    retention on done/dismissed rows). `decryptOpenLoopRow()` unwraps on read.
  - **Privacy plumbing:** `DELETE FROM open_loops` in both self-service account deletion
    (`app/api/account/route.ts`) and admin user deletion (`app/api/admin/users/[id]/route.ts`).
    Data export (`app/api/account/export/route.ts`) includes decrypted open loops via
    `openLoopQueries.list()`. `account.test.ts` updated: mock + `openLoops` shape assertion.
  - **`WhoopSleepDay.performancePct`:** `lib/whoop.ts` — `WhoopSleepDay` interface extended with
    `performancePct: number`; `getSleepHistory` now maps `r.score.sleep_performance_percentage`
    (zero extra API cost — already fetched). Unblocks Core's 7-day weighted Energy Score.
  - 10 new integration tests in `lib/open-loops.test.ts` (in-memory SQLite): insert+decrypt,
    encryption-at-rest, due_date, status filter, user isolation (list/resolve/dismiss), resolve/dismiss
    state transitions, prune retention. Total: 787 green, tsc clean, next build clean.
- **2026-06-15** — **Call path hardening + CASA rate limiting + audit log.**
  - **Call path — claim-first anti-double-dial:** `lib/scheduler.ts`:
    `briefingQueries.createPending(userId, scheduledFor)` now called *before* briefing generation
    so a second cron tick (60s later) sees the 'pending' row and bails — fixes the TOCTOU race
    where two ticks both passed the guard during the 10–30s async briefing gen step.
    `briefingQueries.updateContent(id, content)` writes generated content after gen succeeds.
    On gen failure, row is marked `status='failed', error_code='briefing_gen_failed'` (not orphaned).
    `STALE_PENDING_MS = 5 min` — stale pending rows release the slot so a server crash mid-gen
    doesn't permanently block the day's call.
  - **Call path — daily-limit guard:** Both `checkAndInitiateCalls` and `scheduleBriefingCall`
    now also block on `status='failed' AND error_code='vapi_daily_limit'` rows for today — previously
    the scheduler retried every minute for 2 hours (120 wasted LLM calls) on a permanent failure.
    Daily-limit `CallError` now surfaced directly from the idempotency check, not only from the Vapi
    call path. 'pending' + daily-limit conditions mirrored in `checkAndInitiateCalls` (cron level).
  - 6 new scheduler tests (claim-first order, updateContent call, gen-failure marks row, blocks on
    daily-limit, blocks on pending). 31 scheduler tests total.
  - **CASA rate limiting on new routes** (`lib/rateLimit.ts` — 5 new keys, user-scoped):
    `/api/day-plan` (10/hr), `/api/day-plan/confirm` (5/hr), `/api/focus/recommend` (20/hr),
    `/api/focus/confirm` (30/hr), `/api/scores` (20/hr). User-scoped via `user.id.toString()`
    (avoids shared-IP false positives behind corporate NAT).
  - **Audit log on write paths:** `applyDayPlan` logged in `/api/day-plan/confirm` (action count,
    descriptions). `confirmFocusAreas` logged in `/api/focus/confirm` (date, area titles).
  - 744/744 green, tsc clean, next build clean.
- **2026-06-15** — **Token revocation + security audit of new write paths.**
  - **Whoop token revocation (CASA item):** `lib/whoop.ts` — `REVOKE_URL` constant;
    `clearUserCaches(userId)` clears all 6 in-memory caches on disconnect;
    `revokeWhoopAccess(userId)` (exported) — POSTs to Whoop's RFC-7009 revoke endpoint
    with refresh_token (falls back to access_token), best-effort (catch/log errors),
    always deletes local row + clears caches regardless of revoke outcome. Skips HTTP
    call when client not configured or no token stored.
    `app/api/whoop/disconnect/route.ts` updated to call `revokeWhoopAccess` (was calling
    `whoopQueries.delete` directly). 6 new tests: revoke with refresh_token, fallback to
    access_token, local cleanup on network failure, on non-2xx, no-token skip, unconfigured skip.
    Note: Google token revocation was already implemented in `lib/calendar.ts:disconnectCalendar()`
    via `getOAuthClient().revokeToken()`. Both OAuth providers are now fully covered.
  - **Security/privacy audit of new write paths from Core's overnight build:**
    Audited: `daily_focus` table, `calendar_plan_executions`, `calendarPlan.ts`, `focusRecommendation.ts`,
    `/api/day-plan`, `/api/day-plan/confirm`, `/api/focus/recommend`, `/api/focus/confirm`.
    **Findings (all fixed inline):**
    1. **GAP FIXED: `daily_focus` missing from deletion routes** — added to both admin delete
       (`DELETE /api/admin/users/[id]`) and self-service delete (`DELETE /api/account`).
    2. **GAP FIXED: `daily_focus` missing from data export** — added to `GET /api/account/export`
       (exports date, parsed focusAreas JSON, generatedAt, confirmed flag for all dates).
    **No-action findings (documented):**
    - `daily_focus.focus_areas` is a JSON array of productivity area titles/rationale — same
      sensitivity tier as `tasks`/`priorities` (not encrypted at rest, consistent policy).
    - `calendar_plan_executions` is internal idempotency tracking (UUIDs + counts, no user
      content) — not included in export; not PII; already in deletion routes.
    - `/api/focus/confirm` accepts an optional `dateParam` from request body (allows planning
      ahead). Low risk — userId always comes from session; no cross-user leakage.
    - All write paths are user-scoped, auth-gated, idempotent where appropriate. No SQL
      injection risk (parameterized queries throughout).
  - 739/739 green, tsc clean, next build clean.
- **2026-06-14** — **CASA prep — GDPR deletion table updated, privacy page accurate, CASA checklist.**
  - `specs/google-verification.md`: marked Privacy Policy + self-service deletion checklist items done;
    updated §4 deletion table to include all new tables (`calendar_plan_executions`, `event_energy_tags`,
    `calendar_scores`, `energy_profile`, `focus_milestones`, `energy_log`) in correct leaf-first order;
    removed "gap" note (self-service deletion shipped 2026-06-13); fixed "inbox-wide scan" wording in §5
    security answer; added focus recommendation demo scene (scene 7); updated last-updated date.
  - **Remaining CASA items (PM + user):** (1) Google token revocation in disconnect flow → Core lane;
    (2) demo video recorded and uploaded; (3) PM decision on separate inbox-reading consent step;
    (4) document reviewed by user before submission.
- **2026-06-14** — **Privacy plumbing — data export coverage + privacy page accuracy.**
  - `GET /api/account/export`: added `calendarScores` (all days, focus/energy scores + JSON drivers),
    `energyProfile` (peak/trough hours), `eventEnergyTags` (eventId, type, demand, taggedAt).
    Encryption assessment: none of these store credentials or health PII — same tier as tasks/priorities;
    title_hash is a SHA-derived internal key, not exportable user content (omitted from export).
  - `app/privacy/page.tsx`: Gmail section rewritten to accurately disclose inbox signal reading:
    metadata-only (sender, subject, auto-snippet — never bodies), in-memory, not stored, audit-count
    only. Previously said "reads only threads Edge created" which became false after
    `getRecentEmailSignal` landed. Limited Use section + "How We Use" updated. Date bumped to 2026-06-14.
  - `account.test.ts`: `energyProfileQueries` added to mock; new export shape assertions
    (`calendarScores`, `energyProfile`, `eventEnergyTags`). 673/673 green.
- **2026-06-14** — **`applyCalendarPlan` durability — batch idempotency + plan-level undo group.**
  - `lib/db.ts`: `calendar_plan_executions` table — `UNIQUE(user_id, plan_id)` + `INSERT OR IGNORE`
    makes plan apply idempotent (double-submit on retry/re-render silently no-ops). Tracks
    `status` (applied/reverted), `mutation_count`, `applied_at`, `reverted_at`. Index on
    `(user_id, plan_id)`. Migration: `ALTER TABLE undo_log ADD COLUMN plan_id TEXT` (idempotent).
  - `undoQueries` extended: `recordForPlan(userId, label, payload, planId)` — inserts undo entry
    with plan association; `getByPlanId(userId, planId)` — returns entries `ORDER BY id DESC`
    (most-recent-first = correct undo order); `markPlanUndone(userId, planId)` — sets `undone=1`
    on all plan entries (prevents double-undo).
  - `calendarPlanQueries` exported: `get`, `markApplied` (INSERT OR IGNORE idempotent),
    `markReverted` (UPDATE status/reverted_at). `CalendarPlanExecution` interface exported.
  - `lib/undo.ts`: `recordUndo` extended with optional `planId?` — routes to `recordForPlan`
    when present. `undoPlan(userId, planId, cal)` — executes all entries in a plan batch in
    reverse-insertion order; marks plan undone + reverted; returns `{ reverted: count }`.
  - Deletion routes: `calendar_plan_executions` added to both admin + self-service delete (leaf-first).
  - 22 new tests: `lib/calendar-plan.test.ts` (in-memory SQLite — idempotency, user isolation,
    markReverted, plan-vs-standalone); `lib/undo.test.ts` (mock-based — empty plan, reverse order,
    partial failure, markPlanUndone + markReverted side effects). 673/673 green.
  - **Core handoff:** Generate a UUID `planId` before calling any hero-loop mutations. Pass `planId`
    to `recordUndo(userId, label, ops, planId)` for each mutation. After all mutations succeed, call
    `calendarPlanQueries.markApplied(userId, planId, mutationCount)`. Check
    `calendarPlanQueries.get(userId, planId)` first — if found, it's a replay (idempotent). For undo,
    call `undoPlan(userId, planId, cal)` to revert the whole batch at once.
- **2026-06-14** — **Email signal primitive — `getRecentEmailSignal` for Focus Recommendation.**
  - `lib/gmail.ts`: `getRecentEmailSignal(userId, { days?, max? }) → EmailSignal` — fetches a
    compact digest of recent INBOX threads for Core's `recommendFocusAreas()`. Privacy-first:
    - `format:'metadata'` enforced at the API call — only headers (From, Subject, Date) and
      Gmail's own auto-truncated snippet (~100 chars) are fetched. Message bodies never requested.
    - No storage of email content — derive signal in-memory, return to caller, discard.
    - Audit log: thread count + days window only. Zero email content in the log.
    - INBOX label only; hard cap of 50 threads per call regardless of `opts.max`.
    - Scope gate: returns `{ items: [], scopeMissing: true }` gracefully when `gmail.readonly`
      not granted — caller degrades without throwing.
    - Individual thread-fetch failures swallowed via `Promise.allSettled` — partial result
      always returned instead of aborting.
  - `EmailSignalItem` interface: `{ threadId, sender, subject, snippet, date, isUnread, isImportant }`.
  - `EmailSignal` interface: `{ items, fetchedAt, scopeMissing }`. Exported from `lib/gmail.ts`.
  - `lib/gmail.test.ts`: 10 new tests (25 total) — scope gates, empty inbox, metadata mapping,
    snippet-from-list (not body), partial-failure resilience, audit entry contents, inbox-only
    filter, max-cap enforcement. All verify no body content is ever fetched/stored.
  - **⚠️ CASA FLAG documented in `specs/google-verification.md`:** `gmail.readonly` use-case
    expands from "read only watched_threads" to also "read recent INBOX metadata for AI
    prioritization." Scope itself unchanged (already in `GOOGLE_SCOPES`). Required actions before
    CASA re-submission: (1) update Privacy Policy to disclose inbox reading; (2) update §5
    questionnaire answers; (3) add focus recommendation demo scene; (4) PM decision on separate
    consent step for inbox reading.
  - 651/651 green, tsc clean, next build clean.
  - **Core handoff:** `getRecentEmailSignal(userId, { days: 14, max: 20 })` from `@/lib/gmail`.
    Returns `EmailSignal`. Pass `items` as context into the `recommendFocusAreas` LLM call.
    When `scopeMissing: true`, prompt re-consent or degrade gracefully. Nothing to store —
    the signal is ephemeral input to the LLM, same as calendar events.
- **2026-06-14** — **Event energy tag cache — `event_energy_tags` table (additive).**
  - `lib/db.ts`: `event_energy_tags (id, user_id, google_event_id, type, demand CHECK('high','med','low'),
    title_hash, tagged_at)`. UNIQUE(user_id, google_event_id) + upsert-on-conflict. Index on
    `(user_id, google_event_id)`. `title_hash` enables automatic cache invalidation when an event is renamed.
  - `eventEnergyTagQueries` exported: `get(userId, eventId)`, `upsert(userId, eventId, {type, demand,
    titleHash})`, `getMany(userId, eventIds[])` (batch lookup; empty input → empty array).
  - `EventEnergyTag` interface exported.
  - Table added to admin + self-service deletion routes (leaf-first FK order).
  - `lib/event-energy-tags.test.ts`: 10 in-memory integration tests — get/miss, upsert overwrite, cross-user
    isolation, getMany partial hits + user scoping.
  - 591/591 green, tsc clean, next build clean.
  - **Core handoff:** `eventEnergyTagQueries` live from `@/lib/db`. Call `getMany(userId, eventIds)` to
    batch-read cached tags before scoring; `upsert(userId, eventId, {type, demand, titleHash})` to write
    after LLM classifies. Compare `title_hash` (e.g. `sha256(title).slice(0,8)`) on read — if mismatched,
    re-classify and upsert the new tag.
- **2026-06-14** — **Calendar scoring engine schema — `calendar_scores` + `energy_profile` tables (additive).**
  - `lib/db.ts`: `calendar_scores (id, user_id, date, focus_score, energy_score, focus_drivers TEXT/json,
    energy_drivers TEXT/json, created_at)`. UNIQUE(user_id, date) + upsert-on-conflict. Index on
    `(user_id, date)`. Stores daily Focus + Energy scores (1–10) with JSON driver arrays for explanation UI.
  - `calendarScoreQueries` exported: `upsert(userId, date, {focusScore, energyScore, focusDrivers,
    energyDrivers})`, `getRange(userId, fromDate, toDate)`, `getLatest(userId)`. All user-scoped.
  - `CalendarScore` interface exported.
  - `lib/db.ts`: `energy_profile (user_id PK, peak_start, peak_end, trough_start, trough_end, updated_at)`.
    One row per user (PK = user_id); upsert via `ON CONFLICT(user_id) DO UPDATE SET …`. Stores the user's
    stated energy windows as integer hours (0–23) for the Energy Score engine.
  - `energyProfileQueries` exported: `get(userId)`, `upsert(userId, {peakStart, peakEnd, troughStart,
    troughEnd})`. User-scoped (PK enforces isolation).
  - `EnergyProfile` interface exported.
  - Both tables added to admin + self-service deletion routes (leaf-first FK order).
  - `lib/calendar-scores.test.ts`: 11 in-memory integration tests — upsert semantics, getLatest ordering,
    getRange bounds + user isolation, energy profile CRUD + upsert overwrite + cross-user isolation.
  - 581/581 green, tsc clean, next build clean.
  - **Core handoff:** `calendarScoreQueries` + `energyProfileQueries` are live from `@/lib/db`. Wire into
    `lib/calendarScore.ts` (scoring engine) — call `calendarScoreQueries.upsert` to persist each day's
    score, and `energyProfileQueries.get` to read peak/trough for the Energy Score input.
- **2026-06-14** — **Focus Scoreboard schema — `focus_milestones` table (additive).**
  - `lib/db.ts`: `focus_milestones (id, user_id, priority_id, title, done, sort_order,
    created_at, completed_at)`. FK to `priorities(id)`. Index on `(user_id, priority_id)`.
    `CREATE TABLE IF NOT EXISTS` — additive, idempotent.
  - `focusMilestoneQueries` exported: `listForUser(userId)`, `listForPriority(userId, priorityId)`,
    `create(userId, priorityId, title)`, `setDone(id, userId, done)` (manages `completed_at`
    automatically), `remove(id, userId)`. All queries filter by `user_id` — security invariant.
  - `FocusMilestone` interface exported.
  - `focus_milestones` added to admin + self-service deletion routes (leaf-first FK order).
  - `lib/focus-milestones.test.ts`: 12 in-memory integration tests — CRUD, done lifecycle
    (completed_at set/cleared), user isolation (wrong userId = no-op on setDone/remove),
    cross-priority filtering. 555/555 green, tsc clean, next build clean.
  - **Core handoff:** `focusMilestoneQueries` is live from `@/lib/db`. Wire into
    `GET/POST /api/priorities/[id]/milestones` + dashboard Focus Scoreboard.
- **2026-06-14** — **Energy OS schema — `energy_log` table (additive).**
  - `lib/db.ts`: `energy_log` table — `(user_id, date, level, source, created_at)`, unique on
    `(user_id, date)` (one record per user per day). `level` CHECK `('red','yellow','green')`;
    `source` CHECK `('whoop','manual','override')`. Index on `(user_id, date)`.
  - `energyLogQueries.getForDate(userId, date)` — returns today's energy record or `undefined`.
  - `energyLogQueries.setEnergy(userId, date, level, source)` — upserts via `INSERT OR REPLACE`.
    Callers pass the user's local YYYY-MM-DD date. Override source wins over Whoop tier (per spec).
  - `EnergyLog` interface exported from `lib/db.ts`.
  - `energy_log` rows added to both admin + self-service user-deletion routes; included in data export.
  - 9 new in-memory integration tests covering: basic CRUD, upsert (one row per user-date after N
    writes), cross-date isolation, cross-user isolation. 522/522 green, tsc clean, next build clean.
  - **Core action items:** consume `energyLogQueries` from `lib/briefing.ts` (derive from Whoop
    recovery tier + store as 'whoop'), from `vapi.ts` call handler (ask/store 'manual', store
    override as 'override'), and from a new `GET/POST /api/energy` dashboard quick-set endpoint.
- **2026-06-13** — **Data export + self-service account deletion (GDPR / Google CASA launch requirement).**
  - `GET /api/account/export` — user-scoped, returns a full JSON download of all user data:
    profile (no password_hash), priorities, memories, facts, tasks, briefings (with decrypted
    transcript/user_response), and email draft history (recipient/subject decrypted). Sets
    `Content-Disposition: attachment` so browsers download the file. 10000-row cap on
    briefings/memories (ample for any real user at launch).
  - `DELETE /api/account` — user-scoped, irreversible self-service deletion. Requires body
    `{ "confirm": "delete my account" }` (explicit contract for Core's UI — 400 without it).
    Deletes all 16 tables in FK-safe order (same coverage as admin route: whoop_tokens,
    calendar_tokens, gmail_drafts_log, watched_threads, notifications, audit_log, facts,
    briefings, preview_briefings, memories, priorities, tasks, undo_log, event_dedupe_keys,
    delete_confirm_tokens, users). Clears the session cookie on success.
  - `lib/db.ts`: `Briefing` interface completed (was missing `retry_attempted`,
    `calendar_actions`, `edge_promises`, `tool_actions` fields).
  - 15 new tests (auth guards, response shape, confirm contract, deletion coverage,
    cookie clearing). 490/490 green, tsc clean, next build clean.
  - **Core action items:** wire "Export my data" link → `GET /api/account/export` and
    "Delete account" confirmation flow → `DELETE /api/account` (with the exact phrase UI).
    Also add Google token revocation call in `lib/calendar.ts` disconnect (CASA requirement).
- **2026-06-13** — **Call reliability: idempotency guard + error_code persistence + call-status endpoint.**
  - `lib/db.ts`: `briefings` table gains `error_code TEXT` column (migration + `ALLOWED_FIELDS`
    + `Briefing` interface + `briefingQueries.getTodayForUser(userId, datePrefix)` helper).
  - `lib/scheduler.ts`:
    - `CallError.code` extended with `'already_called'`.
    - `getTodayCallStatus(userId)` — exported query wrapper returning today's briefing status
      in the user's local timezone; used by the status endpoint.
    - `triggerBriefingCallNow(userId)` — exported safe re-trigger; catches `CallError` and
      returns `{ ok: false, code, message }` instead of throwing (Core can call this from the
      "I didn't get my call" button without try/catch boilerplate).
    - Idempotency guard inside `scheduleBriefingCall`: checks for an existing
      `calling`/`completed` briefing for today before creating a new record — throws
      `CallError('already_called')` so the on-demand path can't double-fire.
    - Both Vapi error catch blocks now persist `error_code` alongside `status: 'failed'`
      so the dashboard can surface WHY a call failed.
  - `app/api/vapi/call-status/route.ts` (new): `GET` endpoint, user-scoped. Returns
    `{ status, errorCode, briefingId, scheduledFor }` for today's call or
    `{ status: 'none', ... }` when no briefing exists. Core reads this for the
    "Call me now" button state and error messaging.
  - 10 new tests (idempotency guard × 4, `triggerBriefingCallNow` × 4, error_code
    persistence × 1, existing assertions updated to `objectContaining`). 475/475 green,
    tsc clean, next build clean.
- **2026-06-13** — **At-rest encryption verification + user deletion completeness + Google CASA prep.**
  - `lib/db-encryption.test.ts` (11 tests): integration proof that ciphertext is
    stored on disk for `calendar_tokens` (access+refresh), `whoop_tokens`
    (access+refresh), and `briefings` (transcript+user_response). Each test writes
    via the normal query helper, reads raw SQLite bytes and asserts `enc:1:` prefix,
    then reads via the normal get path and asserts plaintext round-trip. Also verifies
    no-key degradation (plaintext stored transparently). 452/452 green.
  - `app/api/admin/users/[id]/route.ts`: user deletion was missing 9 tables.
    Added `whoop_tokens` (health PII — critical), `gmail_drafts_log`,
    `watched_threads`, `notifications`, `audit_log`, `facts`, `preview_briefings`,
    `undo_log`, `event_dedupe_keys`, `delete_confirm_tokens`. All user data is now
    fully purged on account deletion.
  - `specs/google-verification.md`: Google CASA prep document — scope inventory
    (calendar.readonly, calendar.events, gmail.compose, gmail.readonly) with
    justifications and code pointers; data handling + storage table; security
    controls summary; retention/deletion policy; draft Google security questionnaire
    answers; demo video shot-list (7 scenes); CASA process notes and pre-submission
    checklist. Two action items surfaced: (a) self-service `DELETE /api/account`
    endpoint needed before CASA (currently admin-only); (b) Google token revocation
    call missing from disconnect flow (Core lane).
- **2026-06-13** — **Whoop history fetch primitive.**
  Added `getRecoveryHistory(userId, days=14)`, `getSleepHistory(userId, days=14)`,
  `getStrainHistory(userId, days=14)` to `lib/whoop.ts`. Each uses the WHOOP v2
  date-range `start` param + `limit=25` and follows `next_token` pagination via a
  new `whoopGetAll` helper (max 50 records). Returns `{ date, recoveryScore | durationMs | strain }[]`
  sorted oldest-first; naps filtered from sleep history; PENDING_SCORE records dropped.
  Caches per user (1h TTL, consistent with point-in-time fns). Degrades to `[]` on
  any failure — never throws. Raw record types extended with `created_at?` (recovery)
  and `start?` (sleep, cycle). New public exports: `WhoopRecoveryDay`, `WhoopSleepDay`,
  `WhoopStrainDay`. 20 new tests (IDs 300–317). 391/391 green, tsc clean, next build clean.
  🤝 **For Core:** import `getRecoveryHistory`, `getSleepHistory`, `getStrainHistory`
  from `lib/whoop.ts` — all return `[]` when Whoop is not connected, so safe to call
  unconditionally.
- **2026-06-13** — **Litestream restore drill + encryption ops-readiness.**
  Ticket 1: `scripts/restore-drill.sh` — standalone shell script that downloads
  Litestream, runs `litestream restore` to a temp path, verifies the restored DB
  with `better-sqlite3` (`PRAGMA integrity_check` + row counts on key tables), and
  exits 0/1 with a clear PASS/FAIL summary. Documented in `LAUNCH.md` §10 (restore
  drill log, how-to, PITR manual-restore command). Ticket 2: `lib/healthCheck.ts`
  — `runHealthChecks()` asserts 5 launch-critical conditions: `DATA_ENCRYPTION_KEY`
  (critical), `JWT_SECRET` (critical), DB connectivity (critical), Litestream S3
  replication (high), `VAPI_SECRET_ENFORCE` (high). Returns `status: ok | degraded
  | critical` + per-check detail. New admin endpoint `GET /api/admin/health` wraps
  it (HTTP 503 on critical). Logs `console.warn` on any failure so Railway log
  surfaces it. `LAUNCH.md` §9 (encryption ops: key generation, STRICT_ENCRYPTION
  rollout, how to verify), §2 env-var table updated (WHOOP_, LITESTREAM_, STRICT_
  ENCRYPTION). 8 new tests. 338/338 green.
  🤝 **For PM:** After setting `DATA_ENCRYPTION_KEY` + `STRICT_ENCRYPTION=1` on Railway,
  hit `GET /api/admin/health` (admin cookie) to confirm. After setting `LITESTREAM_S3_*`,
  run `sh scripts/restore-drill.sh` from the Railway shell and record the result in
  LAUNCH.md §10 restore drill log.
- **2026-06-13** — **Whoop OAuth integration — foundation layer.**
  New `whoop_tokens` table in `lib/db.ts` (encrypted at rest — health data PII; same
  `encryptField`/`decryptField` pattern as `calendar_tokens`). `whoopQueries`: `upsert`,
  `get` (decrypt-on-read), `delete`. New `lib/whoop.ts`: `getAuthUrl(userId)`,
  `exchangeCode(code)`, `refreshAccessToken` (auto-refresh 5 min before expiry),
  `getLatestRecovery(userId)` → `{ recoveryScore, hrv, restingHeartRate }`,
  `getLastSleep(userId)` → `{ durationMs, performancePct, efficiencyPct }` (naps
  skipped), `getRecentStrain(userId)` → `{ strain, avgHeartRate }`, `hasWhoopConnected`.
  All public fetch fns degrade to `null` when `WHOOP_CLIENT_ID`/`WHOOP_CLIENT_SECRET`
  unset or on any network failure. 1-hour in-memory cache per user (daily briefing pull).
  Routes: `/api/whoop/connect` (start OAuth, sets backup uid cookie), `/api/whoop/callback`
  (exactly `https://edg3.ai/api/whoop/callback` — matches Whoop dev-app redirect URI),
  `/api/whoop/disconnect`, `/api/whoop/status`. 21 new tests. 311/311 green. tsc + next
  build clean.
  🤝 **For Core:** consume `getLatestRecovery`, `getLastSleep`, `getRecentStrain` from
  `@/lib/whoop` in `lib/briefing.ts`. All return `null` when disconnected/unscored —
  safe to skip. `hasWhoopConnected(userId)` for the dashboard "Connect Whoop" button.
  **Env needed on Railway:** `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET` (user is creating
  the Whoop dev app; PM will set these).
- **2026-06-11** — **[CRITICAL] Surface Vapi/briefing failures — "Call me now" no longer fails opaquely.**
  `scheduleBriefingCall` and `scheduleOpenCall` previously awaited `initiateCall` and
  `generateDailyBriefing` with no try/catch — any Vapi rejection (e.g. free-tier daily
  cap) threw an unhandled 500 with no information for the dashboard. Fix: new `CallError`
  class with `userMessage` + `code` (`vapi_daily_limit` / `vapi_error` /
  `briefing_gen_failed`); `classifyVapiError()` detects the daily-limit string vs generic
  failures. Both scheduler functions now catch Vapi errors → set briefing to `'failed'` →
  throw `CallError`. Briefing gen failure is separately guarded. Routes
  (`/api/briefing/call`, `/api/briefing/open-call`) return HTTP 503 with
  `{ error, code }` so the dashboard can tell "daily cap" from "broken". 7 new tests for
  CallError + 7 catch-up window tests retained. 290/290 green.
- **2026-06-11** — **[CRITICAL] Scheduler catch-up window — missed morning calls fixed.**
  Root cause: `checkAndInitiateCalls` matched the call tick by exact minute
  (`userCurrentTime !== user.call_time`) — any server restart during that minute
  caused a silent miss with no retry. Fix: replaced exact-match with a 120-minute
  catch-up window (`userMinutes >= callMinutes && userMinutes < callMinutes + 120`).
  The existing once-daily dedupe (check for `calling`/`completed` briefing today)
  prevents double-firing within the window. `checkAndInitiateCalls` exported with
  injectable `now: Date` for deterministic testing. 7 new tests covering: fires at
  call_time, fires after missed tick, doesn't fire before call_time, doesn't fire
  past grace window, doesn't double-fire, multiple ticks = one call, fires at last
  minute of window. 283/283 green.
- **2026-06-10** — **[LOW-MED] rateLimit loud-fail + crypto strict-mode.** (a) `checkRateLimit`
  catch now logs loudly via `console.error` — a silent fault was erasing brute-force
  protection with no observable signal. (b) `encryptField` in `lib/crypto.ts` supports
  `STRICT_ENCRYPTION=1`: throws instead of silently passing plaintext when
  `DATA_ENCRYPTION_KEY` is unset — prevents misconfigured deploys from persisting
  plaintext PII. Health signal: `/api/admin/backup` GET already exposes `encryptionEnabled`.
  3 new tests; 172/172 green.
- **2026-06-10** — **[MEDIUM] Fixed XFF rate-limit bypass in `getClientIP`.** The old
  `split(',')[0]` (leftmost hop) was fully client-controlled — an attacker could send a
  random `X-Forwarded-For` per request and get a fresh rate-limit bucket every time,
  defeating brute-force protection on login/signup. Fix: take the rightmost hop instead
  (Railway's load balancer appends the IP it observed, so the rightmost entry is
  proxy-verified). 2 new tests (rightmost-wins + spoofed-leftmost rejected). 169/169 green.
- **2026-06-10** — **[HIGH] Fixed admin auth bypass on CoS-agent routes.** Two routes
  (`app/api/admin/calendar/events`, `app/api/admin/latest-briefing`) used a local
  `checkAuth()` with `===` — the exact timing side-channel `timingSafeEqual` was added
  to kill. Both had no rate limiting. Fix: new `checkAdminSecretAuth(req)` in
  `lib/adminAuth.ts` (timingSafeEqual on `ADMIN_SECRET`/`x-admin-secret` header);
  new `adminApi` bucket in `lib/rateLimit.ts` (60/min); both routes now use the shared
  helpers. 6 new tests. 167/167 green.
- **2026-06-10** — **Gmail READ access code-complete** (was already implemented;
  added missing test coverage). `readThread(userId, threadId)` in `lib/gmail.ts` with
  `hasGmailReadScope` scope gate, `GMAIL_READONLY_SCOPE` in `lib/google-auth.ts`,
  `GOOGLE_SCOPES` includes both compose + readonly. `watched_threads` table +
  `watchedThreadQueries` in `lib/db.ts`. 10 new tests for `readThread` +
  `hasGmailReadScope` + snippet-fallback behavior. 160/160 green.
  ⚠️ **Prod landmine:** `gmail.readonly` is a Google *restricted* scope → needs
  Google app verification + CASA before prod rollout. Same queue as `gmail.compose`.
  🤝 **For Core:** `readThread(userId, threadId)` is the guarded primitive. Import from
  `@/lib/gmail`. Pass only `threadId`s from `watched_threads` (threads Edge created).
- **2026-06-10** — Shipped **#7 Harden audit log**. New append-only `audit_log` table
  in `lib/db.ts` (no row cap — unlike `briefings.tool_actions` which was capped at 50;
  90-day retention with ~1% prune on each insert). Columns: `user_id`, `briefing_id`
  (null = web), `action`, `args_json`, `result_text`, `ok`, `snapshot_before`,
  `snapshot_after`, `created_at`. Index on `(user_id, created_at DESC)`. New
  `auditLogQueries`: `record()` (never throws), `recent(userId, limit)` (Core's
  dashboard feed), `recentAll(limit)` (admin panel), `successCount(userId, days)`.
  Wired into `tool-call/route.ts` (every voice tool call — alongside the legacy
  `tool_actions` JSON blob for backward compat) and `book/route.ts` (web "Book it"
  path). Admin endpoint `/api/admin/audit` (GET with userId/limit/action/failures
  filters). `AuditEntry` + `AuditRow` types exported for Core's dashboard queries.
  16 new tests; preflight green (150/150, tsc, next build).
  🤝 **For Core:** `auditLogQueries.recent(userId, limit)` is the data source for the
  "Recent Activity" feed. Import from `@/lib/db`. The `snapshot_before`/`snapshot_after`
  fields are null for now — a future pass will populate them as handlers capture
  pre/post calendar state.
- **2026-06-10** — Shipped **#10 Harden admin auth**. Two fixes: (1) `edg3_admin`
  cookie now stores `HMAC-SHA256(ADMIN_PASSWORD, "edg3-admin-session-v1")` — a
  derived token — instead of the raw password; cookie leak no longer exposes the
  secret. (2) All password/cookie comparisons use `crypto.timingSafeEqual` —
  constant-time compare prevents timing side-channels. New `lib/adminAuth.ts`:
  `checkAdminAuth(req)`, `verifyAdminPassword(submitted)`, `getAdminCookieToken()`.
  All 11 admin routes migrated from inline `checkAdminAuth` / async `checkAdmin`
  stubs to the shared utility (removes ~60 lines of duplicated code). Admin login
  also wired into existing rate-limiter (#8 missed it). 15 new tests; preflight
  green (134/134, tsc, next build). Note: existing admin sessions (old cookie format)
  are invalidated — admin must re-login after deploy.
- **2026-06-10** — Shipped **#8 Rate limiting** on auth + admin endpoints. New
  `lib/rateLimit.ts`: `checkRateLimit(type, ip)` (fixed-window counter via
  `rate_limits` SQLite table, atomic transaction, fails open on fault),
  `getClientIP()` (prefers `x-forwarded-for` for Railway proxy), `rateLimitResponse()`
  (429 + `Retry-After` / `X-RateLimit-Reset` headers). Limits: `login` 10/15min,
  `signup` 5/hr, `triggerCall` 3/5min. Wired into `auth/login`, `auth/signup`,
  `admin/trigger-call`. `rate_limits` table + `rateLimitQueries.check()` in db.ts.
  12 new tests; preflight green (117/117, tsc, next build).
- **2026-06-10** — Shipped **#5 off-box durability (Litestream)**. `litestream.yml`:
  S3-compatible replication (72h WAL retention, 6h full snapshots, 1s sync interval,
  configurable endpoint for B2/R2/MinIO). `scripts/start.sh`: conditional wrapper —
  active only when `LITESTREAM_S3_BUCKET` is set; auto-restores DB on fresh volume;
  falls back to plain start on download failure (never blocks the app). `railway.toml`
  start command updated. `lib/backup.ts`: `verifyBackup(file)` opens snapshot read-only
  (separate connection, never touching live DB), runs `PRAGMA integrity_check`, returns
  row counts for key tables — supports restore drill without downtime. `litstreamEnabled()`
  for admin UI. Admin backup endpoint: GET exposes `litstreamEnabled`; POST supports
  `{ action: 'verify' }` to run the drill in-process. 105/105 preflight green.
  ⚠️ **Ops:** set S3 env vars + redeploy + run the restore drill (see #5 checklist).
- **2026-06-10** — Shipped **#2 Vapi secret enforcement (code side)**. The two-stage
  gate (`checkVapiSecret`) was already implemented; added observability to make the
  24h fail-open window actionable. New `vapi_auth_log` table + `vapiAuthLogQueries`
  persist every mismatch event (accepted calls not logged — low noise). New admin
  endpoint `/api/admin/vapi-secret`: returns `enforceMode`, `secretSet`,
  `mismatches24h` (24h window), `readyToEnforce` flag, and last 50 events. Wired into
  both `webhook` and `tool-call` routes. New `lib/vapi.test.ts` (10 tests for all 4
  `checkVapiSecret` states). preflight green (105/105, tsc, next build).
  ⚠️ **Ops follow-up:** set `VAPI_SERVER_SECRET` on Railway → monitor
  `/api/admin/vapi-secret` for 24h (confirm `readyToEnforce: true`) → set
  `VAPI_SECRET_ENFORCE=true` → redeploy.
- **2026-06-10** — Shipped **#9 Hard delete-confirmation** (server-issued one-time token).
  Replaces the `confirmed=true` boolean (which the model could self-set) with a
  `confirmToken` that the server generates and the model must present back verbatim.
  `delete_confirm_tokens` table (2-min TTL, `consume()` is atomic transaction, single-use).
  `issueDeleteToken`/`consumeDeleteToken` in `lib/idempotency.ts`. `deleteEvent` handler
  updated; `consumeDeleteToken` fails CLOSED (false on any DB fault). System prompt
  instruction in `lib/vapi.ts` updated. 7 new tests; preflight green (95/95, tsc, next build).
  ⚠️ **Ops follow-up:** update the `deleteEvent` Vapi tool schema in the dashboard — add
  `confirmToken: string` (optional), remove `confirmed: boolean`.
- **2026-06-10** — Shipped **#3 Event-creation idempotency** (both creation paths). New
  `lib/idempotency.ts`: `claimEventCreate(userId, key)` + `buildEventDedupeKey(title, start)`.
  New `event_dedupe_keys` SQLite table (5-min TTL, atomic `INSERT OR IGNORE`, composite PK).
  Guards: voice `createEvent` (timed + all-day), `createRecurringEvent`, `copyDayEvents` in
  `tool-call/route.ts`; web "Book it" in `app/api/calendar/book/route.ts`. Fails open — a DB
  fault never blocks a real write. 10 new tests; full suite 71/71, tsc clean.
- **2026-06-09** — Shipped **★ Gmail draft-only access primitive + scope + undo op**
  (gates Core's email feature). Per PM ownership ruling, `lib/gmail.ts` +
  `lib/google-auth.ts` are Security's guarded primitive; Core's `lib/outreach.ts`
  composes and calls it. Delivered: `lib/google-auth.ts` (scope authority incl.
  `gmail.compose` + `hasGmailScope`/`missingRequiredScopes`); `lib/gmail.ts`
  `createDraft(userId, {to,subject,body})` with built-in scope gate (`GmailScopeError`),
  per-user hourly rate limit (`GMAIL_DRAFTS_PER_HOUR` → `GmailRateLimitError`), and
  append-only `gmail_drafts_log` audit (recipient/subject encrypted at rest) — exposes
  only `drafts.create`/`drafts.delete`, never `messages.send`; plus `deleteDraft` +
  `userHasGmailScope`. `calendar_tokens.scope` persisted (re-consent detection);
  `lib/calendar.ts` requests the scope + `include_granted_scopes`; new **`deleteDraft`
  UndoOp** in `lib/undo.ts` → Security's `deleteDraft`. **Core wiring:** `createDraft(
  userId, { to: recipient.email, subject, body })` then record `deleteDraft` undo.
  ⚠️ Prod landmine: `gmail.compose` is a Google restricted scope (verification + CASA)
  before rollout beyond the owner dogfooding via the unverified-app path.
- **2026-06-09** — Shipped **#4 Data-at-rest encryption** + **#5 code-side
  durability** (commit `80b4d30`). `lib/crypto.ts`: AES-256-GCM field encryption,
  transparent + backward-compatible (legacy plaintext passes through; no-op until
  `DATA_ENCRYPTION_KEY` is set → fail-safe rollout, lazy re-encrypt on next write;
  8/8 unit tests green). Wired in `lib/db.ts` to encrypt `calendar_tokens`
  (access/refresh) **and** `briefings` PII (`transcript`, `user_response`) on write,
  decrypt on read; read sites (admin briefings, verify-promises, webhook) decrypt
  via `decryptBriefingRow`. `lib/backup.ts`: online `.backup()` SQLite snapshots w/
  rotation + opportunistic `maybeDailyBackup()`; admin-gated `app/api/admin/backup`.
  H1 ✅, Transcript-PII ✅. **Ops follow-up:** set `DATA_ENCRYPTION_KEY` on Railway
  (until then encryption no-ops); off-box replication (Litestream) for volume-loss
  is the remaining ops half of #5.
- **2026-06-09** — Shipped **#6 Undo** (commit `28f364d`): every mutation records
  inverse ops in a new `undo_log`; reversible by voice (`undoLastAction`) and
  dashboard. H3 now ✅. Defused **#1 JWT fallback** in code (`lib/auth.ts` fails
  closed — throws if `JWT_SECRET` unset, no public default). **Ops follow-up
  still open:** rotate `JWT_SECRET` on Railway (invalidates existing sessions).
- **2026-06-09** — Roadmap re-derived from a verified code audit (not the
  spreadsheet). Re-ranked around trust + cost-to-fix. Added the JWT fallback
  landmine as the new #1 (previously unlisted). Confirmed H6 done, C2 mitigated,
  M4 mostly handled.

---

## How priorities are ranked
By (a) armed landmines that are cheap to defuse, (b) highest-frequency real
user-trust failure, then (c) genuine gaps. Effort is rough dev-days.

## Verified status of prior audit findings
| ID | Item | Verified state |
|----|------|----------------|
| C1 | Vapi webhook auth | ✅ Code done (#2) — `checkVapiSecret` two-stage rollout: fail-open with persisted mismatch log (Stage A), then `VAPI_SECRET_ENFORCE=true` to reject (Stage B). Admin endpoint `/api/admin/vapi-secret` shows 24h mismatch count + `readyToEnforce` flag. ⚠️ **Ops:** set `VAPI_SERVER_SECRET` on Railway, watch mismatches24h for 24h, then set `VAPI_SECRET_ENFORCE=true`. |
| C2 | Unauthorized/cross-user mutation | ✅ Mitigated — user is bound server-side via `call.id → briefing.user_id`. Model can't pick the user. |
| C3 | Idempotency on writes | ✅ Done — `lib/idempotency.ts` `claimEventCreate` + 5-min `event_dedupe_keys` table. Guards `createEvent` (timed + all-day), `createRecurringEvent`, `copyDayEvents` (voice) and `book/route.ts` (web "Book it"). Fails open so DB fault never blocks a real write. |
| H1 | Token encryption | ✅ Done (`80b4d30`) — `calendar_tokens` encrypted at rest (AES-256-GCM via `lib/crypto.ts`); transparent legacy read. _Ops: set `DATA_ENCRYPTION_KEY` on Railway to activate._ |
| H2 | Action audit log | ✅ Done (#7) — new append-only `audit_log` table (no cap; 90-day retention; `snapshot_before`/`snapshot_after` columns). Wired into both voice (`tool-call/route.ts`) and web (`book/route.ts`). `auditLogQueries.recent(userId)` exported for Core's dashboard. Legacy `tool_actions` kept in parallel for backward compat until Core migrates. Admin endpoint `/api/admin/audit`. |
| H3 | Undo last action | ✅ Done (`28f364d`) — `undo_log` records inverse ops on every mutation; reversible via `undoLastAction` (voice) + dashboard banner. |
| H4 | Rate limiting | ✅ Done (#8) — `lib/rateLimit.ts` + `rate_limits` table. Fixed-window counters: login 10/15min, signup 5/hr, trigger-call 3/5min. Fails open on DB fault. |
| H5 | Backups / PITR | ✅ Fully code-complete — on-volume snapshots (`80b4d30`) + off-box Litestream (`litestream.yml`, `scripts/start.sh`). `verifyBackup()` for restore drills. ⚠️ Ops: set S3 env vars on Railway + run restore drill (see #5 in 30-Day plan). |
| H6 | Destructive confirmation | ✅ Done + hardened (#9) — server-issued one-time `confirmToken` closes model self-confirmation hole. Model must present a server-issued token; `confirmed=true` shortcut removed. |
| M4 | Timezone/recurring | ✅ Mostly handled — IANA passed + validated everywhere. |
| — | **JWT fallback secret** | ✅ Fixed in code — `lib/auth.ts` fails closed (throws if `JWT_SECRET` unset, no public default). ⚠️ **Ops:** still rotate the secret on Railway. |
| — | Transcript PII | ✅ Done (`80b4d30`) — `briefings.transcript` + `user_response` encrypted at rest (same `lib/crypto.ts` path). |
| — | Retry reliability | ⚠️ `retryCall` uses in-process `setTimeout(10m)` — lost on deploy/restart. |

---

## 30-Day plan

### Week 1 — Defuse landmines (cheap, catastrophic if left)
- [x] **1. Remove JWT fallback** → code fails closed (throws if `JWT_SECRET` unset). _Ops follow-up: rotate the secret on Railway._ _½d_
- [x] **2. Enforce Vapi secret** — code-side two-stage gate already implemented + now observable. Added persisted `vapi_auth_log` table + `vapiAuthLogQueries` + admin endpoint `/api/admin/vapi-secret` (shows `secretSet`, `enforceMode`, `mismatches24h`, `readyToEnforce`). 10 unit tests for `checkVapiSecret`. ⚠️ **Ops (still needed):** (1) set `VAPI_SERVER_SECRET` on Railway to match the Vapi dashboard secret, (2) watch `/api/admin/vapi-secret` for 24h — confirm `mismatches24h=0`, (3) set `VAPI_SECRET_ENFORCE=true` on Railway + redeploy.
- [x] **3. Idempotency** on `createEvent` / `createRecurringEvent` / `copyDayEvents` — 5-min TTL dedupe key per (user, normalized-title, start-minute). Guards both voice (tool-call) and web (book/route.ts) creation paths. Additive — fails open. _1d_

### Week 2 — Protect data at rest
- [x] **4. Encrypt** `calendar_tokens` **and** `transcripts` — done (`80b4d30`): AES-256-GCM
  field encryption (`lib/crypto.ts`), transparent/backward-compatible, no-op until
  `DATA_ENCRYPTION_KEY` set. _Ops follow-up: set the key on Railway to activate._ _2–3d_
- [x] **5. SQLite durability** — fully code-complete. On-volume snapshots done (`80b4d30`).
  Off-box now wired: `litestream.yml` (S3 config, 72h retention, 6h snapshots),
  `scripts/start.sh` (conditional Litestream wrapper — active when `LITESTREAM_S3_BUCKET`
  set, plain start otherwise), `railway.toml` updated to `sh scripts/start.sh`.
  Auto-restore on fresh volume (missing DB → `litestream restore` before app boots).
  `lib/backup.ts` + `verifyBackup()` (read-only snapshot integrity_check + row counts),
  `litstreamEnabled()`. Admin endpoint enhanced: GET shows `litstreamEnabled`;
  POST `{ action: 'verify', file }` runs the drill in-process.
  ⚠️ **Ops follow-up (to complete the restore drill):**
  (1) Set `LITESTREAM_S3_BUCKET`, `LITESTREAM_S3_ACCESS_KEY_ID`,
      `LITESTREAM_S3_SECRET_ACCESS_KEY` on Railway.
  (2) Redeploy → confirm Litestream logs `[start] Starting Litestream replication`.
  (3) POST `/api/admin/backup` `{ action: 'backup' }` → then
      POST `{ action: 'verify', file: '<snapshot>' }` → confirm `valid: true`.
  (4) Simulate volume loss (or use Railway shell): rename DB → redeploy → verify app
      restores from S3 and row counts match.

### Week 3 — Finish half-built trust features
- [x] **6. Wire the undo_log** — done (`28f364d`): inverse ops recorded on every mutation; "undo last action" in dashboard + voice. _1.5–2d_
- [x] **7. Harden audit log** — append-only `audit_log` table (no cap; 90-day retention). Columns incl. `snapshot_before`/`snapshot_after` (null today; future pass populates). Wired into `tool-call/route.ts` (voice) + `book/route.ts` (web). Admin endpoint `/api/admin/audit`. `auditLogQueries.recent(userId)` exported for Core's dashboard feed. 16 tests.
  - 🤝 **For Core:** import `auditLogQueries` from `@/lib/db`. `recent(userId, limit)` is the data source for "Recent Activity".

### Week 4 — Abuse + correctness hardening
- [x] **8. Rate-limit** auth/signup + admin trigger-call. `lib/rateLimit.ts`: `checkRateLimit(type, ip)` + `rateLimitResponse()`. `rate_limits` SQLite table (fixed-window, self-expiring, atomic transaction). Wired: login (10/15min), signup (5/hr), trigger-call (3/5min). 12 tests. preflight green.
- [x] **9. Hard delete-confirm** — server-issued one-time `confirmToken` replaces `confirmed=true`; model must present the server's token. `delete_confirm_tokens` table (2-min TTL, single-use, consume is a transaction). System prompt updated. ⚠️ Ops: add `confirmToken: string` to the `deleteEvent` Vapi tool schema in the dashboard and remove `confirmed`. _½d_
- [x] **10. Harden admin auth** — new `lib/adminAuth.ts`: HMAC-derived cookie token (never stores raw password), `timingSafeEqual` throughout, all 11 admin routes migrated to shared utility, admin login rate-limited. 15 tests.

### Incoming from PM (coordinate with Core)
- [x] **★ TOP PRIORITY (2026-06-10): Gmail READ access for reply tracking (scope + guarded thread read)** — _gates Core's email-reply tracking feature (`ROADMAP-CORE.md`)._
  - **Scope:** add `gmail.readonly` to the OAuth scopes (alongside the existing `gmail.compose`) in `lib/google-auth.ts`. Re-consent flow: detect the missing read scope (extend `missingRequiredScopes`) and prompt re-auth. ⚠️ `gmail.readonly` is **broad** (reads all mail) — there is no "only my threads" Gmail scope, so the **privacy guardrail is in our code**: Core only ever passes `threadId`s that Edge itself created. State this clearly in the consent/settings copy.
  - **Guarded primitive Core calls:** `readThread(userId, threadId)` in `lib/gmail.ts` → returns that thread's messages (from, date, snippet/body), **read-only**. Same OAuth client/token; add audit logging + a per-user rate limit; never expose a broad inbox-list call to Core.
  - **Extend `createDraft`** to also return `threadId` (currently `{draftId, messageId}`) so Core can register the watched thread.
  - **Schema:** `watched_threads` table (Shared `lib/db.ts`) — coordinate with Core on columns (threadId, userId, context, last_seen, status).
  - ⚠️ **Production landmine:** `gmail.readonly` is a Google **restricted** scope → another **verification + CASA** round (same as `gmail.compose`). Bundle with the existing verification effort; flag to PM.
  - **Effort ~2d.** Deliver scope + `readThread` + `createDraft` threadId, then PM green-lights Core.

- [x] **★ TOP PRIORITY: Gmail access for draft-only email (scope + guardrails)** — **Security side DELIVERED** (per PM ownership ruling: `lib/gmail.ts` + `lib/google-auth.ts` are Security's guarded access primitive; Core's `lib/outreach.ts` composes and calls `createDraft`).
  - ✅ **Scope:** `gmail.compose` via new **`lib/google-auth.ts`** (scope authority + `hasGmailScope`/`missingRequiredScopes`). Scope string matches the consent screen: `https://www.googleapis.com/auth/gmail.compose`. `lib/calendar.ts` sources scopes from it + requests `include_granted_scopes` so calendar-only users re-consent without dropping calendar.
  - ✅ **Guarded primitive Core calls** — **`lib/gmail.ts`**: `createDraft(userId, {to, subject, body, cc?, bcc?})` → `{draftId, messageId}`. Built-in scope gate (`GmailScopeError`→re-consent), per-user hourly rate limit (`GMAIL_DRAFTS_PER_HOUR` default 20 → `GmailRateLimitError`), and append-only `gmail_drafts_log` audit (recipient/subject encrypted at rest). Exposes ONLY `drafts.create` + `drafts.delete` — `messages.send` is never imported (test asserts it's never called).
  - ✅ **Re-consent detection:** granted scopes persisted on `calendar_tokens.scope` (callback passes `tokens.scope`); `userHasGmailScope(userId)` + `missingRequiredScopes()` let onboarding/settings prompt re-auth. **Core builds the prompt UI.**
  - ✅ **Token sensitivity:** the Gmail-enabled token rides the same encrypted `calendar_tokens` row as #4 (encrypted at rest).
  - ✅ **Undo op:** new `deleteDraft` UndoOp in `lib/undo.ts` → calls Security's `deleteDraft(userId, draftId)` (`drafts.delete`, not rate-limited so undo always cleans up).
  - ✅ Tests: `lib/gmail.test.ts` (createDraft guardrails + deleteDraft + draft-only) + `lib/google-auth.test.ts`. Full suite green, tsc clean.
  - ⚠️ **Production landmine (still open, ops/PM):** `gmail.compose` is a Google **restricted scope** → public/production rollout requires Google **OAuth app verification + a CASA security assessment** (weeks). Owner can dogfood now via the unverified-app path; **hard gate before rolling email to all users.**
  - 🔄 **Parallel user-side track (Google Cloud Console):**
    - ✅ Gmail API enabled (2026-06-09).
    - ✅ `gmail.compose` scope added under Data Access (2026-06-09). Code scope string matches: `https://www.googleapis.com/auth/gmail.compose`.
    - ⏳ App is **"In production"** → restricted-scope rollout to all users needs Google **verification + CASA** (multi-week, long lead). Owner can dogfood now via the unverified-app path; PM offered to draft the verification packet (scope justification, demo-video script, Gmail privacy-policy language).
  - **Handoff to Core:** `outreach.ts` composes `{recipient, subject, body}` → in the `draftEmail` handler call `await createDraft(userId, { to: recipient.email, subject, body })`; record undo via the `deleteDraft` op; handle `GmailScopeError`→re-consent, `GmailRateLimitError`→back off. Coordinate before merging into `tool-call/route.ts`.
- [ ] **Secure the travel API credential** — ⏸ PARKED (travel feature parked 2026-06-09). When resumed: own the `AMADEUS_*` secret + a rate-limit/cost guardrail on the lookup endpoint.

### Closed / deprioritized (do not re-open without reason)
- H6 confirmation gate — **done**.
- C2 cross-user mutation — **mitigated** (server-side user binding); monitor only.
- M4 timezone — **mostly handled**; only add explicit recurring-scope read-back if gaps surface.

---

## Production env vars to verify (cannot be checked from code)
On Railway, confirm both are set correctly — these are the difference between
the landmines being armed or defused:
- `JWT_SECRET` — must be a real random secret (not unset → fallback).
  **2026-06-09: fresh secret generated; rotate on Railway (set + redeploy).**
  Logs out all sessions once — that's expected. Confirm here once saved.
- `VAPI_SECRET_ENFORCE=true` — and `VAPI_SERVER_SECRET` set.
