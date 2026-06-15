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
| `https://www.googleapis.com/auth/gmail.readonly` | **Restricted** | (1) Check for replies to outreach emails Edge drafted (reply-tracking). (2) Read recent inbox thread metadata as a prioritization signal for the AI focus recommendation engine. ⚠️ **Use-case expanded — see CASA flag below.** | `lib/replies.ts` (reply tracking); `lib/gmail.ts getRecentEmailSignal` (prioritization) |

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
2. **Focus prioritization (NEW):** The AI Focus Recommendation engine analyzes the
   user's recent inbox to identify what matters to them (financial/legal/life admin
   threads factor into suggested focus areas). Only metadata is read
   (`format:'metadata'` — no message bodies); only INBOX label. The signal is used
   in-memory for LLM prioritization; **no email content is stored.** An audit entry
   (thread count only) is written to `audit_log` for transparency.

### ⚠️ CASA FLAG — `gmail.readonly` use-case expansion

**What changed:** The prior CASA submission described `gmail.readonly` as reading
*only specific threads Edge started*. The focus recommendation feature changes
this to also reading *recent inbox thread metadata broadly* (INBOX label, recent
N days, up to 50 threads).

**Why this matters for CASA/verification:**
- Google's verification review will compare our declared use against the actual
  code. The prior answer ("we do not do a broad inbox scan") is now FALSE.
- The CASA questionnaire answer for `gmail.readonly` **must be updated** before
  the next submission to accurately describe both use cases.
- The Privacy Policy (`app/privacy/page.tsx`) must be updated to disclose inbox
  reading for AI prioritization — currently it only mentions reply tracking.
- The demo video (§6 below) needs a scene showing the focus recommendation feature.

**Privacy mitigations we've built (document to assessors):**
- `format:'metadata'` API parameter — only headers (From, Subject, Date) and
  Gmail's own snippet (~100 chars) are fetched. Message bodies are never
  requested or transmitted to our server.
- No storage of email content — the signal is derived and discarded.
- Audit log records the fetch action (thread count only) so users see it in
  their Activity feed. Zero email content in the log.
- Hard cap: maximum 50 threads per fetch, INBOX only.
- User-scoped: `user_id` required at every call layer.

**Action items before CASA submission:**
- [ ] Update Privacy Policy to disclose inbox reading for AI focus recommendation.
- [ ] Update the Google OAuth verification questionnaire answers (§5 below).
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
| Message bodies/content | **No** — reply tracking reads snippets; focus signal uses `format:'metadata'` (headers + Gmail's own snippet only). Bodies never fetched or stored. | Never persisted | N/A |
| Recent inbox thread metadata (From, Subject, Date headers + snippet) | **No** — fetched in-memory for AI focus recommendation; discarded after LLM call | Never stored | N/A |
| Inbox access action | Yes — `audit_log` records the fetch (thread count + days window, no content) | Audit retention policy (~90 days) | Action string not encrypted; no PII in this log entry |
| Full inbox contents (bodies, attachments) | **Never accessed** — `format:'metadata'` parameter ensures this at the API level | — | — |

### What we explicitly do NOT do

- We do not read or store message bodies (enforced via `format:'metadata'` API param).
- We do not read attachments, drafts, sent mail, spam, or trash — only INBOX metadata.
- We do not store email header content, subjects, or sender addresses from inbox reads.
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
- `gmail.readonly` reads (1) specific `watched_threads` for reply tracking, and (2) recent INBOX thread metadata (headers + snippet only, via `format:'metadata'`) for AI focus prioritization. Bodies are never fetched. Inbox access is capped at 50 threads per call.
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

When an admin deletes a user (`DELETE /api/admin/users/:id`), all user data is
permanently deleted in this order:

1. `whoop_tokens` (health PII)
2. `calendar_tokens` (OAuth tokens)
3. `gmail_drafts_log`
4. `watched_threads`
5. `notifications`
6. `audit_log`
7. `facts`
8. `briefings` + `preview_briefings`
9. `memories`
10. `priorities`, `tasks`
11. `undo_log`, `event_dedupe_keys`, `delete_confirm_tokens`
12. `users`

**Gap to address before launch:** There is no self-service user deletion flow yet.
Users must contact the owner to request deletion. A `DELETE /api/account` endpoint
(user-initiated, confirmed via `delete_confirm_tokens`) should be added before
public launch to satisfy Google's deletion requirement and good-faith privacy
commitment.

### Google token revocation

When a user disconnects their Google account (`DELETE /api/calendar/disconnect`),
`calendar_tokens` is deleted. However, we do not currently call the Google token
revocation endpoint (`accounts.google.com/o/oauth2/revoke`). This should be added
for proper OAuth hygiene — token revocation ensures Google-side access is also
terminated.

**Action item:** Add `fetch('https://oauth2.googleapis.com/revoke?token=<accessToken>')`
in the disconnect flow in `lib/calendar.ts` (Core lane).

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
`format:'metadata'` API parameter, which returns only email headers (From, Subject,
Date) and Gmail's own auto-generated snippet — no message bodies are fetched or
stored. Only INBOX threads from the past N days (≤50) are accessed. The derived
signal is used in-memory for AI analysis and immediately discarded. We record the
fetch action (thread count only) in our audit log for user transparency.

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
  described features. We never call `messages.send`; we never perform an inbox-wide
  scan.

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
| 7 | Dashboard → Disconnect Google → account settings. Show Google's own revoke page. | (data deletion) |

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
- [ ] Self-service user deletion endpoint (`DELETE /api/account`) — currently
      admin-only deletion; CASA assessors will check this.
- [ ] Google token revocation call in disconnect flow (see §4 above).
- [ ] Privacy policy accurately describes all scopes and data use (see `app/privacy/page.tsx`).
- [ ] Demo video (§6 above) recorded and uploaded.
- [ ] This document reviewed by the user for accuracy before submission.

**Assessor contact:** https://developers.google.com/identity/protocols/oauth2/production-readiness/casa

---

*Last updated: 2026-06-13. Owner: PM/CTO. Route accuracy questions to Security lane.*
