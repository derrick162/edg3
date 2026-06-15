# Focus recommendation engine — Edge TELLS you what to focus on

_Derrick "aha" 2026-06-15. Potentially the most differentiating piece of the whole product._

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

## Data sources
- **Past calendar (~6 months)** — what you actually spend time on. We have a past-fetch primitive
  (`getPastCalendarDays`, currently 14d) → extend to ~180d. ✅ buildable now.
- **Call memory (~10 calls)** — accumulated structured facts + raw notes from briefings
  (`factQueries` + memories). ✅ now.
- **⚠️ ChatGPT** — NEEDS CLARIFICATION from Derrick. No ChatGPT integration exists today. Likely =
  importing a ChatGPT conversation-history export as a "what's on my mind" signal. Confirm source/access
  before scoping into v1.
- **Whoop past** — recovery/energy history (have ~14d; 6mo needs more). Later, minor signal.
- **Email** — later.
- **MVP = calendar + call memory** (both available now; the two richest signals).

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
