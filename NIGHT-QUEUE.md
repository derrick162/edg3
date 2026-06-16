# 🌙 Overnight build queue — Night 2 (2026-06-15→16)

Rules: `git merge master` before EVERY push. Run full `npm run preflight` (real exit code) BEFORE pushing.
Commit small. PM (Kevin) auto-integrates green pushes. **Cam owns dashboard LAYOUT, Darren owns
data/logic** — when both touch `app/dashboard/page.tsx`, merge master + keep BOTH (Cam=visual, Darren=data);
if it conflicts, Cam reconciles. Anything needing Derrick → write into your lane roadmap + the Status Board.
Build your queue IN ORDER.

---

## ★★★ NEW FLAGSHIP — Open Loops / Commitment Tracking
The chief-of-staff superpower: **"Edge caught the thing you forgot."** Track unresolved action threads
pulled from email + call transcripts + calendar:
- **Commitments YOU made** — "I'll send the deck", "I'll call them Friday"
- **Awaiting YOUR response** — replies/requests owed (e.g. the credit collector)
- **Deadlines** — bills due, responses due, appointments
Surface: a calm dashboard **"Open Loops"** section (3 buckets: *you owe · awaiting you · deadlines*, each
resolve/dismiss) + feed urgent loops into the focus recommendations + Edge mentions them on calls
("you told X you'd send Y — still open"). Calm + helpful, never anxiety-inducing.

Lane split:
- **Vijay** — `open_loops` table (additive): `{ id, user_id, description, type (commitment_made|awaiting_you|deadline), source (email|call|calendar), due_date?, status (open|done|dismissed), created_at, resolved_at }` + `openLoopQueries` + privacy (email-derived = sensitive: encryption, export/delete, retention). **Ship this FIRST** so Darren can build on it.
- **Darren** — `lib/openLoops.ts`: extract open loops/commitments from recent email + call transcripts + calendar (one LLM pass, with due dates), dedup vs existing (like facts). `/api/open-loops` (list + resolve + dismiss). Feed urgent/overdue loops into `recommendFocusAreas` + the briefing. 
- **Cam** — the "Open Loops" dashboard surface (3 buckets, resolve/dismiss, calm design).

---

## 🛠️ Darren (Core) — queue
1. **★ Open Loops** extraction + `/api/open-loops` + feed into recs/briefing (after Vijay's schema; stub the table type if needed to start).
2. **Edge Score never "calibrating" once a calendar is connected** — blend over AVAILABLE (non-calibrating) components, renormalize weights; per-component calibrating stays in the breakdown only. Ensure **Energy** computes from Whoop sleep+recovery (needs Vijay's `performancePct` on sleep history).
3. **Email-relevance TUNING** [in progress] — discernment (real financial/legal/runway vs routine ops), no grab-bag, surface the genuinely-important item specifically, ground in anchors.
4. **Memory DEDUP + consolidation** — prevent duplicate facts on extraction + `consolidateFacts(userId)` to merge existing overlaps.
5. **Name-correction in fact extraction** — Faiza misheard as "Pfizer"; cross-check contacts/calendar/profile.
6. **(if time) Email↔calendar↔memory cross-link** — meeting-prep context: "your 2pm with X — here's the thread + what Edge knows."

## 🎨 Cam (Design) — queue
1. **Reconcile the memory-tab conflict** + land your **ContentSection** (real Esther copy + reader) + **memory declutter** (collapsible categories). [in progress — merge master, keep Darren's parseUTC]
2. **★ Open Loops dashboard surface** (3 buckets, resolve/dismiss, calm).
3. **Fix-It preview clarity** + **strong-signal / "tweak" clarity** (drop jargon, obvious actions).
4. **Edge Score "live number" presentation** — once computing, show movement; components maturing in the breakdown (not a dead "calibrating").
5. General home-cockpit polish.

## 🔒 Vijay (Security) — queue
1. **★ `open_loops` schema + queries + privacy** (ship FIRST — unblocks Darren).
2. **Add `performancePct` to sleep history** in `lib/whoop.ts` (`WhoopSleepDay`) — so the Energy score computes from sleep+recovery over 7d. Darren needs this; do it early.
3. **Privacy/security audit of email-derived data** (open loops + facts-from-email): encryption-at-rest, data export + deletion coverage, retention minimization.
4. Durability/reliability + remaining CASA code items.

## 🔧 Esther (CoS) — optional
- More content pieces / GTM / the 30-60-90. (Content v1 = 7 pieces done.)

---
_PM reconciles + integrates continuously; leave the tree green. Highest-value: Open Loops end-to-end +
the Edge-Score-never-calibrating fix._
