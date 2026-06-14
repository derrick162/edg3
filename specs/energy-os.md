# Edge — Focus × Energy (product vision)

_Crystallized with Derrick 2026-06-14._

## Mission (the why) — added 2026-06-14
> **Prevent burnout.** Edge keeps high-performers focused on the right things and spending their
> energy effectively — sustainably — so they don't run themselves into the ground. "Using your energy
> well" *includes resting*; protecting recovery and whitespace is core, not a footnote.
- **Founder-market fit:** Derrick has lived this (his own burnout journey + ADHD) — an authentic story
  and a moat competitors can't copy. (Narrative/GTM owned by the Chief of Staff.)
- **Why now / white space:** calendar tools optimize *logistics*, productivity tools optimize *output* —
  almost nothing optimizes for **sustainable energy**. That gap is the opening.
- **Guardrail:** frame as a **wellbeing/sustainability** tool, NEVER clinical/medical — no diagnosis or
  treatment claims (keep the existing "never make medical claims" rule in the call prompts).

## Positioning
> **Edge is the intelligent AI chief of staff that organizes your calendar around your *focus*
> and your *energy* — so you get more of what matters most done, without burning out.**

## ★ The magic moment (the hero loop) — added 2026-06-14
> You do a 3-minute call. Edge already knows your focus + energy. He opens with the diagnosis —
> *"Your focus score's a 6, energy's a 4; here's why"* — then *"here's what I'll change."* You do
> **as little as possible** (one "yes," maybe one tweak), and **your week is reshaped.** You hang up
> feeling lighter and more productive: *"whoa, that improved my week."*

The whole product exists to deliver this feeling. Design principle: **minimum user effort, maximum
calendar improvement, felt as relief.** Edge LEADS with specific proposals (not open questions),
executes on a single lightweight approval, and proves it worked by re-scoring ("focus went 6 → 8").
Trust is preserved by: read-back before executing, **one undo for the whole reshape**, and the
Activity log. Full build: `specs/calendar-scores.md` (the scores find what to change) + the hero-loop
roadmap item (propose-plan → one-yes → batch-execute the week as one undoable unit).

## ★ Ideal customer (ICP) — added 2026-06-14
**Core user: the high-performer at risk of (or recovering from) burnout — overwhelmed and already
calendar-driven.** They live by their calendar, it's full, and they're drowning in it — "I need help
managing this before it breaks me." Two views of the same person: *functionally* the overwhelmed power
user; *emotionally* someone protecting themselves from burnout.
- **Strong sub-segment: high-performers with ADHD.** Edge acts as external executive-function
  scaffolding — prioritization, time-blindness, decision fatigue, energy regulation — and the
  "do as little as possible, I'll handle the calendar" design removes the friction that kills ADHD
  follow-through. Large, loyal, growing, under-served.
- We optimize for **reorganizing / optimizing an existing rich calendar** (move, recolor, rebalance to
  focus + energy AND protect recovery), not for filling an empty one. The Focus/Energy scores require a
  substantive calendar to grade — which is exactly this user.
- **Secondary path:** a sparse-calendar user gets a "let's build it together" mode — supported, but not
  the hero experience we design around.

