# Edg3 — Google OAuth Verification & CASA Prep

This document is the single source of truth for our Google OAuth verification
submission. It covers scope justifications, data handling, security controls,
retention/deletion, and draft answers to Google's security questionnaire.

**Scopes requested:** `calendar.readonly`, `calendar.events`, `gmail.compose`,
`gmail.readonly` — all are sensitive or restricted, requiring Google's OAuth
verification review and CASA assessment before unrestricted production use.

---

## 1. Scope inventory

| Scope | Classification | What we use it for | Where in code |
|---|---|---|---|
| `https://www.googleapis.com/auth/calendar.readonly` | Sensitive | Read the user's calendar events to build the daily briefing and detect conflicts | `lib/calendar.ts` — `listEvents()` |
| `https://www.googleapis.com/auth/calendar.events` | **Restricted** | Create, move, delete, and edit events on the user's behalf via voice commands | `lib/calendar.ts` — `createEvent()`, `deleteEvent()`, `patchEvent()` |
| `https://www.googleapis.com/auth/gmail.compose` | **Restricted** | Create email drafts only — user reviews and sends manually. We never call `messages.send`. | `lib/gmail.ts` — `createDraft()` only |
| `https://www.googleapis.com/auth/gmail.readonly` | **Restricted** | (1) Check for replies to outreach emails Edge drafted (reply-tracking). (2) Read recent inbox metadata as a prioritization signal for the AI focus engine. (3) Read recent inbox **body text** (≤10 non-promotional threads, in-memory) to learn durable facts for memory. ⚠️ **Use-case expanded — see CASA flag below.** | `lib/replies.ts` (reply tracking); `lib/gmail.ts getRecentEmailSignal` (prioritization + memory) |

### Why we need each scope

**`calendar.readonly`** — Edg3's core loop is a daily voice briefing that reads
your calendar aloud. Without read access there is no product.

**`calendar.events`** — The entire value proposition is "tell Edge what to change
on your calendar." We create, move, and delete events on voice command. We cannot
do this with `calendar.readonly` alone.

**`gmail.compose`** — Users ask Edge to draft outreach emails mid-call
("draft a meeting request to Sarah"). We create the draft in Gmail so the user
can review, edit, and send it manually. We never send without explicit user action.

**`gmail.readonly`** — Two uses:
1. **Reply tracking:** After drafting an outreach email, users ask "did Sarah reply?"
   Edge reads the specific Gmail thread it created to answer. Scope-limited to
   `watched_threads` (only threads Edge originated).
2. **Focus prioritization + memory (EXPANDED — Round 7):** The AI Focus Recommendation
   engine and the memory pipeline analyze the user's recent inbox to identify what
   matters and to learn durable facts (goals, projects, people). Header metadata + Gmail's
   snippet are read for recent INBOX threads; for a small number (up to 10) of recent,
   non-promotional threads, the **message body text is also read** (`format:'full'`, capped
   ~2000 chars/thread). All of this is used **in-memory** for LLM prioritization + fact
   extraction; **the raw email body is never stored** — only short derived facts (which the
   user can view and delete in the Memory tab) and encrypted thread subjects persist. An
   audit entry (thread count + encrypted subjects) is written to `audit_log` for transparency.

### ⚠️ CASA FLAG — `gmail.readonly` use-case expansion

**What changed:** The prior CASA submission described `gmail.readonly` as reading
*only specific threads Edge started*. Two expansions since: (a) the focus
recommendation feature reads *recent inbox thread metadata broadly* (INBOX label,
recent N days, up to 50 threads); (b) **Round 7** additionally reads the *message
body text* of up to 10 recent non-promotional threads (in-memory, ~2000-char cap)
to extract durable memory facts. Raw bodies are never stored.

**Why this matters for CASA/verification:**
- Google's verification review will compare our declared use against the actual
  code. The prior answer ("we do not do a broad inbox scan") is now FALSE.
- The CASA questionnaire answer for `gmail.readonly` **must be updated** before
  the next submission to accurately describe both use cases.
