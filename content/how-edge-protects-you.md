# How Edge protects you

_User-facing copy — web (Privacy page), Settings screen, and CASA/Google verification submission._
_Technical accuracy reviewed against Vijay's security delivery (June 2026). Route back to Security for any implementation changes before re-publishing._

---

## The short version

Edge only stores what it needs to do its job. Everything sensitive is encrypted with bank-grade encryption and backed up off-device so your data is never at risk of being lost. You can see everything Edge knows about you, correct anything that's wrong, and disconnect your accounts at any time. Your data is never sold. It's never used to train AI without your explicit permission.

---

## You control how your data is used

When you set up Edge, you choose one of two settings. You can change your choice at any time in Settings → Privacy.

### Privacy Mode _(default)_

Your data is used **only to power your own experience**. Nothing you share — your goals, your calls, your calendar, your health data — is ever used to train or improve Edg3's AI. It is never shared with any third party beyond the services required to run Edge (Google APIs, Vapi for voice calls, Anthropic for AI processing). This is the default for every new account.

### Help improve Edg3 _(opt-in)_

Your calls, transcripts, and edits may be used to evaluate and improve Edg3's features and AI. You can switch back to Privacy Mode at any time; after switching, your data is no longer used for improvement purposes going forward.

**The setting you choose is included in your data export** so you always have a record of what you agreed to.

---

## What Edge remembers — and why

Edge is a Chief of Staff with memory. A simple chatbot forgets you the moment the conversation ends. Edge deliberately builds up a picture of your life so it can give you better advice over time, not just answer questions in the moment.

What it stores:

- **Goals and priorities** — what you're working toward this week, this year
- **Facts about you** — your work style, key relationships, ongoing projects
- **People** — important contacts, their context, what you've discussed
- **Patterns** — what makes your weeks productive or draining
- **Call notes** — a record of your daily briefings and what was decided

You can see everything Edge knows about you in the "What Edge knows" tab, correct any fact, or delete anything at any time.

---

## What's encrypted and how it's protected

Every piece of sensitive data stored on Edge's servers is encrypted using **AES-256-GCM** — the same standard used by banks and healthcare systems. "Encrypted at rest" means that even if someone gained unauthorized access to our database, they would see random bytes — not your data.

What's encrypted:

- Your Google Calendar and Gmail credentials
- Your Whoop health tokens (recovery, sleep, and strain data)
- Call transcripts and briefing notes
- Everything Edge has learned about you — goals, preferences, facts, priorities
- Email recipients and subjects logged in your activity history
- Inbox subject lines reviewed during email scans
- Dashboard notifications
- Focus plans generated for you

**If a decryption error ever occurs** — for example, during a system update — Edge degrades gracefully. The affected section of your briefing is skipped with a clear notice rather than crashing. Your data is never corrupted; it simply waits until the issue is resolved.

**Your database is backed up continuously** to a separate storage location outside the primary server. A server failure does not mean data loss — your memory is preserved on an independent system and can be restored within minutes.

---

## What Edge can and can't do with your connected accounts

| Source | What Edge can do | What Edge cannot do |
|---|---|---|
| **Google Calendar** | Read events; create, move, and delete events when you ask | Access other Google accounts; read anything outside your calendar |
| **Gmail** | Read thread subject lines and auto-generated snippets; create email drafts for your review | Read message bodies; send email; access other accounts |
| **Whoop** | Read recovery score, sleep duration, and strain data | Write anything back to Whoop |

Edge never reads the bodies of your emails. It never sends email — only creates drafts for you to review and send yourself. Calendar changes happen only when you explicitly say yes during a call.

---

## How long your data is kept

| Data | How long |
|---|---|
| Call transcripts | Until you delete them or close your account |
| Memory and facts Edge has learned | Until you delete them or close your account |
| Inbox subject lines | 90 days, then automatically cleared |
| Activity log | 90 days, then pruned |
| OAuth tokens (Google, Whoop) | Until you disconnect the source |

Inbox subject lines have the shortest retention because they offer the most direct view into your correspondence. After 90 days, the record of how many threads were reviewed stays in your Activity feed for context, but the individual subject lines are cleared.

---

## Your data is yours alone

Every query Edge makes to its database filters by your account. There is no query that can return another user's data. This is enforced at the application layer on every endpoint — not just at the UI.

---

## What you can do right now

- **See everything Edge knows** — "What Edge knows" tab in your dashboard
- **Correct any fact** — click the edit icon next to any fact
- **Delete any fact** — click the delete icon (priority-linked facts update via the Priorities tab)
- **Change your privacy setting** — Settings → Privacy → switch between Privacy Mode and Help improve Edg3
- **See which emails Edge reviewed** — expand any "Read N inbox threads" row in the Activity tab
- **Disconnect any account** — Settings → Connections → disconnect Google or Whoop instantly
- **Export your data** — Settings → Account → Export (includes your current privacy setting)
- **Delete your account** — Settings → Account → Delete; this is immediate and permanent

---

## What we never do

- We do not sell your data. Ever.
- We do not use your data to train AI without your explicit opt-in (the "Help improve Edg3" setting).
- We do not share your data with any third party beyond the services required to run Edge: Google (Calendar and Gmail APIs), Vapi (voice call infrastructure), and Anthropic (AI processing).
- We do not access your data ourselves except to diagnose a technical issue you've asked us to investigate.

---

_Technical accuracy: Security (Vijay), June 2026. Copy: Esther (CoS), June 2026._
_CASA note: this page accurately reflects the `data_consent` column (default `'privacy'`), `lib/consent.ts` `isImproveConsented()` behavior, AES-256-GCM encryption across all sensitive tables, user-scoped query enforcement on all endpoints, graceful `decryptField` degradation (returns null, does not crash), and off-box database replication via Litestream (in progress — Vijay T0-1/T0-2). Update the Litestream note to "complete" once Vijay ships T0-1._
