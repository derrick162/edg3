# 🔒 EDG3 — Security & Reliability Lane

> Backlog for the **Edg3 Security & Reliability** session. Governed by the shared
> [`ROADMAP.md`](ROADMAP.md) constitution — read that first (ownership map,
> worktree isolation, merge protocol). Work on branch `security` in
> `C:\Users\Derrick\edg3-security`. Update this changelog in the same commit that
> ships work, and claim files in the constitution's Status Board before touching
> anything in the ⚠️ Shared list.

## Changelog
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
| H2 | Action audit log | ⚠️ Partial — `tool_actions` JSON exists but mutable, capped 50, no before/after snapshots. |
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
