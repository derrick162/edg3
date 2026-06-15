# 🌙 Overnight build queue — 2026-06-15

Derrick is asleep (~9h). PM/CTO is in **AUTO MODE**: can't message lanes, but **WILL keep
auto-integrating** your green pushes to master (fetch → merge → preflight → push). Work your queue
autonomously, in order.

## Rules for autonomous overnight work
- `git merge master` before EVERY push. Commit small. Keep `npm run preflight` GREEN (real exit code) —
  the PM auto-integrates green pushes; red/conflicting ones get held.
- Build your queue **in order**. Don't start another lane's work.
- **Shared page files** (`app/dashboard/page.tsx`, `app/onboarding/**`): claim in the Status Board first,
  small diffs, **Core = data/logic, Design = visual**. Prefer building presentational pieces in
  `components/ui/` that Core wires, to avoid collisions.
- If something needs a **Derrick decision**, write it into your lane roadmap + the Status Board (the PM
  CANNOT relay messages in auto mode). Don't block on it — move to the next queue item.
- Source of truth: `specs/focus-recommendation.md`, `specs/calendar-scores.md` (the "✅ FINAL — KEEP IT
  SIMPLE" banner), `specs/energy-os.md`. Product is DAY-scoped; priorities are a hierarchy
  (stable anchors → weekly tactics = milestones → daily focus).

---

## 🛠️ Core
1. **[in progress] Focus Recommendation engine v1 (day-scoped).** `recommendFocusAreas(userId)` → today's
   3 focus areas {title, rationale, confidence} anchored to the stable overarching priorities, factoring
   today's energy (Whoop + voice read). Extend `getPastCalendarDays`→~180d; pull call memory.
   `GET /api/focus/recommend` + `POST /api/focus/confirm`. Real-time surfacing on the ~9am briefing call +
   dashboard data. v1 = calendar + memory (Whoop/email pluggable).
2. **ONE Edge Score + fix energy-100.** Collapse focus+energy into a single 0–100 Edge Score (readout).
   Fix the Energy half so it MEANS something: (recovery/sleep availability) × (demand-match); show
   "calibrating" on thin data, never a fake 100. (specs/calendar-scores.md FINAL banner.)
3. **Hero loop (day-scoped).** `lib/calendarPlan.ts` (pure: compose a plan of today's add/move/delete/
   recolor changes from the day's gaps + the scores' fixes) + `applyCalendarPlan` tool (execute the batch
   for TODAY on ONE confirm) + plan-level undo group + re-score after ("your day just got better").
   Pairs with Security #2.
4. **Energy color-coding.** `colorByEnergy` action + `lib/calendar.ts` write using `event_energy_tags` —
   color today's events by energy demand/window (Google `colorId`).
5. **(Coordinate w/ Design) Remove Tasks IA.** Remove the Tasks tab + task pipeline; migrate the
   "did you do X?" accountability onto milestones; clean briefing refs. Claim the dashboard in the
   Status Board; small diffs.

## 🎨 Design
1. **[in progress] "Your 3 focus areas for TODAY" card** (`components/ui/`) — to Core's contract
   `FocusRecommendation = {areas:{title,rationale,confidence}[], basedOn:string[], generatedAt}`;
   one-tap confirm + tweak; chief-of-staff feel; today-scoped + tied to today's energy; calibrating/sparse
   states.
2. **ONE Edge Score gauge.** Collapse the two Calendar Fit gauges into a single Edge Score gauge (0–100).
   Coordinate on `app/dashboard/page.tsx` with Core (Status Board, small diffs).
3. **Notification center polish.** Finalize the control-surface visuals + the celebration + energy-one-tap
   states (the notifications re-aim presentation). Keep it presentational, in `components/ui/`.
4. **Hero-loop moment visual.** The "here's today's plan → confirm → your day just got better (score
   moved)" presentation — component-level; Core wires the data.
5. **Design-system polish.** `globals.css` tokens + consistency passes across `components/ui/` (safe,
   non-shared).
- ⚠️ Prefer self-contained `components/ui/` work; avoid ahead-building on shared page files. Held commits
  (notif-center earlier ver, data-control) stay PARKED — data-control needs Derrick's default decision.

## 🔒 Security
1. **[in progress] Email read source.** `gmail.readonly` + privacy-hardened `getRecentEmailSignal(userId,
   {days,max})` digest (sender/subject/short snippet, not full bodies) + encryption + minimal retention +
   user-data-only + export/delete; written **CASA / Google-verification impact** assessment for the read
   scope. Most sensitive data we touch — over-index on privacy.
2. **`applyCalendarPlan` durability** (pairs with Core #3): batch idempotency + plan-level undo group
   recording, so one undo reverts the whole day's reshape; audit-log the mutations.
3. **Privacy plumbing for new data.** Ensure `calendar_scores`, `energy_profile`, `event_energy_tags`,
   and the email digest are covered by encryption-at-rest + data export/delete.
4. **Durability/reliability hardening** (ongoing mandate): backups, idempotency on new write paths.
5. **CASA security-assessment prep** — the long pole for Google verification.

---
_PM will reconcile + integrate everything when Derrick is back / auto mode is off. Leave the tree green._
