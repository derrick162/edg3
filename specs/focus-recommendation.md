# Focus recommendation engine — Edge TELLS you what to focus on

_Derrick "aha" 2026-06-15. Potentially the most differentiating piece of the whole product._

## ★★ UNIT = TODAY, not the week (Derrick 2026-06-15) — overrides "week" everywhere below
**Maniacally focus on the DAY at hand — forget the week.** A real chief of staff dissects *today*. Each
morning (call moving EARLIER, ~9:00 AM) Edge:
1. Reads **today's energy** — Whoop recovery + **how you sound on the call** (transcript/voice read).
2. Names your **3 focus areas for TODAY** (not the week), shaped by that energy.
3. **Reshapes today's calendar in real time** during the call — you give feedback, it acts.
- **Target: within ~5 minutes you think "wow, my day just got a lot better because of Edge."**
- History (calendar / memory / email) feeds WHAT matters; **today's energy + today's calendar** decide
  HOW today should go. No weekly-priority upkeep — recompute fresh every morning.
- (Read "week" below as "today"; the engine still mines long-range history for context, but the OUTPUT
  and the action are day-scoped.)

## ★★ The priority HIERARCHY (Derrick 2026-06-15) — reconciles day vs week
It's not day-OR-week — it's a hierarchy. The daily call is the obsession, but it HINGES on stable anchors.
- **Overarching priorities (STABLE, ~2, change rarely):** the most important things right now. Derrick's:
  (1) **Extend personal runway** — ship Edge to market to monetize; sell secondhand on Kijiji; review
  personal burn on Wednesdays. (2) **Get to 130 lb** — health → confidence → everything better.
- **Weekly tactics (derived, change week-to-week):** concrete sub-goals under an anchor. E.g., for 130lb
  this week: "eat 3000 cal/day", "join a local gym if traveling."
- **Daily focus (the magic moment):** each morning Edge picks **today's 3 focus areas** that LADDER UP to
  the anchors, modulated by today's energy + today's calendar, and checks whether today actually fits them
  — reshaping live. ("Forget the week" = don't make weekly *planning* the unit; the week survives as the
  tactical layer between anchors and daily execution.)
- **Maps to what we built:** overarching = the `priorities` store (treat as STABLE anchors w/ a strong
  "why", NOT weekly-reset); weekly tactics = `focus_milestones` under each; daily focus = the derived
  recommendation. Nothing wasted.
- **Edge recommends at the TOP too:** propose the overarching priorities from the data (history screams
  runway + health), confirmed rarely; then derive weekly tactics + daily focus from them.

## The flip
Today the user DECLARES their 3 areas of focus and Edge measures against them. **Flip it: Edge analyzes
your data and TELLS you what your focus should be.** A real chief of staff doesn't ask an overwhelmed
person what to prioritize — it figures it out and proposes. Perfect fit for the ICP (overwhelmed / ADHD
— "I have so much going on") and the "do as little as possible" principle.

## Why it wins
- Removes the highest-friction, hardest input (deciding priorities) — the exact thing an overwhelmed /
  ADHD user struggles with most.
- Focus areas stay current automatically (derived from behavior, not manual upkeep).
- **Deep moat:** measuring against a manual list is trivial to copy; *recommending* focus from months of
  behavioral history is the proprietary chief-of-staff brain. This is the hard, defensible part.
- Slots upstream of everything already built — nothing thrown away: Edge recommends focus → scores
  measure calendar vs focus → Edg3 Score presents.

## The flow
At onboarding and weekly: Edge scans your data → **proposes your top 3 focus areas for the week, each
with a one-line rationale** → you confirm or tweak in one breath (one "yes"). On confirm it writes to
the existing priorities store, so the scores + scoreboard keep working unchanged. Re-run weekly; user
can always override.

## Data sources — Derrick (2026-06-15): "it has to pull all of these"
- **Past calendar (~6 months)** — what you actually spend time on. `getPastCalendarDays` (14d) → extend
  to ~180d. ✅ ready now.
- **Call memory** — accumulated structured facts + raw notes from briefings (`factQueries` + memories). ✅ now.
- **Whoop** — recent recovery/energy as the ENERGY input/modulator (have ~14d history; sufficient — not a
  6mo requirement). ✅ usable now.
- **★ Email — ELEVATED to a CORE source (was "later").** Derrick: email is a big chunk of his life
  (foreclosures, financial/legal, life admin) — much of "what matters" lives there; a chief of staff
  must see it. **NOTE this is a NEW, on-vision use of email — reading it as a PRIORITY SIGNAL — distinct
  from the parked `draftEmail`/reply-tracking features.** Needs: `gmail.readonly` scope (re-consent),
  Security-owned ingestion, and **STRONG privacy** (highly sensitive PII — encryption, minimal retention,
  user-data-only). ⚠️ Elevates the Google read scope → CASA / verification implication.
- **ChatGPT** — earlier mention now unclear/superseded; likely Derrick meant email. Park unless re-raised.
- **Sequencing:** TARGET = pull calendar + memory + Whoop + email together. Ship **v1 on calendar +
  memory** (ready now), fold in **Whoop** (ready) + **email** (needs read scope + Security + privacy) as
  they land — so we don't block the engine on email plumbing.

## Build (proposed)
- `recommendFocusAreas(userId)` — assemble past calendar (~6mo) + call facts/memories → ONE LLM call →
  top 3 proposed focus areas + per-area rationale + confidence. Returns a structured proposal.
- **Surface:** on the briefing call ("based on your last six months and our calls, here's what I'd focus
  you on this week — sound right?") and on the dashboard (proposed priorities the user accepts/edits).
- **Confirm flow:** one yes accepts; light edit adjusts. Writes to the priorities store.
- Degrade gracefully on thin data (few events/calls → fewer/low-confidence proposals, or ask the user).

## Relationship to the rest
UPSTREAM of the scores. Edge recommends focus → scores measure calendar vs focus → Edg3 Score presents.
This makes the "areas of focus" effortless and is the strongest expression of the chief-of-staff thesis.

## Lane split
- 🛠️ Core — `recommendFocusAreas`, extend `getPastCalendarDays` to ~180d, call-memory synthesis, the
  confirm flow, call + dashboard surfacing.
- 🔒 Security — if/when ChatGPT or email data is ingested: ingestion + secrets + privacy + retention.
- 🎨 Design — the "here's what I'd focus you on — confirm/tweak" UI (onboarding + weekly).

## Open questions
1. ChatGPT data source (see above) — what access/export?
2. Sequencing vs the Edg3-Score restructure (both open) — this is more differentiating; likely goes first.
