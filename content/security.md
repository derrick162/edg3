# How We Protect Your Data

Edg3 is designed to handle sensitive personal information — your calendar, health data, financial context, and private commitments. Here is an honest account of what we do to keep that information secure.

---

## Encryption at rest

Sensitive fields in our database are encrypted using AES-256-GCM, an authenticated encryption standard that also detects tampering. This covers:

- **Calendar and Whoop OAuth tokens** — your credentials for Google Calendar and Whoop are never stored in plain text.
- **Call transcripts and your responses** — everything you say during your morning briefing is encrypted before it touches disk.
- **AI-extracted facts** — when Edge learns something about you ("prefers deep work before noon"), that note is encrypted at rest.
- **Open loops and commitments** — extracted items like "Follow up with CIBC by Friday" are encrypted.
- **Daily focus areas** — Edge's morning focus recommendations for you are encrypted.
- **Email draft metadata** — recipient names, subjects, and context notes are encrypted.
- **Reply-tracking threads** — watched thread metadata (recipient, context) is encrypted.

Encryption is controlled by a `DATA_ENCRYPTION_KEY` environment variable stored securely on our hosting platform. If the key is not set, the app does not silently write plaintext — it either no-ops (in development) or hard-fails (when `STRICT_ENCRYPTION=1` in production).

Existing plaintext values (written before encryption was enabled) decrypt transparently — no data loss during rollout.

---

## Passwords

We use **bcrypt with a cost factor of 12** to hash passwords. Bcrypt is specifically designed to be slow, making brute-force attacks computationally expensive. We never store your actual password.

---

## Session security

When you log in, Edg3 creates a signed JWT (JSON Web Token) using a secret key that never leaves our server. Your session cookie is:

- **HttpOnly** — JavaScript on the page cannot read it (prevents XSS token theft).
- **Secure** — only sent over HTTPS in production (never over plain HTTP).
- **SameSite=Lax** — blocks cross-site request forgery (CSRF) on state-changing requests.

Sessions expire automatically after 30 days. You can log out at any time to invalidate your session immediately.

---

## OAuth — no password storage

When you connect Google Calendar or Whoop, Edg3 uses the standard OAuth 2.0 flow. We never see or store your Google or Whoop password. We only store the access tokens that Google/Whoop issue to us, and those tokens are encrypted at rest (see above).

**We only request the permissions we actually use:**

- `calendar.events` — to read, create, move, and delete events on your behalf
- `gmail.readonly` — to check whether people have replied to emails you drafted through Edg3 (metadata only — we never read email bodies)
- Whoop read scopes — recovery, sleep, and strain data only

You can revoke Edg3's access to Google or Whoop at any time from the dashboard or directly from your Google/Whoop account settings.

---

## Data minimization

**We do not store email content.** When checking for replies, we only read email metadata (sender, subject, snippet). No email bodies are ever fetched or stored.

**We store what we need for the product to work, nothing more.** Specifically:

- Calendar data is fetched live from Google — we do not cache or store your calendar events.
- Whoop health data (recovery score, sleep duration, strain) is fetched on demand and not persisted beyond what's needed for the briefing.
- Open loops, facts, and memories are kept because they make Edge smarter over time. You can delete them at any time.

---

## Retention and automatic deletion

We automatically prune data we no longer need:

- **Reply-tracking threads** — deleted after 30 days once handled or dismissed.
- **Open loops** — resolved or dismissed items are deleted after 30 days.
- **Call briefings** — retained so you can review them, but you can delete your account and all associated data at any time.

---

## We never sell or share your data

Edg3 does not sell your personal data. We do not share it with advertisers or data brokers. Your data is used exclusively to provide the Edg3 service to you.

Data is shared only with the third-party services that power the product (Google Calendar, Whoop, Vapi for phone calls, Anthropic for AI), and only to the extent necessary for those services to function. All of these providers are GDPR-compliant.

---

## Rate limiting

All public endpoints are rate-limited to block brute-force attacks and abuse:

- Login: 10 attempts per 15 minutes per IP
- Signup: 5 per hour per IP
- Open calls: 5 per 5 minutes per user
- Admin endpoints: separate, tighter limits

Rate limiting uses a fixed-window counter stored in our database — no third-party service required.

---

## Audit logging

Every calendar mutation (event created, moved, edited, deleted) is written to an append-only audit log. This lets you see exactly what Edge did on your behalf, and powers the "Recent Activity" feed in your dashboard.

Webhook authentication events from our calling provider (Vapi) are logged separately so any attempted tampering is visible to us.

---

## Admin access

Our admin panel is protected by:

- A separate admin password (stored as an environment variable, never in the database).
- Constant-time password comparison to prevent timing attacks.
- An HMAC-derived session token in the admin cookie (the raw password is never stored in the cookie).
- Rate limiting on the admin login route.

---

## Backups and durability

We take automated SQLite snapshots daily. Backups are rotated (14 copies kept) and can be integrity-checked at any time. We are transparent that these backups live on the same server volume — off-site replication is on our roadmap.

---

## Secret handling

All secrets (JWT signing key, Google OAuth credentials, Whoop client credentials, Vapi secrets, encryption key) are stored as environment variables on our hosting platform (Railway). They are never committed to source code or logged.

Our calling provider (Vapi) authenticates each incoming webhook using a shared secret sent in a request header. We verify this on every request and log mismatches.

---

## Your rights

**Export:** You can download a full copy of your data at any time from Account Settings → Export my data. The export includes your profile, priorities, memories, facts, tasks, briefings, and email draft history.

**Deletion:** You can permanently delete your account and all associated data from Account Settings → Delete account. This removes all your data from our database immediately and irrevocably.

For questions or concerns: derrickfung87@gmail.com