- The Privacy Policy (`app/privacy/page.tsx`) must be updated to disclose inbox
  reading for AI prioritization — currently it only mentions reply tracking.
- The demo video (§6 below) needs a scene showing the focus recommendation feature.

**Privacy mitigations we've built (document to assessors):**
- **Body reading is bounded:** metadata-only (`format:'metadata'`) is the default path;
  message bodies are fetched (`format:'full'`) only for up to 10 recent, non-promotional
  INBOX threads, each capped at ~2000 chars. Spam/promotional threads are skipped.
- **No storage of raw email content** — bodies are held in memory for the LLM call and
  discarded immediately. Only short derived facts (user-visible and deletable in the Memory
  tab) and encrypted thread subjects (90-day retention) persist.
- Audit log records the fetch action (thread count only) so users see it in
  their Activity feed. Zero email content in the log.
- Hard cap: maximum 50 threads per fetch, INBOX only.
- User-scoped: `user_id` required at every call layer.

**Action items before CASA submission:**
- [x] Update Privacy Policy to disclose inbox reading for AI focus recommendation. *(Done 2026-06-14)*
- [x] Update the Google OAuth verification questionnaire answers (§5 below). *(Done 2026-06-14)*
- [ ] Add focus recommendation scene to demo video (§6 below).
- [ ] PM decision: should this be a separate consent step (user explicitly opts in
      to inbox reading for prioritization, beyond the base re-consent)? Flagged —
      lean yes for trust, but PM call.

### `gmail.compose` — the "could-technically-send" caveat

Google's `gmail.compose` scope grants both `drafts.create` and `messages.send`
permission at the API level. Our code enforces a draft-only limit in
`lib/gmail.ts`: only `drafts.create` is called; `messages.send` is never wired.
This is a **code-level enforcement**, not a scope-level enforcement. We document
this honestly to Google and commit to it in the questionnaire.

---

## 2. Data accessed, stored, and used

### Calendar data

| What | Stored? | Retention | Encryption |
|---|---|---|---|
| Event titles, times, attendees (read for briefing) | No — used in-memory for briefing generation | Not stored | In transit: HTTPS |
| Events created/moved/deleted by user command | Google Calendar is the source of truth; we log the action | Action recorded in `audit_log` (title + args only); no full event stored | `audit_log.args_json` not encrypted (no raw PII stored — only event titles) |
| Google OAuth tokens | Yes — `calendar_tokens` table | Until user disconnects or account deleted | AES-256-GCM at rest (`encryptField`) |

### Gmail data

| What | Stored? | Retention | Encryption |
|---|---|---|---|
| Draft ID (for undo) | Yes — `gmail_drafts_log.draft_id` | Until account deleted | Draft ID not encrypted (not PII); recipient/subject encrypted |
| Recipient name + email | Yes — `gmail_drafts_log.recipient` | Until account deleted | AES-256-GCM at rest (`encryptNullable`) |
| Draft subject | Yes — `gmail_drafts_log.subject` | Until account deleted | AES-256-GCM at rest |
| Thread IDs we watch for replies | Yes — `watched_threads.thread_id` | Until handled/dismissed or account deleted | Thread ID not encrypted; recipient/context encrypted |
| Message bodies/content | **In-memory only — raw body NEVER stored.** For up to 10 recent, non-promotional threads, body text (`format:'full'`, ~2000-char cap) is read for fact extraction, then discarded after the LLM call. | Raw body never persisted | N/A |
| Facts derived from email (e.g. a project or person mentioned) | Yes — `facts` table (short summaries, not raw email) | Until user deletes (visible/deletable in Memory tab) | AES-256-GCM at rest |
| Recent inbox thread metadata (From, Subject, Date headers + snippet) | **No** — fetched in-memory for AI focus recommendation; discarded after LLM call | Never stored | N/A |
| Inbox access action + thread subjects | Yes — `audit_log` records the fetch (thread count) + the reviewed subjects | ~90 days | Subjects encrypted (AES-256-GCM); action string not encrypted |
| Attachments / full message history | **Never accessed** — only recent thread metadata + (for ≤10 threads) the message body text are read; attachments are never fetched | — | — |

