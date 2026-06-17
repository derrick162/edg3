# Day-7 Check-in Interview Script
_20 minutes. Video or phone. Run at day 7 ± 1 day from first call._
_Goal: determine if the habit is forming, catch any trust breaks, extract the sharpest product signal of the beta._

This is your most important conversation. By day 7, you have real data: either the calls are happening and something is landing, or they're not and you need to find out why. The script below is a research interview, not a sales call. Do not try to oversell.

---

## Before the call (2 min prep)

Check:
- How many calls have they had this week? (Vapi dashboard)
- Did they apply any day plans? (dashboard → activity)
- Any bug reports or texts from them this week?
- What did Edge surface as their priorities — do you know if those still feel right?

Come in knowing their number: "[name], looks like you've had 4 calls this week" — it shows you're paying attention.

---

## Opening (2 min)

> "Hey [name] — thanks for the 20 minutes. It's been a week since you started and I really just want to understand honestly what the experience has been like."

> "I'm going to ask a bunch of questions that might feel nitpicky — that's because I'm genuinely trying to figure out what's working and what isn't. Nothing you say is going to hurt my feelings. I'd rather know."

---

## Section 1 — Habit signal (5 min)

**"How has the morning call routine actually played out?"**

Listen for: natural (taking calls as scheduled), friction (missing occasionally but resuming), or disengaged (found reasons to skip after day 2-3).

**If they're taking calls consistently:**
> "What's it like when you pick up? What happens in those first 30 seconds?"

You're listening for: does it feel like a useful interruption or an awkward robot? Do they describe it with any warmth or just neutral reporting?

**If they've been skipping:**
> "When you skipped, what was it that got in the way — was it the time, something going on that morning, or something about the calls themselves?"

This is the most important question if retention is at risk. Probe until you understand whether it's scheduling or product.

**"Has it changed how you start your mornings at all?"**

Even a small change ("I look at my priorities before opening email now") is signal. "Not really" is useful data too.

---

## Section 2 — Trust and accuracy (5 min)

**"Has Edge said anything that felt wrong or made up?"**

Let them answer before you follow up. If yes:
> "Can you describe what happened? I want to understand if it was a one-time thing or something that's been recurring."

Log this regardless — it's bug data.

**"Has Edge ever said something that made you feel like it actually understood what was going on for you?"**

This is the inverse. You're listening for the "aha" moments. If they give you one — a specific quote or moment — this is testimonial material (see testimonial guide for how to capture it).

**"What about the priority derivation — do those three priorities still feel like they represent what you're actually working on?"**

If they say no: this is the most important product signal of the call. Probe: "What would have been more accurate?" — this tells you what the engine is reading wrong.

If they say yes but with nuance: "Which one feels the sharpest, and which feels most generic?"

---

## Section 3 — Day plan / hero loop (3 min)

**"Have you looked at the day plan after any calls? If so, did you ever actually follow it?"**

The target is at least 1 apply in the first 7 days. If the answer is no:
> "What would have made it feel worth acting on? Was it the tasks it was suggesting, or something about how they were framed?"

You're checking: empty card (Ticket H gap), low credibility ("felt generic"), or friction in the UI.

If they have applied a plan:
> "When you applied it, did it feel like it was tuned to your actual situation, or more like a reasonable template?"

---

## Section 4 — The honest assessment (3 min)

**"If you had to predict right now — are you going to keep taking the calls after this week?"**

Listen to the tone, not just the words. "Probably" with hesitation is different from "yes, it's become a habit."

**"What's the one thing that would make this noticeably more useful to you?"**

Don't offer suggestions. Let them answer from their own experience. This is often where the sharpest product insight comes from.

---

## Close (2 min)

> "This has been really helpful — I mean it. One thing I want to say: if you have a call that's particularly good or particularly off, text me that day. I'm paying close attention to what's working with the first users."

> "Next check-in from me will be around day 14 — that's where I want to know if this has started to feel like part of your routine versus a product you're testing."

---

## After the call — log in `content/beta-user-feedback.md`

Capture:
- Habit status: `forming` / `at-risk` / `disengaged`
- Trust rating: `high` / `medium` / `low` (did they report any errors?)
- Day plan apply count (from dashboard)
- Priority derivation: accurate / off (if off, note what was missing)
- One quote from the call (verbatim — for testimonial or product insight)
- Red flags: any concern they raised that wasn't already on your radar
- Immediate action required: yes/no — if yes, what and when

---

## Interpretation guide

| Pattern | What it means | What to do |
|---|---|---|
| Taking calls + has a specific "aha" moment | Product is working for this ICP | Capture testimonial, invite next user |
| Taking calls + "it's fine / informative" | Habit forming but not yet transformative | Continue; probe day-14 call for deeper signal |
| Inconsistent calls + "just been busy" | Scheduling problem, not product problem | Change call time, reduce friction |
| "I didn't feel like the calls were for me" | ICP mismatch or wrong framing at activation | Note ICP archetype + what missed; don't invite lookalikes yet |
| Priorities felt off | Derivation accuracy issue for this user type | Log derivation miss for Core (Darren); note what the engine would need |
| No day plan applies | Hero loop not landing (empty card or low credibility) | Check Ticket H status; give user interim workaround |

---

_See also: `content/beta-weekly-health-check.md` for the 3-number weekly signal. `content/testimonial-capture-guide.md` for capturing moments from this call. `content/beta-user-feedback.md` for per-user log._
