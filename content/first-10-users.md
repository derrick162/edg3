# Edge — First 10 Users Plan
_Concrete plan from 0 to 10 paying users. Last updated: June 18, 2026._

---

## The goal

Not 10 signups. Not 10 activated accounts. **10 users who have had a morning call for at least
7 consecutive days.** That's the signal — habitual use, not one-time novelty.

Why 10 specifically? It's the minimum viable number to start seeing patterns:
- At least 2–3 will reveal the same friction point → that's a real bug
- At least 1–2 will have a "wow" story → that's the testimonial + positioning validation
- At least 1 will churn in week 1 → that's the learning

---

## The constraint: sequential, not simultaneous

The biggest mistake would be inviting 10 people at once. You can't support 10 simultaneous
first-week experiences. You'll miss signals, fail to fix problems, and damage word-of-mouth
with low-quality early experiences.

**The rule:** Don't invite user N+1 until user N has had 3 successful calls.

This means the first 10 users take roughly 3–4 weeks at 2–3 users per week. That's intentional.

---

## The funnel (per user)

```
Derrick identifies candidate → personal message sent → yes received →
signup link sent → onboarding complete → activation moment seen →
first call → 3 calls → design-partner check-in → 7 days → wave success
```

Each step has a pass/fail:
- **Personal message sent → yes received:** If no response in 5 days + 1 follow-up, move on
- **Signup link sent → onboarding complete:** If they don't complete onboarding in 48h, one nudge
- **Onboarding → first call:** If they set up but don't take the first call, one message
- **First call → 3 calls:** If they miss day 2 or 3, one check-in message

---

## The 10 users in 3 waves

### Wave 1 — Design Partners (users 1–5)
**Focus:** Product validation, not growth. Every person is known to Derrick personally.

**Source:** Derrick's personal network, matched to ICP archetypes.
See `content/design-partner-outreach-kit.md` for the 5 archetype slots.

**Gate:** Twilio live + onboarding flow testable + T1/T2 trust UI shipped

**Timeline:** July 2026
**Success criteria:** 4 of 5 still having daily calls at day 7

---

### Wave 2 — Warm Referrals (users 6–8)
**Focus:** Can Edge work for people who aren't Derrick's close friends?

**Source:** The 2–3 design partners who had the best experience in wave 1.
Ask them: "Is there one person in your network who'd get value from this?"

**Why this works:** A warm referral from a trusted peer has the highest conversion and
retention. User 6 says "my friend Derrick built this thing, I use it every morning, here's
the link" — that's as warm as it gets.

**Gate:** At least 3 wave-1 users are still active at day 14 with positive signals

**Timeline:** Mid-July 2026
**Who to ask for referrals:** The user who said the most spontaneously positive thing after week 1.
Don't ask skeptics. Don't ask anyone who seems unsure.

---

### Wave 3 — Waitlist Invites (users 9–10)
**Focus:** Cold-to-warm conversion. Does Edge work for people who found it without Derrick
personally vouching?

**Source:** The live waitlist (already collecting signups at `/api/waitlist`). Pick the first
two people who signed up and who match the ICP criteria.

**Gate:** At least 5 of the first 8 users are still active at day 7; onboarding is frictionless

**Timeline:** Late July / early August 2026

**How to invite from the waitlist:**
- Pull the email from the waitlist DB
- Send a personal email from Derrick (not automated): "Hey — you signed up for early access to
  Edge. We're ready for you. Here's how to get started."
- If they signed up more than 2 weeks ago: acknowledge it: "I know you've been waiting — we
  wanted to get it right before inviting you."

---

## The conversation cadence for all 10 users

### Immediately after sign-up
> Personal message from Derrick: "You're all set. Edge will call you tomorrow at [time]. If
> anything doesn't work, text me directly."

### Day 1 post-call (within 2 hours)
> "How'd that go?"

### Day 3 (if active)
> Nothing — don't over-message. Let them use it.

### Day 7 check-in
> "It's been a week — I'd love to know what's working and what isn't. Can we jump on a 20-minute
> call this week?"

### Day 14 check-in
> "Checking in — anything Edge has done that surprised you, good or bad?"

### Day 30 NPS
> "On a scale of 1–10, how likely are you to recommend Edge to a friend? No pressure, just honest."

---

## What to track per user

| User | Signed up | Onboarded | First call | Day-7 active | Day-14 active | Week-4 score | Notes |
|---|---|---|---|---|---|---|---|
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |
| 4 | | | | | | | |
| 5 | | | | | | | |
| 6 | | | | | | | |
| 7 | | | | | | | |
| 8 | | | | | | | |
| 9 | | | | | | | |
| 10 | | | | | | | |

_Keep this updated in a simple spreadsheet or Notion table. The pattern across 10 users will
tell you everything you need to know about what to fix for wave 2._

---

## The 10-user success definition

At the end of wave 1–3, you've succeeded if:

1. **≥7 of 10** users are still having morning calls at day 14
2. **≥1 testimonial** — unprompted positive quote you can use (with permission)
3. **≥1 thing you fixed** based on real user feedback (not something you invented)
4. **≥1 referral request** — someone asked "can I tell my friend about this?"
5. **The founding story is validated** — at least one ICP 1 (ADHD founder) who said something
   approximating "this is exactly what I needed"

If all 5 are true, you have the foundation for a broader launch.

---

## What failure at this stage looks like and what to do

**Failure mode 1: Low first-call completion rate**
- More than 2 users sign up but don't take a first call
- Root cause: Twilio, onboarding friction, or misaligned expectations in the invite message
- Fix: Call them manually, simplify onboarding, rewrite the invite framing

**Failure mode 2: High day-7 churn (more than 2 users ghost)**
- Root cause: the first call isn't delivering enough value
- Fix: Listen to 3 call recordings. The answer is in there.

**Failure mode 3: Flat Edge Score**
- Score doesn't move after 2 weeks for any user
- Root cause: hero loop proposals aren't credible (users aren't applying them)
- Fix: This is an engineering signal, not a user education problem. Route to Core.

**Failure mode 4: Positive feedback but no referrals**
- Users like it but don't tell anyone
- Root cause: they're not "wowed" enough to evangelize; or they don't know anyone else who fits
- Fix: Ask directly ("is there one person in your world who might find this useful?")

---

## The number that matters most

Of all the metrics you could track, this is the one:

**Day-7 retention rate.**

If ≥4 of the first 5 users are still having daily calls at day 7, you have something. If fewer
than 3 are, fix the product before inviting anyone else.

Everything else is secondary.

---

_Feeds `content/beta-launch-playbook.md` (the full wave-1 operational plan) and
`content/beta-feedback-loop.md` (the ongoing feedback cadence)._
