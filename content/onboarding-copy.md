# Edge — Onboarding Copy
_First-run narrative v2. Incorporates priority derivation (Core shipped `lib/priorityDerivation.ts`).
For Cam's onboarding flow. Last updated: June 18, 2026._

---

## Design principle

The onboarding has one job: get the user to their first "whoa" moment as fast as possible. That
moment is when Edge tells them something true about themselves that they didn't have to explain.

Every screen before that is friction. Every screen after it is momentum.

Minimum friction. Maximum payoff. The user should feel understood, not processed.

**New in v2:** Core shipped priority derivation — Edge can analyze 6+ months of calendar history
and infer what the user has actually been spending time on, before they type a single word.
The Clarity reveal now surfaces these derived insights. This is the "whoa."

---

## Screen 1 — Welcome

**Headline:**
> Meet Edge.

**Body:**
> Your AI chief of staff. He learns how you work, organizes your calendar around what actually
> matters, and makes sure your energy goes toward the right things.
>
> Not another app to maintain. He calls you every morning and takes care of it.

**CTA:** Get started →

**Design note:** Full-bleed, dark, minimal. The Edge wordmark only. No feature list. No bullet
points. Trust the headline.

---

## Screen 2 — Connect your calendar

**Headline:**
> First, let's see your week.

**Body:**
> Edge works by reading your calendar — not just what's scheduled, but what it means. This
> takes 30 seconds and unlocks everything.

**Sub-copy (trust):**
> Edge reads your events to understand your schedule. It never modifies your calendar without
> your approval. You can disconnect at any time.

**CTA:** Connect Google Calendar →

**If already connected:**
> ✓ Calendar connected.

**Design note:** One thing on this screen. No distractions. The connect button is the only CTA.

---

## Screen 3 — Connect additional sources (optional)

**Headline:**
> The more Edge knows, the more accurate he gets.

**Body:**
> Each connection makes your mornings more useful. Connect what you have — skip what you don't.

**Cards:**

---

**Gmail (recommended)**
> Edge scans your inbox for urgent threads, financial signals, and important replies — so
> nothing critical gets buried. He reads subject lines only. Never message bodies.
>
> *Connect Gmail →*

**Whoop**
> Edge reads your recovery and sleep scores to understand your energy each day — and adjusts
> what he recommends based on how you're actually doing.
>
> *Connect Whoop →*

---

**Skip line:** You can add more later. Even with just your calendar, Edge is ready to start.

**CTA:** Continue →

---

## Screen 4 — Edge shows what it already sees (NEW — priority derivation)

_This screen is NEW. It appears after the user connects their calendar, before they set focus
areas. Edge has already analyzed their calendar history and derived what they've been spending
time on. Show the insight first — then ask them to confirm or adjust._

**Headline:**
> Edge has been watching your calendar. Here's what it sees.

**Body (dynamic — generated from `/api/priorities/derive`):**

_If calendar history ≥ 4 weeks (most users):_

> Based on your last [N] months of calendar history, here's what Edge thinks you've been
> prioritizing:
>
> **[Derived priority 1]** — [N] hours/week on average · [evidence: "recurring meetings with X", "blocks labeled Y"]
>
> **[Derived priority 2]** — [N] hours/week · [evidence]
>
> **[Derived priority 3]** — [N] hours/week · [evidence]
>
> *Are these right? Edge will use these as your starting point.*

**Confirm / Adjust buttons:**

**[These look right →]** — accepts derived priorities; moves to Screen 5 (Clarity reveal)

**[Let me set my own →]** — moves to Screen 4b (manual focus area entry)

---

_If calendar history < 4 weeks or insufficient data:_

> Edge needs a bit more calendar history to derive your priorities — it'll do this after your
> first few calls. For now, tell Edge what you're working toward.

[Skip directly to Screen 4b]

---

**Copy note:** The derived priorities use plain language from calendar event titles and patterns —
not abstract labels. "Fundraising prep" if that's what shows up, not "Goal 1." The more specific,
the better the "whoa."

---

## Screen 4b — Your focus areas (manual / confirmation)

_Shown either as the primary step (thin calendar) or after "Let me set my own →" on Screen 4._

**Headline:**
> What are you actually working toward?

**Body:**
> Edge organizes your time around your top priorities — not your task list, not your inbox,
> but the things that actually matter to you right now. They can be professional, personal,
> or both.

**Input fields:**
- Priority 1 (e.g. "Extend runway", "Get to 135 lbs", "Build calm work capacity")
- Priority 2
- Priority 3

**Sub-copy:**
> Don't overthink it. Edge will help you refine these on your first call.

**CTA:** These are my priorities →

---

## Screen 5 — The Clarity reveal (the "whoa" moment)

_This is the emotional peak. Edge shows what it already knows — from the calendar, inbox,
Whoop, and the priorities just set. It should feel like meeting someone who's already read
your file._

**Headline:**
> Here's what Edge already knows about you.

---

**Body (dynamic — multiple variants):**

### Variant A — Calendar + Gmail + Whoop + priorities derived

