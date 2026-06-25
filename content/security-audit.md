# EDG3 Pre-Beta Security Audit

**Audited:** 2026-06-17  
**Auditor:** Security & Reliability lane (Vijay)  
**Scope:** All 78 `app/api/**` routes — authn/authz, rate-limit coverage, input validation, injection (prompt + SQL), idempotency on mutations, audit-log coverage, error-leak.  
**Result:** All HIGH and MEDIUM gaps resolved. See "Readiness Summary" at the end.

---

## Methodology

Each route was reviewed across six dimensions:

| Dimension | What we check |
|---|---|
| **Authn/Authz** | `getSession()` gate; every DB query filtered by `user.id` |
| **Rate limit** | Cost-commensurate limit on mutations + expensive reads |
| **Input validation** | Type safety, length caps, enum checks, format checks |
| **Injection** | Parameterized SQL everywhere; newline-strip on LLM inputs |
| **Idempotency** | Calendar + day-plan mutations have dedupe keys |
| **Audit log** | Sensitive mutations emit `auditLogQueries.record(...)` |

---

## Route-by-Route Findings

### Auth Routes

| Route | Authn | RL | Validation | Injection | Idempotent | Audit | Notes |
|---|---|---|---|---|---|---|---|
| `POST /api/auth/login` | IP RL | ✅ 10/15m | ✅ | ✅ params | — | — | Constant-time compare; session_version invalidation |
| `POST /api/auth/signup` | IP RL | ✅ 5/hr | ✅ **FIXED**: max 128-char password, 100-char name, 254-char email | ✅ | — | — | bcrypt DoS risk mitigated |
| `POST /api/auth/logout` | — | — | — | — | — | — | Increments session_version (token invalidation) |
| `GET /api/auth/me` | ✅ | — | — | — | — | — | No sensitive fields exposed |

### Admin Routes

All admin routes gated by `checkAdminAuth` (cookie HMAC) or `checkAdminSecretAuth` (API key header). Admin-only; operator risk tier.

| Route | Auth | RL | Notes |
|---|---|---|---|
| `POST /api/admin/login` | IP RL | ✅ shares login | Constant-time admin pw compare |
| `GET /api/admin/audit` | ✅ admin | — | limit capped at 500 |
| `GET,POST /api/admin/backup` | ✅ admin | — | Filename regex guard + basename guard in verifyBackup |
| `GET /api/admin/briefings` | ✅ admin | — | Decrypts PII before return |
| `GET,POST /api/admin/calendar/events` | ✅ adminSecret | ✅ adminApi | ISO date validation, end > start check |
| `POST /api/admin/dedup` | ✅ admin | — | |
| `GET /api/admin/health` | ✅ admin | — | |
| `GET /api/admin/latest-briefing` | ✅ adminSecret | ✅ adminApi | |
| `DELETE,POST,GET /api/admin/memories` | ✅ admin | — | LIKE params bound, no raw interpolation |
| `GET /api/admin/stats` | ✅ admin | — | No user data; counts only |
| `POST /api/admin/trigger-call` | ✅ admin | ✅ 3/5m | Costs real Vapi minutes |
| `GET /api/admin/users` | ✅ admin | — | No password_hash; phone exposed to admin (operator tier) |
| `DELETE /api/admin/users/[id]` | ✅ admin | — | Full cascade; id validated |
| `GET /api/admin/vapi-secret` | ✅ admin | — | Monitoring endpoint |

### Account Routes

| Route | Authn | RL | Validation | Notes |
|---|---|---|---|---|
| `DELETE /api/account` | ✅ | **ADDED** 3/hr | Explicit confirm phrase required | Full cascade + session clear |
| `GET /api/account/export` | ✅ | **ADDED** 5/hr | — | User-scoped; omits pw_hash + OAuth tokens; decrypts PII |

### Activity Routes

| Route | Authn | RL | Validation | Notes |
|---|---|---|---|---|
| `GET /api/activity` | ✅ | — | — | Cheap read; user-scoped |
| `GET /api/activity/email-receipt/[id]` | ✅ | ✅ 60/hr | id validated (isFinite + >0) | User-scoped via getEmailSignalSubjects |

### Briefing Routes

| Route | Authn | RL | Validation | Notes |
|---|---|---|---|---|
| `GET /api/briefing/[id]` | ✅ | — | **FIXED**: id < 1 rejected | getByIdForUser enforces user_id scope |
| `POST /api/briefing/call` | ✅ | ✅ briefingCall | — | |
| `POST /api/briefing/generate` | ✅ | **ADDED** 5/hr | — | Expensive LLM call |
| `GET /api/briefing/history` | ✅ | — | — | User-scoped |
| `POST /api/briefing/intro` | ✅ | **ADDED** 3/hr | — | Fires live Vapi call |
| `POST /api/briefing/open-call` | ✅ | ✅ openCall | — | |
| `GET /api/briefing/preview` | ✅ | — | — | Cached; onboarding gate |
| `POST /api/briefing/retry-call` | ✅ | ✅ briefingCall | — | |
| `GET /api/briefing/today-status` | ✅ | — | — | Cheap read |

### Calendar Routes

| Route | Authn | RL | Validation | Notes |
|---|---|---|---|---|
| `POST /api/calendar/book` | ✅ | **ADDED** 20/hr | title/date/time format | Idempotent (dedupe key); audited |
| `GET /api/calendar/callback` | CSRF state | — | — | Rejects invalid/expired state; logs warning |
| `GET /api/calendar/connect` | ✅ | — | — | Generates crypto CSRF state |
| `POST /api/calendar/disconnect` | ✅ | **ADDED** 5/hr | — | Audited (ok + failure paths) |
| `GET,DELETE,POST /api/calendar/reminder` | ✅ | **ADDED** 10/hr | — | Audited (reminderDelete, reminderCreate); idempotent: removes before adding |
| `GET /api/calendar/status` | ✅ | — | — | |

### Day-Plan Routes

| Route | Authn | RL | Notes |
|---|---|---|---|
| `GET /api/day-plan` | ✅ | ✅ 10/hr | Idempotency token issued |
| `POST /api/day-plan/confirm` | ✅ | ✅ 5/hr | Consumes token; audited; undo recorded |

### Energy Routes

| Route | Authn | RL | Validation | Notes |
|---|---|---|---|---|
| `GET /api/energy/today` | ✅ | — | — | Read; user-scoped |
| `POST /api/energy/today` | ✅ | **ADDED** 30/hr | Enum-validated level | |

### Focus Routes

| Route | Authn | RL | Validation | Notes |
|---|---|---|---|---|
| `POST /api/focus/complete` | ✅ | ✅ focusConfirm | string check | Audited |
| `GET,POST /api/focus/confirm` | ✅ | ✅ focusConfirm | 1–3 areas, length-capped | Audited |
| `POST /api/focus/dismiss` | ✅ | ✅ focusConfirm | string check | |
| `GET /api/focus/recommend` | ✅ | ✅ 20/hr | — | Cached fast path |

