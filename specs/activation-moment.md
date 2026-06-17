# Spec — The First-Run Activation Moment ("wow in 2 minutes")

**Goal:** A brand-new user, within ~2 minutes of connecting their calendar, sees Edge
*already understand them* and *improve their day* — so they instantly get why this is
different. This is the beta conversion lever + the design-partner demo. It leans on the
priority-derivation engine + the hero loop we just built.

## The flow (onboarding)
1. Sign up / arrive from waitlist → existing.
2. **Connect Google Calendar** → existing.
3. **★ "Here's what I already learned about you."** Immediately after connect, Edge runs
   priority-derivation on ~6 months of calendar history (+ any email signal/memory) and
   reveals 2–3 derived overarching ANCHORS + this WEEK's priorities, each with a one-line
   evidence-based rationale ("You've spent 40h on X over 3 months — looks like a top priority").
   Delightful reveal; honest loading state ("Edge is reading your last few months…"); graceful
   thin-data fallback (sparse calendar → ask 1–2 quick questions instead of fabricating).
4. **One yes to accept / tweak** → writes anchors + priorities.
5. **★ First hero-loop.** Edge shows today's reshape ("here's what I'd change today") → one
   "Make it happen" → calendar updates + Edge Score appears. (If today's already aligned, show
   the positive state + the Edge Score.)
6. → Dashboard, primed. Optional: set the morning call time.

The two ★ beats ARE the wow. Everything else is glue.

## Lane ownership
- **🛠️ Core (Darren) — flow + data.** New onboarding step(s) that call priority-derivation +
  day-plan right after calendar connect; surface derived priorities (accept/tweak writes them
  via the existing accept flow); then the first hero-loop. Loading + thin-data fallback + tests.
  You own logic/data; Cam owns the visual. Files: `app/onboarding/**`, reuse
  `lib/priorityDerivation.ts`, `/api/priorities/derive` + accept, `/api/day-plan`.
- **🎨 Design (Cam) — the experience.** The activation screens: the "Edge is learning about you"
  loading, the priorities REVEAL (make it feel like magic — they appear one by one with their
  rationale), the first hero-loop card, sequencing/motion (respect prefers-reduced-motion),
  mobile. `git merge master` FIRST (canonical EdgeScoreCard etc.). Coordinate flow with Darren,
  copy with Esther.
- **📋 CoS (Esther) — copy + funnel + metrics.** Refine the activation copy for the real screens
  (welcome, the "here's what I learned" framing, accept/tweak, first-call setup), the
  waitlist→onboarding handoff, and define activation success metrics (connected calendar → saw
  priorities → accepted → applied first plan). Markdown in `content/`.
- **🔒 Security (Vijay) — safe first run.** Review the onboarding + priority-derive path: OAuth,
  strict user-scoping, rate-limit the derive on a fresh account, no cross-user leak, graceful
  failure. Then continue remaining audit/backlog items.

## Principles
- ONE Edge Score (never a competing number). Honest when data is thin (never fabricate priorities).
- Degrade gracefully — a user with an empty calendar still gets a good first run.
- Ship incrementally: derive-and-reveal first (the biggest wow), then the first hero-loop, then polish.
