# 💡 EDG3 — Idea Parking Lot

> Future ideas that are **not** scheduled work. The PM parks things here when they're
> worth remembering but shouldn't pull focus from the launch backlog (the lane roadmaps).
> Promote an idea into a lane roadmap only when we decide to actually build it.
> Each entry: what it is, why it's parked, and the cheap-validation path if one exists.

## Health / wearables

### Garmin body-composition (weight) sync — _parked 2026-06-13_
- **Idea:** Pull Derrick's Garmin weigh-ins (weight/BMI/body-fat) so Edge can track progress
  against the "get to 130 lbs" priority automatically.
- **Feasible?** Yes — Garmin has a real cloud API (Garmin Health / Connect), unlike Apple
  Health which has no cloud API. Body composition is available.
- **Why parked:** (1) Garmin's API needs **developer-program approval** (application + uncertain
  timeline; aimed at companies) — not turnkey like Whoop's OAuth. (2) It's another **niche,
  device-specific** integration (Garmin owners only) right before launch.
- **Cheap-validation path first:** capture the *value* (weight-toward-goal accountability) with
  **manual weight logging** — "Edge, log my weight: 134" on a call, or a dashboard field. Edge
  tracks the trend + nudges/celebrates toward the goal. Works for ALL users, tiny build. If that
  proves used + valuable, THEN invest in Garmin auto-sync to remove the manual step.
- **Decision:** wait on the Garmin integration; weight-tracking middle-path available if/when wanted.

### Device-agnostic health input (broaden beyond Whoop) — _parked 2026-06-13_
- **Idea:** Make the health layer work for non-Whoop users (the bigger market): Garmin / Oura /
  Health Connect, or a manual-input fallback.
- **Why parked:** bigger lift; Whoop already covers the founder; validate the health features pay
  off before widening. Apple Health specifically has no cloud API (blocker).