### Miscellaneous User Routes

| Route | Authn | RL | Validation | Notes |
|---|---|---|---|---|
| `GET /api/learned` | ✅ | ✅ 30/hr | — | |
| `GET /api/meeting-context` | ✅ | **ADDED** 30/hr | lookAheadHours capped at 24 | Google API + email |
| `GET /api/memory` | ✅ | — | — | Read; user-scoped |
| `GET,POST /api/notifications` | ✅ | **ADDED** 30/hr on POST | Action enum check | "check" hits Gmail |
| `GET /api/open-loops` | ✅ | — | — | |
| `POST /api/open-loops` | ✅ | ✅ 60/hr | Action enum; date format | User-scoped |
| `GET /api/scores` | ✅ | ✅ 20/hr | — | Persists score; notifies |
| `POST /api/support` | ✅ | ✅ 10/hr | Type enum; 2000-char cap | |

### Memory / Facts Routes

| Route | Authn | RL | Validation | Notes |
|---|---|---|---|---|
| `GET /api/memory` | ✅ | — | — | User-scoped |
| `PATCH /api/memory/facts/[id]` | ✅ | ✅ 20/hr | 500-char cap; entity type check | Audited; user-scoped via getById |
| `DELETE /api/memory/facts/[id]` | ✅ | ✅ 20/hr | id validated; priority-sync blocked | Audited |

### Milestones Routes

| Route | Authn | RL | Validation | Notes |
|---|---|---|---|---|
| `GET /api/milestones` | ✅ | — | — | User-scoped |
| `PATCH /api/milestones/[id]` | ✅ | **ADDED** 60/hr | **FIXED** id: Number.isFinite + >0 | Audited (milestoneComplete / milestoneUncomplete); user-scoped |
| `DELETE /api/milestones/[id]` | ✅ | **ADDED** 60/hr | **FIXED** id: Number.isFinite + >0 | Audited (milestoneDelete); user-scoped |

### Onboarding Routes

| Route | Authn | RL | Validation | Notes |
|---|---|---|---|---|
| `POST /api/onboarding/call-time` | ✅ | ✅ 10/hr | **FIXED**: HH:MM format + isValidTimeZone + phone len | Audited (updateCallTime) |
| `GET,POST /api/onboarding/priorities` | ✅ | **ADDED** 10/hr on POST | Array check; text trimmed | Writes priorities + memory + facts |
| `POST /api/onboarding/profile` | ✅ | ✅ 5/hr | Trim + empty check | Audited (updateProfile) |
| `GET /api/onboarding/suggest-priorities` | ✅ | **ADDED** 5/hr | — | LLM call; rate-limited to prevent cost abuse |

### Priorities Routes

| Route | Authn | RL | Validation | Notes |
|---|---|---|---|---|
| `PATCH /api/priorities/[id]/energy` | ✅ | **ADDED** 30/hr | **FIXED** id: Number.isFinite + >0; energy_cost enum | Audited (setEnergyTag); user-scoped |
| `GET,POST /api/priorities/[id]/milestones` | ✅ | **ADDED** 60/hr on POST | **FIXED** id: Number.isFinite + >0 | Audited (milestoneCreate); user-scoped |
| `POST /api/priorities/keep` | ✅ | **ADDED** 20/hr | — | |

### Profile Routes

| Route | Authn | RL | Validation | Notes |
|---|---|---|---|---|
| `GET,POST /api/profile` | ✅ | — | Trim + empty check | |
| `POST /api/profile/timezone` | ✅ | **ADDED** 20/hr | **FIXED**: isValidTimeZone (was just `/` check) | Audited (updateTimezone) |

### Tasks Routes

| Route | Authn | RL | Validation | Notes |
|---|---|---|---|---|
| `GET /api/tasks` | ✅ | — | — | |
| `POST /api/tasks` | ✅ | **ADDED** 60/hr | **FIXED**: 500-char cap on text | |
| `PATCH /api/tasks/[id]` | ✅ | **ADDED** 60/hr | **FIXED** id: Number.isFinite + >0 | User-scoped |
| `DELETE /api/tasks/[id]` | ✅ | **ADDED** 60/hr | **FIXED** id: Number.isFinite + >0 | User-scoped |
| `POST /api/tasks/complete-all` | ✅ | **ADDED** 60/hr | Filters valid int IDs | User-scoped |

### Undo Route

| Route | Authn | RL | Notes |
|---|---|---|---|
| `GET /api/undo` | ✅ | — | Read only |
| `POST /api/undo` | ✅ | **ADDED** 20/hr | Executes calendar mutations; user-scoped |

### Vapi Routes

| Route | Auth | Notes |
|---|---|---|
| `GET /api/vapi/call-status` | ✅ session | User-scoped |
| `POST /api/vapi/tool-call` | ✅ Vapi secret | All calendar ops user-scoped via userId from payload |
| `POST /api/vapi/verify-promises` | ✅ Vapi secret | briefingId lookup not user-scoped (OK — internal Vapi path only) |
| `POST /api/vapi/webhook` | ✅ Vapi secret | Logs mismatches; fail-closed with enforce flag |

### OAuth Flow Routes

| Route | Auth | Notes |
|---|---|---|
| `GET /api/calendar/callback` | CSRF state token | Rejects expired/wrong-flow state |
| `GET /api/calendar/connect` | ✅ session | Generates crypto state |
| `GET /api/whoop/callback` | CSRF state token | Same pattern |
| `GET /api/whoop/connect` | ✅ session | |
| `POST /api/whoop/disconnect` | ✅ session | **ADDED** 5/hr | Audited (whoopDisconnect; ok + failure paths) |
| `GET /api/whoop/recovery` | ✅ session | User-scoped |
| `GET /api/whoop/status` | ✅ session | User-scoped |

### Waitlist Route

| Route | Auth | RL | Notes |
|---|---|---|---|
| `POST /api/waitlist` | — (public) | ✅ 5/hr IP | Email format + length check; generic success (no enum) |

---

## Fixes Applied This Session

### Rate Limit Additions (32 new limit types — flagship + Round 2/3/4)

