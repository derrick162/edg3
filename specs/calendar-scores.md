# Focus Score & Energy Score — the proprietary calendar-intelligence engine

_Decided with Derrick 2026-06-14. This is flagship, differentiating IP — a "spend real time, make it
proprietary" build, not a quick ticket._

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
