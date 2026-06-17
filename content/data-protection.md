# How Edge protects your data
_Security-engineer draft — route to Esther for copy polish before publishing._

---

## The short version

Edge only stores what it needs to do its job. Everything sensitive is encrypted. You can see everything, correct anything, and disconnect any time. No data is sold or used for training without your explicit permission.

---

## You control how your data is used

When you set up Edge, you choose one of two settings — and you can change it any time in Settings:

| Setting | What it means |
|---|---|
| **Help improve Edg3** | Your calls, transcripts, and edits may be used to evaluate and improve Edg3's features and AI. |
| **Privacy Mode** | Your data is used **only to power your own experience**. It is never used for training or improvement, and never shared with any third party beyond the services required to run Edge (Google APIs, Vapi for calls, Anthropic for AI). |

Edge's memory — your goals, relationships, patterns, decisions — is deep and personal. The privacy setting makes that boundary real, not just a promise.

---

## What Edge remembers (and why)

Edge is a Chief of Staff with memory. It needs to remember context to do its job. Unlike a simple chatbot, Edge deliberately builds up a picture of your life — so it can give you better advice, not just answer questions. What it stores:

- **Goals and priorities** — what you're working toward this week, this year
- **Facts about you** — your work style, key relationships, ongoing projects
- **People** — important contacts, their context, what you've discussed
- **Patterns** — what makes your weeks productive or draining
- **Call notes** — a record of your daily briefings and what was decided

All of this is stored encrypted. You can see it, correct it, and delete it at any time from the "What Edge knows" tab.

---

## What's encrypted at rest

Every piece of sensitive data stored on our servers is encrypted using **AES-256-GCM** — the same standard used by banks and healthcare systems. This includes:

- Your Google Calendar and Gmail access credentials (OAuth tokens)
- Your Whoop health tokens (recovery, sleep, strain data)
- Call transcripts and briefing notes
- Memory notes (call insights, profile context)
- Facts Edge has learned about you (your goals, preferences, priorities)
- Email draft recipients and subjects logged in your activity history
- The email subject lines Edge reviewed during inbox scans
- Notification messages sent to your dashboard
- Daily focus plans and open loop descriptions generated for you

"Encrypted at rest" means that even if someone gained unauthorized access to our database, they would see random bytes — not your data.

---

## What Edge can and can't access

| Source | What Edge can do | What Edge can't do |
|---|---|---|
| **Google Calendar** | Read events; create, move, delete events you ask for | Access other Google accounts; read anything outside your calendar |
| **Gmail** | Read thread subject lines + auto-generated snippets; create drafts | Read message bodies; send email; access other accounts |
| **Whoop** | Read recovery score, sleep, and strain data | Write anything back to Whoop |

Edge never reads email bodies. It never sends email — only creates drafts for you to review and send. Calendar changes only happen when you explicitly say yes on a call.

---

## What's stored and for how long

| Data | Retention |
|---|---|
| Call transcripts | Until you delete your account |
| Memory and facts Edge has learned | Until you delete them or your account |
| Inbox subject lines | **90 days**, then automatically cleared |
| Activity log | **90 days**, then pruned |
| OAuth tokens | Until you disconnect the source |

Inbox subject lines have a shorter retention than other data because they're the most privacy-sensitive — they give a window into your correspondence. After 90 days, the record of "N threads reviewed" stays for your Activity feed, but the individual subject lines are cleared.

---

## User-scoped data (no cross-user leakage)

Every database query in Edge filters by your user ID. There is no query that can return another user's data. This is enforced at the application layer on every endpoint, not just at the UI.

Specifically for inbox receipts: even if you somehow obtained another user's audit entry ID, the API returns 404 — it checks that the entry belongs to your account before decrypting anything.

---

## What you can do

- **See everything Edge knows**: "What Edge knows" tab in your dashboard
- **Correct any fact**: click the edit icon next to any fact in that tab
- **Delete any fact**: click the delete icon (priority-linked facts update via the Priorities tab instead)
- **Change your data-use setting**: Settings → Privacy → switch between Privacy Mode and Help improve Edg3
- **See which emails Edge reviewed**: expand any "Read N inbox threads" row in the Activity tab
- **Disconnect any source**: Settings → Connections → disconnect Google or Whoop instantly
- **Export your data**: Settings → Account → Export (includes your current privacy setting)
- **Delete your account**: Settings → Account → Delete — immediate and irreversible

---

## What we don't do

- We do not sell your data. Ever.
- We do not use your data to train AI models without your explicit opt-in (the "Help improve Edg3" setting).
- We do not share your data with third parties except the services needed to run Edge (Google APIs, Vapi for calls, Anthropic for AI).
- We do not access your data ourselves except to diagnose a technical issue — and only with your permission.

---

_Reviewed by Security (Vijay), June 2026. Route to Esther for final copy before launch._
