# CASA Self-Assessment — Edg3 Security Narrative
_Draft for Cloud Application Security Assessment submission. Source of truth: `app/privacy/page.tsx` and `content/how-edge-protects-you.md`. Review with Vijay before submitting._

---

## Application Overview

**Application name:** Edg3  
**URL:** edg3.ai  
**Description:** Edg3 is an AI Chief of Staff that delivers a personalized daily voice briefing. It integrates with Google Calendar and Gmail to surface the user's schedule and draft outreach emails; optionally with Whoop to incorporate recovery and health context. The application stores a structured memory of the user's goals, priorities, relationships, and patterns to make each briefing more accurate than the last.

**Data processed:** Google Calendar events (read + write on user request); Gmail thread metadata only (subject, sender, auto-snippet — never message bodies); Whoop recovery/sleep/strain (read-only); voice call transcripts; user-defined goals, priorities, and profile data.

---

## 1. What data we collect and why

### Google Calendar
- **Scopes used:** `https://www.googleapis.com/auth/calendar.events`
- **What we read:** Event titles, start/end times, attendees, and location fields from the user's primary and connected calendars.
- **What we write:** New events, event updates (title, time, location), and deletions — always at the user's explicit spoken instruction during a live briefing call. Edge never modifies the calendar autonomously.
- **Why:** To surface the user's schedule in their daily briefing and to carry out calendar changes the user asks for ("move my 2pm to 4pm," "add a gym block Tuesday morning").
- **Retention:** Calendar data is read at briefing time and not stored persistently except as part of the encrypted briefing transcript (which records what was discussed).

### Gmail
- **Scopes used:** `https://www.googleapis.com/auth/gmail.compose`, `https://www.googleapis.com/auth/gmail.readonly` (metadata-only — see note)
- **What we read:** Thread subject lines and the auto-generated snippet Google provides per thread. We never read message bodies.
- **What we write:** Email drafts only. We never send email — the user reviews and sends every draft themselves.
- **Why:** Draft creation enables the user to ask Edge to draft outreach emails during a call. Inbox metadata (subject/snippet) is used to compute the user's daily Focus score and to recognize replies to outreach Edge drafted.
- **Retention:** Subject lines are stored encrypted at rest (AES-256-GCM) in the user's activity log for 90 days, then automatically deleted. Senders and snippets are never stored.
- **Note on read scope:** We request `gmail.readonly` but process only metadata. We do not access, read, or store message bodies. This is enforced in code at `lib/gmail.ts` — the fetch uses `format: 'metadata'` with explicit header field restrictions.

### Whoop
- **Scopes:** Whoop OAuth, recovery/sleep/strain read-only
- **What we read:** Daily recovery score (0–100%), sleep performance, and strain. Never write anything to Whoop.
- **Why:** To factor the user's physical state into the morning briefing ("your recovery is 34% today — keep the morning lighter").
- **Retention:** Health metrics are fetched from the Whoop API at briefing time and not stored in Edg3's database. Only the OAuth token is stored (encrypted at rest).

---

## 2. How data is protected

### Encryption at rest
All sensitive fields in Edg3's database are encrypted using **AES-256-GCM** before storage. This is implemented in `lib/crypto.ts` using Node.js's built-in `crypto` module with a 256-bit key (`DATA_ENCRYPTION_KEY`) stored as a Railway secret.

Encrypted fields include:
- Google and Whoop OAuth tokens
- Call transcripts and briefing notes
- Extracted facts, goals, preferences, and priorities
- Email recipients and subjects in the activity log
- Dashboard notifications
- Episode records (encrypted call/calendar/email ground truth)
- Focus plans and energy logs

**Key custody:** `DATA_ENCRYPTION_KEY` is stored in Railway's secret management. Key rotation requires a re-encryption migration (documented in `content/encryption-key-rotation.md`). A missing or changed key causes `decryptField` to return `null` and log a diagnostic error rather than crashing the application.

### Encryption in transit
All traffic is served over HTTPS. Railway provides TLS termination. There is no HTTP fallback.

### Data isolation
Every database query filters by `user_id`. There is no query path that can return another user's data. This is enforced at the application layer on every API endpoint, not only at the UI.

