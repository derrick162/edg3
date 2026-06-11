# Spec: Forward-to-Book (email → calendar, no Google scope)

> **Status:** Captured / scoped — **NOT yet greenlit to build.** Top post-validation
> candidate. Build only after the core loop is validated on a real call (see ROADMAP).
> **Origin:** User (Derrick) workflow pain, 2026-06-10 — "I booked a hotel on Expedia,
> the confirmation is in my inbox, I want to flag it and have Edge put it on my calendar."
> **Decision:** Approach **B (forward-to-Edge)** chosen over A (Gmail-read) — see below.

## The magic moment
You forward a booking/confirmation email (hotel, flight, restaurant, appointment) to a
personal Edge address. Seconds later it's on your calendar — correct dates, location,
confirmation number — and Edge confirms it. No retyping. "Flag it" = "forward it," a
gesture people already do.

This is one instance of a broader capability — **"email → action"** — which also covers
the reply-tracking feature. Worth treating as a capability, not a one-off.

## Why Approach B (forward-to-Edge), not A (Gmail-read)
| | A. Edge reads your inbox | **B. Forward-to-Edge (chosen)** |
|---|---|---|
| Permission | `gmail.readonly` (Google **restricted** scope) | **None** |
| Launch gate | Google **verification + CASA** (multi-week) — same long pole already blocking reply-tracking | **None** — ships to all users immediately |
| "Flag" UX | Edge scans inbox / a label | User **forwards** the email |
| Privacy story | Edge can read all mail | Edge only sees what you explicitly forward |
| New infra | — | **Inbound-email service** (Postmark / SendGrid) + a subdomain |

B trades a Google-verification dependency (weeks, out of our control) for inbound-email
infra (days, in our control) — and is *more* privacy-respecting. Clear win for v1.

## Architecture / flow
1. **Per-user forward address.** Each user gets a unique, secret alias, e.g.
   `book-<random-token>@inbound.edg3.app`, shown in their dashboard settings. We identify
   the user by the **alias** (the token), NOT the spoofable `From` header.
2. **Inbound-email provider** (recommend **Postmark Inbound** — reliable, signed webhooks;
   alt: SendGrid Inbound Parse) receives mail to that subdomain and POSTs the parsed
   message (from, to, subject, text/html body, attachments) to a new webhook.
3. **`POST /api/inbound/email`** (new, ⚠️ Shared):
   a. **Verify** the request is genuinely from the provider (signature/secret) — reject otherwise.
   b. **Identify the user** from the recipient alias token. Unknown alias → drop.
   c. **Extract** structured event(s) from the (often forwarded/nested) email body via Claude:
      `{ type: 'hotel'|'flight'|'reservation'|'appointment'|'other', title, start, end,
        allDay, location, confirmationNumber, notes }`. Handle multi-event (flight
      outbound+return; hotel check-in→check-out as an all-day span).
   d. **Create** the calendar event(s) via the existing `createCalendarEvent` path
      (reuse idempotency + undo). Dedupe by confirmation number / content hash so the same
      forward twice doesn't double-book.
   e. **Confirm back**: in-app notification ("Added 'Hotel X, Jun 25–28' to your calendar")
      + optionally a reply email; optionally surface in the next briefing.

## Lane ownership
- **🔒 Security** — inbound infra + integrity: the provider account + secret/API key
  (`INBOUND_EMAIL_*`), webhook signature verification, the per-user alias generation +
  secret, rate-limiting + abuse handling. Owns the *auth/integrity* of `/api/inbound/email`
  (analogous to the Vapi webhook). New external credential.
- **🛠️ Core** — behavior: the Claude extraction (email → structured event), calendar
  creation (reuse `createCalendarEvent`), the confirmation/notification + briefing surfacing,
  and the settings UI that shows the user their forward address. Owns the extraction→calendar
  logic in `/api/inbound/email`.
- **⚠️ Shared** — `/api/inbound/email` (Security: integrity/auth; Core: extraction→calendar),
  `lib/db.ts` (per-user alias column; ingested-email log for idempotency/audit).

## Trust & safety (non-negotiable)
- **Honest, conservative extraction.** Low-confidence parse → create a **tentative** event
  AND notify ("I think you booked Hotel X Jun 25–28 — added it; tap to fix"), or ask rather
  than silently booking wrong. Never fabricate dates/locations not in the email.
- **Idempotency** — dedupe by confirmation #/hash; reuse `claimEventCreate`.
- **Undo** — every auto-created event is undoable (reuse the undo_log).
- **Abuse** — only process mail to a valid user alias; rate-limit per user; ignore /
  low-confidence non-confirmation mail (don't junk the calendar).
- **Attachments** — v1: text/HTML body only. PDF itineraries (common for flights) = v1.1.

## External setup (the gating ops step — do before building)
- Pick + provision the inbound provider (Postmark Inbound recommended).
- A subdomain for inbound (e.g. `inbound.edg3.app`) with **MX records** pointed at the
  provider. DNS + provider config is the real lead-time item (hours, not weeks).

## Open decisions
- Provider: Postmark vs SendGrid (recommend Postmark).
- Address shape: `book-<token>@inbound.edg3.app` (per-user secret) — confirm.
- Confirmation channel: in-app notification only, or also reply-email?
- Auto-book vs confirm-first for low-confidence parses (recommend: auto-book high-confidence,
  notify-to-confirm low-confidence).

## Sequencing & effort
- **Gate:** build AFTER the core loop is validated on a real call. This is a strong *branch*,
  not the core loop.
- **Effort:** ~2–4 dev-days once the provider + subdomain MX are set up. Infra setup
  (provider account + DNS) is the external pre-req.
- **Why it may jump the queue:** unlike reply-tracking, it ships to ALL users with **no
  Google verification wait** — a rare "magic moment we can launch without the long pole."