### What we explicitly do NOT do

- We do not **store** raw message bodies — body text (≤10 recent non-promotional threads,
  ~2000-char cap) is read in memory for fact extraction and discarded; only short derived
  facts (user-visible and deletable in the Memory tab) persist.
- We do not read attachments, sent mail, spam, or trash — only recent INBOX threads
  (metadata for all; body text for up to 10 non-promotional threads).
- Reviewed thread subject lines ARE stored, encrypted at rest (AES-256-GCM, ~90-day
  retention), so users can see which emails Edge reviewed. Sender addresses and raw bodies
  are not stored.
- We do not send emails — only create drafts for user review.
- We do not share any Google data with third parties.
- We do not use Google data for advertising, profiling, or model training.

---

## 3. Security controls

### Encryption at rest

All OAuth tokens (Google + Whoop) and sensitive PII columns are encrypted
using AES-256-GCM with a random 12-byte IV per value. Format: `enc:1:<base64>`.
Key material: `DATA_ENCRYPTION_KEY` env var (64 hex chars / 32 bytes). Legacy
plaintext rows are decrypted transparently (backward-compatible rollout).

Covered columns:
- `calendar_tokens.access_token`, `calendar_tokens.refresh_token`
- `whoop_tokens.access_token`, `whoop_tokens.refresh_token`
- `briefings.transcript`, `briefings.user_response`
- `gmail_drafts_log.recipient`, `gmail_drafts_log.subject`
- `watched_threads.recipient`, `watched_threads.context`
- `notifications.title`, `notifications.body`

See `lib/crypto.ts` and `lib/db-encryption.test.ts` (11 integration tests proving
ciphertext at rest for the three highest-sensitivity tables).

### Encryption in transit

All communication uses HTTPS/TLS. Railway enforces TLS termination; no plaintext
HTTP routes are exposed.

### Authentication

Session-based auth via HttpOnly cookies (`edg3_token`, signed JWT). Google tokens
never exposed to the browser. Admin routes protected by a separate `edg3_admin`
cookie. Vapi webhooks protected by `VAPI_SERVER_SECRET` HMAC enforcement
(`VAPI_SECRET_ENFORCE=true`).

### Rate limiting

IP-based rate limiting on auth and write-path routes (`rate_limits` table,
fixed-window counters). See `lib/rateLimit.ts`.

### Audit logging

All calendar mutations recorded in `audit_log` (action, args, result, success/fail,
timestamp, user_id). Used for activity feed + incident diagnosis.

### Principle of least privilege

- `gmail.compose` scope only creates drafts — `messages.send` is never called.
- `gmail.readonly` reads (1) specific `watched_threads` for reply tracking, (2) recent INBOX thread metadata (headers + snippet, via `format:'metadata'`) for AI focus prioritization, and (3) for up to 10 recent non-promotional threads, the message body text (`format:'full'`, ~2000-char cap) — read in memory for fact extraction and immediately discarded. **Raw message bodies are never stored.** Inbox access is capped at 50 threads per call.
- Calendar event content is not stored — only processed in memory for briefings.

---

## 4. Data retention & deletion

### Retention policy

