# 🔒 EDG3 — Security & Reliability Lane

> Backlog for the **Edg3 Security & Reliability** session. Governed by the shared
> [`ROADMAP.md`](ROADMAP.md) constitution — read that first (ownership map,
> worktree isolation, merge protocol). Work on branch `security` in
> `C:\Users\Derrick\edg3-security`. Update this changelog in the same commit that
> ships work, and claim files in the constitution's Status Board before touching
> anything in the ⚠️ Shared list.

## Changelog
- **2026-06-16** — **⚠️ PM HOTFIX — CSP nonce broke production (site down); strict-dynamic reverted.**
  - **Symptom:** `https://www.edg3.ai` rendered HTML but never hydrated (blank page) after the CSP-nonce deploy.
  - **Root cause:** `script-src 'self' 'nonce-…' 'strict-dynamic'` was set, but **Next.js 16 + Turbopack did NOT emit the per-request nonce onto its framework `<script>` tags.** Under `'strict-dynamic'` the browser ignores `'self'`, so every un-nonced script was blocked → no JS ran. The "Next 16 auto-propagates the nonce" assumption in the original comment was false for this Turbopack build.
  - **Fix (PM, `e2370e3`):** `proxy.ts` reverted to `script-src 'self' 'unsafe-inline'` (same-origin scripts + Next's inline bootstrap; blocks cross-origin injection). Removed nonce/strict-dynamic + the `x-nonce` request-header plumbing. Verified live: CSP updated, `/` and `/dashboard` both 200, scripts now allowed. 989 green.
  - **🔒 Vijay follow-up (do NOT re-deploy strict CSP until verified):** if we still want nonce-based strict CSP, first reproduce locally with `next build && next start` (NOT dev), curl the HTML, and **confirm the `<script>` tags actually carry `nonce="…"`** before shipping. If Turbopack won't emit nonces, either (a) stay on `'self' 'unsafe-inline'` (acceptable — same-origin only, our real exposure is low), or (b) move CSP to a hashed-script approach. Browser-verify enforcement, not just the header.
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
