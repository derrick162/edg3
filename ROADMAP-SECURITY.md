# 🔒 EDG3 — Security & Reliability Lane

> Backlog for the **Edg3 Security & Reliability** session. Governed by the shared
> [`ROADMAP.md`](ROADMAP.md) constitution — read that first (ownership map,
> worktree isolation, merge protocol). Work on branch `security` in
> `C:\Users\Derrick\edg3-security`. Update this changelog in the same commit that
> ships work, and claim files in the constitution's Status Board before touching
> anything in the ⚠️ Shared list.

## Changelog
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
| C1 | Vapi webhook auth | ⚠️ Built but **fail-open** — `checkVapiSecret` accepts mismatches unless `VAPI_SECRET_ENFORCE=true`. See `lib/vapi.ts:36`. |
| C2 | Unauthorized/cross-user mutation | ✅ Mitigated — user is bound server-side via `call.id → briefing.user_id`. Model can't pick the user. |
| C3 | Idempotency on writes | ❌ Absent — `createEvent` inserts directly. Retries/double-calls duplicate. |
| H1 | Token encryption | ✅ Done (`80b4d30`) — `calendar_tokens` encrypted at rest (AES-256-GCM via `lib/crypto.ts`); transparent legacy read. _Ops: set `DATA_ENCRYPTION_KEY` on Railway to activate._ |
| H2 | Action audit log | ⚠️ Partial — `tool_actions` JSON exists but mutable, capped 50, no before/after snapshots. |
| H3 | Undo last action | ✅ Done (`28f364d`) — `undo_log` records inverse ops on every mutation; reversible via `undoLastAction` (voice) + dashboard banner. |
| H4 | Rate limiting | ❌ Absent on all endpoints. |
| H5 | Backups / PITR | ⚠️ Code-side done (`80b4d30`) — rotating on-volume `.backup()` snapshots + `maybeDailyBackup()`. Off-box replication (Litestream) for volume-loss still pending (ops). |
| H6 | Destructive confirmation | ✅ Done (`tool-call/route.ts:350`); soft spot: model could self-confirm. |
| M4 | Timezone/recurring | ✅ Mostly handled — IANA passed + validated everywhere. |
| — | **JWT fallback secret** | ✅ Fixed in code — `lib/auth.ts` fails closed (throws if `JWT_SECRET` unset, no public default). ⚠️ **Ops:** still rotate the secret on Railway. |
| — | Transcript PII | ✅ Done (`80b4d30`) — `briefings.transcript` + `user_response` encrypted at rest (same `lib/crypto.ts` path). |
| — | Retry reliability | ⚠️ `retryCall` uses in-process `setTimeout(10m)` — lost on deploy/restart. |

---

## 30-Day plan

### Week 1 — Defuse landmines (cheap, catastrophic if left)
- [x] **1. Remove JWT fallback** → code fails closed (throws if `JWT_SECRET` unset). _Ops follow-up: rotate the secret on Railway._ _½d_
- [ ] **2. Enforce Vapi secret** — confirm Vapi sends `x-vapi-secret`, then set `VAPI_SECRET_ENFORCE=true` (keep fail-open log 24h first). _½d_
- [ ] **3. Idempotency** on `createEvent` / `createRecurringEvent` / `copyDayEvents` — dedupe key per (user, title-hash, start-minute) + TTL. _1–2d_
  - ⚠️ **Coupled to Core's multi-day all-day rewrite** (`ROADMAP-CORE.md` ticket #1): that change rewrites the event-creation path. Land idempotency alongside it so the new all-day/span logic can't duplicate-on-retry. Coordinate before either side merges `tool-call/route.ts`.

### Week 2 — Protect data at rest
- [x] **4. Encrypt** `calendar_tokens` **and** `transcripts` — done (`80b4d30`): AES-256-GCM
  field encryption (`lib/crypto.ts`), transparent/backward-compatible, no-op until
  `DATA_ENCRYPTION_KEY` set. _Ops follow-up: set the key on Railway to activate._ _2–3d_
- [~] **5. SQLite durability** — code-side done (`80b4d30`): rotating on-volume
  `.backup()` snapshots + `maybeDailyBackup()` + admin endpoint. _Still pending:
  Litestream off-box replication + one real restore drill._ _1d + drill_

### Week 3 — Finish half-built trust features
- [x] **6. Wire the undo_log** — done (`28f364d`): inverse ops recorded on every mutation; "undo last action" in dashboard + voice. _1.5–2d_
- [ ] **7. Harden audit log** — before/after snapshots, own append-only table (drop the 50-cap), "Recent activity" view. _2d_
  - 🤝 **Backbone for Core's "Recent activity" surface** (`ROADMAP-CORE.md`, Next): this append-only table is the data source Core's dashboard feed reads. Build the table + snapshots here; Core builds the UI on top.

### Week 4 — Abuse + correctness hardening
- [ ] **8. Rate-limit** auth/signup, admin trigger-call, per-user mutations/min ceiling. _1–2d_
- [ ] **9. Hard delete-confirm** — server issues one-time confirm token; model can't self-confirm. _1d_
- [ ] **10. Harden admin auth** — `trigger-call/route.ts:7` compares cookie to plaintext password; hash + constant-time. _½d_

### Incoming from PM (coordinate with Core)
- [ ] **★ TOP PRIORITY (2026-06-10): Gmail READ access for reply tracking (scope + guarded thread read)** — _gates Core's email-reply tracking feature (`ROADMAP-CORE.md`)._
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