> Before your first call, Edge has already done some work.
>
> **From your calendar:** You have [N] events this week. [Focus area priority 1] has
> [X hours / no protected time] — [honest 1-line diagnosis].
>
> **From your inbox:** [N] threads may need attention, including [1 specific example if
> urgent signal exists — e.g., "a message from [sender type] that's been waiting [N days]"].
>
> **From your Whoop:** Your 7-day recovery average is [score]. [One-line honest read —
> e.g., "You've been running below 50% — Edge will factor that in before suggesting
> anything demanding."]
>
> **Based on what Edge sees:** Your biggest focus gap right now is **[priority with least
> calendar time]**. Your first call will address it.
>
> **Your Edge Score: [N]** — [one-line honest diagnosis]

---

### Variant B — Calendar + Gmail, no Whoop

> Before your first call, Edge has already done some work.
>
> **From your calendar:** You have [N] events this week. [Priority 1] has [X hours /
> no time yet]. [Priority 2] has [better coverage]. Your schedule is [honest read].
>
> **From your inbox:** [N] threads scanned. [0–1 specific urgent signal if exists.]
> Nothing critical missed in the last 48 hours.
>
> **Your Edge Score: [N]** — [honest one-liner]
>
> Connect Whoop after your first call to add the energy layer.

---

### Variant C — Calendar only, priorities confirmed from derivation

> Before your first call, Edge has already done some work.
>
> **From your calendar:** [N] events this week. Edge has been watching your schedule
> for [N] months — you've averaged [X] hours/week on [derived priority], [Y] hours on
> [priority 2].
>
> **Gap:** [Focus area] has [no scheduled time / less than 1 hour] this week — well
> below the time you've committed to it in past weeks.
>
> **Your Edge Score: [N]** — [one-liner]
>
> Connect Gmail and Whoop to give Edge the full picture.

---

### Variant D — Thin data (new account, sparse calendar)

> Edge is ready to learn. Your first call is where it starts.
>
> In the meantime, your Edge Score is warming up. It'll be more accurate after a week of
> calls.
>
> One thing Edge already knows: **[focus area 1]** has no protected time on your calendar
> this week. First call, first fix.

---

**Sub-copy (all variants):**
> This is just the start. Edge gets sharper every morning.

**CTA:** Schedule my first call →

---

**Design note for Cam:** Make the specific insights bold or visually highlighted —
the event title, the email sender type, the priority name. The user should be able to scan
and see three true things about themselves in under 5 seconds. If it reads like a template,
redo it.

---

## Screen 6 — Schedule your morning call

**Headline:**
> When should Edge call you?

**Body:**
> Your morning call is 5–10 minutes. Edge opens with what matters today, proposes one or two
> changes to your calendar, and asks you one question to stay on track. Pick a time you can
> actually answer.

**Time selector:** [default 7:30 AM]

**Sub-copy:**
> Monday through Friday, Edge calls at this time. You can change it in Settings anytime.
>
> Tip: most people find calls between 7–8:30 AM work best — before the day gets away from you.

**CTA:** Set my call time →

---

## Screen 7 — You're set

**Headline:**
> Edge is ready for tomorrow.

**Body:**
> Your first call is at **[time] tomorrow**. Between now and then, Edge will finish reviewing
> your calendar and preparing — so he can open with something real.
>
> In the meantime, your dashboard is live. Your Edge Score is already running.

**Secondary copy (if Whoop or Gmail not connected):**
> You can connect [Whoop / Gmail] anytime from Settings to give Edge more to work with.

**CTA:** Go to my dashboard →

**Design note:** Quiet, confident. No confetti. No fanfare. Edge is matter-of-fact. The
celebration is tomorrow morning when the call happens.

---

## First-call framing (in-app pre-call card)

_Shown on the dashboard home tab for users who have never had a call. Replaces the idle state._

**Headline:**
> Your first call is tomorrow at [time].

**Body:**
> Edge will open with what he already sees in your calendar and ask one question about your
> week. Say yes to at least one thing he proposes — that's how you know it's working.

**Sub-copy:**
> He'll call your phone at [time]. Just pick up.

**What to expect (expandable):**
> 1. Edge tells you what he sees — what's on your calendar, what gap stands out
> 2. He proposes one concrete change (usually a focus block or a reschedule)
> 3. You say yes or no — he executes it if yes, asks for more context if no
> 4. He closes with one commitment: what's the one thing you'll have done by tomorrow?
>
> That's it. The first call takes about 8 minutes.

---

## Error / edge case copy

**Calendar connection failed:**
> Something went wrong. Try again or skip and connect later in Settings — Edge needs your
> calendar to work, but the setup can wait a few minutes.

**No focus areas entered:**
> Edge works best with priorities set. You can start without them, but your first call will be
> more specific if you add three now.

**Priority derivation unavailable (thin calendar):**
> Edge needs a bit more history to derive your priorities — it'll do this automatically as
> your calendar builds up. For now, tell Edge what you're working toward.

**Call time conflict:**
> You have something at [time] on [day]. Want to pick a different slot, or keep it and Edge
> will schedule around it?

**Whoop not connected:**
> No Whoop — Edge will check in on your energy at the start of each call instead. Connect
> Whoop anytime in Settings.

**Late timezone (after 11 AM):**
> It's already past morning. Edge will schedule your first call for tomorrow — pick a time
> that works for your typical morning.

---

## Tone notes for Cam

- Edge is "he" throughout — consistent brand voice, not a robot
- Never say "AI," "algorithm," "data," or "system" in user-facing copy
- "Data" should never be the subject: not "your data is safe" but "Edge reads your calendar
  and never shares it"
- The Clarity reveal (Screen 5) is the emotional peak — give it visual weight and specificity.
  Not a permissions list. A moment of: *"Edge already sees me."*
- Screen 4 (priority derivation reveal) is the new "whoa" moment for users with calendar history.
  Make the derived priorities look like real insight, not a data dump.
- Onboarding should feel like meeting a sharp person who's already done their homework —
  not installing software