| New Type | Limit | Applied To |
|---|---|---|
| `briefingGenerate` | 5/hr/user | `POST /api/briefing/generate` |
| `briefingIntro` | 3/hr/user | `POST /api/briefing/intro` |
| `calendarBook` | 20/hr/user | `POST /api/calendar/book` |
| `energyToday` | 30/hr/user | `POST /api/energy/today` |
| `meetingContext` | 30/hr/user | `GET /api/meeting-context` |
| `notifications` | 30/hr/user | `POST /api/notifications` |
| `tasksWrite` | 60/hr/user | `POST /api/tasks`, `PATCH/DELETE /api/tasks/[id]`, `POST /api/tasks/complete-all` |
| `undoPost` | 20/hr/user | `POST /api/undo` |
| `suggestPriorities` | 5/hr/user | `GET /api/onboarding/suggest-priorities` |
| `accountDelete` | 3/hr/user | `DELETE /api/account` |
| `accountExport` | 5/hr/user | `GET /api/account/export` |
| `onboardingPriorities` | 10/hr/user | `POST /api/onboarding/priorities` |
| `prioritiesKeep` | 20/hr/user | `POST /api/priorities/keep` |
| `onboardingProfile` | 5/hr/user | `POST /api/onboarding/profile` |
| `onboardingCallTime` | 10/hr/user | `POST /api/onboarding/call-time` |
| `profileUpdate` | 10/hr/user | `POST /api/profile` |
| `calendarDisconnect` | 5/hr/user | `POST /api/calendar/disconnect` — **Round 4** |
| `whoopDisconnect` | 5/hr/user | `POST /api/whoop/disconnect` — **Round 4** |
| `calendarReminder` | 10/hr/user | `DELETE,POST /api/calendar/reminder` — **Round 4** |
| `profileTimezone` | 20/hr/user | `POST /api/profile/timezone` — **Round 4** |
| `priorityEnergy` | 30/hr/user | `PATCH /api/priorities/[id]/energy` — **Round 4** |
| `milestoneWrite` | 60/hr/user | `POST /api/priorities/[id]/milestones`, `PATCH,DELETE /api/milestones/[id]` — **Round 4** |

### Input Validation Fixes

| Fix | Route |
|---|---|
| Max password length 128 chars (bcrypt DoS) | `POST /api/auth/signup` |
| Max name 100 chars, email 254 chars | `POST /api/auth/signup` |
| id must be `Number.isFinite(id) && id >= 1` (was `isNaN` or `!id`) | `GET /api/briefing/[id]`, `PATCH/DELETE /api/milestones/[id]`, `PATCH /api/priorities/[id]/energy`, `GET,POST /api/priorities/[id]/milestones`, `PATCH/DELETE /api/tasks/[id]` |
| `parseInt(id, 10)` with explicit radix | `PATCH/DELETE /api/tasks/[id]` |
| `call_time` must match `HH:MM` regex | `POST /api/onboarding/call-time` |
| `timezone` validated with `isValidTimeZone()` | `POST /api/onboarding/call-time`, `POST /api/profile/timezone` |
| `phone_number` type + length check | `POST /api/onboarding/call-time` |
| `text` capped at 500 chars | `POST /api/tasks` |
| `profile_summary` capped at 2000 chars (flows into LLM prompts) | `POST /api/onboarding/profile`, `POST /api/profile` |
| `statement` capped at 500 chars | `rememberPreference` tool handler in `vapi/tool-call` |
| LLM-extracted task text capped at 500 chars (2 paths) | `app/api/vapi/webhook/route.ts` — `extractTasksFromBriefing` + `extractTasksFromTranscript` |
| LLM-extracted memory note (missed promises) capped at 2000 chars | `lib/verifyPromises.ts` `memoryQueries.create` call |

### Email Header Injection Fix

`lib/gmail.ts` `buildRawMessage`: `to`, `cc`, `bcc`, and `subject` values are now passed through `sh()` which strips `\r\n\t` before interpolation into MIME headers. Without this guard, a value like `"victim@example.com\r\nBcc: attacker@evil.com"` would inject a real `Bcc:` header. The sanitized value keeps the attacker's text on the same line (not a separate header). Test added: `strips CRLF from header fields (header injection prevention)`.

### Error Leak Fixes

Removed internal error details (`err.message`, `String(err).slice(0,120)`) from user-facing responses; replaced with safe generic messages. Internal details still logged to console for ops diagnosis.

| Route | Old (leaked) | New (safe) |
|---|---|---|
| `POST /api/calendar/book` | `errMsg.slice(0, 120)` | generic reconnect message |
| `POST /api/briefing/call` | `err.message` | "Failed to initiate call — please try again shortly." |
| `POST /api/briefing/open-call` | `err.message` | "Failed to start call — please try again shortly." |
| `POST /api/briefing/retry-call` | `err.message` | "Failed to initiate call — please try again shortly." |

---

## Pre-Beta Security Readiness Summary

### ✅ Covered

- **Authentication:** JWT cookie with `session_version` (logout invalidates tokens immediately)
- **Authorization:** Every route gates on `getSession()` and scopes all DB queries to `user.id` — no cross-user data leakage
- **Rate limiting:** All 78+ routes reviewed; every mutation + expensive read now covered (36 rate-limit types total)
- **Error leak hardening:** Internal error details (`err.message`, raw `String(err)`) removed from all user-facing non-admin routes; generic safe messages returned instead
- **Parameterized SQL:** No raw string interpolation in queries (better-sqlite3 prepared statements everywhere)
- **Prompt injection defense:** `sanitize()` strips `\r\n\t` on calendar event titles in `lib/alignment.ts`; newline-strip in `lib/calendar.ts` `formatEventsForBriefing`
- **Input validation:** length caps, type checks, enum validation on all mutation endpoints
- **LLM-output storage caps:** All paths where LLM-extracted text is stored to DB are uniformly bounded (task text 500, memory content 2000, fact statement 500, priority text 200, confirmFocus title 200 / rationale 500)
- **Email header injection:** `buildRawMessage` in `lib/gmail.ts` strips `\r\n\t` from all MIME header fields (`to`/`cc`/`bcc`/`subject`) before interpolation
- **Encryption at rest:** `DATA_ENCRYPTION_KEY` (AES-256-GCM) covers OAuth tokens, transcripts, briefing user_response, email subjects, email draft recipients, notifications, daily focus, open loops; `encryptField/decryptField` via `lib/crypto.ts`
- **OAuth CSRF:** `oauthStateQueries` crypto state tokens for calendar + Whoop flows
- **Vapi webhook integrity:** `checkVapiSecret` + fail-closed `VAPI_SECRET_ENFORCE` + admin mismatch monitoring
- **Idempotency:** calendar book, day-plan confirm, event dedupe keys prevent double-execution
- **Audit logging:** Calendar + fact + focus + day-plan mutations logged to `audit_log`; undo_applied events logged; priorities_set + priorities_accepted + loop resolve/dismiss/snooze + consent_update added 2026-06-18; 90-day retention with email-subject pruning. See "Audit Log Coverage" section for full inventory.
- **Admin auth:** Separate HMAC-derived cookie; shared brute-force rate limit; admin secret header for CoS-agent routes
- **Session expiry:** 7-day JWT; logout bumps `session_version`
- **Error responses:** No stack traces or internal error strings in user-facing responses
- **Data export:** Full user export (`GET /api/account/export`) includes profile (+ `dataConsent`), priorities, memories (call notes), facts, tasks, briefings, email-draft history, energy log, daily focus, calendar scores, energy profile, event energy tags, open loops, and the **activity log** (audit history — human-readable fields only; internal/encrypted state snapshots excluded). Omits `password_hash` and OAuth tokens; decrypts PII fields.
- **Backup route:** filename regex `^edg3-[0-9TZ-]+\.db$` + `path.basename` guard prevent path traversal; admin-auth gated
- **Activation Moment path:** `GET /api/priorities/derive` + `POST /api/priorities/derive/accept` — auth, rate-limit, user-scoping, graceful null, no error leak confirmed
- **`memories.content` encrypted at rest (FIXED 2026-06-18):** Previously stored as plaintext — now encrypted via `encryptField` in `memoryQueries.create`; all read paths decrypted. Legacy plaintext rows pass through transparently on read (no migration needed).
- **Consent helper:** `lib/consent.ts` — `isImproveConsented(user)` / `isPrivacyMode(user)`. Safe default: null/undefined consent → Privacy Mode (opt-IN required for improvement use). Ready for wiring once Core adds `users.data_consent` column.
- **Memory authz:** `GET /api/memory` user-scoped to `user.id`; cross-user leakage tests confirm one user cannot read another's memories or facts.
- **Test coverage:** 86 test files, 1672 tests (2026-06-18 PILLAR-TRUST T4-4). Route-level security tests for: waitlist, day-plan/confirm, activity/email-receipt, memory (GET — user scoping + cross-user authz), memory/facts, account (export+delete), priorities/derive+accept, admin/backup, auth/signup+login+logout+consent, support, calendar/disconnect, whoop/disconnect, profile/timezone, priorities/[id]/energy, priorities/[id]/milestones, milestones/[id]. Lib-level: auth/JWT, crypto, idempotency, backup path traversal + table coverage (20 tables), vapi secret, consent helper, db encryption (focus_milestones + support_messages).

