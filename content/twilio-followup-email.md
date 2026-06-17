# Twilio Follow-Up Email
_Send from derrickfung87@gmail.com or derrick@edg3.ai. Send today (June 18, 2026)._

---

## Context

Twilio A2P registration was submitted previously. No response received. This email follows up
and escalates. The outbound calling capability is blocked until Twilio approves.

---

## The email

**To:** support@twilio.com (or the contact from the original submission confirmation)
**Subject:** Re: A2P registration — follow-up on pending application [include your case/ticket # if you have it]

---

Hi Twilio team,

I'm following up on my A2P (Application-to-Person) registration submitted on [submission date].
I haven't received an update on the status and wanted to check in.

**Application summary:**
- Company: Edge / Delta Edg3 Inc.
- Use case: Outbound voice calls to consenting registered users of a B2B SaaS product. Users opt in during account creation and set their preferred call time.
- Calling pattern: One call per user per day, at a time the user specifies. Not bulk marketing — each call is a personalized AI briefing for a single user.
- Expected volume: <50 calls/day to start (beta users); growing with user base

The calls are made via Vapi (our voice AI infrastructure). Each user explicitly consents to receiving calls when they sign up and can turn them off at any time from their settings.

Is there anything additional you need from me to move the application forward? I'm happy to provide documentation, answer questions, or jump on a call.

Thank you,
Derrick Fung
Founder, Edge
derrick@edg3.ai
[Phone number]

---

## If no response in 48 hours: escalation options

**Option 1 — Twilio business support**
Call Twilio's sales/business line directly. Your use case (B2B SaaS, consenting opt-in users,
<100 calls/day to start) is extremely standard and should not be blocked. Ask to speak with
someone in the carrier compliance team.

**Option 2 — Alternative carriers**
If Twilio continues to stall, Vapi supports other telephony providers. Consider:
- **Vonage (now Ericsson)** — similar A2P registration process; known for faster business support
- **Bandwidth** — US carrier, direct relationships, good for B2B use cases
- **Plivo** — fast approval for consenting B2B calls; good developer experience

These all integrate with Vapi. Switching carriers would require updating the Vapi settings,
not changing the Edge codebase.

**Option 3 — Manual first calls while waiting**
Vapi lets you trigger a call manually from the dashboard. For the first 2–3 design partners,
Derrick can manually initiate each call while Twilio clears. Not scalable, but buys time for
the first wave.

---

_This is a hard dependency — no outbound calls without it. Send the follow-up today._
