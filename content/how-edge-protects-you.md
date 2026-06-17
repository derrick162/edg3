# How Edge Protects You
_Page copy v1, June 2026. For Cam to render as a standalone trust page. Coordinate with Vijay (Security) to verify technical accuracy before publishing._

---

## Page purpose

This page is for users who want to go deeper than the FAQ. It's not a legal document — it's a plain-English commitment. It exists because trust isn't a checkbox; it's built over time through transparency.

Audience: design partners and early users with higher-than-average privacy awareness — founders, execs, people who've been burned by data misuse before.

---

## Hero

**Headline:**
> Edge handles sensitive data. Here's exactly how we protect it.

**Sub-headline:**
> Your calendar, your inbox, your energy data. You're trusting Edge with the real stuff. We take that seriously — and we want to show you, not just tell you.

---

## Section 1 — What Edge can see (and what it can't)

### Your calendar
Edge reads your events to understand your schedule and writes changes when you approve them. That's the foundation of everything.

What Edge sees: event titles, times, locations, attendees.
What Edge doesn't do: store your calendar events in our database. They're fetched live from Google and processed in memory — nothing is retained after the call.

### Your inbox (if you connect Gmail)
Edge scans your inbox for signals: urgent threads, financial or legal notices, replies from people you've contacted. It doesn't read your emails — it reads about your emails.

Technically: Edge uses Gmail's `format:metadata` API parameter, which returns only the From address, Subject line, and Gmail's own auto-generated snippet (~100 characters). Message bodies are never requested or transmitted to our servers.

What gets stored: subject lines only, encrypted with AES-256-GCM, for 90 days. Visible only to you in your Activity tab — so you can always see which threads Edge reviewed. Senders, snippets, and bodies are never stored.

What Edge never touches: newsletters, promotions, automated notifications, attachments, sent mail, drafts, spam.

### Your energy data (if you connect Whoop)
Edge reads your daily recovery score and sleep data. This is read-only — Edge never writes anything to Whoop.

Whoop health data gets an extra layer of protection: stored with the same AES-256-GCM encryption as everything else, but treated with additional care given its sensitivity. You can disconnect Whoop at any time and your health data is removed from our systems.

### Your call transcripts
Every morning call is transcribed. Edge uses the transcript to remember what you said, learn your preferences, and follow up on commitments. Transcripts are encrypted at rest and accessible only to you — the Edge team cannot read them without your explicit permission.

---

## Section 2 — How your data is protected

### Encryption at rest
Everything sensitive is encrypted before it's written to our database using AES-256-GCM — a standard used by financial institutions and healthcare providers. Each value gets its own random initialization vector so even identical values encrypt differently.

What's encrypted: all OAuth tokens (Google + Whoop), call transcripts, Gmail draft metadata, Whoop health tokens, notification content, inbox thread subjects, stored facts containing personal information.

### Encryption in transit
All data travels over HTTPS/TLS. There are no unencrypted routes.

### You're the only one who can see your data
Your call transcripts, inbox subjects, and stored facts are user-scoped at the database level — a query for your data literally cannot return another user's data, not because we trust ourselves, but because the schema enforces it.

The Edge team does not access individual user data except when diagnosing a technical issue — and only with your permission.

---

## Section 3 — What Edge does with your data

**Edge uses your data to make Edge work for you. Full stop.**

- We do not sell your data.
- We do not share your data with advertisers.
- We do not use your data to train AI models for other users.
- We do not share your Google data with any third parties beyond what's required to deliver the product (Google's own APIs, Vapi for calls, Anthropic for AI reasoning).

This is not a "we won't do this unless legally compelled" carve-out. It's a product principle: the moment Edge's value depends on monetizing your data rather than serving you, the product has failed at its core purpose.

---

## Section 4 — You're always in control

### Disconnect any source
Go to Settings → Connections. Disconnect Google, Gmail, or Whoop at any time. Edge stops accessing that source immediately. Reconnecting is always an option.

When you disconnect Google, we call Google's token revocation API — your authorization is removed at Google's end, not just in our database.

### See everything Edge knows
Your dashboard has a "What Edge knows" tab showing every fact Edge has learned about you — your focus areas, preferences, people you've mentioned, and insights from your calls. Nothing is hidden. You can correct or delete any fact.

### Delete your account
Go to Settings → Account → Delete my account. Confirm with a phrase. Every record associated with your account — profile, call history, facts, tokens, email signals, health data — is permanently deleted. The deletion is immediate and irreversible.

We retain nothing after deletion. There is no "we'll keep it for 30 days just in case" window.

---

## Section 5 — Third-party services

Edge uses these services to function:

| Service | What it does | Their privacy policy |
|---|---|---|
| **Google** | Calendar read/write, Gmail read, OAuth | [Google Privacy Policy](https://policies.google.com/privacy) |
| **Vapi** | Powers the morning voice call | [Vapi Privacy Policy](https://vapi.ai/privacy) |
| **Anthropic** | AI reasoning (Claude) | [Anthropic Privacy Policy](https://www.anthropic.com/privacy) |
| **Whoop** | Recovery + sleep data | [Whoop Privacy Policy](https://www.whoop.com/privacy-policy/) |
| **Railway** | Hosting infrastructure | [Railway Privacy Policy](https://railway.app/legal/privacy) |
| **Twilio** | Outbound phone calls | [Twilio Privacy Policy](https://www.twilio.com/legal/privacy) |

Your data passes through these services to deliver the product. We do not authorize them to use your data for any other purpose.

---

## Section 6 — Google OAuth verification

Edge's use of Google Calendar and Gmail has been submitted for Google's OAuth verification review. Restricted scopes (calendar write, Gmail read) require Google's independent assessment before unrestricted use.

What this means for you: until verification is complete, Edge operates under Google's test-user policy. Design partners are added as test users manually. This is a bureaucratic process, not a product limitation — the security is the same either way.

We'll update this page when verification is complete.

---

## Section 7 — Questions

If something here doesn't add up, or you want to understand a specific data practice in more detail:

**Email:** hello@edg3.ai  
**Response time:** within 24 hours for beta users

We don't have a privacy team with a 30-day SLA. You'll hear from Derrick.

---

_Technical accuracy: Vijay (Security) to verify §1–4 before publishing. Cam to render as `/privacy-trust` or as a tab within the existing privacy page. Legal review recommended before public launch._