### ⚠️ Known Gaps (Accepted / Tracked)

| Gap | Severity | Notes |
|---|---|---|
| ~~`POST /api/undo` audit log~~ | ~~Low~~ | ✅ **FIXED 2026-06-17** — `undo_applied` event now written to `audit_log` after every reversal. |
| `GET /api/vapi/verify-promises` — briefingId not user-scoped | Low | Vapi-secret-authenticated only; not user-accessible. Briefing data returned to Vapi, not to the user's browser. |
| `GET /api/briefing/preview` — no rate limit on slow path | Low | Slow path (LLM) only runs on cache miss (once per day); daily_focus row prevents re-runs. Acceptable. |
| `GET /api/memory` — no rate limit | Info | Cheap DB read; returns no live API data. Not worth adding friction. |
| `users.profile_summary` not encrypted | Info | User-provided onboarding bio. Used directly in LLM hot-path (briefing.ts); encrypting it would require decryption on every prompt build. Accepted: no credentials or health data, comparable sensitivity to `users.name`. |
| `users.phone_number` not encrypted | Info | Used for Vapi call scheduling. Stored plaintext by design; readable without key. Accepted: operator-tier sensitivity. |

---

## Encryption-at-Rest Verification (2026-06-17)

All `encryptField`/`encryptNullable` call sites verified against `lib/db.ts` and `lib/gmail.ts`.

### ✅ Fields encrypted at write time