### Access controls
- Passwords are stored as bcrypt hashes (never plaintext).
- Session tokens are short-lived JWT-style cookies (HTTP-only, secure, SameSite=strict).
- Admin routes require a separate admin password distinct from user credentials.
- Rate limiting is applied to all authentication and mutation endpoints (`lib/rateLimit.ts`).

### Database backups
The Edg3 database is SQLite hosted on Railway. Periodic local backups run via `lib/backup.ts`. Continuous off-box replication via Litestream → object storage is in progress (tracked as PILLAR-TRUST T0-1).

---

## 3. What users can do

Users have full control over their data:

- **See everything Edge knows:** "What Edge knows" tab in the dashboard shows all extracted facts by category. Users can correct or delete any fact.
- **Disconnect accounts:** Google and Whoop can be disconnected from the dashboard at any time. Disconnection immediately revokes token storage and terminates data access.
- **Export data:** Settings → Account → Export produces a full data export including facts, memories, call history, priorities, tasks, and the user's privacy setting.
- **Delete account:** Settings → Account → Delete permanently removes all user data within 30 days. This is irreversible.
- **Control improvement opt-in:** Users choose between Privacy Mode (data used only for their own experience, never for AI training) and Help Improve Edg3 (opt-in to allow their anonymized call data to be used for feature improvement). This setting is stored per-account and included in data exports.

---

## 4. What we never do

- We do not sell user data.
- We do not use user data to train or improve Edg3's AI without explicit opt-in (the "Help improve Edg3" setting).
- We do not allow humans to read user Google or Whoop data except to diagnose a technical issue the user has asked us to investigate.
- We do not transfer user data to third parties beyond the services required to run Edg3: Google (Calendar and Gmail APIs), Vapi (voice call infrastructure), Anthropic (AI generation), ElevenLabs (voice synthesis), Railway (hosting).
- We do not read email message bodies. Ever. This is enforced at the API call level in `lib/gmail.ts`.
- We do not send emails. Edge only creates drafts for the user to review and send.
- We do not write anything back to Whoop.
- We do not modify the user's calendar autonomously. Every calendar change requires explicit spoken confirmation during a call.

---

## 5. Third-party services and their role

| Service | Purpose | Data shared |
|---|---|---|
| **Anthropic** | AI generation of briefing content | Briefing context pack (memory, calendar summary, priorities) — no raw Google or Whoop data |
| **Vapi** | Voice call delivery and transcription | Phone number, call audio (for transcription) |
| **ElevenLabs** | AI voice synthesis | Briefing text to speak aloud |
| **Google** | Calendar and Gmail APIs | OAuth scopes as described above |
| **Railway** | Hosting, database, and secret management | All application data (encrypted at rest) |
| **Whoop** | Health data API | OAuth token; health data fetched on demand |

No analytics, advertising, or marketing platforms receive any user data.

---

## 6. Google API Limited Use compliance statement

Edg3's use of Google Calendar and Gmail data adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements:

1. **Use limited to requested features:** Google Calendar data is used only to surface the user's schedule in their briefing and to make calendar changes the user explicitly requests. Gmail data (subject/snippet metadata) is used only to compute Focus score and recognize replies to outreach Edge drafted.
2. **No advertising use:** Google user data is never used for advertising.
3. **No human access without consent:** No Edg3 employee or contractor accesses Google user data except to diagnose a technical issue at the user's explicit request.
4. **No transfer to third parties:** Google user data is not transferred to any third party except as required to run the service (Anthropic receives only a structured context pack, not raw Google data).
5. **No unrelated use:** Google user data is not used for any purpose unrelated to the features the user requested.
6. **Gmail specifics:** Edge creates drafts only (never sends). Inbox read access is metadata-only (`format: 'metadata'` with explicit header restrictions — bodies are never fetched). Subject lines are stored encrypted for 90 days in the user's own activity log, visible only to them.

---

_Draft: Kevin (PM/CTO), June 2026. Technical accuracy review: Vijay (Security). Sources: `app/privacy/page.tsx`, `content/how-edge-protects-you.md`, `lib/crypto.ts`, `lib/gmail.ts`, `lib/google-auth.ts`. Submit to CASA after Vijay confirms T0-1 (Litestream) and T1-4 (encryption audit) are complete._
