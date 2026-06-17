# Spec — Memory & Context backend (build the moat)

_From Derrick's 2026-06-17 vision jam. Implements [`memory-architecture.md`](memory-architecture.md).
Strategic bet: Edge wins on **context + memory**. This is the backend that makes Edge "remember a
user's life better than they do." Sequenced by leverage — tagging first (it feeds everything)._

## The principle
Every ingestion path (calendar, email, Whoop, call transcript) must **tag + structure** what it sees
into the seven memory layers — not just store raw text. Richer, more accurate tags → better focus,
energy, hero-loop, and briefing. Build the *structured understanding*, then surface it.

## Workstreams (priority order)

**M1 — Unified tagging of calendar + email (feeds every layer).** For each calendar event and email
thread, derive + persist structured tags: **type** (meeting/deep-work/meal/exercise/social/admin/
travel/personal), **people** (canonical names — use T4 grounding + profile/calendar titles), **which
goal/anchor it serves** (link to priorities), **energy demand** (high/med/low), and where observable,
**outcome** (happened / moved / skipped). One enrichment pass; cache it; reuse across briefing + scores
+ memory. This is the substrate for L1–L3 + L5 + L7.

**M2 — Relationship Memory (Layer 5).** Build evolving **people profiles** from calendar attendees +
email senders/recipients + call mentions: canonical name, role/relationship, how often they interact
(cadence), last interaction, recurring context/topics. Surface in the briefing ("you've got X with
[person] — last time you discussed Y") and in "What Edge knows." Honest + correctable. Clear gap today
(facts "People" is shallow) and high user value — the "remember important people" promise.

**M3 — Pattern Memory (Layer 3) deepening.** From the combined calendar + Whoop + behavior history,
detect: most-productive days/times, energy cycles, recurring distractions, what precedes good vs poor
recovery, habits associated with focus-confirmed days. Feed one honest pattern insight into the briefing
("you're sharpest Tue–Thu mornings — I protected that"). Build on `whoopCorrelations` + `calendarPatterns`.

**M4 — Accountability Memory (Layer 7) — close the loop.** Extend open-loops/commitments with **outcome
recording**: did the committed/predicted thing actually happen? Record the result, and let the briefing
reflect it back ("you committed to X on Monday — it happened / it didn't"). Turns memory into learning.

**M5 — (phase 2) Decision Memory (L4) + Narrative Memory (L6).** Capture major decisions + rationale,
and a coherent life-story thread, from calls. Newer/bigger — scope after M1–M4.

## Lane ownership
- **🛠️ Core (Darren)** — the memory backend: M1 tagging → M2 relationships → M3 patterns → M4
  accountability. Wire each into the briefing so Edge *demonstrably* remembers better. ⚠️ FIRST finish
  the compliance gate: add the `data_consent` DB column + queries (Security's consent UI is inert
  without it) and make consent enforceable. Then memory work. Tests throughout.
- **🔒 Security (Vijay)** — memory is deep PII (relationships, decisions, life narrative). Every new
  memory field **encrypted at rest**, user-scoped, and **consent-gated** (the `data_consent` setting must
  govern what's stored/used for "improve"). Finish CASA enforcement; audit the memory store; retention.
- **🎨 Design (Cam)** — surface the accumulating memory in **"What Edge knows"**: people/relationships,
  patterns, goals, with provenance + inline correction (correcting improves the data). Make the moat
  *visible* — it builds trust and shows the product getting smarter. Canonical EdgeScoreCard untouched.
- **📋 CoS (Esther)** — make the **memory moat** the spine of positioning + the pitch deck: the five
  streams competitors can't combine, "the moat is accumulated memory, not the model," compounding value.
  This is the investor + design-partner narrative.

## Principles
- Honest: never fabricate memory; mark low-confidence; let users correct (correction = better data).
- Consent-gated: respect the CASA data_consent setting for anything used to "improve."
- Degrade gracefully on thin data. One Edge Score; canonical model untouched.
