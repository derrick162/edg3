# Wave-2 Readiness Checklist
_Before inviting user #6. Not a checkbox exercise — each item is a real risk if skipped._

Wave-1 is white-glove: Derrick is present for every activation, ready to fix anything within hours. Wave-2 is semi-scaled: the product has to carry more weight, onboarding is less hand-held, and you're learning to step back. This checklist confirms you're ready to make that shift.

---

## Product gates (all must be green)

- [ ] **4/5 wave-1 users are at day-7 with ≥4 calls/week.** If fewer than 4 are retained, fix the retention problem first. Adding users to a leaky bucket doesn't help.

- [ ] **No open trust-breaking bugs.** Any Edge fabrication, wrong-name error, or invented data that occurred in wave-1 must be fixed and confirmed fixed. Not "workaround identified" — fixed.

- [ ] **The hero loop card is populating for at least 3/5 wave-1 users.** If it's still empty for most users (Ticket H), wave-2 users will have the same experience. Don't scale an empty card.

- [ ] **Priority derivation feels accurate for at least 3/5 wave-1 users** (confirmed on day-7 check-in). If the derivation is consistently missing the mark, you're inviting more users to a misaligned first impression.

- [ ] **Trust features are shipped (T1 fact correction, T2 inbox receipts, T3 undo toast).** These are the features that let users fix mistakes themselves without texting Derrick. Required before wave-2 because you won't be as available for every correction.

---

## Operational gates (all must be green)

- [ ] **The onboarding flow works end-to-end without Derrick present.** Test it yourself with a fresh account. Can someone activate, connect calendar, see derived priorities, and get to first call without intervention?

- [ ] **Twilio is cleared for production calls.** If you're still using workarounds for wave-1 (manual Vapi triggers), this must be resolved before inviting 10 more people. Twilio support response should be received and acted on.

- [ ] **You have a bug triage system.** Not Derrick's phone. A way to log, prioritize, and route bugs that doesn't require your personal attention 24/7. Even a simple Notion table is fine.

- [ ] **You have at least 1 strong testimonial from wave-1.** This becomes the first line of the wave-2 invite. "One founder told me: '[quote]' — want to try it?" converts significantly better than a cold invite.

---

## Content gates (all must be green)

- [ ] **The design partner guide is accurate.** `content/design-partner-guide.md` — does it reflect the current product? Any screens that changed in wave-1 should be updated before wave-2 users read it.

- [ ] **The wave-2 invite copy is written.** Not "I'll adapt the wave-1 invite." Write it explicitly. Wave-2 users should feel like they're getting access to something that's already working, not still being tested.

---

## What changes in wave-2

**Activation:** you're still doing the T+30 welcome call, but you'll be doing it 10 times over 2–3 weeks instead of 5 times over 2 weeks. Start using the scripted version (`content/design-partner-welcome-call-script.md`) — it should be consistent now.

**Support cadence:** wave-1 = "text me anything anytime." Wave-2 = "text me for bugs; use the dashboard for fact corrections; weekly check-ins are my window to dig deeper." Set this expectation on the welcome call.

**Feedback collection:** use the structured check-in scripts (`day-7`, `day-14`). You're no longer learning what the product does — you're looking for patterns across users. Does the same type of user respond the same way? That's ICP signal.

**Invite pacing:** wave-2 invites should be spaced 2–3 days apart, not same-day. Let each user stabilize before adding the next. You want to be able to give them attention if something breaks.

---

## The wave-2 invite

Once you have a wave-1 testimonial:

**DM or text (personal, not email):**
> "Hey [name] — been running a closed beta of Edg3 for the last few weeks. One of the founders I'm working with said '[quote from wave-1 testimonial].' I'm opening up 5 more spots. Want to try it?"

If they say yes:
> "Great — I'll send you the signup link and walk you through it personally. It takes about 20 minutes to set up."

Wave-2 users should feel like they're getting something that already works, not joining a test. That requires having the testimonial first.

---

## Wave-3 threshold (for reference)

Wave-3 = 15–25 users, near-public. Do not start wave-3 until:
- 30-day retention is at ≥70% across both wave-1 and wave-2 (users still calling at 30 days)
- The product runs independently for 72 hours without a bug requiring Derrick's intervention
- Google CASA review is submitted or in progress (required to scale past ~100 users)
- Pricing is decided and communicated on the signup page

---

_See also: `content/first-10-users.md` for the full 3-wave plan. `content/beta-weekly-health-check.md` for the weekly signal that feeds this gate check. `content/testimonial-capture-guide.md` for the testimonial needed to unlock wave-2 invites._
