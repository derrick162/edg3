# Focus Score & Energy Score — the proprietary calendar-intelligence engine

_Decided with Derrick 2026-06-14. This is flagship, differentiating IP — a "spend real time, make it
proprietary" build, not a quick ticket._

## ✅✅ CURRENT MODEL (2026-06-15 — SUPERSEDES everything below) — ONE Edge Score, 3 components
**Edge Score (0–100) = a blend of three components, each shown in an expandable breakdown:**
1. **Focus** — *how focused are you?* = % of your working hours booked toward your focus areas
   (sourced from today's confirmed `daily_focus`, else most-recent priorities). drivers = which areas
   have time / are starved.
2. **Energy** — *how energized are you?* = a **weighted average of your Whoop SLEEP score + RECOVERY
   over the trailing ~7 days** (sleep weighted higher, e.g. 60/40, tunable). NOT calendar-energy
   matching anymore (too complex). `calibrating` when no Whoop data. drivers = "7-day sleep 78,
   recovery 62."
3. **Clarity** — *how clear a picture does Edge have of you?* (was "Intelligence/Memory" — renamed by
   Derrick) = connected sources (calendar/Gmail/Whoop) + accumulated facts/calls. drivers = actionable
   connect nudges ("Connect Gmail +20"). A growth flywheel: more inputs → clearer picture → Edge works
   better for you → higher score.
4. **Momentum** — *how consistently are you showing up?* = trailing 7–14 day engagement, hardware-free /
   calendar-derived: (a) completed morning calls, (b) confirmed focus areas / engaged with recommendations.
   Calibrating on day 1. Edge references it naturally ("Momentum's at 85 — you've shown up 6 of the last 7
   mornings"). drivers = streak / show-up rate.
- **Blend weights** tunable — start **Focus 30 / Energy 30 / Clarity 20 / Momentum 20**. No human-judgment layer.
- **Framing (Derrick):** the Edge Score is "how strong you're going to crush it" — a holistic readout of
  your state. A user who's told Edge a lot (Clarity) + shows up every day (Momentum) + has a focused,
  energized calendar (Focus + Energy) is set up to execute.
- The breakdown must be transparent (Derrick wants to see HOW each is calculated + inputs).
- Calendar-energy *matching* still happens in the PRODUCT (hero-loop reshape, color-coding via event
  energy-tagging) — it's just no longer how the Energy SCORE is computed. Score = your energy LEVEL;
  the reshape ACTS on it.

_Everything below is earlier/superseded history — kept for context._

## The idea
Edge's most important capability is to **scan the calendar and make a judgment** about how well it
serves the user. We quantify that judgment as **two scores, each 1–10**, recomputed every day (and
before every morning call):

- **Focus Score (1–10)** — *Does the calendar reflect the user's 3 areas of focus?* Low when focus
  areas have little/no scheduled time, when most time is unaligned, or when the mix doesn't match the
  user's stated priority ranking.
- **Energy Score (1–10)** — *Does what's booked match the user's energy?* Low when high-demand work
  sits in low-energy windows, when a red-recovery day is overloaded with hard work, or when peak
  windows are wasted on admin.

The scores are the **headline Edge reports on every call** ("Focus is a 6, Energy's a 4 — here's why,
want me to fix it?") and the top of the dashboard. The product loop becomes: **scan → score →
propose add/move/delete/recolor → re-score.** The moat is (a) the quality + explainability of the
scoring model and (b) the closed reshaping loop that actually raises the scores.

## Naming — resolved: unify (DECIDED 2026-06-14)
We already have the **Focus Scoreboard** (in flight) = the OUTCOME layer: progress over time
(milestones done, hours invested). The two new scores are different — they're a **point-in-time
quality grade of the schedule**, not progress. **DECIDED: unify them on one surface** (Derrick):

> The dashboard **Scoreboard** surface has two stacked halves:
> 1. **Calendar Fit (today)** — the two live gauges: **Focus Score** + **Energy Score** (1–10). "Is my calendar set up right?"
> 2. **Progress (over time)** — per-focus-area milestones + hours invested. "Am I actually getting it done?"

Keep Derrick's names (Focus Score, Energy Score) for the two gauges; "Focus Scoreboard" becomes the
umbrella surface that contains both halves.

## Scoring model (deterministic + explainable — no black box)
Each score returns `{ score: 1-10, drivers: string[], topFix: {...} }` so Edge can always say *why*
and offer the one change that helps most.

### Focus Score
Inputs: timed events (today + the week ahead), the 3 focus areas, the alignment classification
(`lib/alignment.ts` already maps events→focus area | unaligned + sums hours).
Components:
- **Coverage** — each focus area has *some* scheduled time; a focus area at 0h drags the score hard.
- **Aligned share** — % of meaningful work time mapped to focus areas vs unaligned/reactive time.
- **Protected focus blocks** — real deep-work blocks exist for the top areas (not just scattered minutes).
- **Balance vs intent** — distribution roughly tracks the priority ranking (P1 ≥ P2 ≥ P3).

### Energy Score
Inputs: today's energy level (red/yellow/green), the user's **energy profile** (peak/trough windows),
each event's **energy demand** (from priority `energy_cost` tags + light inference), today's calendar.
Components:
- **Demand↔window match** — high-demand work in high-energy windows (+), high-demand in a trough (−).
- **Load vs capacity** — total demand vs today's energy (a red day packed with hard work scores low).
- **Recovery protection** — on red/yellow days, lighter/admin work is forward and deep work deferred.

Both are pure, unit-tested, and **stored daily** so we get score *trends* (and can correlate
score → outcomes later).

## ✅ FINAL — KEEP IT SIMPLE (2026-06-15, Derrick — SUPERSEDES all score deliberation below)
The score is a **readout, not the product.** Punt the complexity (two-component blend, judgment layer,
the one-vs-two agonizing — all dropped/deferred). Decision:
- **ONE "Edge Score" (0–100)** = how well your calendar reflects your **focus** AND your **energy**.
  A simple blend of the focus measure (% of time on your 3 priorities) + the energy measure (calendar
  demands matched to your energy / Whoop). One number = "how well you're doing this week."
- **Still fix the energy half so it MEANS something** — (recovery/sleep availability) × (demand-match);
  never default to a fake 100; show "calibrating" on thin data.
- **The real product is the LOOP, not the score:**
  1. Edge **TELLS you your top 3 priorities** (fresh each week — `specs/focus-recommendation.md`).
  2. **Assesses** whether your calendar currently reflects those priorities.
  3. **Reshapes** the calendar to fit them, with **energy / Whoop as an input**.
  4. The **Edge Score** just reports how well you're doing.
- **Sequence:** focus-recommendation engine → one simple Edge Score (collapse the existing focus+energy
  scores into one number; fix the energy half) → the reshape loop (the hero loop).

---
_The sections below are superseded by the FINAL decision above — kept for history only._

## ★★ MVP SIMPLIFICATION (2026-06-14, Derrick) — supersedes the judgment layer for now
With only Derrick to train it, a human-judgment layer would just encode one person's preferences.
**Strip it for MVP; add it back when real users give feedback.** The MVP is purely quantitative:

- **Focus Score = % of working hours booked toward the 3 areas of focus.** `score = focusAlignedHours
  / totalWorkingHours * 100` (0–100). Working hours = the user's working window (profile/default
  9–6 Mon–Fri). `focusAlignedHours` from `lib/alignment.ts` (events mapped to a focus area). Fully
  deterministic + explainable. `drivers` = which areas have time / are starved; `topFix` = e.g.
  "fundraising has 0h — block some." **No human component.**
- **Energy Score = how well the calendar's energy demands fit the user's energy** — REQUIRES the new
  **per-event energy tagging** capability (below). 0–100.
- **Both scores are 0–100 (percentages)** — NOT 1–10. (Supersedes the earlier 1–10 framing.)
- **Score shape (MVP):** `ScoreResult = { score /*0–100*/, drivers[], topFix }`. (Drop
  quantScore/judgmentScore/weights — no blend in MVP.)

### ★ NEW capability — per-event energy tagging (prerequisite for the Energy Score)
Edge must understand every event. Classify each calendar event into:
- a **type** — meeting / meal / workout / deep work / admin / social / travel / personal / other, and
- an **energy demand** — high / medium / low (how much energy the event requires).
LLM classification over the event title (+ description/attendees/duration). **MVP: classify the week's
events on-demand in one batch LLM call** when computing the Energy Score (no storage dependency →
Core unblocked). **Fast-follow:** cache tags (Security `event_energy_tags` table keyed by user +
google_event_id, re-tag on title change) to avoid re-classifying. **This double-pays:** the same tags
power **energy color-coding** later. Then Energy Score = fit of the calendar's tagged demands vs the
user's energy level/capacity (red day overloaded with high-demand → low; high-demand in peak window →
good). `drivers` + `topFix` ("your hardest block is in your low-energy window — move it?").

## ★★★ EVOLUTION → ONE "Edg3 Score" with Focus + Energy as drivers (PROPOSED 2026-06-15, Derrick)
Two co-equal scores confused the user in practice (Focus read 0% while Energy read a meaningless 100%
side-by-side). Direction: collapse to a SINGLE headline number, with the dimensions as its breakdown.
- **Edg3 Score (0–100)** — the ONE number: "how set up for a focused, energized, sustainable day/week
  is my calendar?" Something to track and feel.
- **Breakdown (drivers, shown on expand):** Focus + Energy still computed, plus the single biggest fix.
  This PRESERVES the hero loop — Edge must still say WHY it's low + WHAT to change. Mental model:
  WHOOP recovery / credit score — one number, factors underneath. (Do NOT throw the dimensions away.)
- **Blend:** start simple (average or a light Focus/Energy weighting), tunable later. NOT a return of
  the deferred human-judgment layer.
- **★ Redefine the ENERGY component** (today it defaults to a meaningless 100): Energy =
  *(how much energy you have — recovery/sleep availability)* × *(how well the calendar matches it —
  demanding work in high-energy windows, not overloading low-recovery days)*. When inputs are thin
  (no recovery, no energy profile, sparse calendar) → show **"calibrating"/low-confidence, NEVER a
  fake 100.** This energy-definition fix is needed REGARDLESS of the one-vs-two structure.
- **Status:** PROPOSED — recommended structure = "one Edg3 Score + Focus/Energy breakdown." Confirm
  with Derrick before the rework (scoring has iterated several times today; lock it to avoid churn).

## Two-component scoring (FUTURE — DEFERRED until multi-user feedback exists)
_Not MVP — see the simplification above. Kept for when real users can train the judgment half._
Pure hours are the easy ~20% of the truth; the valuable part is **judgment** — "more hours isn't
better; focused hours at the right energy are; an over-packed week wrecks sleep and sinks everything."
Encoding that operator/coach wisdom is harder to copy than hours math → **truer scores AND a deeper moat.**

**Every score = two halves, blended and shown transparently:**
1. **Quantitative half (deterministic):** coverage, aligned hours, balance (the components above).
2. **Judgment half (encoded expert wisdom):** adjusts the raw numbers by principles a seasoned chief
   of staff / coach knows. Generalizable rules to encode (v1, deterministic + explainable):
   - **Diminishing returns** — beyond a point more hours on a focus area stop helping (quality > volume).
   - **Right-energy timing** — focused hours in green/peak energy weigh more than the same hours in a red trough.
   - **Recovery & whitespace** — over-packed days / no gaps / late-night load → penalty (it costs sleep,
     which sinks everything else). The "too many gym events → can't sleep → won't hit the goal" case.
   - **Domain archetypes** — "what good looks like" differs by focus type (delegation/leadership ≠ deep
     work ≠ fitness ≠ fundraising); each archetype carries its own judgment rules.

**Blend weight:** start at **50% quant / 50% judgment** (Derrick's call) — but it's a **tunable dial**, not a constant.

**Score shape (extended):**
```
ScoreResult = { score, quantScore, judgmentScore, weights:{quant,judgment}, drivers[], topFix }
```
Both halves contribute `drivers` so the breakdown is always explainable (no black box).

### Human-assisted training loop (what keeps the judgment true)
- Edge shows the score **with its breakdown** (numbers + judgment + reasons).
- The human reacts ("too high — more board-prep hours isn't the point, focused green-energy hours are").
- Feedback **tunes the weights/rules** + builds a labeled dataset. Early = Derrick is the expert-in-the-loop;
  later = a seasoned-CEO advisor seeds the "expert playbook"; eventually real-user feedback + outcomes refine it.
- ⚠️ **Keep generalizable PRINCIPLES separate from PERSONAL tuning** (Derrick's prefs) so "good judgment"
  doesn't silently become "Derrick's preferences" — this is where overfitting-to-one-user concentrates
  (the strongest reason to get a 2nd ICP user in soon; flagged to CoS).

### Build phasing for the engine
- **MVP (now):** build the **two-component structure** (`computeQuantScore` + `computeJudgmentScore`,
  weighted blend, 50/50 default, weights as params). Judgment half = a **deterministic rules engine**
  encoding the top generalizable principles above. Fully explainable. Capture a hook for human feedback.
- **Later:** LLM-judge augmentation (bounded, reasoned adjustments only) + a real feedback-driven
  tuning loop + expert-advisor-seeded archetype playbook.

## New capabilities this unlocks (calendar management becomes central)
1. **Energy color-coding** — color events via Google Calendar `colorId` so the calendar becomes a
   visual energy map (peak = one color, trough = another), and mismatches are visible at a glance.
   Requires the energy profile (peak/trough windows). New action/tool to (re)color in a batch.
2. **Energy detection from the morning call** — infer the user's energy from the call itself, not
   just by asking. **DECIDED: transcript-first MVP** = LLM classify the call transcript →
   red/yellow/green + confidence, used **only when the user didn't explicitly state it**; writes
   `energy_log` with `source:'inferred-call'`; user override always wins. **v2 = voice/prosody**
   (the proprietary path) — full research + build plan in `specs/voice-energy.md`.
   **Calibration (build in from day one):** energy perception **calibrates over ~10 calls** (per-user
   baseline — scientifically required, see voice-energy spec). Show "Edge is learning your energy —
   call N of 10" until calibrated; don't act on a shaky read before then.
3. **Score-driven reshaping** — when a score is low, Edge proposes the specific add/move/delete/recolor
   that raises it most (`topFix`), and acts on yes.

## Energy precedence (updated)
explicit-statement-this-session > user dashboard override > **inferred-from-call** > Whoop auto > none.

## Lane split
- 🛠️ **Core** — `lib/calendarScore.ts` (the two scoring functions, pure + tested); call + dashboard
  surfacing; energy color-coding (`lib/calendar.ts` write + a `colorByEnergy` action/tool); call-energy
  inference (transcript classifier in the post-call pipeline); score-driven reshaping prompts.
- 🔒 **Security** — daily score history schema (additive); energy-profile storage (peak/trough) if not
  already clean; idempotency/audit for batch recolor (many event writes at once); privacy handling of
  inferred energy + transcript analysis.
- 🎨 **Design** — the two-gauge Calendar Fit visualization atop the Scoreboard; energy color legend;
  "why is my score a 6?" explanation UI.

## Sequencing
1. Land the **Focus Scoreboard** (in flight) — it's the home these scores live on top of.
2. **Scoring engine** `lib/calendarScore.ts` (Focus + Energy scores) → surface on call + dashboard. (Flagship.)
3. **Energy color-coding** (needs energy profile).
4. **Call-energy inference** (transcript MVP) → later prosody.
5. **Score-driven reshaping** loop (the payoff: Edge raises the scores for you).
