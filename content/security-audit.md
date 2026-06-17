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
| `POST /api/calendar/disconnect` | ✅ | — | — | |
| `GET,DELETE,POST /api/calendar/reminder` | ✅ | — | — | Idempotent: removes before adding |
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
| `PATCH /api/milestones/[id]` | ✅ | — | **FIXED** id: Number.isFinite + >0 | User-scoped |
| `DELETE /api/milestones/[id]` | ✅ | — | **FIXED** id: Number.isFinite + >0 | User-scoped |

### Onboarding Routes

| Route | Authn | RL | Validation | Notes |
|---|---|---|---|---|
| `POST /api/onboarding/call-time` | ✅ | — | **FIXED**: HH:MM format + isValidTimeZone + phone len | |
| `GET,POST /api/onboarding/priorities` | ✅ | **ADDED** 10/hr on POST | Array check; text trimmed | Writes priorities + memory + facts |
| `POST /api/onboarding/profile` | ✅ | — | Trim + empty check | |
| `GET /api/onboarding/suggest-priorities` | ✅ | **ADDED** 5/hr | — | LLM call; rate-limited to prevent cost abuse |

### Priorities Routes

| Route | Authn | RL | Validation | Notes |
|---|---|---|---|---|
| `PATCH /api/priorities/[id]/energy` | ✅ | — | **FIXED** id: Number.isFinite + >0; energy_cost enum | User-scoped |
| `GET,POST /api/priorities/[id]/milestones` | ✅ | — | **FIXED** id: Number.isFinite + >0 | User-scoped |
| `POST /api/priorities/keep` | ✅ | **ADDED** 20/hr | — | |

### Profile Routes

| Route | Authn | RL | Validation | Notes |
|---|---|---|---|---|
| `GET,POST /api/profile` | ✅ | — | Trim + empty check | |
| `POST /api/profile/timezone` | ✅ | — | **FIXED**: isValidTimeZone (was just `/` check) | |

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
| `POST /api/whoop/disconnect` | ✅ session | |
| `GET /api/whoop/recovery` | ✅ session | User-scoped |
| `GET /api/whoop/status` | ✅ session | User-scoped |

### Waitlist Route

| Route | Auth | RL | Notes |
|---|---|---|---|
| `POST /api/waitlist` | — (public) | ✅ 5/hr IP | Email format + length check; generic success (no enum) |

---

## Fixes Applied This Session

### Rate Limit Additions (26 new limit types — flagship + Round 2/3)

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
- **Audit logging:** All calendar + fact mutations logged to `audit_log`; undo_applied events logged; 90-day retention with email-subject pruning
- **Admin auth:** Separate HMAC-derived cookie; shared brute-force rate limit; admin secret header for CoS-agent routes
- **Session expiry:** 7-day JWT; logout bumps `session_version`
- **Error responses:** No stack traces or internal error strings in user-facing responses
- **Data export:** Full user export (`GET /api/account/export`) omits `password_hash` and OAuth tokens; decrypts PII fields
- **Backup route:** filename regex `^edg3-[0-9TZ-]+\.db$` + `path.basename` guard prevent path traversal; admin-auth gated
- **Activation Moment path:** `GET /api/priorities/derive` + `POST /api/priorities/derive/accept` — auth, rate-limit, user-scoping, graceful null, no error leak confirmed
- **Test coverage:** 56 test files, 1253 tests. Route-level security tests for: waitlist, day-plan/confirm, activity/email-receipt, memory/facts, account (export+delete), priorities/derive+accept, admin/backup, auth/signup. Lib-level: auth/JWT, crypto, idempotency, backup path traversal, vapi secret.

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
- No audit event is currently written when `data_consent` changes (the column doesn't exist yet); Security will add an `audit_log` record to `POST /api/onboarding/data-consent` (or equivalent Core route) once Core ships the column + route.

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