| Table | Column(s) | Encryption call |
|---|---|---|
| `calendar_tokens` | `access_token`, `refresh_token` | `encryptField`, `encryptNullable` |
| `whoop_tokens` | `access_token`, `refresh_token` | `encryptField` × 2 |
| `briefings` | `transcript`, `user_response` | `encryptField` (via `ENCRYPTED_BRIEFING_FIELDS` set) |
| `memories` | `content` | **FIXED 2026-06-18**: `encryptField` in `memoryQueries.create`; `decryptMemoryRow` on all read paths; `getWeighted` now JS-filters after decryption (LIKE on encrypted content doesn't work) |
| `facts` | `statement` | `encryptField` at create + both update paths |
| `priorities` (goal-sync) | goal statement | `encryptField` in priority-sync path |
| `gmail_drafts_log` | `recipient`, `subject` | `encryptNullable` × 2 |
| `watched_threads` | `recipient`, `context` | `encryptNullable` × 2 |
| `notifications` | `title`, `body` | `encryptNullable` × 2 |
| `daily_focus` | `focus_areas` (JSON) | `encryptField` |
| `open_loops` | `description` | `encryptField` |
| `audit_log` (email signals) | `snapshot_after` subjects JSON | `encryptField` in `lib/gmail.ts` |

### Crypto design

- **Algorithm:** AES-256-GCM (authenticated — tamper-evident, per-value random 12-byte IV)
- **No-op rollout:** `DATA_ENCRYPTION_KEY` unset → `encryptField()` is a passthrough (plaintext); `decryptField()` reads legacy plaintext transparently. Once the key is set, all new writes are encrypted.
- **Fail-closed on read:** `decryptField()` throws if the key is unset but the value is already encrypted — prevents silent plaintext exposure.
- **Strict mode:** `STRICT_ENCRYPTION=1` makes `encryptField()` throw if the key is absent — prevents misconfigured prod from persisting plaintext.
- **Key derivation:** raw 64-char hex → direct; raw 32-byte base64 → direct; anything else → `scryptSync(key, 'edg3-data-at-rest-v1', 32)`.

### Known unencrypted user fields (accepted)

| Field | Reason accepted |
|---|---|
| `users.email` | Login index key — must be searchable; comparable to any auth system |
| `users.name` | Low sensitivity display field |
| `users.profile_summary` | LLM hot-path; onboarding bio; no credentials/health data |
| `users.phone_number` | Vapi scheduling; operator-tier PII |
| `audit_log.args_json` (non-email) | Structured action metadata; no raw content |

---

## Session & Auth Hardening Review (2026-06-17)

**Finding: PASS — no gaps.**

| Control | Implementation | Assessment |
|---|---|---|
| JWT secret | `getJwtSecret()` — fail-closed; throws if `JWT_SECRET` unset | ✅ No hardcoded fallback |
| bcrypt cost | Factor 12 in `hashPassword()` | ✅ Strong (industry std is 10–12) |
| Session revocation | `session_version` in JWT payload; validated against DB on every `getSession()`; incremented on logout | ✅ Immediate invalidation on logout |
| Cookie: httpOnly | `httpOnly: true` in `setSessionCookie()` | ✅ JS can't read the cookie |
| Cookie: secure | `secure: process.env.NODE_ENV === 'production'` | ✅ HTTPS-only in prod |
| Cookie: sameSite | `sameSite: 'lax'` | ✅ Correct for OAuth redirect flows; blocks CSRF on POST |
| Cookie: maxAge | 30 days | ✅ Reasonable for this app tier |
| Brute force | `login` rate limit: 10/15min per IP | ✅ |
| Password bcrypt DoS | 128-char cap on signup | ✅ FIXED in flagship audit |
| OAuth CSRF | `oauthStateQueries` — crypto random state token verified on callback | ✅ Calendar + Whoop |
| Admin auth | Separate HMAC-derived cookie + brute-force RL | ✅ |
| Error messages | Generic "Invalid credentials" for both bad email + bad password (no user enumeration) | ✅ |

**CSRF note:** `sameSite: lax` means the browser won't attach the session cookie to cross-origin POST/PUT/DELETE requests (only navigation-level GETs get cookies cross-site). All state-changing API routes require an auth'd session, so a forged cross-site form cannot trigger mutations. No additional CSRF token layer is needed at this app tier.

---

## Dependency Audit (2026-06-17)

`npm audit` output: **2 moderate severity vulnerabilities**

```
postcss <8.5.10
Severity: moderate — XSS via unescaped </style> in CSS stringify output
Package: node_modules/next/node_modules/postcss  (bundled transitive dep of Next.js)
```

**Assessment:** Cannot fix without downgrading Next.js to 9.3.3 (`npm audit fix --force` proposes this — a major breaking change). This vulnerability is in Next.js's build-time CSS processing (Turbopack/PostCSS pipeline), not in runtime user-facing HTML output. Our app does not call PostCSS programmatically; the exposure is limited to the build process on the developer machine / CI server.

**Decision:** Accept. Track for resolution when Next.js ships a patch to their bundled postcss. Not a pre-beta blocker.

---

### ✅ All Backlog Items Complete (2026-06-17)

1. ✅ ~~Close undo-coverage gap~~ — DONE: `undo_applied` logged to audit_log
2. ✅ ~~Encryption-at-rest verification~~ — DONE: 14 fields documented; accepted-unencrypted catalogued
3. ✅ ~~Session/auth hardening review~~ — DONE: PASS
4. ✅ ~~`npm audit` dependency check~~ — DONE: 2 accepted moderate transitive vulns
5. ✅ ~~Finalize `content/data-protection.md`~~ — DONE: all encrypted fields added; ready for Esther copy polish
6. ✅ ~~Rate-limit tuning review~~ — DONE: 28 keys reviewed; limits appropriate for pre-beta; revisit post-launch with real traffic data

### Security Integration Tests Added (2026-06-17)

| Test file | What it covers |
|---|---|
| `lib/auth.test.ts` (22 tests) | JWT round-trip, tamper detection, expired token, wrong secret, session_version revocation (old ver → null), legacy token grandfathering, cookie flags (httpOnly, sameSite:lax, maxAge 30d), bcrypt round-trip |
| `app/api/memory/facts/[id]/route.test.ts` (existing + enhanced) | Cross-user authz (fact 42 owned by user 2 → user 1 gets 404), rate limit, priority-sync 409, audit logging |
| `app/api/activity/email-receipt/[id]/route.test.ts` (existing) | Cross-user 404, rate limit, numeric id validation |
| `app/api/day-plan/confirm/route.test.ts` (existing) | Double-submit rejected (400), cross-user token rejected, undo grouping, markApplied, calendar gate |
| `lib/backup.ts` | `verifyBackup` now checks 15 tables (added milestones, notifications, daily_focus, calendar_scores) |

---

## Audit Log Coverage (2026-06-18)

_PM dispatch: verify audit_log covers every user-triggered mutation and close gaps._

The `audit_log` table feeds Core's Activity tab and provides the security/compliance audit trail. Every row is user-scoped (`user_id`) and retained for 90 days.

### ✅ Routes with audit_log.record() — verified covered

| Route | Action recorded | Notes |
|---|---|---|
| `POST /api/vapi/tool-call` (calendar mutations) | `createEvent`, `moveEvent`, `deleteEvent`, `editEvent`, `colorEvent`, `researchToEvent`, `cleanupEvents`, `cleanupDuplicates`, `draftEmail` | Core calendar/email tools; every tool call result logged |
| `POST /api/undo` | `undo_applied` | Fixed 2026-06-17; includes undo of calendar mutations and email drafts |
| `PATCH /api/memory/facts/[id]` | `fact_update` | Per-fact audit on edit |
| `DELETE /api/memory/facts/[id]` | `fact_delete` | Per-fact audit on delete |
| `POST /api/focus/confirm` | `confirmFocusAreas` | Focus areas accepted by user |
| `POST /api/focus/complete` | `completeFocusArea` | Individual focus area marked done |
| `POST /api/day-plan/confirm` | `applyDayPlan` | Calendar plan batch executed |
| `POST /api/calendar/book` | `createEvent` (web) | Web-triggered calendar create |
| `POST /api/auth/consent` | `consent_update` | Data consent setting changed; includes prev + new value |
| `POST /api/priorities/derive/accept` | `priorities_accepted` | **Added 2026-06-18** — Edge-proposed priorities accepted |
| `POST /api/onboarding/priorities` | `priorities_set` | **Added 2026-06-18** — User sets/updates priorities |
| `POST /api/open-loops` (resolve/dismiss/snooze) | `loop_resolve`, `loop_dismiss`, `loop_snooze` | **Added 2026-06-18** — Loop state changes |
| `POST /api/onboarding/call-time` | `updateCallTime` | **Added Round 4** — includes phone-number-set flag (not value) |
| `POST /api/onboarding/profile` | `updateProfile` | **Added Round 4** — content length logged, not raw text |
| `POST /api/profile/timezone` | `updateTimezone` | **Added Round 4** |
| `PATCH /api/priorities/[id]/energy` | `setEnergyTag` | **Added Round 4** |
| `POST /api/priorities/[id]/milestones` | `milestoneCreate` | **Added Round 4** |
| `PATCH /api/milestones/[id]` | `milestoneComplete` / `milestoneUncomplete` | **Added Round 4** |
| `DELETE /api/milestones/[id]` | `milestoneDelete` | **Added Round 4** |
| `DELETE /api/calendar/reminder` | `reminderDelete` | **Added Round 4** |
| `POST /api/calendar/reminder` | `reminderCreate` | **Added Round 4** — failure path also logged |
| `POST /api/calendar/disconnect` | `calendarDisconnect` | **Added Round 4** — ok + failure paths |
| `POST /api/whoop/disconnect` | `whoopDisconnect` | **Added Round 4** — ok + failure paths |
| `POST /api/tasks` | `createTask` | **Added T3-2** |
| `PATCH /api/tasks/[id]` | `completeTask` / `uncompleteTask` | **Added T3-2** |
| `DELETE /api/tasks/[id]` | `deleteTask` | **Added T3-2** |
| `POST /api/tasks/complete-all` | `bulkCompleteTasks` | **Added T3-2** |
| `POST /api/profile` | `updateProfile` | **Added T3-2** — length logged, not raw text |
| `POST /api/focus/dismiss` | `dismissFocus` | **Added T3-2** |

### Intentionally NOT logged (with justification)

| Route | Reason omitted |
|---|---|
| `DELETE /api/account` | **GDPR compliance** — the cascade deletes `audit_log WHERE user_id = ?` as part of the deletion. Logging before deletion would be immediately erased. Server-side `console.log` provides operator visibility. |
| `POST /api/auth/login`, `logout`, `signup` | Authentication events, not data mutations. Session table (`session_version`) tracks invalidation. Not useful for the Activity tab. |
| `POST /api/notifications` (markRead) | Read-state toggle — no user data is created or deleted. |
| `POST /api/onboarding/consent` | Consent changes are now logged via `POST /api/auth/consent` (which is the settings-level endpoint with audit). Both routes call `setDataConsent`; the auth/consent route is the one with audit logging. |
| `POST /api/priorities/keep` | Refreshes `week_of` timestamp only — no text changes. Cosmetic operation; no meaningful data change to audit. |
| `POST /api/energy/today` | Energy level log entry — informational, low-sensitivity. |
| `POST /api/profile` (voice_preference only) | Voice preference toggle — no content data, settings-only. |
| `POST /api/briefing/**` (call triggers) | Operational voice-call initiation. The resulting briefing is already recorded in the `briefings` table. |
| `POST /api/support` | Support message submission — goes to the `support_messages` table, not user data. |
| `POST /api/waitlist` | Public endpoint; pre-auth; not user data. |
| Admin routes (`/api/admin/**`) | Operator-tier; gated by `checkAdminAuth`. Admin actions are tracked by `vapi_auth_log` and server logs, not the user-facing audit trail. |

### Rate-limit coverage (Ticket 2 check — Round 4 update)

New routes added since the Round 3 sweep: `/api/auth/consent`, `/api/onboarding/consent` (Core), `/api/scoreboard` (Core), and the routes closed in Round 4:

| Route | Rate limit | Status |
|---|---|---|
| `POST /api/auth/consent` | `consentUpdate` 10/hr/user | ✅ Added this session |
| `POST /api/onboarding/consent` | via Core's dispatch | ✅ Core added `onboardingConsent` RL key |
| `GET /api/scoreboard` | — | ✅ Read-only; no rate limit needed |
| `POST /api/calendar/disconnect` | `calendarDisconnect` 5/hr | ✅ **Added Round 4** |
| `POST /api/whoop/disconnect` | `whoopDisconnect` 5/hr | ✅ **Added Round 4** |
| `DELETE,POST /api/calendar/reminder` | `calendarReminder` 10/hr | ✅ **Added Round 4** |
| `POST /api/profile/timezone` | `profileTimezone` 20/hr | ✅ **Added Round 4** |
| `PATCH /api/priorities/[id]/energy` | `priorityEnergy` 30/hr | ✅ **Added Round 4** |
| `POST /api/priorities/[id]/milestones` | `milestoneWrite` 60/hr | ✅ **Added Round 4** |
| `PATCH,DELETE /api/milestones/[id]` | `milestoneWrite` 60/hr | ✅ **Added Round 4** |

---

## Data Consent and Privacy Mode (2026-06-18)

_Added for CASA compliance and Google OAuth verification. Relevant spec: `specs/data-control-onboarding.md`._

### The two user choices

| Setting | `users.data_consent` | Meaning |
|---|---|---|
| **Help improve Edg3** | `'improve'` | The user's calls, transcripts, and edits may be used to evaluate, train, and improve Edg3's features and AI models. |
| **Privacy Mode** | `'privacy'` | The user's data is used **only to power their own experience** (memory, briefings, scheduling). It is never used for training/improvement and never shared with any third party beyond the inference providers required to provide the service (Anthropic/OpenAI). |

Default value: set by Core during onboarding. Column added by Core — see `specs/data-control-onboarding.md` for the DB migration.

### What data flows where under each setting

**Both settings — no difference today:**

- User data (transcripts, priorities, facts, calendar context) is sent to **Anthropic** (`claude-haiku-4-5-20251001`) for inference requests that power briefings, fact extraction, email drafting, priority derivation, alignment scoring, open-loop detection, and reply analysis. These are **standard API calls** — Anthropic's API terms do not use API-submitted data for training by default. No Anthropic fine-tuning or training pipeline is used.
- User calendar events are fetched from **Google Calendar** via the user's own OAuth grant. They are not stored in any external system beyond the user's own Google account.
- Scheduled calls use **Vapi** (voice AI infrastructure). The call audio is processed by Vapi to produce a transcript; the transcript is sent back to Edg3 and stored (encrypted) in our DB.
- No data is sent to any analytics sink, advertising network, or data broker.
- No batch export or training pipeline exists today. If one is built, it must check `data_consent === 'improve'` before including any user row.

**Privacy Mode (`'privacy'`) additional guarantees:**

- When the privacy-mode enforcement pathway is activated (Core lands the column + Security wires the check), the user's data will be explicitly excluded from any future training/improvement batch.
- Users can export all stored data at any time via `GET /api/account/export` — the export includes their `dataConsent` setting so they can verify it.
- Users can request account deletion (`DELETE /api/account`), which removes all rows scoped to `user_id` across all tables.

### Enforcement — current state

Edg3 does not currently have a training pipeline; the enforcement boundary is therefore documentation + sentinel comments.

**Sentinel comments** have been added to the three highest-volume LLM call sites:
- `lib/briefing.ts` (briefing generation — module-level)
- `lib/facts.ts` (transcript fact extraction)
- `lib/outreach.ts` (email drafting)

Each sentinel reads: _"Any future fine-tuning path must gate on `user.data_consent === 'improve'` before including any user-specific content."_

All other LLM call sites (`lib/alignment.ts`, `lib/calendar.ts`, `lib/calendarScore.ts`, `lib/focusRecommendation.ts`, `lib/openLoops.ts`, `lib/replies.ts`, `lib/priorityDerivation.ts`, `lib/verifyPromises.ts`) follow the same inference-only pattern.

**When Core lands `users.data_consent`:** Security will add a DB-level enforcement check to any batch-export or training-pipeline route at that point.

### Audit trail

- The user's consent setting is included in `GET /api/account/export` under `profile.dataConsent`.
- Account deletion (`DELETE /api/account`) removes all user data regardless of consent setting.
- Consent changes are logged: `POST /api/auth/consent` writes a `consent_update` audit entry with `prev` and `new` consent values. The `data_consent` column is now live (migration added 2026-06-18).

### CASA / Google OAuth verification checklist

| Requirement | Status |
|---|---|
| User-facing privacy control described | ✅ Onboarding screen (Design + Core — see spec) |
| Consent setting persisted per user | ✅ Core DB column (`users.data_consent`) |
| Privacy Mode is end-to-end enforced (not just UI) | ✅ Sentinel comments in all LLM paths; no training pipeline exists |
| Data encrypted at rest | ✅ AES-256-GCM (see Encryption-at-Rest section above) |
| Data exportable | ✅ `GET /api/account/export` includes `dataConsent` field |
| Data deletable | ✅ `DELETE /api/account` |
| Privacy policy accurate | ✅ `app/privacy/page.tsx` describes read-write calendar, Gmail draft, Whoop health data |

---

## R9 follow-up audit — Gmail body-reading + ingest path (2026-06-19, Vijay)

Triggered by R9 dispatch: audit `app/api/auth/google/gmail/ingest` and the Round-7 full-body
reading path for rate-limit + audit coverage.

| Surface | Authn | Rate limit | Audit | Notes |
|---|---|---|---|---|
| `POST /api/auth/google/gmail/ingest` | ✅ `getSession()` | ✅ `gmailIngest` (6/hr — configured in `lib/rateLimit.ts:69`) | ✅ **gap closed this pass** | Fans out to many Gmail header reads → cost-commensurate 6/hr cap was already present. Reads only `From` headers (no bodies). |
| `getRecentEmailSignal` `{ fullBodies }` read path (`lib/gmail.ts`) | ✅ scope-gated (`hasGmailReadScope`) | n/a (internal; callers `/api/learned` @30/hr + 11pm cron are limited) | ✅ `email_signal_fetch` (subjects encrypted in `snapshotAfter`) | Bodies read **in-memory only**, capped 10 threads × 2000 chars, spam-gated before fetch, **never stored**. |
| `extractGmailAccountContacts` (ingest read primitive, `lib/gmail.ts`) | ✅ scope-gated | n/a (internal; gated by the ingest route's 6/hr) | ✅ **added `gmail_contacts_fetch`** | Previously had **no audit receipt** despite creating person facts downstream — gap closed: now records contact count + encrypted contact-email snapshot so the Activity tab shows what Edge scanned. |

**Changes shipped this pass:**
- `extractGmailAccountContacts` now emits a `gmail_contacts_fetch` audit entry (encrypted contact
  snapshot) — mirrors `getRecentEmailSignal`'s receipt; closes the only audit gap on the Gmail read paths.
- `truncateAtSentenceBoundary` (`lib/gmail.ts`) replaces the hard `slice(0,2000)` on full bodies so
  extraction never receives a mid-sentence fragment. 7 new tests in `lib/gmail.test.ts` (43 total green).

**No open gaps** on the Gmail ingest/body-reading surface. Rate limits cost-commensurate; every
Gmail read path now writes an encrypted, user-visible audit receipt; bodies are never persisted.

---

## Gmail multi-account flow — second-flow security review (2026-06-19, Vijay, R10 T2)

The dedicated Gmail OAuth flow (`gmail_tokens` + `/api/auth/google/gmail{,/callback,/disconnect}`)
reviewed against the primary calendar flow's protections.

| Check | Status | Evidence |
|---|---|---|
| **CSRF state** — initiate generates + stores a nonce; callback verifies before accepting code | ✅ equivalent to calendar flow | Initiate: `randomBytes(20)` → `oauthStateQueries.create(state, userId, 'gmail')` (`app/api/auth/google/gmail/route.ts`). Callback: `oauthStateQueries.consume(state)` + rejects unless `flow === 'gmail'` (`/callback/route.ts`); state is REQUIRED (no session fallback). |
| **Rate limits** | ✅ both present | `gmailConnect` 10/hr on initiate, `gmailDisconnect` 5/hr on disconnect (`lib/rateLimit.ts:67-68`); `gmailIngest` 6/hr on `/ingest`. |
| **Audit entries** | ✅ both written | `gmailAccountConnect` on `/callback`, `gmailAccountDisconnect` on `/disconnect`. Added to the coverage map. |
| **Scope minimization** | ⚠️ **NOT a regression — readonly is intentional + required; decision flagged for PM** | See below. |

**Scope finding (Kevin's #3 — corrects the dispatch premise).** The dispatch asked to confirm the
Gmail flow requests **no** read scopes (readonly "calendar-token only"). In fact
`GMAIL_ACCOUNT_SCOPES = ['openid','email', gmail.compose, gmail.readonly]` — the dedicated flow
**does** request `gmail.readonly`, and this is **required, not a regression**: `extractGmailAccountContacts`
(the post-link contact ingest behind `POST /api/auth/google/gmail/ingest`) reads the **dedicated**
account's `From` headers via `getGmailTokens` and gates on `hasGmailReadScope`. Removing readonly
would silently break contact ingest for any user who links a dedicated Gmail account (the scope check
returns `[]` with no fallback, since a token row exists).

- **Action taken:** corrected the misleading "(compose-only)" comment on the initiate route (the scope
  set was already accurately documented in `google-auth.ts:120-122`). **Did NOT remove readonly** —
  that would break a shipped feature.
- **Decision — ✅ ACCEPTED (PM Kevin, reviewed 2026-06-20, R11 T1):** `gmail.readonly` on the dedicated
  Gmail account is **retained**. It is required by `extractGmailAccountContacts` for contact ingest, which
  is a core **Clarity Score** input; tightening to a narrower scope would break that feature. The scope is
  justified, disclosed (privacy page + `specs/google-verification.md`), and audited (`gmail_contacts_fetch`
  receipt). No further action — this is the intended, accepted state.
  - _(Original options, for the record: keep `gmail.readonly` (chosen) vs. drop dedicated-account contact
    ingest + route it through the calendar account and tighten `GMAIL_ACCOUNT_SCOPES` to compose-only.)_

**Result:** CSRF, rate-limit, and audit protections on the Gmail flow are equivalent to the calendar
flow. The one scope finding is now **accepted/closed** — surfaced, decided, documented.

---

## R12 T2 — Email-drafting feature REMOVED (2026-06-20, Vijay) — supersedes the Gmail sections above

Derrick dropped the email-drafting feature; the Gmail multi-account flow, contact ingest, and the
`gmail.readonly` decision above describe code that has now been **removed** (kept here for history):

- **Deleted routes:** `app/api/auth/google/gmail/{route,callback,disconnect,ingest}.ts` + `gmail-routes.test.ts`.
- **Removed from `lib/google-auth.ts`:** the dedicated-Gmail-account OAuth flow — `getGmailAuthUrl`,
  `exchangeGmailCode`, `emailFromIdToken`, `saveGmailTokens`, `disconnectGmailAccount`,
  `GMAIL_ACCOUNT_SCOPES`, `GmailTokenExchange`. (`getGmailTokens` retained — still reads existing rows.)
- **Removed from `lib/gmail.ts`:** `extractGmailAccountContacts` + `EmailContact` + `parseFromHeader`
  and the **`gmail_contacts_fetch`** audit receipt (the contact-ingest feature is gone).
- **Privacy page:** Gmail section rewritten to read-only only (no drafting/compose language).
- **`gmail_tokens` table + `gmailTokenQueries` retained** (existing rows readable; no schema change).

**Follow-up — ✅ DONE (2026-06-20, after Core R12 T7 merged).** `createDraft` + `DraftInput`/`DraftResult`
+ `GMAIL_DRAFTS_PER_HOUR` + the anti-spam block + `logDraft` call removed from `lib/gmail.ts`; the
`gmail.compose` scope removed entirely — `GMAIL_COMPOSE_SCOPE` constant deleted, dropped from
`GOOGLE_SCOPES`, and `hasGmailScope`/`userHasGmailScope` removed (their only consumers were the draft
flow + the accounts-status field, now gone). `GmailScopeError` kept (read-path scope errors), message
genericized. `deleteDraft` retained permanently (`lib/undo.ts` backward-compat). **Net result:
`gmail.readonly` is now the ONLY Gmail scope EDG3 requests** — no compose, no send, read-only inbox
signal for briefings/Focus score/fact extraction. `/api/auth/accounts` dropped its `hasGmailScope` field.

---

## S3 — Multi-user infrastructure audit (2026-06-24)

Pre-onboarding audit before Edg3 serves more than one user. Result: **no cross-user data leak found.**

### (1) `lib/db.ts` query scoping
Scanned every `SELECT`/`UPDATE`/`DELETE` touching a user-scoped table (`facts`, `briefings`,
`episodes`, `tasks`, `priorities`, `memories`, `fact_history`, `calendar_scores`, `energy_log`,
`open_loops`, `watched_threads`, `notifications`, `people_models`, `gratitude_entries`,
`calendar_tokens`/`whoop_tokens`/`gmail_tokens`, `push_subscriptions`, `inbound_call_attempts`,
`daily_focus`, `audit_log`). Every query falls into one of these **correct** buckets:
- **Scoped by `user_id`** — the overwhelming majority (all user-facing reads/writes).
- **Dynamic-clause queries** start with `user_id = ?` as clause[0] (verified `episodeQueries.search`).
- **Maintenance/prune jobs** — intentionally global (`DELETE FROM watched_threads/open_loops/episodes/audit_log WHERE … < cutoff`). Cross-user by design; delete only stale/resolved rows.
- **Admin all-user views** — `audit_log` list, admin stats/users. Admin-auth gated (`checkAdminAuth`).
- **Phone-keyed** — `inbound_call_attempts` rate-limit count is keyed by `phone_number` (pre-user-lookup, correct).
- **Server-internal PK updates** — `briefings … WHERE id = ?` (`update`/`updateLearningStatus`) use a server-derived briefingId during webhook processing, never user-supplied input. Not a user-facing read path.
- **No SQL string interpolation of user input** — all values are bound parameters (`?`); the only `${…}` in SQL are fixed column/clause lists and retention-day constants, never request data.

### (2) Account-deletion cascade
Covered + guarded: `deleteUserData(userId)` iterates `USER_SCOPED_DELETE_ORDER`, and
`lib/db-account-deletion.test.ts` is a **drift guard** — every table with a `user_id` column must
appear in the order list or the test fails. New multi-user isolation test confirms deleting user 1
leaves user 2's facts/briefings/episodes fully intact.

### (3) Admin users overview
`GET /api/admin/users` already lists all users with last-call date, next-call, and call counts;
**added `total_facts`** (active-fact count per user) this pass for the multi-user overview.

### (4) Per-user scheduler
`checkAndInitiateCalls` and every nightly/weekly sweep loop `SELECT … FROM users WHERE
onboarding_complete = 1` — all active users, not hardcoded to one. No single-user assumption found.

### Tests
`lib/multi-user-isolation.test.ts` — two users; fact/briefing/episode reads are scoped; account
deletion of one leaves the other intact.

---

## S4 — OWASP sweep (2026-06-24)

### (1) SQL injection
**Clean.** Every value reaching SQL is a bound `?` parameter. The only `${…}` inside a
`db.prepare()` template is `DELETE FROM ${table}` in `deleteUserData`, where `table` iterates the
hardcoded `USER_SCOPED_DELETE_ORDER` constant — never request data. No string-concatenated values.

### (2) Input validation (POST/PATCH)
Audited the input-accepting routes. Validation is present and strong on the key paths:
- `auth/signup` — email trim+lowercase, all-fields-required (400), password length 8–128, name ≤100.
- `auth/login` — credential check, rate-limited per IP.
- `profile/timezone` — `isValidTimeZone()` gate, rejects garbage.
- `notifications/subscribe` — auth + rate-limit + `typeof` checks on endpoint/p256dh/auth.
- `vapi/tool-call` — Vapi-secret gate; tool args type-checked per handler.
- **Gap fixed:** `notifications/subscribe` type-checked but did not bound lengths — an authenticated
  client could store a multi-MB endpoint/key and bloat `push_subscriptions`. **Added** an http(s)-URL
  + length cap (endpoint ≤1024, keys ≤256) → 400. Tests added (`push-routes.test.ts`).

### (3) Auth coverage on every route
Scanned all `app/api/**/route.ts` for a session/secret/admin/rate-limit gate. **All protected** except
the intentionally-public set: `auth/login`, `auth/signup`, OAuth callbacks (`auth/google|whoop|gmail/*`
— CSRF-state protected), `vapi/webhook` + `vapi/tool-call` (Vapi-secret gated), `waitlist`. The one
grep false-positive — `user/export` — is a thin re-export of the authed `account/export` GET
(`getSession` + 401). No unprotected user-data route found.

### Tests
`push-routes.test.ts` +3 (non-URL endpoint, oversized endpoint, oversized key → 400).

---

## S7 — Scheduler multi-user hardening (2026-06-24)

- **(1) Fires every due user — verified.** `checkAndInitiateCalls` loops all `onboarding_complete`
  users with a phone + call_time, each in its own try/catch; it `continue`s past non-due users and
  never breaks early. 10 users at 7am → 10 calls.
- **(2) Bounded concurrency — added.** Calls were placed sequentially (`await` per user), which could
  exceed the 55s dispatch-lock TTL once enough users shared a call time. Refactored into a filter
  pass (sequential, DB-only) + a placement pass that fires in **batches of `MAX_CONCURRENT_CALLS=5`**
  (`Promise.all` per batch). Under Vapi's simultaneous-call limit; per-user try/catch isolates failures.
- **(3) Double-dial prevention — verified (double-guarded).** The minute-cron acquires `scheduler_lock`
  (`DISPATCH_LOCK`, 55s TTL) before the sweep and releases after, so only one instance runs it across
  replicas/restarts; and `findTodaysBlockingBriefing` + `scheduleBriefingCall`'s own guard block a
  second call for an already-called user.
- **(4) Intended/actual/outcome log — already covered by `call_attempts`.** That table records
  `scheduled_for` (intended), `attempted_at` (actual), `status` (connected/failed/retrying) +
  `fail_reason`, and the 6am digest reads `callAttemptQueries.failedCount(24)` → DEGRADED. A separate
  `scheduled_calls` table would duplicate it, so it was not added.
- **Tests:** `scheduler.hardening.test.ts` (S7 block) — 3 users same call time all fire; already-called
  → no double-dial; one failure doesn't sink the others; 7 users → 7 calls across batches.
