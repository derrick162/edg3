# Spec — Briefing V2: proactive, goal-driven, relational chief of staff

_From Derrick's 10/10 call feedback, 2026-06-14 (see `CALL-FEEDBACK.md`)._

## Problem
Today's briefing reports + reacts. A 10/10 briefing is **proactive** — it completes pending
commitments, drives the user's goals into free time, encourages based on recovery, looks ahead,
and engages with personal events. Below, each capability + where it lives.

## Capabilities (each is a behavior change; mostly prompt, two need data/infra)

1. **Recovery → motivating encouragement, tied to real events.** On good recovery (green), don't
   just say "you're recovered" — encourage pushing hard on the specific event on the calendar
   (e.g. the storage-locker block) and connect it to sleeping well tonight. _Prompt (briefing.ts
   + vapi.ts); builds on existing recovery pacing._

2. **Encourage a hard workout toward the strain goal.** Good recovery + a gym block → encourage a
   hard session aimed at beating the user's **strain goal**. _Needs the strain goal stored as a
   fact (Derrick's = ">10"). Until stored, generic "push for a strong session"; once stored,
   name the number._

3. **★ Complete unfinished commitments first (biggest trust-builder).** If Edge committed to an
   action on a recent call that never completed (e.g. "move gym 11→2" that failed repeatedly),
   the next briefing should OPEN with it: "I noticed I never moved your gym — doing that now,"
   then actually do it. _Needs infra: track committed-but-incomplete actions across calls
   (a `pending_actions` concept, or detect failed/aborted tool calls + carry them forward).
   This is the meaty part — coordinate Core + Security (action/audit log)._

4. **Proactively fill free slots with goal-aligned work + ACT on yes.** Find the first open slot
   and propose using it for a stated priority ("1–2pm after lunch for your 30-60-90 plan?"). On
   yes → create immediately, no re-ask. _Partly exists (priority blocking); extend to scan free
   slots + offer choices among goals._

5. **Offer choices among the user's goals for free time.** After gym (3pm+): energy-management
   work OR the 130lb goal (grocery/protein run)? Let the user pick. _Prompt; uses stored
   priorities/goals._

6. **Nutrition awareness for weight goals.** With a weight goal (130lb), ask forward-looking
   nutrition Qs — "what's for dinner tomorrow?" _Prompt, gated on a weight/nutrition goal fact._

7. **Forward-look to tomorrow.** After today, pivot to tomorrow: surface the free afternoon and
   plan into it. _Briefing prompt; needs tomorrow's calendar (we already fetch a window)._

8. **Engage personal events warmly.** Notice birthdays/anniversaries/personal all-day events
   (e.g. "Dad's Birthday") → acknowledge, ask what they're doing, offer to help (draft a message,
   block time, research a gift). _Prompt; pairs with the all-day-not-a-conflict handling._

## Suggested sequencing
- **Quick prompt wins (low risk):** #1, #4/#5, #7, #8 — tighten the briefing + live prompt to be
  proactive, forward-looking, goal-driving, and relational. Keep it concise (prompt is already large).
- **Needs data (user tells Edge / store facts):** #2 strain goal, #6 dinner/nutrition goal.
- **Needs infra (real build):** #3 pending-commitment memory — the highest-trust item; design a
  way to carry incomplete committed actions to the next call and resolve them first.

## Owner
🛠️ Core (briefing.ts + vapi.ts + the pending-actions infra), with 🔒 Security on the
action/audit-log side for #3. Update `CALL-FEEDBACK.md` themes as pieces ship.
