# Edge — Morning Brief: June 18, 2026
_What Derrick does today, in order. Written by Esther (CoS). 5 actions._

---

## What happened overnight

The engineering team shipped 1133 tests green. Content library is complete — everything you
need to launch wave-1 beta is written and committed. Kevin (PM) has dispatched the trust UI
tickets to Core and Design.

**What you need to do this morning** — five things, in order:

---

## 1. Push to Railway (2 minutes)

Run this in your terminal from `C:\Users\Derrick\edg3`:

```
git push origin master
```

This deploys everything that shipped overnight: the STT grounding fix (no more "Jim" when you
said "Gym"), the fact correction API, the hero loop deepening, all the Security hardening.
Until you push, your production app doesn't have any of it.

**Do this first, before anything else.**

---

## 2. Send the Twilio follow-up (5 minutes)

The email is written. Open `content/twilio-followup-email.md`. Copy the email. Send it to
Twilio support now.

This is your hardest launch dependency. Every day it waits is a day you can't do live calls.

If no response by Friday: escalate to their business support line or evaluate Vonage/Bandwidth
as alternatives (both work with Vapi; details in that doc).

---

## 3. Pick 5 names (15 minutes)

Open `content/design-partner-outreach-kit.md`. Five archetype slots. Put one name in each.

The templates are written. The criteria are defined. The only thing missing is the names.

Don't overthink this. You want people who:
- Know you personally
- Will actually use a morning call
- Will tell you when it's broken, not when you ask

When you have 5 names, the outreach is ready to go.

---

## 4. Record the CASA demo video (today or this week — no later)

Script: `content/google-casa-video-script.md`
Shot list: `specs/google-verification.md §6`

Under 5 minutes, screen-recorded, narrated. Shows all 4 Google OAuth scopes in use.

This unblocks your Google OAuth verification, which is required to grow past ~100 test users.
The earlier you submit, the sooner the 4–8 week CASA review clock starts.

---

## 5. Read the founding story drafts (10 minutes)

Open `content/founding-story-post.md`. Four drafts — A, B, C, and the new D.

Pick one. Rewrite any line that doesn't sound like you. Post it when the first design partner
says yes to the invite — not before.

Draft D is the recommended version: ~200 words, honest burnout + ADHD angle, strong close.
But your fingerprints need to be on it.

---

## What's not on today's list

- **Engineering tickets** — dispatched. Core and Design are working on T1 (fact correction
  UI), T2 (inbox receipts), T3 (undo toast). Nothing blocking.
- **Pricing** — needs a decision before wave 2, but you can run wave 1 free. Don't let pricing
  block outreach.
- **Google CASA submission** — you need the video first (item 4 above). Submit the same week.

---

## New content ready for your review

Full content library is committed to `content/`. This morning's additions:

| File | What it is |
|---|---|
| `content/beta-launch-playbook.md` | Full wave-1 operational plan: gates, funnel, journey, metrics |
| `content/launch-day-runbook.md` | Exact sequence for inviting each user, monitoring, 48h playbook |
| `content/demo-script.md` | 5-minute live demo + written pitch one-pager |
| `content/onboarding-copy.md` | Updated with priority derivation reveal (new Screen 4) |
| `content/icp-interview-guides.md` | Per-ICP discovery question sets |
| `content/icp-cheat-sheet.md` | 1-page triage cheat sheet for discovery conversations |
| `content/design-partner-outreach-kit.md` | 5 archetype slots + personalization angles |
| `content/positioning-messaging.md` | One-liner, trust wedge, why now, objections |
| `content/competitive-landscape.md` | Who else plays here and where Edge wins |
| `content/pricing-analysis.md` | 3 options with ICP fit + recommendation ($69/mo) |
| `content/first-10-users.md` | 3-wave plan, per-user funnel, tracking table |
| `content/google-casa-video-script.md` | Narrated demo script for all 4 OAuth scopes |
| `content/twilio-followup-email.md` | Ready-to-send follow-up + escalation options |
| `content/design-partner-guide.md` | "Your first week" reference for new users |
| `content/founding-story-post.md` | Now has Draft D (A+C combined, recommended) |
| `content/content-calendar-july-august.md` | 8-week LinkedIn + Twitter posting plan for Phase 2 waitlist |
| `content/external-comms-kit.md` | Advisor update template, journalist pitch, Product Hunt copy |
| `content/beta-user-feedback.md` | Per-user tracking template — create entries as design partners go live |
| `content/activation-moment-copy.md` | Screen-by-screen copy for the activation flow; waitlist handoff emails; funnel metrics |
| `content/beta-weekly-health-check.md` | 10-min Monday routine: 3 numbers + 5 questions + recovery scenarios |
| `content/testimonial-capture-guide.md` | When/how to ask for testimonials + what strong looks like + usage map |
| `content/design-partner-welcome-call-script.md` | 20-min T+30 call script: expectations, priority review, feedback loop setup |
| `content/day-7-checkin-script.md` | 20-min interview script: habit signal, trust, day plan, honest assessment |
| `content/angel-outreach-strategy.md` | Advisor warmup → intro requests → first investor call; pipeline tracker + timing |

---

_Today's five actions: push → Twilio email → 5 names → video → founding story pick._