| Data | Retention |
|---|---|
| OAuth tokens (Google, Whoop) | Until user disconnects the integration or account is deleted |
| Call transcripts (`briefings.transcript`) | Indefinitely (user's call history); user can request deletion |
| Calendar mutation log (`audit_log`) | Indefinitely; used for undo and activity feed |
| Gmail draft log (`gmail_drafts_log`) | Indefinitely; user can request deletion |
| Watched threads (`watched_threads`) | Until handled/dismissed or account deleted |
| Call memories/facts | Indefinitely (Edge's memory of the user); user can clear via dashboard |

### Account deletion

User data is permanently deleted via two paths — both clear the same tables in
leaf-first order:

- **Admin-initiated:** `DELETE /api/admin/users/:id`
- **Self-service:** `DELETE /api/account` — requires `{ "confirm": "delete my account" }`
  in the request body. *(Shipped — satisfies Google's self-service deletion requirement.)*

Deletion order (leaf tables first, users row last):

1. `calendar_plan_executions` (idempotency log)
2. `daily_focus` (AI focus areas per day)
3. `event_energy_tags` (LLM classification cache)
4. `calendar_scores` (daily focus/energy scores)
5. `energy_profile` (peak/trough hours)
6. `focus_milestones`
7. `energy_log`
8. `whoop_tokens` (health PII)
9. `calendar_tokens` (OAuth tokens)
10. `gmail_drafts_log`
11. `watched_threads`
12. `notifications`
13. `audit_log`
14. `facts`
15. `briefings` + `preview_briefings`
16. `memories`
17. `priorities`, `tasks`
18. `undo_log`, `event_dedupe_keys`, `delete_confirm_tokens`
19. `users`

### Token revocation *(both providers — shipped 2026-06-15)*

**Google:** `lib/calendar.ts:disconnectCalendar()` calls `getOAuthClient().revokeToken()`
(using the `google-auth-library`'s built-in revoke). Best-effort; local token row always
deleted even if the revoke call fails.

**Whoop:** `lib/whoop.ts:revokeWhoopAccess()` POSTs to
`https://api.prod.whoop.com/oauth/oauth2/revoke` (RFC 7009) with client credentials and
the refresh token. Same best-effort pattern. In-memory caches cleared on disconnect.

---

## 5. Google security questionnaire — draft answers

These are draft answers for Google's OAuth verification application. The user
reviews and submits; do not submit without review.

---

**Q: Describe how your application uses each requested scope.**

`calendar.readonly`: We fetch the user's upcoming calendar events once per day to
generate a personalized voice briefing. Event data is processed in memory and
not stored persistently.

`calendar.events`: Users control their calendar via voice commands ("move my 3pm
meeting to 4pm"). We create, update, and delete events on their behalf in real time.

`gmail.compose`: When a user asks Edge to draft an outreach email, we create a Gmail
draft. The user reviews and sends the email manually from their Gmail inbox. We
never call `messages.send`.

`gmail.readonly`: Two uses. (1) Reply tracking: after drafting an outreach email,
users ask "did Sarah reply?" We read only the specific Gmail threads we originated.
(2) Focus prioritization: our AI analyzes the user's recent inbox metadata to
identify priority areas (financial, legal, life-admin threads). We use Gmail's
`format:'metadata'` API parameter, which returns email headers (From, Subject,
Date) and Gmail's own auto-generated snippet. Additionally, for up to 10 recent
non-promotional threads, the message body text is read in memory (`format:'full'`,
~2000-char cap) for fact extraction and immediately discarded — **raw message bodies
are never stored.** Only INBOX threads from the past N days (≤50) are accessed. The
derived signal is used in-memory for AI analysis and immediately discarded. We record
the fetch action (thread count only) in our audit log for user transparency.

---

**Q: Does your app store any data received from Google APIs? If so, what data and
for how long?**

We store:
- Google OAuth access and refresh tokens (encrypted at rest with AES-256-GCM).
  Retained until the user disconnects or account is deleted.
- Gmail draft IDs and draft recipient/subject (encrypted). Retained for undo
  functionality; deleted on account deletion.
- Gmail thread IDs we originated, for reply tracking. Retained until the thread
  is handled or dismissed.

We do not store calendar event content, email body content, or any other Google
user data.

---

**Q: Does your app share Google user data with any third parties?**

No. Google user data is used only within Edg3 to provide the described features.
It is not shared with, sold to, or accessible by any third parties.

---

**Q: How does your app protect user data?**

- **Encryption at rest:** All Google OAuth tokens and draft metadata are encrypted
  using AES-256-GCM with a per-value random IV before being written to our database.
- **Encryption in transit:** All data is transmitted over HTTPS/TLS only.
- **Authentication:** Sessions use signed HttpOnly JWT cookies. Admin routes
  require a separate credential. Vapi webhook endpoints are HMAC-verified.
- **Least privilege:** We only call the Google APIs and endpoints necessary for the
  described features. We never call `messages.send`. Inbox access is limited to
  INBOX-label threads — headers + snippet via `format:'metadata'`, plus (for ≤10 recent
  non-promotional threads) body text via `format:'full'` read in memory and discarded —
  capped at 50 threads per call. No other mailbox labels or attachments are ever requested,
  and raw message bodies are never stored.

---

**Q: Does your app comply with the Google API Services User Data Policy's
Limited Use requirements?**

Yes. We use Google user data only to provide the features described to the user
in Edg3. We do not use Google data for advertising, profiling, or model training.
We do not share or sell Google user data.

---

**Q: How can users revoke your application's access to their Google data?**

Users can disconnect their Google account from the Edg3 dashboard at any time
(`/dashboard` → "Disconnect Google"). This deletes their OAuth tokens from our
database. Users can also revoke access directly from their Google Account security
settings at `myaccount.google.com/permissions`.

---

## 6. Demo video shot-list

Google requires a video demonstrating how the restricted scopes are used.

| Scene | What to show | Scope demonstrated |
|---|---|---|
| 1 | Dashboard → Calendar connected. Voice call initiates. | `calendar.readonly` |
| 2 | Edg3 reads out today's calendar events in the briefing. | `calendar.readonly` |
| 3 | User says "add a meeting with Sarah at 3pm tomorrow". Edge confirms and it appears in Google Calendar. | `calendar.events` |
| 4 | User says "move my 3pm to 4pm". Edge confirms and calendar updates. | `calendar.events` |
| 5 | User says "draft an email to Sarah about the project". Edge creates a draft — show it in Gmail Drafts, not Sent. | `gmail.compose` |
| 6 | User says "did Sarah reply?". Edge answers based on thread content. | `gmail.readonly` |
| 7 | Focus Score shown on dashboard — show that Edge reads inbox headers/snippet (and, for a few recent threads, body text in memory) to compute it. Narrate: "From/Subject/snippet for every thread, plus body text for a few recent threads — read in memory for fact extraction and never stored." | `gmail.readonly` |
| 8 | Dashboard → Disconnect Google → account settings. Show Google's own revoke page. | (data deletion) |

Video should be < 5 minutes, narrated, showing the actual app (not a mock).

---

## 7. CASA process notes

CASA (Cloud Application Security Assessment) is required for restricted-scope apps
before unrestricted production use. It is run by a Google-authorized third-party
assessor.

**Timeline:** CASA typically takes 4–8 weeks from submission to completion. Start
**immediately** once the app is code-complete — this is the launch long-pole.

**What assessors look for:**
- OWASP Top 10 coverage (injection, auth, XSS, secrets management, etc.)
- Secure data handling (encryption at rest + in transit, access controls)
- Scope justification matches actual code behavior
- User deletion works completely
- No overly broad data access

**What to prepare before submitting:**
- [x] Self-service user deletion endpoint (`DELETE /api/account`) — shipped; requires
      `{ "confirm": "delete my account" }` body. *(Done 2026-06-13)*
- [x] Token revocation on disconnect — both OAuth providers done. *(Done 2026-06-15)*
  - **Google:** `lib/calendar.ts:disconnectCalendar()` calls `getOAuthClient().revokeToken()` (was already implemented).
  - **Whoop:** `lib/whoop.ts:revokeWhoopAccess()` POSTs to `https://api.prod.whoop.com/oauth/oauth2/revoke` (RFC 7009).
  - Both are best-effort: local token row always deleted even if revoke endpoint fails.
- [x] Privacy policy accurately describes all scopes and data use (see `app/privacy/page.tsx`). *(Done 2026-06-14)*
- [ ] Demo video (§6 above) recorded and uploaded.
- [ ] This document reviewed by the user for accuracy before submission.

**Assessor contact:** https://developers.google.com/identity/protocols/oauth2/production-readiness/casa

---

*Last updated: 2026-06-15. Owner: PM/CTO. Route accuracy questions to Security lane.*