## The thesis (input → engine → outcome)
1. **INPUT.** You declare your **3 areas of focus** (+ each area's energy cost). Each day you give
   (or Edge auto-derives) your **energy** — red / yellow / green.
2. **ENGINE.** Edge continuously **adds / edits / deletes calendar events** so the calendar (a)
   *reflects and advances your areas of focus*, and (b) *adapts to your energy* day-to-day
   (high-focus work when energy's high; protect/defer when it's red). The calendar is the MEANS.
3. **★ OUTCOME (the point).** You **get more of your focus areas done — and you can see and feel it.**
   This is the success metric: progress on areas of focus. The OUTCOME is the END.

## The three layers — and where we stand

### Layer 1 — INPUT  (mostly built)
- 3 areas of focus = priorities ✓ (should be framed/elevated as "your 3 areas of focus").
- Energy-cost tag per focus area ✓ (Energy OS MVP).
- Daily energy signal red/yellow/green ✓ (Whoop-auto / dashboard / call).

### Layer 2 — ENGINE  (seeds built; needs to be fully proactive)
- Edge CRUDs the calendar ✓ (create/move/delete). Energy-driven day moves ✓.
- GAP: Edge should *proactively keep the calendar reflecting the focus areas* — notice a focus
  area with no time on it and block some; notice a red day and move high-energy focus work off it
  — without being asked. (This is the Briefing-V2 proactivity, now anchored to focus+energy.)

### Layer 3 — ★ OUTCOME / SCOREBOARD  (THE GAP — not built; the heart of the vision)
We measure nothing about whether the user is *advancing their focus areas*. Build:
- **Progress per area of focus**, two signals:
  - **Time invested** — hours of calendar events mapped to each focus area (the alignment engine
    already computes this) → "6h on fundraising this week."
  - **Milestones / "what done looks like"** — each focus area can have sub-goals the user checks off.
- **"Done" feels good** — checking off a milestone (or completing a whole area of focus) gives a
  satisfying, visible completion + a small celebration; Edge acknowledges it warmly on the next call.
- **A focus scoreboard** on the dashboard — your 3 areas of focus, progress on each (time + milestones),
  what's done.
- **Edge surfaces it on calls** — "you put 6 hours into fundraising — momentum"; "you haven't touched
  [focus area] in 5 days — want me to block time tomorrow?"; celebrates completions.
- **The metric we optimize:** focus-area progress (milestones done + time invested vs intended).

## ★ The proprietary engine — two scores that grade the calendar (added 2026-06-14)
Calendar management is the center of the product (add / move / delete / **color-code by energy**).
Edge's flagship capability: **scan the calendar and grade it with two 1–10 scores**, every day and
before every call. This is the differentiating IP — full spec in `specs/calendar-scores.md`.
- **Focus Score (1–10)** — does the calendar reflect the 3 areas of focus? (builds on `lib/alignment.ts`)
- **Energy Score (1–10)** — does what's booked match the user's energy? (builds on the energy signal + profile)
- **Loop:** scan → score → propose add/move/delete/recolor → re-score. The moat is the model quality +
  the closed reshaping loop.
- **Two new calendar capabilities this drives:** (a) **energy color-coding** (Google `colorId` → the
  calendar becomes a visual energy map); (b) **energy detection from the morning call** (infer
  red/yellow/green from the call transcript when the user doesn't state it; later, voice prosody).
- **Naming:** the dashboard "Scoreboard" holds both — **Calendar Fit (today)** = the two live Score
  gauges, and **Progress (over time)** = milestones + hours (the original Scoreboard).

## Honest read of what we built
We over-indexed on the **input + scheduling mechanics** (energy signal, energy-matched moves) and
under-built the **outcome** (am I getting my focus done?). The engine is real; the *scoreboard* —
the thing that proves the product works and feels rewarding — doesn't exist yet. That's the next build.

## Energy capture flow (DECIDED — unchanged)
One daily energy record per user `{ user_id, date, level, source }`, shared by call + dashboard.
On the briefing call: capture EARLY (after greeting, before plan). No Whoop → ask red/yellow/green;
Whoop present → state it + allow a subjective override that wins; already set today → don't re-ask.
Dashboard: one-tap setter writing the same record.

## NEXT MVP — the Focus Scoreboard (outcome layer)
1. **Areas of focus as first-class** — present the 3 priorities as "your areas of focus," each with
   its energy cost. (Reframe existing priorities UI.)
2. **Progress per area** — show time invested this week (from alignment) + optional **milestones**
   (add/check-off sub-goals per focus area). Additive schema (e.g. `focus_milestones`).
3. **"Done" + celebration** — checking off a milestone / completing an area feels good (visible
   progress, a moment of celebration). Edge acknowledges on the next call.
4. **Edge surfaces progress + nudges** in briefings/calls (momentum, neglected focus → offer to block).
- Lanes: 🛠️ Core (progress logic, milestones, briefing/call surfacing), 🎨 Design (the scoreboard +
  check-off + celebration feel), 🔒 Security (milestones schema, additive).

## Sequence
Focus Scoreboard MVP (outcome layer) → **★ Focus Score + Energy Score engine** (`lib/calendarScore.ts`,
the proprietary core) surfaced on call + dashboard → **energy color-coding** → **call-energy inference**
(transcript → later prosody) → **score-driven reshaping loop** → fully-proactive calendar shaping
(Briefing V2) → week-level optimization → energy forecasting → Oura. Positioning ("focus × energy chief
of staff") → Chief of Staff for messaging/onboarding/pitch.
