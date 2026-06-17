# 🌙 NIGHT QUEUE — work until ~9:00 AM Toronto (2026-06-17)

> Deep, self-replenishing backlog per lane. **Each lane: do the FLAGSHIP first, then work
> DOWN your backlog in order. Commit small + push frequently (every green unit). DO NOT STOP
> and idle — when you finish an item, pull the next one. If you somehow clear the whole list,
> pick the next-highest-value trust/quality improvement in your lane and keep going until ~9 AM
> Toronto.** Theme stays **TRUST** + the vision (Edge tells you your focus, prevents burnout).
> PM (Kevin) integrates everything green continuously through the night.

---

## 🛠️ CORE (Darren)

**★ FLAGSHIP — Proactive Priority Derivation ("Edge tells you what matters").** The #2 vision
gap: today Edge recommends *daily* focus from anchors the user set. Build the layer that DERIVES
the priorities themselves. New `lib/priorityDerivation.ts` (pure + one LLM synthesis call):
analyze ~6 months of calendar history + email signal + memory/facts → propose (a) 2–3 stable
overarching ANCHORS and (b) this WEEK's priorities, each with a one-line evidence-based rationale.
New `GET /api/priorities/derive` (user-scoped, rate-limited). Dashboard: a "Here's what I think
matters" card the user can accept (one yes → writes anchors/priorities) or tweak. Voice: surface
on the morning call. Degrade gracefully on thin data. Full tests. Ship incrementally: engine →
API → dashboard card → voice.

**Backlog (in order):**
1. Hero-loop diagnosis depth: add open-loops-due-today, recurring-pattern, and meeting-prep
   diagnosis types to `buildCalendarPlan`; each with a concrete action. Tests.
2. T3 grounding → extend to the live voice path (tool-call) so mid-call captures use canonical
   calendar/contact spellings, not raw STT.
3. "Show your work" completeness: audit every audit-logged action → ensure each has a rich,
   honest, inspectable Activity label + expandable detail. No raw tool names anywhere.
4. Scoring-engine test hardening: edge cases for Focus recalibration, momentum, the score-stability
   fallback, day-plan real-score recompute.
5. Fact-correction polish: ensure the briefing/extraction prefers user-corrected facts; dedupe
   near-duplicate facts; surface provenance everywhere.
6. Anything that makes the numbers feel TRUE (the trust wedge) — propose + build.

---

## 🎨 DESIGN (Cam)

**★ FLAGSHIP — Full mobile + design-system pass on EVERY screen.** Make Edge genuinely great on a
phone end-to-end: dashboard (all tabs), onboarding, landing, auth, the hero-loop card, Edge Score,
activity, memory, content. Simultaneously consolidate inline styles → `globals.css` tokens/classes
(single source of visual truth). Each screen: real mobile layout, touch targets, no overflow,
readable hierarchy. `git merge master` first.

**Backlog (in order):**
1. Re-apply your memory-tab polish (auto-open first category, "learned MMM d" provenance) vs
   CURRENT master (it was superseded in the merge — redo cleanly).
2. Fact-correction inline-edit UI in "What Edge knows" — Core's `PATCH /api/memory/facts/[id]` is
   LIVE; wire pencil → inline input → save (returns updated fact + clears ⚠ verify flag).
3. Hero-loop card visual: diagnosis list as a sharp exec brief (icon per op type, reason as
   supporting text); make the before→after improvement feel like a payoff. (Note: there is now ONE
   Edge Score — do NOT reintroduce a competing number on the card.)
4. Activity receipts UI polish: the expandable "emails Edge reviewed" subject list — make it clean;
   graceful empty/old-scan state already exists.
5. Empty states + loading states across the whole app — every fetch should have a designed
   loading + empty state, never a blank or a scary error.
6. Accessibility pass: focus rings, contrast, prefers-reduced-motion, aria where missing.

---

## 🔒 SECURITY (Vijay)

**★ FLAGSHIP — Full pre-beta security audit + hardening + readiness report.** Systematically audit
EVERY API route under `app/api/**`: authn/authz (user-scoping), rate-limit coverage, input
validation, injection (prompt + SQL), idempotency on mutations, audit-log coverage, error-leak.
Document each route's status in `content/security-audit.md` and FIX every gap found. Produce a
pre-beta security readiness summary.

**Backlog (in order):**
1. Close the undo-coverage gap you flagged — every calendar/fact mutation must be undoable as a
   unit. Verify + fill.
2. Encryption-at-rest verification: confirm every PII field (facts, daily_focus, email subjects,
   tokens, transcripts) is encrypted; document what's covered. Verify `DATA_ENCRYPTION_KEY`
   behavior + a safe fallback if unset.
3. Session/auth hardening review (JWT, session-version revocation, cookie flags, CSRF on state-
   changing routes).
4. Dependency / supply-chain check (`npm audit`, lockfile review) — note + fix actionable items.
5. Finalize `content/data-protection.md` + the "How Edge protects you" content (coordinate w/ Esther).
6. Abuse/rate-limit tuning review across all keys; add any missing.

---

## 📋 CHIEF OF STAFF (Esther)

**★ FLAGSHIP — Complete beta launch playbook.** `content/beta-launch-playbook.md`: the full plan to
invite + activate the first beta users — onboarding sequence, the waitlist→onboarding funnel (the
waitlist endpoint is live), the first-run "here's what I already learned about you" activation
moment (write the copy), the first-week user journey, success metrics, feedback loop, and the
external dependencies that need Derrick (Google verification, Twilio, pricing, partner names) as a
clearly-labeled blockers list.

**Backlog (in order):**
1. ICP validation interview guides — per ICP (from `icp-target-profiles.md`), the exact questions
   to validate the key hypotheses + what a "yes" looks like.
2. Design-partner outreach kit: criteria, candidate-profile shortlist, and a personalized outreach
   template (DRAFT only — Derrick picks real names + sends).
3. Positioning + messaging doc: the one-liner, the wedge (trust), the "why now," objection-handling.
4. Competitive landscape: who else touches calendar/AI-EA/burnout, how Edge is different.
5. Pricing options analysis (DRAFT for Derrick's decision — not a decision): 2–3 models with
   rationale tied to the ICPs.
6. "First 10 users" concrete plan.

---

_All markdown deliverables in `content/`. All code: small commits, push frequently, green only.
PM integrates continuously and keeps master deployable._
