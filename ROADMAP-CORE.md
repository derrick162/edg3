# 🛠️ EDG3 — Core Lane (features / product)

> Backlog for the **Edg3 Engineer (Core)** session. Governed by the shared
> [`ROADMAP.md`](ROADMAP.md) constitution — read that first (ownership map,
> worktree isolation, merge protocol). Work on branch `core` in
> `C:\Users\Derrick\edg3-core`. Update this changelog in the same commit that
> ships work, and claim files in the constitution's Status Board before touching
> anything in the ⚠️ Shared list. The PM routes new product feedback into the
> backlog below.

## ⚡ Standing order — read this before every ticket

**Do not stop between tickets.** Your job is not done when one ticket is done — it is done when the entire current dispatch is complete and preflight is green.

After every ticket:
1. Run `npm run preflight` from `C:\Users\Derrick\edg3-core`
2. If green → commit with a clear message → immediately start the next ticket in this dispatch
3. If preflight fails → fix it (up to 2 attempts) → if still failing, note the blocker in the Status Board and move to the next ticket if it's independent; only stop if you are fully blocked

**Only stop if:**
- All tickets in the current dispatch AND the pillar backlogs are exhausted AND the QA checklist is complete, OR
- You hit a genuine blocker that requires PM input (note it clearly in the Status Board), OR
- Preflight has failed 3+ times and you cannot identify the root cause

**In all other cases: keep going.** You do not need PM approval between tickets. You do not need to wait for a response. Commit small, run preflight, move to the next ticket.

**When the dispatch is exhausted → move to the pillars (in this order):**
1. Read `PILLAR-DAILY-CALL.md` — briefing quality, flywheel integrity, opener, commitment surfacing (Core leads DC0, DC2, DC3, DC4)
2. Read `PILLAR-MEMORY.md` — work through items in order, highest tier first
3. Read `PILLAR-TRUST.md` — pick up any Trust items tagged (Core) that aren't done
4. When all three pillars are exhausted → run the QA checklists in all three pillar files
5. Log QA results in `content/qa-log.md` (create if it doesn't exist)

## 📥 PM DISPATCH — 2026-06-19 (ROUND 8 BUG FIXES — do before R8 feature work)

> **P0 bugs from Derrick's live dashboard review — fix these first.**

### Bug 1 — TODAY'S FOCUS card shows empty content with a confirm CTA (P0)

**Symptom:** Dashboard Home tab shows the TODAY'S FOCUS card with the header "Here's your focus read for today" and the "Looks right — set focus" / "Skip today" buttons, but **no focus content** between the header and the buttons. The card renders as if there's nothing to confirm, yet the confirm CTA is shown.

**Fix:** Find the `FocusRecommendationCard` (or equivalent component rendering TODAY'S FOCUS) and add a guard: if there are no focus items to display, either (a) show a proper empty state ("No focus items — check your Priorities tab") or (b) hide the card entirely. The "Looks right — set focus" CTA must never appear when there's no content for the user to read. Audit why the data is empty — is the API returning nothing? Is the component failing to render items silently?

**Files:** `app/dashboard/page.tsx` + `components/ui/FocusRecommendationCard.tsx` (or whichever component renders this card). Check the `/api/briefing/focus` or equivalent endpoint too.

---

### Bug 2 — Edge Assessment suggests prep for personal health appointments (P0) + event classifier

**Symptom:** Same as above (PRP prep suggestion). Fix with a proper classification system — not a one-off boolean.

**Build `classifyEvent(title: string, description?: string): EventClass` in `lib/eventMatch.ts`:**

```typescript
export type EventClass =
  | 'work-meeting'     // investor call, team sync, 1:1, standup, interview, client, demo, review
  | 'health'           // doctor, dentist, therapy, treatment, PRP, injection, physio, massage, chiro, appointment
  | 'fitness'          // gym, workout, run, yoga, pilates, training, swim, CrossFit, tennis, golf
  | 'meal'             // lunch, dinner, breakfast, coffee, drinks, brunch, happy hour
  | 'personal'         // birthday, family, date, anniversary, wedding, party, social
  | 'travel'           // flight, airport, drive to, uber, transit, commute
  | 'focus-block'      // deep work, focus time, blocked, writing, coding, no meetings, maker
  | 'reminder'         // reminder, RSVP, deadline, due, follow up, don't forget
  | 'unknown';         // anything that doesn't match — Edge should ask, not assume
```

**Rules:**
- Match against lowercase title + optional description. Use keyword lists per class.
- Priority order when multiple match: `health` > `fitness` > `travel` > `work-meeting` > `meal` > `personal` > `focus-block` > `reminder` > `unknown`.
- `unknown` is the safe default — never assume work-meeting for an ambiguous title.
- Export a second helper `needsPrepSuggestion(cls: EventClass): boolean` — returns `true` only for `work-meeting`. Everything else: false.

**Wire it in:**
1. Edge Assessment / day plan prep logic: wrap any prep suggestion with `needsPrepSuggestion(classifyEvent(event.summary))` — skip if false.
2. Briefing opener (PAST EVENTS RULE already exists): also use `classifyEvent` to skip `fitness`/`meal`/`reminder` from the opener — they're noise.
3. `lib/vapi.ts` prompt note: when suggesting prep, Edge must only do so for `work-meeting` events; for `unknown` — ask on the call instead of assuming.

**Tests:** at minimum — `classifyEvent('PRP')` → `'health'`, `classifyEvent('Investor call')` → `'work-meeting'`, `classifyEvent('Gym')` → `'fitness'`, `classifyEvent('Lunch with Sarah')` → `'meal'`, `classifyEvent('Deep work block')` → `'focus-block'`, `classifyEvent('XYZ123')` → `'unknown'`, `needsPrepSuggestion('work-meeting')` → `true`, `needsPrepSuggestion('health')` → `false`.

**Note:** this replaces the simpler `isPersonalEvent` boolean mentioned elsewhere in this dispatch.

---

**Symptom:** Edge Assessment card shows "Add 15-min prep before 'PRP' at 1:45 PM." PRP is a hair loss treatment — a personal health appointment requiring no prep. Edge is treating it like a work meeting.

**Root cause:** The day plan / Edge assessment logic suggests prep time for any event without classifying whether it's a work meeting vs. personal appointment.

**Fix (two parts):**

1. **Event classification before prep suggestions.** Before suggesting prep time for any event, classify it. Events with titles matching personal/health/fitness/social patterns should never get a prep suggestion:
   - Health/medical: `prp`, `treatment`, `therapy`, `doctor`, `dentist`, `physio`, `massage`, `acupuncture`, `chiro`, `appointment`, `checkup`, `injection`
   - Fitness: `gym`, `workout`, `run`, `yoga`, `pilates`, `training`, `swim`
   - Meals/social: `lunch`, `dinner`, `breakfast`, `coffee`, `drinks`
   - Personal: `birthday`, `family`, `date`, `anniversary`
   Add a pure helper `isPersonalEvent(title: string): boolean` in `lib/eventMatch.ts` (already has similar helpers). If `isPersonalEvent` returns true → skip the prep suggestion entirely.

2. **Ask, don't assume, for unknown events.** If the event title is ambiguous (not clearly a work meeting and not clearly personal), Edge should NOT auto-suggest prep on the dashboard. It can ask on the morning call: *"You've got 'PRP' at 1:45 — do you need any prep time before that?"* Add a note to the vapi.ts system prompt: before suggesting prep time for an event, Edge must be confident it's a work meeting; for anything ambiguous, ask rather than assume.

**Files:** wherever the day plan / prep suggestions are generated (likely `lib/briefing.ts` or `app/api/briefing/...`), `lib/eventMatch.ts` (new helper), `lib/vapi.ts` (prompt note).

**Test:** `isPersonalEvent('PRP')` → true. `isPersonalEvent('Investor call')` → false. `isPersonalEvent('Team sync')` → false. Preflight green.

---

## 📥 PM DISPATCH — 2026-06-19 (ROUND 8 — Social mental models + Briefing V2 proactive wins)

> Master at current HEAD. `git merge master` first. **Context:** Railway DB is confirmed wiped on deploys (ephemeral volume — Derrick/Kevin fixing externally). Build now so it's ready when DB is stable.

### Ticket 1 — M4-4: Social mental models — `people_models` table (P1 — NOW UNBLOCKED)

> Was blocked on People-extraction cleanup. That merged weeks ago. **Build this now.**

The gap: Edge knows *facts* about people (from `facts` table, category='person') but has no structured per-person model. When "Sarah Chen" appears on the calendar, Edge can't recall her goals, communication style, or what the last interaction was about. This ticket adds that.

**What to build:**

1. **`people_models` table** (coordinate with Vijay for schema — he'll add it to `lib/db.ts`):
   ```sql
   CREATE TABLE IF NOT EXISTS people_models (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id),
     person_name TEXT NOT NULL,
     goals TEXT,                    -- encrypted: what this person is trying to achieve
     communication_style TEXT,      -- encrypted: how they communicate
     relationship_state TEXT,       -- encrypted: current relationship context
     last_interaction TEXT,         -- encrypted: what the last conversation was about
     health_score REAL DEFAULT 1.0, -- confidence in this model (decays like facts)
     updated_at TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE(user_id, person_name)
   );
   ```

2. **Sleep-time consolidation**: in `lib/facts.ts` `runSleepTimeConsolidation`, after extracting facts — check if any person-category facts were upserted. For each new/updated person fact, call `upsertPersonModel(userId, personName, fields)` to keep the model in sync. Extract: goals mentioned ("Sarah's trying to close a Series A"), communication style ("prefers async, brief"), relationship state ("haven't spoken in 3 weeks").

3. **Briefing builder injection**: in `lib/briefing.ts`, when building calendar context — for each calendar event, look up attendee names in `people_models`. If a model exists, inject a compact block: `[Sarah Chen: Series A fundraising · prefers async · last: discussed term sheet 2 weeks ago]`. Degrade silently if no model exists. Cap at 3 people per briefing.

4. **`peopleModelQueries`** in `lib/db.ts`: `upsert(userId, personName, fields)`, `getForUser(userId, personName)`, `listForUser(userId)`, `deleteForUser(userId)` (for account deletion).

**Test:** person mentioned in a mocked call transcript → sleep-time consolidation creates a `people_models` row → briefing builder injects the model when that person appears on the calendar. Preflight green.

---

### Ticket 2 — Briefing V2 quick prompt wins (P1 — direct continuation of call quality work)

> These are prompt-only changes in `lib/briefing.ts` and `lib/vapi.ts`. Low risk, high call quality impact. Derrick's feedback: "Edge should feel proactive, not just reporting."

**Four specific wins — do all four in one commit:**

1. **Proactive free-slot offer**: In Part 2 of the briefing (FOCUS + ACTION), after naming the top priority — if there's a free slot >60 min in the next 4 hours, Edge should name it: *"There's a clear 2-hour block at 10am — want me to lock that in for [P1]?"* Wire in `lib/vapi.ts` so Edge calls `createEvent` immediately on yes. Update the PRIORITY BLOCKING instruction.

2. **Look ahead to tomorrow**: In Part 3 (ALIGNMENT), add one sentence about tomorrow if today looks heavy or if a priority has nothing scheduled tomorrow: *"Tomorrow's light — good day to push forward on [P2] if today stays packed."* Never add this if tomorrow already has dense focus work.

3. **Personal event warmth**: In the opener section — if there's a personal/social event today (birthday, dinner, anniversary detected from event title keywords: "birthday", "dinner", "anniversary", "date", "family"), Edge should acknowledge it warmly and offer to help (send a message, block prep time). One sentence, naturally woven in.

4. **Proactive recovery offer (when Whoop connected + red/sharp-drop)**: The `detectRecoveryDrop` function already exists in `lib/whoopTrends.ts` and returns a `RecoveryAlert`. In the briefing builder, when this fires — inject a concrete RECOVERY ALERT that names the heaviest deferrable event: *"Recovery's at 28% — that's 20 points below your week average. [Strategy session at 3pm] looks like the most deferrable thing. Want me to push it to tomorrow?"* Edge must name the specific event and offer to act. Already coded in `whoopContextBlock` in briefing.ts — verify it's wiring the specific event name, not just generic language.

**Test each win individually.** Preflight green after each.

---

## 📥 PM DISPATCH — 2026-06-18 (ROUND 7 — Full email body reading for memory)

> **P0 — do this before Round 6.** Derrick's core vision: Edge reads his emails to build memory. Currently `getRecentEmailSignal` only reads thread metadata + snippets (subject, sender, Gmail snippet) — NOT full message bodies. This ticket closes that gap.

### Ticket 1 — Full email body reading + memory extraction (P0 — do now)

**What exists:** `lib/gmail.ts` has `readThread(userId, threadId)` which fetches full message bodies. `getRecentEmailSignal` fetches thread list + snippets but stops there. `extractAndUpsertFactsFromEmail` and `extractAndUpsertOpenLoops` consume the signal but only see snippets.

**What to build:**

1. **Extend `getRecentEmailSignal`** in `lib/gmail.ts` to optionally fetch full bodies. Add a `fullBodies?: boolean` option (default false for backwards compat). When true: for each thread returned, call `readThread` to get the full message text. Attach as `body` on each `EmailSignalItem`. Cap at 10 threads max (cost/latency guard) and 2000 chars per body (truncate cleanly at sentence boundary).

2. **Wire full bodies into the briefing** in `lib/briefing.ts`: call `getRecentEmailSignal(userId, { days: 7, max: 10, fullBodies: true })`. The existing `extractAndUpsertFactsFromEmail` and `extractAndUpsertOpenLoops` calls already consume the signal — they'll automatically get richer input once bodies are attached.

3. **Extend `extractAndUpsertFactsFromEmail`** in `lib/facts.ts` to use body text when present. Currently it only sees `snippet` and `subject`. When `item.body` exists, pass it to the Haiku extraction call instead of (or in addition to) the snippet. Extract: people mentioned, commitments made, facts stated, deadlines implied.

4. **Spam/noise filter**: before extracting facts from a body, check `isLikelySpam(item)` — skip threads where `isUnread=false` AND sender domain is not in a known-contacts list AND subject matches common promotional patterns (Unsubscribe, noreply, no-reply, newsletter, promo). This was already flagged as a live issue by Derrick.

**Scope boundary:** Security owns `lib/gmail.ts` access primitives. Core owns the briefing wiring + fact extraction. You're extending the signal consumption side — `getRecentEmailSignal` already exists and is Security's, so coordinate: either ask Vijay to add the `fullBodies` option to `lib/gmail.ts`, OR add it yourself and note the cross-lane touch in the Status Board.

**Test:** unit test `isLikelySpam` filter. Integration: call `getRecentEmailSignal` with `fullBodies:true` in a test and verify body text comes back. Verify `extractAndUpsertFactsFromEmail` produces more facts with body text than without.

**Done when:** briefing runs use full email bodies for memory extraction, spam is filtered, preflight green.

---

## 📥 PM DISPATCH — 2026-06-18 (ROUND 6 — Predictive context loading + confidence decay + outcome-weighted memory)

> Master at `c7d2515`. `git merge master` first. **READ FIRST:** `content/memory-research-applied.md`
> (Theories 1, 2, 3 — confidence decay, outcome-weighted memory, predictive context loading).
> **SEQUENCE:** finish People-extraction trust fix + voice switch FIRST, then Round 5 P1s, THEN this.
> Nothing here starts until Round 5 bi-temporal (T1) lands — confidence decay and outcome-weighted
> memory both depend on it. Exception: T1 below (context-pack builder fn) is independent — add it now.

### Ticket 1 — Export `buildBriefingContextPack(userId)` from `lib/briefing.ts` (P1 — do now, independent)

> **Coordinate with Vijay (Security).** He wires the 11pm cron in `lib/scheduler.ts`; you provide this fn.

- Extract a `buildBriefingContextPack(userId: number): Promise<string>` function from the existing
  briefing context assembler in `lib/briefing.ts`. It should return the same context string the briefing
  prompt currently builds — active facts, recent episodes, current priorities, recovery snapshot, outstanding
  commitments. **Do NOT fork or duplicate the assembly logic** — this must be the same path the live briefing uses.
- Export it. Vijay calls it nightly. The morning call reads the cached result first and falls back to live
  assembly if the cache is missing.
- Test: calling it returns a non-empty string for a user with data; gracefully returns a minimal string for
  a new user with no history.

---

### Ticket 2 — Mid-call reconfirmation trigger for low-confidence facts (P2 — after bi-temporal + confidence decay land)

> Depends on: Round 5 T1 (bi-temporal) + Security Round 6 T2 (confidence decay schema + decay job).

- In the briefing builder / vapi prompt: query for facts with `confidence < 0.3`. If any exist, inject ONE
  reconfirmation question naturally into the call — not a list, not an interrogation. One question per call max.
  Example: *"Last I heard you were targeting $500K for the raise — is that still the number?"*
- On user confirmation (Derrick doesn't correct it): call `factQueries.confirmFact(userId, factId)` → resets
  `confidence = 1.0`, `last_confirmed_at = now()`.
- On correction: the `rememberPreference` / in-call memory trigger (Round 5 T3) retires + replaces the fact.
- Prioritize: lowest confidence first; skip if the fact category is one where asking would feel intrusive
  (e.g. deeply personal health/relationship facts — flag those for dashboard surfacing instead).

---

### Ticket 3 — Outcome-weighted memory: extend M4 Accountability Memory (P2 — after bi-temporal lands)

> Extends `lib/accountabilityMemory.ts` (M4, already shipped). Do NOT build a new system.
> Depends on: Round 5 T1 (bi-temporal), Round 5 T2 (sleep-time consolidation agent).

**The gap:** M4 tracks whether commitments were kept. This ticket uses that signal to *weight* facts
and recommendations — Edge learns that some of Derrick's commitments are reliable and some aren't,
and adjusts its framing accordingly.

**What to build:**
- In `lib/accountabilityMemory.ts`: add a `getReliabilitySignal(userId, category?)` fn that returns a
  reliability score (0.0–1.0) for a category of commitment (e.g. morning-routine commitments vs.
  long-horizon goals vs. same-day tasks).
- In the briefing builder: when recommending or surfacing a commitment, factor the reliability signal
  into how Edge frames it. High-reliability category → confident nudge. Low-reliability category →
  softer framing, offer concrete next step rather than a reminder.
- In the sleep-time consolidation agent (Round 5 T2): after extracting commitments, update their
  reliability signal based on follow-through observed in the new transcript.
- No new table — extend the existing accountability snapshot structure with a `reliabilityScore` field.

---

### Ticket 4 — Social mental models: `people_models` table (WAVE 2 — blocked, do not start yet)

> **BLOCKED** on People-extraction cleanup merging first. We have dirty people data (hallucinated contacts,
> dup Pfizer entries, Edge showing up as a person). Building rich per-person models on dirty data compounds
> the errors. This ticket unlocks the moment the People-extraction fix merges.

**When unblocked, build:**
- New `people_models` table: `(id, user_id, person_name, goals TEXT, communication_style TEXT, relationship_state TEXT, last_interaction TEXT, health_score REAL, updated_at TEXT)` — encrypted at rest.
- Sleep-time consolidation agent: after each call, update the model for any person mentioned.
- Briefing builder: when a person appears on the calendar, inject their model into context.
- Research source: `content/memory-research-applied.md` Theory 5 — social mental models.

---

> Small commits. Preflight gate (`npm run preflight` from `C:\Users\Derrick\edg3`) before every merge.
> Update this changelog + Status Board when done.

---

## 📥 PM DISPATCH — 2026-06-17 (ROUND 5 — Memory self-learning / "win on context")

> Master at `e7357cc` (episode store + CASA enforcement LIVE). `git merge master` first.
> **READ FIRST:** `content/memory-research-applied.md` (Esther's MemGPT/Letta + Zep/Graphiti synthesis).
> Strategy: Edge's moat is accumulated *context*, not the model — two instances of the same model
> with different context behave as different agents. Build the self-learning flywheel:
> call → sleep-time consolidation → bi-temporal facts → pattern detection → better briefing → more trust.
> **NOTE:** the raw episode store (row 6 of the spec's dispatch table) is DONE — shipped this tick.
> **SEQUENCE:** finish the in-flight People-extraction trust fix + voice switch FIRST, then this in order.

### Ticket 1 — ★ Bi-temporal facts (P1 — the foundation; do first) — on the `facts` table, NOT `memories`
Depends on Security adding `valid_from`/`valid_until` to the **`facts`** table (dispatched to Vijay this round).
- In the fact pipeline (`lib/facts.ts` `upsertFact` + `extractAndUpsertFacts` + `consolidateFacts`): when a new
  fact conflicts with an existing one (same entity+category, contradictory statement), **retire** the old
  (`valid_until = now()` via `factQueries.retire`) and insert the new — NEVER hard-delete. Active = `valid_until IS NULL`.
- All briefing/memory reads filter to active facts (`valid_until IS NULL`).
- This is the STRUCTURAL fix for the fact-collision class (two contradictory priorities; the duplicate-Pfizer/
  contradiction problem from Derrick's live People-section review). COMPLEMENTS — does not replace — the
  People-extraction grounding fix (that stops garbage people; this handles legit facts changing over time).

### Ticket 2 — ★ Sleep-time consolidation agent (P1 — highest leverage)
- Background job triggered after each call completes (off the vapi webhook, fire-and-forget, no user-facing clock).
- One Haiku call: read the just-ended transcript + current active facts → structured updates
  `{action:'update'|'retire'|'add', category, entity, old, new, reason}` → apply via the bi-temporal pipeline (T1).
  Reconcile contradictions. ~$0.001/user/day. Makes every next call better than the last.
- Degrade silently on failure — NEVER block the call/briefing path.

### Ticket 3 — In-call memory triggers (P2)
- In the `rememberPreference` (and similar) vapi tool-call handler: on a new preference/fact, check for a
  conflicting existing fact on the same topic and OVERWRITE immediately (retire+insert) — don't wait for
  sleep-time. Return spoken confirmation ("Got it — updated your gym time to 7am"). Next-day briefing is correct.

### Ticket 4 — Pattern detection pass (P2) — EXTENDS the existing M3 Pattern Memory
- We already shipped M3 (`lib/patternMemory.ts`). Deepen it with the temporal history bi-temporal facts now give:
  a weekly scheduled Haiku pass over 30+ days of fact history → commitments kept vs broken, best-recovery weeks,
  people-before-stress, stated-vs-actual time. Output structured pattern facts feeding briefing §3 (alignment).
  Do NOT duplicate M3 — extend it.

> P3 (memory quality scoring + stale-fact surfacing, Core+Design) dispatches after P1/P2 land.
> Small commits, preflight gate (`npm run preflight` from `C:\Users\Derrick\edg3`), update this changelog + Status Board.

---

## 📥 PM DISPATCH — 2026-06-18 (ROUND 2 — CASA DB wiring + Focus Scoreboard)

> Master at `30ff3df`. `git merge master` first. Two tickets in priority order.

### Ticket 1 — CASA DB wiring (unblocks full CASA flow — do this first, it's short)

Security shipped enforcement; Design shipped the screen. You own the last piece.

1. Add `data_consent TEXT DEFAULT 'privacy'` column to `users` table in `lib/db.ts`.
2. Expose `data_consent` from `GET /api/profile` so Design's Settings toggle reads initial state.
3. Wire `POST /api/onboarding/consent` (body: `{ data_consent: 'privacy' | 'improve' }`) — upsert into the column. Design's onboarding screen + settings toggle already POST to this endpoint.

That's it — Design and Security are already done. This unblocks CASA/Google OAuth verification.

### Ticket 2 — ★★★ Focus Scoreboard (the outcome layer)

The backlog item marked `★★★`. This is the heart of the vision — users need to see that Edge is moving the needle on their actual priorities, not just managing their calendar. Build the outcome/scoreboard layer so the Edge Score has a visible story behind it.

Read `ROADMAP-CORE.md §Focus Scoreboard` for the full spec if it exists, otherwise implement:
- A weekly "how did your time map to your priorities?" summary — hours per priority vs target, surfaced in the dashboard.
- The data already exists: `priorities` table + calendar events + `lib/alignment.ts` alignment scores. Wire it into a visible scoreboard surface (new tab or section) so the user can see trend over time, not just today's score.

Ship Ticket 1 first (it's ~30 min), then Ticket 2. Small commits, preflight gate (`npm run preflight` from `C:\Users\Derrick\edg3`), update this changelog + Status Board when done.

---

## 📥 PM DISPATCH — 2026-06-18 (Data control onboarding screen — CASA requirement)

> Master at `65c04dd`. Sync master first. Full spec: `specs/data-control-onboarding.md`.
> This is required for Google CASA verification. Three-lane build — Cam owns the screen, Vijay
> owns enforcement, you own the onboarding step wiring + settings.

**Your piece (Core):**
1. Add a `data_consent` column to the `users` table: `TEXT DEFAULT 'privacy'` — values `'improve'` or `'privacy'`. Additive, no migration drama.
2. Wire a new onboarding step between profile and call-time: show Cam's screen, capture the choice, persist via `UPDATE users SET data_consent = ? WHERE id = ?`.
3. Add a Settings toggle ("Help improve Edg3" on/off) that reads and updates `data_consent`. Reuse the existing settings page.
4. Expose `data_consent` from `/api/profile` so the Settings toggle can read initial state.

**Do NOT ship** without Security confirming the enforcement is in place (their task below). The UI must not lie about Privacy Mode being honored.

**Files:** `lib/db.ts` (column), `app/onboarding/**` (new step), `app/api/profile/route.ts`, Settings page.
**Coordinate:** Cam (screen, claim onboarding in Status Board). Vijay (enforcement — let them merge first, then wire).

---

## 📥 PM DISPATCH — 2026-06-18 (★ FLAGSHIP — First-run Activation Moment, flow + data)

> Master at `a3053cb`. Sync master first. Full spec: `specs/activation-moment.md`.
> Esther owns copy (`content/activation-moment-copy.md`). Cam owns screens. You own flow + data.

**What to build:** New onboarding step(s) that fire immediately after calendar connect.

1. **Priority derivation reveal.** Call `/api/priorities/derive` right after OAuth. Show loading
   state ("Edge is reading your last few months…") for ≥ 5s visible time (hold if faster so
   the reveal isn't jarring). On success: pass derived anchors + evidence rationale to Cam's
   reveal screen. On thin data (< 2 anchors with confidence): show Screen 3b (two quick
   questions) — answers write to fact store same as call preferences.

2. **Accept / tweak flow.** "These look right" → call `/api/priorities/derive/accept` (existing
   endpoint). "Let me adjust" → show editable fields pre-filled with derived anchors → save via
   the same accept endpoint. Both paths write anchors + priorities.

3. **First hero-loop.** After priorities are written, call `/api/day-plan` with the new priorities
   context. Show 1–3 plan actions (truncate to 3 in onboarding — don't overwhelm). "Make it happen"
   → call `/api/day-plan/confirm` → calendar changes → Edge Score appears (post-apply, Screen 5).
   Positive state (Screen 5b) when no actions needed.

4. **Loading state timing:** Hold loading screen for minimum 300ms AFTER derivation returns (don't
   snap straight to reveal). Makes the transition feel intentional.

5. **Edge Score post-apply:** Score must be available after confirm in onboarding context. Show
   even if some components still calibrating — use what we have.

**Files:** `app/onboarding/**`, reuse `lib/priorityDerivation.ts`, `/api/priorities/derive` +
`/api/priorities/derive/accept`, `/api/day-plan`, `/api/day-plan/confirm`.

**Coordinate:** Cam (screens + motion) on shared `app/onboarding/**` files — claim Status Board
before touching. Esther's copy doc has data dependencies for Darren noted at the bottom.

**Thin-data questions write to:** preference facts (same as call memory). These feed the first
morning call.

---

## 📥 PM DISPATCH — 2026-06-17 (T4 — clean call transcript/notes against canonical sources)

> From Derrick's live morning call. Master at HEAD. The SPOKEN call is fine (Edge addresses
> him via `firstName` from profile + references calendar event titles), but the **raw
> speech-to-text TRANSCRIPT + extracted call notes** show homophone errors: "Derrick"→"Derek",
> "Gym"→"Jim". These are what the user reads in the dashboard (call summary / transcript / notes),
> so they erode trust even though the audio was correct.

**T4 — Canonicalize transcript-derived text before storing/displaying.** Extend the T3 grounding:
when saving the call summary, call notes, and any transcript shown in the dashboard, run a cleanup
pass that replaces STT homophones with canonical spellings from (a) the user's profile **firstName /
full name** (Derrick, not Derek), and (b) the user's **calendar event titles** for that day (Gym,
not Jim). Fuzzy/phonetic match, conservative (only replace clear near-matches of known canonical
tokens). Apply in `lib/briefing.ts` call-summary path + the transcript/notes the dashboard renders.
- ⚠️ ALSO verify the source of `firstName`: confirm the user's profile name is actually stored as
  "Derrick" (if onboarding captured it via STT it may literally be "Derek" in the DB → real bug, not
  just transcript). If so, ensure the profile name is editable + correct. Coordinate profile-edit UI
  with Design.

---

## 📥 PM DISPATCH — 2026-06-18 (Trust features — fact API + T3 undo toast)

> Master at `9c2ed83` (1051 green). Sync master first. Full specs in `specs/trust-features.md`.
> These are the three beta-gate trust features. Build in order: T1 unblocked now; T3 after H confirmed.

**T1 — Fact correction API (backend for Design's inline edit).** Design (Cam) is building the
inline edit/delete UI in "What Edge knows" and needs these two endpoints:
- `PATCH /api/memory/facts/[id]` — update `entity` + `detail` for a single fact (user-scoped;
  verify `facts.user_id = session.userId`; return `{ id, entity, detail, category, learnedAt }`).
- `DELETE /api/memory/facts/[id]` — hard delete (user-scoped; priority-sync facts blocked —
  check `category === 'priorities'` and reject with 403 + message). Return 204.
Full spec in `specs/trust-features.md §T1`. **Fully unblocked.** Coordinate with Cam: she builds
the UI now; you ship the endpoints; she wires when they land.

**T3 — Undo toast + score changelog (ship after Ticket H confirmed real score math).** Ticket H
landed real 4-component `scoreBefore`/`scoreAfter`. Now surface the payoff:
- Add `changeLines: string[]` to the `/api/day-plan/confirm` response — 1–3 plain-English lines
  explaining what drove the score change ("Freed 90 min on 'extend runway'", "Removed back-to-back
  buffer gap", "Recovery low — deferred heavy meeting"). Max 3 lines. Pure string composition from
  the applied plan's actions.
- Add `scoreBefore: number` to the confirm response (already computed in H; thread through).
- Post-Apply toast in `DayPlanCard` (coordinate with Cam, Design owns the visual): shows
  "Day reshaped — Edge Score +7" with an **Undo reshape** CTA that calls the existing
  `/api/undo/plan?planId=<id>` endpoint. 30-second timeout. Uses existing undo infrastructure.
- Edge Score card: show delta + 1–3 changelog lines after Apply. Cam wires the visual;
  you supply `changeLines[]` from the confirm response.
Full spec in `specs/trust-features.md §T3`. **Dependency:** Ticket H must be in master (it is ✅).

**T2 — Inbox receipts expandable UI is Design-led.** Backend is done (S4). Cam owns the UI.
You may need to coordinate if she surfaces issues with the Activity tab query in `GET /api/activity`.

---

## 📥 PM DISPATCH — 2026-06-17 (Trust bugs T1 + T2 — Derrick live feedback)

> Two concrete trust-erosion bugs Derrick hit. Queue AFTER Ticket H unless trivial.

**T1 — "Read 20 inbox threads for prioritization" looks robotic + opaque.** `getRecentEmailSignal`
(lib/gmail.ts:313 — **Security-owned file, coordinate with Vijay**) records an `email_signal_fetch`
audit entry every time it runs (briefing, focus rec, scores) → the Activity tab shows the SAME
"20 inbox threads read" line repeatedly. Always 20 because `max:20` cap + user has ≥20 recent
threads. Two trust problems: (a) identical repetition with no detail, (b) you can't see WHICH emails.
By design the audit stores ZERO email content (privacy). **Fix (Core display + Security storage
decision):** (1) collapse/dedupe repeated identical reads in the Activity feed (or filter
`email_signal_fetch` as a read-only internal step like `readCalendar`); (2) make it expandable to
show the actual thread SUBJECTS Edge reviewed — store subjects **encrypted at rest** (we have field
encryption) so it's transparent to the USER about their OWN data while staying protected. Decide the
privacy tradeoff with Vijay. This is the flagship "show your work" trust example.

**T2 — Contact name misread: calendar says "Onsi", memory stored "Ansi".** A People fact reads
"Ansi: …needs to follow up with. ⚠ verify" but the calendar event spells it **Onsi**. Same class as
the earlier Faiza→Pfizer STT/LLM error. **Fix:** (a) when extracting a person fact from a calendar
event, prefer the event's EXACT spelling over a re-transcribed/LLM-normalized version; (b) ship a way
for the user to CORRECT a fact in the "What Edge knows" tab, not just delete it (inline edit →
updates the fact + clears the ⚠ verify flag). Accuracy + user-correctable facts is a core trust
pillar. (Coordinate any People/fact UI with Design.)

**T3 — Calendar/memory GROUNDING layer (generalizes T2; Derrick's idea — high value).** Root class:
Edge trusts the STT transcript over the canonical source. Live example — a call note says "shorten
**Jim's** appointment" when Derrick clearly said **Gym**; also Onsi→Ansi, Faiza→Pfizer. Derrick's
insight: *if Edge already knows which event the user means and that event's title is literally on the
calendar, pull the name from the CALENDAR, not the transcript.* **Build a grounding pass** that, before
saving any fact / call note / event reference, cross-references transcribed proper nouns against (a)
the user's actual calendar event titles (today + this week) and (b) known contacts/facts in memory,
and CORRECTS near-matches to the canonical spelling (fuzzy match — "Jim"≈"Gym", "Ansi"≈"Onsi"). Apply
in the transcript→facts and transcript→notes extraction paths (lib/facts.ts, briefing summary). When
a transcribed token closely matches a calendar title or known name, prefer the canonical form; only
keep the transcript spelling when there's no calendar/memory match. This kills the whole misread class
at the source. Tests with the Gym/Jim, Onsi/Ansi, Faiza/Pfizer cases.

---

## 📥 PM DISPATCH — 2026-06-17 (Ticket H — DEEPEN the hero loop; supersedes G)

> Master at `75d32da` (1015 green). Sync master first. **CORRECTION: the hero-loop
> scaffold from G already EXISTS** (`/api/day-plan` + `/api/day-plan/confirm` +
> `DayPlanCard` + `buildCalendarPlan` + "Improve my day" CTA). The problem is it's
> SHALLOW. Ticket H makes it deep + honest. Don't rebuild the scaffold — extend it.

**H1 — `buildCalendarPlan` only ever proposes ONE thing (a focus block), and the
energy-move branch is dead code.** (`lib/calendarPlan.ts`) Today it creates a focus block
only when `focusScore.topFix.op === 'create'`; the "move draining event" branch requires
`energyScore.worstMismatchEventId`, which `computeEnergyScore` (Whoop-derived, not per-event)
NEVER sets — so it never fires. Result: when Focus is fine (now common after the recalibration),
the plan is empty → the card hides. **Fix:** feed the plan the diagnosis signals we ALREADY
compute but ignore: hygiene flags (`detectHygieneFlags` → 3 back-to-back meetings → insert 15-min
buffers; no deep-work block on busy days → create one), recovery tier (low-recovery + over-scheduled
→ propose moving the heaviest deferrable event to tomorrow — this is the real source for the move
action, replacing the dead `worstMismatchEventId` path), alignment gaps (biggest unaligned time-sink
→ propose trimming/moving), urgent open loops (due today → propose a block). Compose 1–3 concrete,
deterministic actions.

**H2 — The projected score is FAKE and INCONSISTENT.** (`app/api/day-plan/route.ts:89`)
`scoreAfter = edgeScore + actions.length * 12` — a hardcoded guess. AND the route computes its
score with only Focus+Energy (`computeCalendarFit(alignment, priorities, recoveryHistory, todaySleep)`
— no clarity/momentum inputs), so even `scoreBefore` doesn't match the dashboard's 4-component Edge
Score. **Fix:** compute `scoreBefore` with the SAME 4-component inputs as `/api/scores` (pass
clarityInputs + momentumInputs), and compute `scoreAfter` by actually re-deriving the score for the
reshaped calendar (apply the plan's deltas to the event set / alignment and recompute), not a flat
+12. The before→after the user sees must be real and must match the headline.

**H3 — Always say something.** When `actions.length === 0`, the route returns `null` → the card
vanishes (looks like a missing feature). **Fix:** return a positive state ("Your day's well-aligned —
nothing to reshape right now", with the current score) so the card always renders. Design (Cam) will
surface this prominently rather than behind "Improve my day".

Reuse everything; keep `app/dashboard/**` diffs small (SHARED with Design — Cam is doing card
prominence + the spark in the same files; claim Status Board rows, merge frequently). Tests for the
new plan-generation branches + the real score projection. Ship incrementally (H1 first, then H2, then
H3), green at each step.

---

## 📥 PM DISPATCH — 2026-06-16 EVENING (Ticket G — hero-loop scaffold — ✅ EXISTS, see H)

> Master at `2c73f5b` (997 green). Sync master first. This is the #1 strategic build —
> bring the voice `applyCalendarPlan` reshape to the dashboard as ONE visible motion.

**G — Dashboard Hero Loop: one-click "Fix my day".** The hero loop (diagnose → propose →
one yes → reshaped day → re-score) exists in pieces but not as a single on-screen motion.
Build that card on the home tab:
1. **Diagnose** — from data we ALREADY compute: alignment (`/api/scores` → focus drivers,
   `topUnaligned`), hygiene flags (`detectHygieneFlags`), recovery tier, open loops. Surface
   1–3 concrete problems ("0h on 'extend runway' today", "3 back-to-back meetings, no breaks",
   "recovery low — you're over-scheduled").
2. **Propose** — generate a CONCRETE reshaped day: named blocks + times (reuse `/api/day-plan`
   / the `applyCalendarPlan` plan-generation). Show it as a clear before→after, not prose.
3. **One yes** — a single **Apply** button that executes the whole plan atomically via the
   existing `applyCalendarPlan` path (create/move/buffer ops), each `recordUndo`'d.
4. **Re-score** — on success, refetch `/api/scores` so the Edge Score visibly climbs.
   Coordinate with Cam: the spark animation (Design D) fires at this moment.
- REUSE existing: `DayPlanCard`, `applyCalendarPlan`, `/api/day-plan`, alignment, scores, undo.
  Build the missing GLUE + the concrete before→after proposal. Don't rebuild what exists.
- Ship incrementally: diagnose+propose card first (green/mergeable), then wire Apply, then rescore.
- Tests for plan-generation + the apply/undo path. Keep `app/dashboard/**` diffs small (Shared
  with Design — claim in Status Board, coordinate with Cam who's in the same files for D/E).

---

## 📥 PM DISPATCH — 2026-06-16 (NEW — landing page waitlist 404)

> Master at `bda358f` (997 green). **Tickets A + C shipped ✅** (integrated by PM).
> **Ticket F SHIPPED ✅ by PM** (`bda358f`) — landing CTA was launch-blocking and live-broken,
> so PM built it directly. Darren: do NOT rebuild; sync master. Details below for the record.

**F — ~~Build the missing `/api/waitlist` route (landing-page form 404s).~~ DONE (PM).** Security's audit
found that `app/page.tsx` POSTs `{ email }` to `/api/waitlist` (lines 33, 103, 288) but the
route **does not exist** → every waitlist signup 404s. This blocks the whole top-of-funnel for
beta. Build `app/api/waitlist/route.ts` (POST): validate email, persist to a `waitlist` table
(add to `lib/db.ts` — coordinate schema; `email TEXT UNIQUE`, `created_at`, optional `source`),
de-dupe on email (ON CONFLICT IGNORE), rate-limit (add a `waitlist` key to `lib/rateLimit.ts`),
return 200 on success/duplicate (never leak whether an email already signed up). No auth (public
endpoint). Tests. ⚠️ This is the single highest-priority Core item — landing page is live but the
CTA is dead.

---

## 📥 PM DISPATCH — 2026-06-16 (Derrick live feedback: Edge Score feels wrong)

> **Tickets A + C COMPLETE ✅** (shipped by Darren, integrated to master by PM at `3d4c623`).
> **Ticket B shipped by PM** (momentum reward loop). History below for reference.

**A — Recalibrate the Focus Score (it's too harsh).** `computeFocusScore` in
`lib/calendarScore.ts` = `alignedHours / 45 * 100`. The fixed 45h denominator assumes
a fully-blocked week on the top 3 priorities — so a genuinely focused 15–20h week
scores only ~35–45%. Derrick's week IS focused but reads 41.
- **Fix:** score focus as the share of *scheduled, non-routine* time that's priority-aligned,
  with a light coverage floor so a near-empty calendar can't hit 100 off 2h:
  `ratio = aligned / max(committed,1)`; `coverage = min(1, committed/15)`;
  `score = round(100 * ratio * (0.6 + 0.4*coverage))`. Calibrate so a focused 18–25h week
  lands ~70–85 and a meeting-dominated week stays low.
- **⚠️ Critical subtlety (do not skip):** `alignment.unalignedHours` currently INCLUDES
  routine events (meals, etc.) that the Haiku classifier marks "none" — see
  `lib/alignment.ts:130`. If you compute `committed = aligned + unalignedHours` naively,
  **lunch/breakfast will drag the Focus Score down** — a new trust bug. You own `alignment.ts`:
  either return a separate `unalignedWorkingHours` that excludes routine titles
  (gym/walk/meals/commute — reuse the routine set from `lib/timeAllocation.ts`), or filter
  routine before the alignment classify call on the score path. `committed` must = real
  working time only.
- Keep the no-priorities→0 branch + honest drivers. Add tests (focused week → high; meeting-heavy → low; routine must not inflate). **Ping PM if calibration targets feel off before merging.**

**C — Populate the notification center (it only has 1 item — the old email reply).**
Per `specs/notifications.md`, generate notifications for: (1) **Edge Score changed vs yesterday**
— "Edge Score 41 → 47 ▲6" — at most once/day, from `calendar_scores` history; (2) **new
memory/fact learned** (post-call extraction); (3) **new activity** (new `audit_log` mutations not
yet surfaced). De-dupe, cap volume (one score-change notif/day max — no spam), keep the existing
email-reply notification.

Ship small / green / full preflight (real exit code) per item; log each below.

## Changelog
- **2026-06-19** — **Gmail-link → immediate fact extraction (Vijay-routed ticket) — SHIPPED (1951 green).**
  Closes the "no new facts after linking Gmail" report. Root cause: on `?gmail_linked=1` the dashboard
  only kicked **contact ingestion** (`/api/auth/google/gmail/ingest`), never a **fact** pass; and the
  on-load `/api/learned` GET only extracts when `totalFacts < 10`, so an active user (Derrick, ≥10 facts)
  never re-extracted post-connect.
  - `app/api/learned/route.ts`: `GET(req)` now reads `?source=gmail-connect` → `forceExtraction` bypasses
    the thin-facts gate (still requires a Google token + non-spam inbound signal; fire-and-forget; rate-limited).
  - `app/dashboard/page.tsx`: the `gmail_linked` effect now also calls `/api/learned?source=gmail-connect`
    alongside the contact-ingest call, so durable facts populate immediately on connect.
  - 6 new route tests (401 / 429 / thin-trigger / above-threshold-no-trigger / forced-trigger / token-required-even-when-forced).
  - This is the Core-side resolution Vijay routed back (no OAuth-callback / Security change). 1951/1951 green,
    tsc clean, next build clean. ⚠️ Committed on `core` — ready for PM merge.
  - NB: Kevin's R8 re-dispatch (empty-focus guard, classifyEvent/needsPrepSuggestion, M4-4 people_models,
    Briefing V2 free-slot+warmth+recovery-name) was verified **already fully shipped on master** — not rebuilt.
- **2026-06-19** — **Memory-tab extraction P0 batch (Esther dispatch) — SHIPPED (1945 green).**
  Live Memory-tab review surfaced several extraction/data bugs. Fixes:
  - **[1] Self-entity leak under nickname/STT/initial variants.** New `lib/selfName.ts` (pure):
    `soundex()` + `matchesSelfName(entity, userName)`. Matches full name, first name, last name,
    "initial last" / "D. Fung" forms, AND phonetic first-name variants (Soundex) so `"derek"`→
    `"Derrick"` is caught (old guard was exact-match only, leaking "derek: Derrick works with
    Derrick Fung"). `isSelfEntity` in `lib/facts.ts` now delegates to it — so both live extraction
    AND the retroactive `cleanupPeopleFacts` pass now drop these (existing bad rows clean up on next run).
  - **[2] Hallucinated health metric ("weighs 122 lbs" never stated).** New `lib/factGuards.ts` (pure):
    `isUngroundedHealthFact(statement, source)` — a weight/body-measurement fact is DROPPED unless its
    number actually appears in the source text the user produced (transcript / inbox digest). Wired into
    both the transcript and email extraction loops. Prompt also hardened: "NEVER infer health metrics…
    only record if the user explicitly states the number." (Root-cause audit: LLM was inferring the
    number from ambient context; the "from your morning call" label was the generic source stamp — the
    guard prevents the bad write at the source.)
  - **[4] Preference recall gap.** Added an explicit "DO capture preferences" instruction to the
    extraction prompt (how the user likes to work/communicate/schedule) — these were being under-captured.
  - **[5] "Meetings with self" in People.** `extractAttendeesFromEvent` now also filters the user by
    NAME (`matchesSelfName`), not just the `self` flag + email — solo/personal events that list the user
    as a plain attendee (no self flag, secondary email) no longer leak the user into "people you meet
    with." `selfName` threaded through `computePersonInteractions`/`syncPeopleProfiles`/
    `buildRelationshipContextBlock`; briefing passes `user.name`.
  - **[3] No facts after linking a 2nd Gmail — ROUTED TO SECURITY/PM.** Finding: email-derived fact
    extraction is **briefing-triggered** (needs the inbox digest fetched at call time), not OAuth-callback
    triggered — so "nothing new immediately after linking" is expected until the next call. The OAuth
    callback (`app/api/auth/**`) is Security-owned; did not edit. Recommend Security decide whether
    connecting an account should kick a one-off extraction. Deliberately did NOT manufacture a
    "connected a 2nd Gmail account" fact (ephemeral system state, not durable user memory).
  - New: `lib/selfName.ts`, `lib/factGuards.ts` (+ tests). Modified: `lib/facts.ts`, `lib/relationships.ts`,
    `lib/briefing.ts`, `lib/facts.test.ts`, `lib/relationships.test.ts`. +27 tests. 1945/1945 green, tsc
    clean, next build clean. ⚠️ Committed on `core` — ready for PM merge to master.
- **2026-06-19** — **T3-1-B — pattern facts now use `category='pattern'` (Patterns tab fix). SHIPPED.**
  - `lib/factPatterns.ts`: `upsertFact` now stores `category='pattern'` (was `'fact'`), so detected patterns land in the dashboard Patterns section instead of Facts. **Deeper fix:** the `facts` table has no `source` column, so the four `f.source === 'historical-pattern'` read/throttle/retire filters never matched — patterns were write-only (never surfaced in briefing, never deduped on re-run). All four now key on `f.category === 'pattern'`, so patterns surface AND dedup correctly. Removed the dead `HISTORICAL_SOURCE` constant. `lib/briefing.ts` needed no change (reads via `getHistoricalPatterns`). Tests updated. Gated on Vijay's T3-1-A (`'pattern'` in CHECK + type), confirmed in master. 1918/1918 green, tsc clean, next build clean.
- **2026-06-19** — **Round 8 P0 bug fixes — SHIPPED.**
  - **Bug 1 — empty TODAY'S FOCUS card CTA** (`components/ui/FocusRecommendationCard.tsx`): the "Looks right — set focus" CTA rendered on a blank card when `recommendation.areas` was empty. Guard widened (`!recommendation || recommendation.areas.length === 0`) so an empty list shows the learning/empty state — the confirm CTA never appears with no content.
  - **Bug 2 — event classifier** (`lib/eventMatch.ts`): new `classifyEvent(title, description?): EventClass` (9 classes — work-meeting/health/fitness/meal/personal/travel/focus-block/reminder/unknown; dispatch priority order; `unknown` safe default; bare "call" intentionally NOT a work keyword so ambiguous calls stay unknown) + `needsPrepSuggestion(cls)` (true only for work-meeting). Wired into `findNextMeetingNeedingPrep` (`lib/calendarPlan.ts`) so prep blocks are only suggested for work meetings — "PRP" (hair treatment), gym, lunch, doctor no longer get a prep suggestion; it scans on to the next real meeting. `lib/vapi.ts` PREP-ONLY-FOR-WORK note: Edge asks on ambiguous events, never assumes. 16 new tests; one prep timing test updated ("Important call"→"Investor meeting" — generic "call" is now correctly `unknown`).
  - 1917/1917 green, tsc clean, next build clean.
- **2026-06-19** — **Round 8 — SHIPPED (both tickets).**
  - **Ticket 1 — M4-4 social mental models (`people_models`).** New table (PII encrypted, `health_score` confidence, `UNIQUE(user_id, person_name)`, cascade-delete + in `USER_SCOPED_DELETE_ORDER`) + `peopleModelQueries` (COALESCE partial-merge upsert / getForUser / listForUser / deleteForUser) in `lib/db.ts`. `lib/facts.ts`: `derivePersonModelFields` (heuristic goals/comm-style/relationship from a person's facts) + sleep-time consolidation rebuilds each mentioned person's model after extraction. `lib/briefing.ts`: `buildPeopleModelBlock` injects a compact recall block (≤3) when someone on today's calendar has a model (matched by title/attendee/first-name). 15 new tests. ⚠️ cross-lane: added a table to shared `lib/db.ts` per dispatch authorization — Vijay FYI.
  - **Ticket 2 — Briefing V2 proactive wins (all 4, one commit).** (1) Proactive free-slot offer in Part 2 (names a 60+ min block in next ~4h, offers to lock it for P1; vapi acts on yes). (2) Tomorrow look-ahead in Part 3 (points ahead when today's heavy / priority unscheduled tomorrow; skips if tomorrow already dense). (3) Personal-event warmth in Part 1 (broadened to timed social events — dinner/anniversary/date/family — with concrete offer). (4) Proactive recovery offer now names the SPECIFIC most-deferrable timed event today (new heaviest-deferrable computation reusing exported `isRoutineTitle`) instead of generic language.
  - 1905/1905 green, tsc clean, next build clean.
- **2026-06-18** — **Round 7 P0 — full email body reading for memory. SHIPPED.**
  - **The gap it closes:** `getRecentEmailSignal` only read Gmail's ~100-char snippets — Edge could see subject lines but not what emails actually said. Derrick's vision is Edge reading his email to build memory; this makes the Gmail link meaningful.
  - **`lib/gmail.ts`** (⚠️ cross-lane — Security-owned, edited per Esther's explicit dispatch authorization): `getRecentEmailSignal` gains `{ fullBodies?: boolean }`. When true, for up to **10 non-spam threads** it calls `readThread` to fetch the **inbound** body text (excludes the user's own SENT replies), capped **2000 chars/thread**. Spam is filtered BEFORE the per-thread fetch so we don't waste API calls. `EmailSignalItem.body?` added. **In-memory only — nothing stored** (audit log still records subjects only). Design-contract + privacy comment updated.
  - **`lib/briefing.ts`**: passes `fullBodies: true` to the existing email-signal fetch (one fetch feeds both prioritization and memory extraction).
  - **`lib/facts.ts`** `extractAndUpsertFactsFromEmail`: prefers `item.body` over snippet (2000-char slice), skips `isLikelySpam` threads, prompt updated to "headers + body when available".
  - **`lib/emailActivityFilter.ts`**: new `isLikelySpam(subject, sender)` — reuses the ticket-9 subject classifier + a conservative sender check (no-reply/newsletter/mailchimp/etc.; does NOT over-flag shared inboxes like support@/hello@). Used by both the body-fetch and the extraction path.
  - 10 new tests (isLikelySpam + body-preference/spam-skip extraction). 1880/1880 green, tsc clean, next build clean.
  - ⚠️ **Security/PM follow-up:** update `google-verification.md` + the privacy page to state Edge reads inbox **body text** (in-memory, for memory; never stored/sold) — this expands the gmail.readonly use case beyond snippets. CASA flag in ROADMAP-SECURITY.md.
- **2026-06-18** — **Multi-account Google linking UI (P1) — shipped.**
  - Consumes Vijay's backend (merged to master): `GET /api/auth/accounts` (`{calendar:{connected,email,hasGmailScope}, gmail:{connected,email}}`), `GET /api/auth/google/gmail` (→ `{url}`), `POST /api/auth/google/gmail/disconnect`, separate `gmail_tokens` table.
  - `app/dashboard/page.tsx`: replaced the single Google-connect block with TWO sidebar slots. **Calendar account** — existing connect/reconnect/disconnect, subcopy "Reads your calendar and creates events during calls". **Gmail account** (new) — `connectGmail()` (GET → redirect to `url`), `disconnectGmail()` (POST), shows the linked Gmail address when connected, subcopy "Drafts emails on your behalf — reads nothing, send-only", soft nudge "Connect to unlock email drafting" when not. When the calendar account already carries Gmail scope (`hasGmailScope`), the nudge notes drafting currently runs via that account. Dashboard load now hits `/api/auth/accounts` once (replaces the separate calendar-status + gmail-scope checks) → sets `calendarConnected` + `gmailAccount` + `calendarHasGmailScope`.
  - Lets Derrick link his personal Gmail (derrickfung87@gmail.com) separately from his deltaedge calendar account. 1857/1857 green, tsc clean, next build clean.
- **2026-06-18** — **Derrick dashboard-review batch — tickets 4, 5, 6, 7, 10 (+ 8 deferred). 9/10 shipped.**
  - **Ticket 7 — browsable priority history** (`app/api/priorities/history/route.ts` + dashboard `PriorityHistory`): replaced the fixed 4-week heatmap (which projected onto the *current* priority set, so it couldn't show priorities that had changed) with a 1M/3M/6M/1Y range toggle + scannable week-by-week list reading the actual per-week priority rows. Reuses `priorityQueries.getRecentWeeks`. Ages gracefully; gets more useful over time.
  - **Ticket 4 — focus lock-in feels like a moment** (dashboard): the locked daily-focus list now shows a green-check "Today's Focus · Locked in" header + per-item green checks. The proposal card already unmounts on confirm; this gives the clear "locked in" state it was missing.
  - **Ticket 10 — expandable threads** (dashboard): "+N more threads" is now a button that expands the full reviewed-thread list inline, with a "Show less" toggle (per-receipt state).
  - **Ticket 6 — removed avg metric** (dashboard): dropped the "avg Xh/wk" running-average label + bar tick — meaningless when priorities change week to week; hours-this-week kept.
  - **Ticket 5 — naming consistency** (dashboard): audited focus labels — daily consistently "today", weekly "this week"; no mixing found. Canonicalized the locked daily header to keep "Today's Focus" distinct from the weekly "Focus this week" screen.
  - **Ticket 8 — DEFERRED (LOW).** Consolidating the duplicate priority sections (FocusScoreboardPanel analytics cards vs PrioritiesTab editor — both inherently list priorities) is a structural/layout decision in Design's lane; rushing it solo risks the milestone editor. **Recommend:** Core + Design jointly fold milestone editing into the scoreboard cards (or strip the editor's duplicate list), so priorities render once with inline milestone editing.
  - 1818/1818 green, tsc clean, next build clean. ⚠️ Manual: priority-history view needs 2+ weeks of priority rows to show much.
- **2026-06-18** — **PILLAR-TRUST T2-4 — buildBriefingContext extraction + 10 spec-driven regression tests.**
  - `buildBriefingContext(user, data, today?)` pure function extracted from `lib/briefing.ts` and exported. Implements all assembly rules: commitment ordering (past-due source=edg3 tasks first), non-routine calendar before routine (gym/breakfast/etc.), priorities, Whoop, structured facts, calendar-scoped relationship context, personalization floor (≥3 signals → fill-the-gap when not met), confidence hedging ("last I heard — " for conf < 0.5), 16k char cap.
  - 10 spec-driven regression assertions in `lib/briefing.test.ts` covering every rule (sourced from `content/briefing-regression-spec.md`). Any briefing change that breaks these assertions fails preflight.
  - 1828/1828 green, tsc clean, next build clean.
- **2026-06-18** — **Derrick dashboard-review batch — tickets 1, 2, 3, 9 (the HIGH-priority four).**
  - **Ticket 9 — spam filter in email activity** (`lib/emailActivityFilter.ts` + dashboard): the "Threads Edg3 reviewed" panel was showing Instacart receipts, Walmart order confirmations, CNBC newsletters, market blasts. New pure helper (10 tests) classifies noise by subject (promo/receipt/automated/market-news) and the dashboard hides it — always keeping real correspondence + flagged-keyword threads. Shows an honest "just automated mail this scan" line when a scan is all noise.
  - **Ticket 1 — Edge Score "why" reads as a reason** (`lib/scoreChange.ts` + `EdgeScoreCard.tsx`): `buildReason` is now direction-aware — an upward move is never explained by a problem driver ("Up 16 because focus not confirmed yet"). Picks a positive driver for rises, topFix/negative for drops, strips trailing punctuation. Card shows "Up N since X — because <reason>" above the breakdown link. 5 new/updated tests.
  - **Ticket 3 — gate "what I'd change" panel** (`DayPlanCard.tsx`): a non-null plan with zero changes fell through to the full proposal panel + "Make it happen" CTA (a big button that does nothing). Now shows the aligned assessment with no CTA. Applied-state celebration preserved.
  - **Ticket 2 — Today's Focus per-item context** (dashboard): the locked focus list dropped each area's rationale (bare to-do list). Now surfaces the one-line "why this matters today" under each item; hides gracefully when empty; persists across reload.
  - 1818/1818 green, tsc clean, next build clean. Remaining batch: 4,5,7 (MEDIUM), 6,8,10 (LOW). **Claimed `app/dashboard/page.tsx` — Design hold.**
- **2026-06-18** — **PILLAR LOOP 7 — T2-3 honest failure messages + M3-1 smarter stale filter + pillar doc audit.**
  - **T2-3 (PILLAR-TRUST)** (`app/api/vapi/tool-call/route.ts`): `friendlyError` sharpened — 403 now offers "Want me to draft a message to the organizer instead?" (actionable draftEmail path); added rate-limit (429 → "Google Calendar is temporarily rate-limiting") + timeout (ETIMEDOUT/ECONNRESET/ECONNREFUSED → "The request timed out") cases. `FAILURE_RE` updated to match new messages so activity log marks them as failures. Stale test fixed: `VOICES.aria.model` updated `eleven_flash_v2` → `eleven_turbo_v2_5`, removed stale `speed: 1.2` assertion. 1816/1816 green, tsc clean, next build clean.
  - **M3-1 smarter stale filter** (`lib/memorySalience.ts`): `isStaleForBriefing(fact, today)` — 3-condition guard: old (>90d) AND confidence_score < 0.7 AND last_confirmed_at stale. Old facts that were recently reconfirmed by the user stay in briefing context; truly abandoned facts are excluded. `topFacts` updated to call it when `filterStale: true`. Fixed M3-1 gap: `salientFactsEarly` (live 7am briefing) was missing `filterStale: true`; now consistent with 11pm context-pack path.
  - **DC2-4 section size log** (`lib/briefing.ts`): char-count dev log before Anthropic call (`[DC2-4] prompt sections chars: total=... | calText=... | ...`) — lets us diagnose briefing bloat from Railway logs without listening to live calls.
  - **Pillar doc audit**: DC2-2/DC2-4/DC3-1 (PILLAR-DAILY-CALL) + T2-3/T2-4 (PILLAR-TRUST) marked ✅ LIVE (all code already existed); stale DISPATCHED statuses corrected.
- **2026-06-18** — ⚠️ **CONCURRENCY ALERT (PM please read):** a **second session was editing this same `edg3-core` worktree** during the overnight Core loop (§2 isolation violation — never two lanes in one worktree). That session swept up the working tree — including this loop's in-progress M2-3 priority-drift code (`lib/patternMemory.ts`, `lib/db.ts`, `lib/briefing.ts`) — and committed it together with its own M2-4 + UX-4-403 work as **`c14ce31`** + qa-log `fae5e92`. Nothing was lost (M2-3 code is intact in `c14ce31`, tree green at 1747/1747), but attribution is merged and two sessions shared one worktree. PM: please re-establish single-session ownership of `edg3-core`. The M2-3 detail entry below documents the priority-drift work that landed in `c14ce31`.
- **2026-06-18** — **PILLAR-MEMORY M2-3 #5 — priority-drift / stability pattern detection (extends M3, shipped in `c14ce31`).**
  - `lib/patternMemory.ts`: implemented `detectPriorityDriftPattern` — the previously-stubbed `priority_drift` PatternType now has a detector. Pure, takes `PriorityWeek[]` (weekly priority snapshots). **STABLE** signal: one priority anchored ≥70% of weeks AND still current → positive reinforcement ("you've held 'fundraising' across 4 of the last 5 weeks — consistency compounds; worth protecting time for it again"). **CHURN** signal: week-over-week Jaccard < 0.34 with no persistent anchor → opportunity-framed ("priorities have shifted most weeks — picking one to anchor could help it move"), never critical (TONE rule). Returns null on < 3 weeks or moderate/ambiguous signal. 7 new tests.
  - `lib/db.ts`: additive read-only `priorityQueries.getRecentWeeks(userId, weeks=8)` — priorities across the most recent N distinct weeks (text is plaintext, not encrypted).
  - `lib/briefing.ts`: builds `PriorityWeek[]` from history and feeds `detectPriorityDriftPattern` into both `pickBestPattern` call sites. Flows through the existing PATTERN INSIGHT briefing block (section 5). Data-gated: fires once 3+ weeks of priority history accrue; degrades to null before then.
  - 1747/1747 green, tsc clean, next build clean.
- **2026-06-18** — **M2-4 context pack wiring + UX-4 403 message fix.**
  - **M2-4 (PILLAR-MEMORY)**: `generateDailyBriefing` now reads the pre-warmed context pack from `briefing_context_packs`. Logs `[M2-4] context pack HIT/MISS (N chars)` on every call for Railway observability. When the live Whoop fetch fails completely (all three null), the function extracts the Whoop section from the pack as a fallback — addresses the DC2-3b edge case where the token expires between 11pm pack-build and 7am call. Pack data is labeled "(Whoop live-fetch unavailable — using last night's context pack data)" in the prompt. 1747/1747 green.
  - **UX-4 / T2-3 (PILLAR-TRUST)**: `friendlyError` 403 handler in `app/api/vapi/tool-call/route.ts` updated to acknowledge BOTH causes — expired token (reconnect) AND organizer restriction. Old: "you may need to reconnect your calendar." New: "it may be on a calendar that needs reconnecting, or the event was organized by someone else (only the organizer can change it in Google Calendar)." No tests changed — this is a user-facing string fix.
- **2026-06-18** — **M4-1 reconfirmation now fires for fresh STT-garbled facts (helps tomorrow's call).**
  - `lib/factConfidence.ts` `isUnverified`: now also true when extraction flagged a fact categorically `confidence === 'low'` (STT-garbled name/address) — these are uncertain from day one, so they're reconfirmation candidates even on a brand-new account. Previously reconfirmation only fired for 30+ day-old facts, so it would never help a fresh user; this makes it useful on the very next call ("I've got a meeting with Yassen — did I get that right?"). `buildReconfirmationPromptBlock` uses a "did I catch that right?" framing for low-confidence facts vs "last I heard…" for aged ones. 3 new tests (28 total in factConfidence).
  - **Shared-file additive touch** (`lib/db.ts` `factQueries.confirmFact`): now also sets `confidence = 'high'` (not just `confidence_score = 1.0`) so a once-garbled fact the user verifies stops re-triggering reconfirmation every call. Verified Security's Round 6 T2 `confirmFact` tests (partial `toContain`/`toMatch` assertions) still pass. ⚠️ Security: heads-up on this additive change to your function.
  - 1740/1740 green, tsc clean, next build clean.
- **2026-06-18** — **M4-1 reconfirmation polish + flaky-suite fix.**
  - **Category weighting** (`lib/factConfidence.ts`): `selectReconfirmationFact` now ranks candidates by category importance (goal > project > preference > person > fact) before confidence/staleness, so the one reconfirmation question lands on what matters (a stale goal — "still targeting 500K?") rather than trivia. 2 new tests (25 total).
  - **vapi wording fix**: reconfirmation guidance now keys off the spoken "last I heard…" line the assistant actually delivered, not an internal briefing block it never sees.
  - **Flaky preflight FIXED**: `facts.test.ts` + `call-to-briefing.test.ts` didn't mock `./calendar`, so `extractAndUpsertFacts`' auto-fetch of today's events (`getCalendarEvents`, used for name grounding when `calendarEventTitles` is omitted) hit real code that was nondeterministic under parallel load — caused 2–3 intermittent failures per full run. Added `vi.mock('./calendar', { getCalendarEvents: async () => [] })` to both. Three consecutive clean full runs at 1737/1737.
- **2026-06-18** — **PILLAR-TRUST UX-4 — no false hedging on known facts.**
  - `lib/vapi.ts` (live call) + `lib/briefing.ts` (spoken opener): added a NO FALSE HEDGING rule to the GROUNDED & DECISIVE anchor / briefing IMPORTANT rules. Edge states facts confirmed by calendar/priorities/memory plainly — never "I think", "I believe", "maybe", "probably" about something it's certain of. Explicitly carves out the ONE exception: facts under a RECONFIRM instruction (long-unconfirmed) are hedged with "last I heard…" on purpose. This complements M4-1: hedge stale facts deliberately, state confident facts directly. Prompt-only; 1735/1735 green, tsc clean, next build clean.
- **2026-06-18** — **PILLAR-DAILY-CALL DC0-2 — call-to-briefing latency measurement.**
  - `app/api/vapi/webhook/route.ts`: the five post-call memory jobs (tasks, facts, consolidation, open loops, episode) are now captured as promises and wrapped in `Promise.allSettled` to measure end-to-end post-call processing latency. Records `post_call_ms` on the briefing's `learning_status` (no schema change — flexible JSON column). Logs `[DC0-2] post-call memory pipeline Xms`; emits a `[DC0-2] HEALTH:` warn line (scrapeable by Security's T1-3 digest) when latency exceeds the 2-minute target. Gives visibility into whether facts land well within the 30-min window before the next morning's briefing. 1735/1735 green, tsc clean, next build clean.
- **2026-06-18** — **PILLAR-MEMORY M4-1 + Round 6 Ticket 2 — mid-call fact reconfirmation (confidence decay now consumed).**
  - Security's Round 6 T2 (confidence decay schema) has landed: `facts.confidence_score`, `facts.last_confirmed_at`, `factQueries.confirmFact`, and the weekly `decayFactConfidenceScores` cron all exist. This is the Core-side consumer — nothing read `confidence_score` before now.
  - **New `lib/factConfidence.ts`** (pure, 0 I/O, 23 tests): `factConfidence` (default 1.0 for legacy rows), `daysSinceConfirmed` (last_confirmed_at → learned_at fallback), `isSensitiveFact` (keyword guard — health/relationship/finance skip spoken reconfirmation), `isUnverified` (score < 0.3 OR not confirmed 30+ days), `shouldHedge` (score < 0.5 OR stale), `selectReconfirmationFact` (single lowest-confidence non-sensitive active fact, ties broken by most-stale), `buildReconfirmationPromptBlock`. Dual signal (decay score OR recency) so it works even before the decay job's categories fully align.
  - **`lib/briefing.ts`**: picks ONE reconfirmation fact per briefing → injects a `RECONFIRM ONE FACT` block instructing Edge to hedge ("last I heard…") and ask one natural confirmation question rather than stating a stale fact as truth. Also **removed the DC2-3b duplicate** — my prior commit's `whoopContextBlock` "data unavailable" string duplicated the pre-existing inline `WHOOP STATUS` block; reverted to avoid double instruction.
  - **`confirmFact` tool** (`app/api/vapi/tool-call/route.ts`): when the user confirms a reconfirmed fact (no correction), resolves the active fact by topic/entity and calls `factQueries.confirmFact` → resets `confidence_score=1.0`, `last_confirmed_at=now`. Corrections still route through `rememberPreference` (retire+replace).
  - **`lib/vapi.ts`**: RECONFIRM-A-FACT live-call guidance + `confirmFact(topic)` tool doc + placeholder toolId.
  - 1735/1735 green, tsc clean, next build clean.
  - ⚠️ **External step:** create `confirmFact` Vapi tool (param: `topic`, string, required) → paste UUID into `lib/vapi.ts` toolIds and uncomment.
  - ⚠️ **FLAG FOR SECURITY (lib/scheduler.ts):** the weekly `decayFactConfidenceScores` job decays categories `priorities/projects/current_focus/personality/working_style/relationships`, but the `facts` table CHECK constraint only allows `person/project/goal/preference/fact`. The category lists don't match → the decay job currently updates **0 rows** (`confidence_score` stays 1.0 for all real facts). Core's reconfirmation still fires via the `last_confirmed_at` 30-day recency path (intentional dual-signal), but the decay-score path is dormant until Security aligns `VOLATILE_CATEGORIES`/`STABLE_CATEGORIES` to the real fact categories (suggest: volatile = `goal`,`project`; stable = `person`,`preference`,`fact`).
- **2026-06-18** — **QA checklist logged in `content/qa-log.md`.**
  - Code-verifiable items from all three pillars (Memory/Trust/Daily Call) marked pass/fail. Manual live-call items listed in priority order for next 7am call. Blocked/delegated items noted. 1712/1712 green, tsc clean, next build clean.
- **2026-06-18** — **PILLAR-DAILY-CALL DC2-3b — honest Whoop data acknowledgment when fetch fails.**
  - `lib/briefing.ts` `whoopContextBlock`: when `whoopIsConnected` but all three Whoop data points are null (fetch timed out or token needs refresh), now injects a `WHOOP CONNECTED BUT DATA UNAVAILABLE` instruction block. Edge acknowledges with "I wasn't able to pull your Whoop data this morning — I'll try again for tomorrow" rather than silently omitting the health section. The Whoop fetch timing log (already live since DC0-1) provides the audit trail to diagnose repeated failures. 1712/1712 green, tsc clean, next build clean.
- **2026-06-18** — **PILLAR-TRUST T4-5 — undo coverage sweep: planWeek + rememberPreference + fact undo ops.**
  - **`planWeek`** (`app/api/vapi/tool-call/route.ts`): was creating calendar events without any undo record. Fixed by capturing `res.data.id` per insert and calling `recordUndo` with a `deleteMany` op once all events are created.
  - **`lib/undo.ts`**: two new `UndoOp` types — `retireFact { userId, factId }` (undoes a new fact insert by retiring it) and `rollbackFact { userId, historyId }` (undoes a fact update by restoring the prior version via `factHistoryQueries.rollbackFact`). Both handled in `executeUndo`.
  - **`rememberPreference`**: now calls `recordUndo` after every write. For new facts (upsert path): queries the newly created fact by category+entity and records `retireFact`. For updates (updateFact path): reads the `fact_history` row just written and records `rollbackFact`. Both wrapped in try/catch — non-critical, never blocks the main response.
  - `factHistoryQueries` added to `tool-call/route.ts` import. 1712/1712 green, tsc clean, next build clean.
- **2026-06-18** — **PILLAR-MEMORY M4-3b — memory block versioning + rollback.**
  - `lib/db.ts` `upsertFact`: both INSERT paths (new fact + bi-temporal update) now capture `lastInsertRowid` and call `snapshotFactToHistory(newId, userId, 'created')` — every fact creation is logged to `fact_history` (extends M1-4 which only logged retire/edit/extraction-update).
  - `factHistoryQueries.rollbackFact(userId, historyId)` added: reads history row, retires the currently active fact (if any) with a 'retired' snapshot, re-inserts the historical statement/entity/category as a new active fact with `confidence='high'`. Statement stays encrypted byte-for-byte (no re-encrypt needed — `fact_history` stores the raw ciphertext).
  - 6 new tests in `lib/db-facts.test.ts` (M4-3b suite): created-logging after new INSERT, created-logging after bi-temporal UPDATE INSERT, rollback with active fact (retire + re-insert), rollback with no active fact (re-insert only), confidence='high' after restore. 1712/1712 green, tsc clean, next build clean.
- **2026-06-18** — **PILLAR-TRUST UX-2+UX-3 — duplicate entity guard verification + name spelling tests.**
  - **UX-2** (`lib/facts.test.ts`): 4 new tests — blocks "Edg3" and "Edg3 AI" as person entities, consolidates identical goal duplicates, full end-to-end scenario (user + Edge + Edg3 + repeated goal transcript → only goal upserted, 3 blocked). 1696/1696 green.
  - **UX-3** (`lib/facts.test.ts`): 3 new tests — first-name self-entity blocked, full-name self-entity blocked, Anthropic prompt includes userName hint (confirmed the "Derek = Derrick" model-level correction wiring is live). 1696/1696 green, tsc clean, next build clean.
- **2026-06-18** — **PILLAR-TRUST T2-3+T2-4 — honest failure messages + briefing accuracy regression tests.**
  - **T2-3**: Audited all failure paths in `app/api/vapi/tool-call/route.ts`. All major paths were already specific (read-only calendars, 403s, 404s, organizer-restricted events, Gmail scope, rate limits). One vague message fixed: `copyEvents` "Couldn't copy events from X" → now says "Google didn't confirm them — want me to try again?" Error strings match `FAILURE_RE` pattern throughout. `friendlyError` fallback is honest last-resort for unknown failures.
  - **T2-4**: Added T2-4 briefing accuracy regression suite to `lib/briefing.test.ts` (6 new tests): sleep-debt + high-strain composite signal, fallback briefing regression guards (no async-note-box references, brand-name stability), Whoop section format regressions (% symbol, no trailing "0 minutes"), `buildBaselineContext` always outputs today + delta line. Also added the 3-signal composite test (sleep debt + high strain, no red recovery). 1689/1689 green, tsc clean, next build clean.
- **2026-06-18** — **PILLAR-MEMORY M4-2 — outcome-weighted reliability signal for commitment language calibration.**
  - `lib/accountabilityMemory.ts`: Added `ReliabilitySignal` type + `getReliabilitySignal(tasks, today, lookbackDays=30)` — pure function that buckets edg3-sourced tasks into sameDay / thisWeek / longHorizon using `created_at` vs `date` delta. Returns completion rate per bucket (null when <2 data points). `TaskLike` extended with optional `created_at` (present for DC0-1b+ tasks; absent → falls back to same-day bucket, treating date as creation date).
  - `calibrateCommitmentLanguage(text, dueDate, madeAt, signal)` — picks the right horizon bucket and returns calibrated language: high (>0.7) → "did that happen?", medium (0.4–0.7) → "want to block time?", low (<0.4) → "is it still the right priority, or should we let it go?". Falls back to neutral when signal is null.
  - `accountabilityBriefingInstruction` updated to accept optional `ReliabilitySignal` and use `calibrateCommitmentLanguage` for the most overdue outstanding commitment.
  - `lib/briefing.ts`: 30-day task fetch after the 7-day accountability snapshot → `getReliabilitySignal` computes the signal → passed to `accountabilityBriefingInstruction`. Both degrade gracefully on DB error.
  - 13 new tests in `lib/accountabilityMemory.test.ts`. 1683/1683 green, tsc clean, next build clean.
- **2026-06-18** — **PILLAR-MEMORY T0-3 — end-to-end smoke test: "7am path."**
  - `lib/call-to-briefing.test.ts` (new): 18 tests covering the post-call chain:
    `extractAndUpsertFacts` → `factQueries.upsertFact` called; `persistCallEpisode` → `episodeQueries.insert` called.
    Pure helpers covered: `tagTopicsFromTranscript` (domain keyword detection, priority matching, 10-tag cap),
    `tagCommitmentsFromTasks` (cap at 10). DB contract: skips short transcripts (<50 chars), self-entity
    and assistant-entity person facts are filtered, malformed Anthropic JSON degrades without throw.
    End-to-end "7am path" test: both writes fire in the same pipeline and the stored episode surfaces in
    `buildEpisodeMemoryBlock`. 1670/1670 green, tsc clean, next build clean.
- **2026-06-18** — **PILLAR-TRUST UX-1 — landing page brand + timing copy fixes.**
  - `app/page.tsx`: All "Edge" instances replaced with "Edg3" on public-facing surfaces (Derrick's explicit feedback 2026-06-17). "5 minutes" replaced with "3 minutes" throughout (hero, section heading, "How it works" step 1, features list). The mock UI chip showing the assistant speaking updated to "Edg3:" label. 1652/1652 green.
- **2026-06-18** — **PILLAR-DAILY-CALL DC0-1b — after-call memory audit: due date extraction fix.**
  - `app/api/vapi/webhook/route.ts` `extractTasksFromTranscript`: previously hardcoded all commitment tasks to "tomorrow." Now extracts explicit due dates from the transcript ("by Friday", "this week", "next week") and resolves them to YYYY-MM-DD. Return format changed from `string[]` to `{text, dueDate}[]`. Validation falls back to tomorrow if date is malformed. People + goal extraction already correct in `lib/facts.ts` extraction prompt.
  - 1652/1652 green, tsc clean, next build clean.
- **2026-06-18** — **Round 6 T1 + PILLAR-DAILY-CALL DC2-0/DC2-1/DC2-3/DC2-3b — context pack + briefing quality.**
  - **Round 6 T1 — `buildBriefingContextPack(userId)` exported** (`lib/briefing.ts`): New async export collects stable personal context (priorities, salient facts by category, Whoop snapshot, accountability block, open loops, episode memory, weighted memories) and returns it as a labeled string. Calendar events excluded — time-sensitive, must be fetched live. The 11pm scheduler's `runNightlyContextPacks` was already wired and dynamically imports this fn — it activates automatically now that the export exists. 1652/1652 green.
  - **DC2-3b — Whoop timing log + "connected but unavailable" acknowledgment** (`lib/briefing.ts`): Added timing log `{whoopFetchMs, recoveryNull, sleepNull, strainNull}` after the main parallel fetch. Added `hasWhoopConnected(userId)` check — if Whoop is connected but data came back null, briefs Edge to acknowledge once in Part 1 ("Your Whoop data didn't come through this morning — I'll keep trying") rather than silently skipping. Import: `hasWhoopConnected` added to whoop import.
  - **DC2-0 — No-preamble opener rule** (`lib/briefing.ts` + `lib/vapi.ts`): PART 1 instruction now opens with: "CRITICAL — NO PREAMBLE: zero warm-up, zero scene-setting, zero 'here's what we'll cover.' Actionable information within 10 seconds is the standard." `lib/vapi.ts`: added OPENER RULE instructing Edge never to re-greet or re-introduce after the briefing; call is already in motion.
  - **DC2-1 — Forbid routine/predictable opener** (`lib/briefing.ts`): PART 1 instruction strengthened — "ONE sentence ONLY if there is a genuinely meaningful event today (not breakfast, gym, meals, or routine blocks — these are predictable and add nothing)."
  - **DC2-3 — Commitments first in Part 1** (`lib/briefing.ts`): When `edg3Commitment` exists, it moves INTO Part 1 before the Edge Score — "Before the Edge Score, open with the commitment accountability line." Part 2 commitment opening removed to avoid repetition.
  - 1652/1652 green, tsc clean, next build clean.
- **2026-06-18** — **PILLAR-MEMORY M3-3 — commitment tracking: 7-day window + oldest-first ordering.**
  - `lib/db.ts` `taskQueries.getIncomplete`: widened window from `-1 days` → `-7 days` so edg3 commitments from the past week surface in the briefing (not just yesterday's).
  - `lib/briefing.ts` `edg3Commitment`: changed from `.at(-1)` (most recent = newest) to `.at(0)` (oldest = most overdue). The most overdue commitment now opens the briefing, not the most recently-made one. 1706/1706 green, tsc clean, next build clean.
- **2026-06-18** — **PILLAR-MEMORY M3-2 — on-demand memory retrieval: searchMemory Vapi tool.**
  - `app/api/vapi/tool-call/route.ts`: `searchMemory(query)` handler — searches active facts (all, including >90-day stale since user explicitly asked), episodes (topic match via `episodeQueries.search`), and memories (content substring). Returns up to 7 results as spoken lines. Degrades each source independently. If nothing found, offers to remember it now.
  - `lib/vapi.ts`: prompt instruction added — triggers on "what do you know about X?", "do you remember what I said about X?". Placeholder toolId comment added; external step: create tool in Vapi dashboard (param: `query: string, required`), paste UUID, uncomment.
  - `memoryQueries` + `episodeQueries` added to `tool-call/route.ts` import. 1706/1706 green, tsc clean, next build clean.
  - ⚠️ **External step:** create `searchMemory` Vapi tool (param: `query`, string, required) → paste UUID into `lib/vapi.ts` toolIds and uncomment.
- **2026-06-18** — **PILLAR-MEMORY M3-1 — briefing context relevance: 90-day hard cutoff for stale facts.**
  - `lib/memorySalience.ts` `topFacts`: new `filterStale?: boolean` option. When `true`, facts where `recencyScore === 0` (≥90 days since `learned_at`) are excluded before the top-N selection. The recency score was already 0 but other components (type weight, reinforcement) could still pull stale facts into the top 20. Hard cutoff closes this gap.
  - `lib/briefing.ts`: both `topFacts` calls now pass `filterStale: true` — stale facts no longer auto-inject into briefing context or event-linked memory. T2-2 hedge code (`[UNCONFIRMED >90d]`) remains as a defensive measure for any path that bypasses the cutoff. On-demand retrieval (M3-2 `searchMemory`) can still surface stale facts when explicitly asked.
  - 3 new tests. 1706/1706 green, tsc clean, next build clean.
- **2026-06-18** — **PILLAR-MEMORY M2-2 — in-call memory trigger: always-write + fact_history + specific confirmation.**
  - `app/api/vapi/tool-call/route.ts` `rememberPreference`: when `isUpdate` (existing fact with different statement), now calls `factQueries.updateFact` (snapshots old value to `fact_history` with reason `'user-edit'`, always overwrites) instead of `upsertFact` (which skips high-confidence facts). Fixes silent no-op when user explicitly says "update X." Spoken confirmation now includes the topic name: `"Got it — I've updated "goal" in your memory."` 1703/1703 green, tsc clean, next build clean.
- **2026-06-18** — **PILLAR-MEMORY M2-1 — sleep-time consolidation: duplicate active fact reconciliation.**
  - `lib/facts.ts` `runSleepTimeConsolidation`: before the Haiku call, sweeps active facts for same entity+category pairs (race condition / import bug artifact). Keeps the most-recently-learned fact; retires the older one. Logs count when any are retired. Confidence-decay portion of M2-1 (flag facts not confirmed in 60+ days) remains BLOCKED on Security Round 6 T2 (confidence decay schema). 2 new tests. 1703/1703 green, tsc clean, next build clean.
- **2026-06-18** — **PILLAR-DAILY-CALL DC2-4 — briefing length calibration: 220-word / 3-minute target.**
  - `lib/briefing.ts`: PART 1 tightened from "2–3 sentences" → "2 sentences MAX"; PART 2 from "4–5 sentences" → "3–4 sentences MAX". `max_tokens` lowered 320 → 290 (≈223 words ceiling, enforces the stated 220-word limit). Word count log added post-generation: `[DC2-4] briefing N: X words` — warns at >250 words for monitoring. Total call duration target: ≤3 minutes (briefing text ≈90s + user response). 1701/1701 green, tsc clean, next build clean.
- **2026-06-18** — **PILLAR-DAILY-CALL DC2-2 — personalization signal: 3-fact floor + reconfirmation.**
  - `lib/briefing.ts`: `buildPersonalizationPromptBlock(factCount)` exported pure helper. Returns a `PERSONALIZATION SIGNAL` instruction block when `factCount < 3` — directs Edge to close the call with a personal-context question ("what's the challenge you feel most stuck on?") instead of a generic focus question. Returns null when ≥3 facts (normal path). Used in PART 3 of the user prompt; stale-priorities nudge suppressed when personalization fires to avoid two competing closing asks.
  - 5 new tests in `lib/briefing.test.ts`. 1701/1701 green, tsc clean, next build clean.
- **2026-06-18** — **PILLAR-TRUST T2-2 — stale fact hedging in briefings.**
  - `lib/briefing.ts` `linkedMemory` formatter: facts with `learned_at` > 90 days ago are now marked `[UNCONFIRMED >90d]` in the EVENT-LINKED MEMORY block. Added instruction line telling the model to preface marked facts with "last I heard…" when spoken. No change to other sections — the hedge fires only in the event-linked memory path where facts are surfaced as statements. 1523/1523 green.
- **2026-06-18** — **PILLAR-MEMORY M1-3 + M1-4 — fact freshness + fact_history audit trail.**
  - **M1-3 fact freshness** (`lib/db.ts` `upsertFact`): On exact-match (same statement already active), now updates `learned_at=datetime('now')` regardless of confidence. Prevents facts seen repeatedly from drifting toward "stale" classification. High-confidence + different statement still silently skips (user edit wins). Low-confidence + same statement → learned_at refreshed.
  - **M1-4 fact_history audit table** (`lib/db.ts`): `fact_history` table (id, fact_id, user_id, statement encrypted, entity, category, retired_at, reason). `snapshotFactToHistory()` internal helper — copies raw encrypted statement byte-for-byte, non-fatal try/catch. `factHistoryQueries.getForFact(factId, userId)` + `getRecentForUser(userId, limit)` exported. Snapshot fires in: `retire()` (reason='retired'), `updateFact()` (reason='user-edit'), `upsertFact` bi-temporal path (reason='extraction-update').
  - 1523/1523 green, tsc clean, next build clean.
- **2026-06-18** — **Learning pipeline reliability — per-call learning status.**
  - **`lib/db.ts`**: `"ALTER TABLE briefings ADD COLUMN learning_status TEXT"` migration. `briefingQueries.updateLearningStatus(briefingId, update)` — read-merge-write JSON patch; non-fatal try/catch (observability only).
  - **`app/api/vapi/webhook/route.ts`**: Each fire-and-forget (fact extraction, sleep-time consolidation, open loops, episode store, briefing task extraction) now calls `updateLearningStatus` on `.then()` with `{ facts_ok: true }` and on `.catch()` with `{ facts_ok: false, facts_error: String(err).slice(0,200) }`. Failure still console.errors — learning status is additive, not a retry mechanism. **DC0-1 extension:** fact extraction path now captures `facts_extracted` count + `extraction_ms` timing; sets `flagged_for_review: true` + console.warn when count === 0. `extractAndUpsertFacts` return type changed `void → number` (stored count, 0 on catch).
  - **`app/api/admin/briefings/route.ts`**: Added `learning_status` to SELECT. New `?failed=1` query param filters to briefings with any `_ok":false` in `learning_status` — allows admin to surface any call where learning failed silently.
  - 1696/1696 green, tsc clean, next build clean.
- **2026-06-18** — **Edge Score Transparency — `change` field in GET /api/scores.**
  - **`lib/scoreChange.ts`** (new, pure, 0 I/O): `summarizeScoreChange(currentTotal, currentComponents, prevSnapshot, today)` → `ScoreChangeSummary { delta, direction, sinceLabel, reason, asOf }` | null. Diffs today's score vs the most-recent prior `calendar_scores` snapshot. Picks the component that moved most (focus vs energy — DB only persists these two; clarity/momentum excluded from dominance). Phrases one plain-English reason: up → first driver of dominant component; down → topFix.description if available, else first driver. `sinceLabel` is "since yesterday" / "since N days ago" / "since Mon DD" depending on gap. Returns null when no prior snapshot, same-date snapshot, or prior has no `edge_score`. 13 new tests in `lib/scoreChange.test.ts`.
  - **`lib/db.ts`**: `calendarScoreQueries.getPrior(userId, beforeDate)` — fetches the most recent row with `date < beforeDate` (used to avoid same-day self-diff).
  - **`app/api/scores/route.ts`**: fetches `getPrior` after upsert, runs `summarizeScoreChange`, adds `change` object to JSON response when non-null. Non-fatal try/catch — scores still return on any failure. `computeAlignment` already uses `temperature: 0` for deterministic Focus Score.
  - 1523/1523 green, tsc clean, next build clean.
- **2026-06-18** — **Round 5 complete — Memory self-learning flywheel (T1–T4).**
  - **T1 — Bi-temporal facts** (`lib/db.ts`, `lib/facts.ts`): `valid_from`/`valid_until` columns on `facts` table; `factQueries.retire()` sets `valid_until=now()`; `upsertFact` bi-temporal conflict path — low-confidence existing fact is retired, new inserted (history preserved); all briefing/memory reads filter `valid_until IS NULL`. `getAllIncludingRetired()` added for T4 history analysis. `lib/db-facts.test.ts` (10 tests).
  - **T2 — Sleep-time consolidation agent** (`lib/facts.ts`): `runSleepTimeConsolidation(userId, transcript, userName?)` — one Haiku call after each call; structured `{action:'update'|'retire'|'add'}` output → applies via bi-temporal pipeline; wired in webhook fire-and-forget after `extractAndUpsertFacts`. Degrades silently (<50 char transcript → early return). 7 new tests in `lib/facts.test.ts`.
  - **T3 — In-call memory triggers** (`app/api/vapi/tool-call/route.ts`, `lib/vapi.ts`): `rememberPreference` handler expanded to accept `topic` and `category` params; looks up existing fact by entity and detects update vs. new; returns "updated" vs. "saved" confirmation. Prompt updated with overwrite guidance. ⚠️ External: add optional `topic`/`category` params to Vapi `rememberPreference` tool.
  - **T4 — Historical pattern detection** (`lib/factPatterns.ts`, `lib/patternMemory.ts`, `lib/briefing.ts`): weekly Haiku pass over bi-temporal fact history → `commitment_follow_through` + `priority_drift` patterns; weekly throttle (6.5d cache); results stored as JSON fact rows (`source='historical-pattern'`); `PatternType` extended; `pickBestPattern` TYPE_RANK updated; `patternMemoryBlock` spreads `getHistoricalPatterns()` alongside M3 calendar/Whoop patterns. 9 new tests in `lib/factPatterns.test.ts`. 1506/1506 green, tsc clean, next build clean.
  - **Voice naming reconciliation**: `daniel`/`aria` keys replace `male`/`female` system-wide (db, api, scheduler, vapi, tests). `app/api/profile/voice/route.ts` created for Design's voice UI. Dashboard conflict resolved (Design's voice picker section is canonical; Core's duplicate removed).
- **2026-06-18** — **Voice preference — per-user male/female voice override.**
  - **`lib/vapi.ts`** — `VOICES` map with both configs (male: Daniel `3WqHLnw80rOZqJzW9YRB` eleven_turbo_v2_5; female: `cgSgspJ2msm6clMCkdW9` eleven_flash_v2). `initiateCall` adds `voicePref` param; wires `VOICES[voicePref]` into BOTH the inline assistant `voice:` block AND `assistantOverrides.voice` so it applies regardless of whether `VAPI_ASSISTANT_ID` is set. No Vapi dashboard step needed.
  - **`lib/db.ts`** — `voice_preference TEXT NOT NULL DEFAULT 'male'` migration added; `userQueries.setVoicePreference(id, pref)` added; `User.voice_preference` optional field.
  - **`lib/scheduler.ts`** — both `scheduleBriefingCall` and `scheduleOpenCall` now pass `user.voice_preference` to `initiateCall` (defaulting to `'male'`).
  - **`app/api/profile/route.ts`** — GET returns `voice_preference`; POST accepts `voice_preference` standalone (no `profile_summary` required); validates against `{'male','female'}`.
  - **`app/dashboard/page.tsx`** — "Edge's voice" section in ProfileTab: two buttons (Daniel / Female), immediate save on click, "Applies to your next call" note.
  - 6 new tests (VOICES map shape × 3, initiateCall voice path × 3). No Vapi dashboard step. 1480/1480 green, tsc clean, next build clean.
- **2026-06-18** — **Memory trust fix — people/goals hallucination guards.**
  - **`isAssistantEntity()`** — new guard blocks Edge/Edg3/AI as person contacts at upsert (and in email path).
  - **`isActivityEntity()`** — blocks gym, workout, lunch, etc. from being filed as people (STT homophone fix).
  - **M2 contact cross-check** — `extractAndUpsertFacts` loads `peopleProfileQueries.listForUser` and drops low-confidence person facts with no real contact match when M2 data is available. Degrades gracefully when M2 is empty (no filter applied).
  - **Fuzzy entity dedup in `consolidateFacts`** — Pass 2 merges groups where one entity is a substring of the other (e.g. "Pfizer" + "Pfizer CIBC" → "Pfizer"). Guards against over-merging first names. Reuses the existing `reduceGroup` sort/bestStatement logic.
  - **Tighter extraction prompt** — "person" category line explicitly excludes Edge/Edg3, activities, and companies. New CONCRETE DETAILS rule: prefer "Derrick's dad's birthday is June 15" over "Dad has a birthday."
  - **`cleanupPeopleFacts(userId, userName?)`** — exported idempotent cleanup for existing bad data: removes self/assistant/activity entities and unmatched low-conf facts; calls `consolidateFacts` to merge fuzzy dups. Returns `{ removed }`.
  - **Email path guards** — `extractAndUpsertFactsFromEmail` now applies all three person guards (self, assistant, activity).
  - **Dashboard JSX fix** — two `{!secCollapsed && <div>...</div>}` blocks had a missing `}` causing malformed JSX tree; fixed by closing the conditional block before the show-more button expression.
  - 7 new tests in `lib/facts.test.ts` (`people fact guards` describe block). 1425/1425 green, tsc clean, next build clean.
- **2026-06-18** — **Briefing V2 + Episode dashboard surface.**
  - **Briefing V2 prompt improvements** (`lib/briefing.ts` + `lib/vapi.ts`):
    - **#1 — Recovery tied to specific events.** Green recovery now encourages pushing hard on a NAMED calendar event, not a generic "solid day ahead." Red recovery names the heaviest deferrable block and offers to move it.
    - **#4/#5 — Afternoon free-slot + goal choice.** When FREE TIME SLOTS shows an open afternoon window and multiple priorities exist, PART 2 offers a choice: "Would you rather push on [A] or [B]?" Proactive, not passive.
    - **#7 — Forward-look to tomorrow.** PART 3 adds one forward-looking sentence about tomorrow's meaningful events or free windows (e.g. "Tomorrow you've got a clear morning — I'll protect it for deep work.").
    - **#8 — Personal all-day event warmth.** PART 1 now acknowledges birthdays/anniversaries in a warm sentence with a small offer. `lib/vapi.ts` voice guidance added for mid-call recognition.
  - **Episode dashboard surface** (`app/api/episodes/route.ts` + `app/dashboard/page.tsx`):
    - `GET /api/episodes` (new): returns last 10 episodes in 90-day window. Auth + rate-limited via `meetingContext`.
    - Memory tab: new "Call history Edge remembers" section — each episode shows date, topics (up to 4), first commitment + overflow count. Renders below the "Past commitments" section.
  - **Episode retention** (`lib/db.ts` + `lib/scheduler.ts`):
    - `episodeQueries.pruneAll(keepDays=548)` — global retention variant for scheduler.
    - Wired into nightly 3am UTC prune cron alongside open_loops, watched_threads, oauth_state, and email subjects.
  - 1418/1418 green, tsc clean, next build clean.
- **2026-06-18** — **Episode Store — episodic memory tier (M5).**
  - **`lib/db.ts`** — `episodes` table (id, user_id, source, occurred_at, content_raw encrypted, topics JSON, commitments JSON, created_at). Index on `(user_id, occurred_at DESC)`. `EpisodeSource` type, `Episode` interface, `episodeQueries` (insert/recent/search/prune).
  - **`lib/episodeStore.ts`** (new, pure ingestion + query):
    - `tagTopicsFromTranscript(transcript, priorityTexts)` — keyword-based tagging matching priority texts + domain vocabulary (fundraising, runway, fitness, hiring, product, launch, revenue, customers). Zero LLM cost. Caps at 10 tags.
    - `tagCommitmentsFromTasks(taskTexts)` — reuses already-extracted task texts; caps at 10.
    - `persistCallEpisode(userId, transcript, occurredAt, priorityTexts, taskTexts)` — write path; skips if transcript < 50 chars.
    - `buildEpisodeMemoryBlock(userId, priorityTexts, todayEventTitles)` — query path; fetches last 5 episodes (last 30 days) matching current topic overlap; formats EPISODIC MEMORY block for briefing prompt. Returns '' when no relevant episodes.
  - **`app/api/vapi/webhook/route.ts`** — fire-and-forget `persistCallEpisode` after open-loop extraction; dynamic import so webhook path never blocked on episode failure.
  - **`lib/briefing.ts`** — imports `buildEpisodeMemoryBlock`; computes episode block after `latestPriorities` declaration; injects EPISODIC MEMORY section into briefing prompt when non-empty.
  - **`lib/episodeStore.test.ts`** (new) — 11 tests for `tagTopicsFromTranscript` + `tagCommitmentsFromTasks`. 1418/1418 green, tsc clean, next build clean.
- **2026-06-18** — **M4 Accountability Memory — commitment outcome tracking + briefing reflection.**
  - **`lib/accountabilityMemory.ts`** (new, pure, zero I/O):
    - `buildAccountabilitySnapshot(tasks, openLoops, today, lookbackDays=7)` — takes edg3-source tasks
      + `commitment_made` open_loops for the last N days; splits into `done` vs `stillOpen` with
      `daysOpen`, `completionRate`, and `dueDate` metadata. `completionRate` is null when < 2
      commitments (avoids misleading "100%" on first use). Today's open tasks excluded (too fresh).
    - `formatAccountabilityForBriefing(snapshot)` — formats done/open list with age/due-date labels.
      Caps `stillOpen` display at 3 + overflow note. Returns '' when nothing to surface.
    - `accountabilityBriefingInstruction(snapshot)` — if open items exist: ask about most overdue
      in section 4 ACTION ITEMS, offer to reschedule or drop ("never shame — curious, not judgmental").
      If all done: encourage briefly in GREETING or closing. Returns '' when no commitments.
  - **`lib/briefing.ts`**: ACCOUNTABILITY block injected into the briefing prompt when
    `accountabilitySnapshot` has past commitments. Falls back to old single-line `YESTERDAY'S
    COMMITMENT` block when snapshot is empty (backwards-compatible). Fixed `require('./db')` ESM
    bug — now uses the already-imported `openLoopQueries` at top level. Inputs: all 7-day tasks
    (done + incomplete) + open+done open_loops; zero new API calls.
  - **`GET /api/accountability`** (new): returns `buildAccountabilitySnapshot` for the current user
    scoped to 7 days; rate-limited via `meetingContext` (30/hr).
  - **`app/dashboard/page.tsx`**: `accountability` state + `/api/accountability` fetch. Memory tab
    "Past commitments" section: ⏳ stillOpen cards (age + due date) + ✓ done cards + completion
    rate badge. Appears above "Patterns Edge has noticed".
  - **`lib/accountabilityMemory.test.ts`** (new): 18 tests — all snapshot, format, and instruction
    pure-function paths. All 1407/1407 green, tsc clean, next build clean.
- **2026-06-18** — **M3 Pattern Memory — behavioral patterns from calendar + Whoop history.**
  - **`lib/patternMemory.ts`** (new, pure, zero I/O): 4 detectors:
    - `detectProductiveDayPattern` — which days have the most uninterrupted ≥60min blocks (proxy for deep work)
    - `detectLightDayPattern` — which day consistently has the fewest meetings (≥20% below median)
    - `detectMeetingLoadRecoveryPattern` — do heavy-meeting days (≥5 events) precede lower Whoop recovery?
    - `detectFocusWindowPattern` — which 2-hour slot is most consistently meeting-free across weeks
    - `pickBestPattern(patterns[])` — picks highest-confidence, most-evidenced pattern
    - `formatPatternForBriefing(pattern)` — formats as briefing prompt block with confidence + sample count
  - **`pattern_cache` table** added to `lib/db.ts` (one row/user, JSON blob, refreshed each briefing).
    `patternCacheQueries`: `get` (read cached patterns) + `upsert` (replace on each briefing run).
  - **Briefing wiring** (`lib/briefing.ts`): patterns computed inline from already-fetched `pastCalendarHistory`
    + `recoveryHistory` — zero extra API calls. Best pattern injected as `PATTERN INSIGHT` block in section 5
    (calendar blocks). Cache upserted fire-and-forget. Both the inline block AND cache update degrade silently.
  - **`GET /api/patterns`** — reads `pattern_cache` for user; returns `{ patterns }` for dashboard.
  - **Dashboard Memory tab**: "Patterns Edge has noticed" section with summary + confidence + data points.
    Populated from first briefing call; empty before then (no cold-start cost).
  - 18 new tests for all 4 detectors + pickBestPattern + formatPatternForBriefing.
    1389/1389 green, tsc clean, next build clean.
- **2026-06-18** — **M2 Relationship Memory — people profiles from calendar attendees.**
  - **`lib/relationships.ts`** (new, pure + sync layer): `extractAttendeesFromEvent` strips self/selfEmail;
    `computePersonInteractions(pastEvents, upcomingEvents, selfEmail, nowIso)` — pure, no I/O — groups attendees
    by display name, counts past interactions, finds `lastInteraction` (most recent past date) and
    `upcomingInteraction` (earliest future date). `syncPeopleProfiles(userId, ...)` — I/O wrapper, upserts top 50
    by interaction count, fire-and-forget safe. `buildRelationshipContextBlock(upcomingEvents, profiles, selfEmail)`
    formats a briefing-ready block for attendees with ≥2 past interactions. `formatInteractionContext` — compact
    "met 5× · last Jun 10" string.
  - **`people_profiles` table** added to `lib/db.ts`: `canonical_name`, `email`, `interaction_count`,
    `last_interaction`, `upcoming_interaction`, `updated_at`. Unique index on `(user_id, canonical_name)`.
    `peopleProfileQueries`: `listForUser`, `getByName`, `upsert` (ON CONFLICT DO UPDATE). Migration for `email`
    column (try/catch safe for fresh installs).
  - **`GET /api/relationships`** — returns profiles sorted by interaction_count DESC; rate-limited via
    `meetingContext` key (30/hr).
  - **`POST /api/relationships/sync`** — triggers 30-day past + 14-day upcoming calendar fetch + upsert; rate-limited.
  - **Briefing wiring** (`lib/briefing.ts`): fire-and-forget `syncPeopleProfiles` after each briefing's calendar
    fetch (keeps profiles fresh at zero cost). `buildRelationshipContextBlock` injected after MEETING PREP — Edge
    gets "met N× · last Jun 10" for each attendee with history. Degrades silently when no data.
  - **Dashboard Memory tab**: "People you meet with" section shows canonical_name, met count, last date, next
    date (indigo) — rendered before Call notes, sorted by interaction_count DESC.
  - 17 new tests (extractAttendeesFromEvent, computePersonInteractions, formatInteractionContext).
    1353/1353 green, tsc clean, next build clean.
- **2026-06-18** — **Focus Scoreboard — outcome layer + 4-week trend (Ticket 2).**
  - **`computeWeeklyBreakdown(events, priorities, numWeeks)` pure helper** added to `lib/timeAllocation.ts`.
    Splits calendar events into weekly Sun–Sat buckets going back `numWeeks` weeks. For each bucket, applies the
    same keyword + goal-category matching as `computeTimeAllocation` (fitness goals get exercise credit).
    Returns `WeeklyBucket[]` oldest-first: `weekLabel` ("Jun 9"), `weekStart` (ISO), `perPriority`, `otherHours`.
    7 new tests in `lib/timeAllocation.test.ts`.
  - **`GET /api/scoreboard`** new endpoint: fetches current week events + past 4 weeks of calendar events in
    parallel; runs keyword-based `computeWeeklyBreakdown` for the trend (no LLM cost); returns per-priority
    `{ hoursThisWeek, weeklyAvgHours, milestoneDone, milestoneTotal, milestones[], weeklyTrend }`.
    7 tests in `app/api/scoreboard/route.test.ts`.
  - **`FocusScoreboardPanel`** component added to `app/dashboard/page.tsx` (self-contained, fetches
    `/api/scoreboard` on mount). Renders at the top of the Priorities tab — above the `PrioritiesTab` edit form.
    Shows: per-priority cards with hours bar + avg marker + trend arrow (↑/↓) + milestone count + energy cost
    badge; 4-week trend table (hours per priority per week). Degrades to null when no priorities or loading.
  - 1335/1335 green, tsc clean, next build clean.
- **2026-06-18** — **Compliance gate — `data_consent` DB column + consent endpoint (unblocks CASA).**
  - `lib/db.ts`: added `"ALTER TABLE users ADD COLUMN data_consent TEXT CHECK(data_consent IN ('improve', 'privacy'))"` to the migrations list. Added `userQueries.setDataConsent(id, consent)` to persist the user's choice.
  - `GET /api/profile`: now returns `data_consent` (defaults to `'privacy'` when null — Privacy Mode is the safe default).
  - `POST /api/onboarding/consent` (new endpoint): auth + rate-limited; validates `data_consent` is `'improve'` or `'privacy'`; calls `setDataConsent`; returns `{ ok: true }`. Both the onboarding `ConsentStep` and dashboard `DataConsentToggle` already POST to this URL — they are now wired.
  - 7 new tests (401, 429, invalid JSON, missing field, invalid value, privacy, improve). 1320/1320 green, tsc clean, next build clean.
- **2026-06-18** — **Trust Bug T2 — prefer event-title spelling in fact extraction.**
  - `extractAndUpsertFacts` now auto-fetches today's calendar events when `calendarEventTitles`
    is not supplied (call site in the webhook is unchanged). Event-title names are combined
    with stored person facts and passed to BOTH the Tier-1 `groundProperNouns` pre-pass AND
    the Haiku `knownNamesLine` hint, so the model uses the exact event spelling (e.g. "Jim" from
    "1:1 Jim") rather than the STT re-transcription when they're a phonetic near-miss.
  - 1246/1246 green, tsc clean.
- **2026-06-18** — **Activation loading — 5 s minimum hold + 300 ms post-return buffer.**
  - `ActivationStep` in `app/onboarding/page.tsx`: tracks derivation start time; delays the
    transition to the reveal by `max(5000 − elapsed, 300)` ms so the loading orb is always
    visible for at least 5 seconds and the reveal never snaps immediately even on a fast network.
  - Prevents the jarring "blink" when `derivePriorities` returns in < 300 ms.
  - Thin-data path (null proposal) advances immediately (no point holding for 5 s on nothing).
  - 1240/1240 green, tsc clean.
- **2026-06-18** — **T4 — STT transcript canonicalization (3 write paths).**
  - **`canonicalNamesFromProfile(userName)`** pure helper added to `lib/grounding.ts`. Splits a
    user's profile name ("Derrick Fung") into proper-noun tokens for use as canonical names in
    the Tier-1 grounding pass. Tokens < 3 chars filtered; deduplicates automatically.
  - **Full call transcript (stored in DB):** before `briefingQueries.update` in the webhook
    `call-ended` block, applies `groundProperNouns` with user name + person facts. Corrects
    1-edit near-misses (e.g. "Derick" → "Derrick") before the transcript is persisted — what
    the user sees in the dashboard deep-link is already canonical.
  - **Call-summary path (`saveCallSummaryToCalendar`):** extended existing T3 grounding to also
    include user name tokens and today's calendar event titles (via `extractNamesFromEventTitles`
    + `getCalendarEvents`). Event titles are the canonical source for event-specific names (e.g.
    "1:1 Jim" → corrects STT "Gym" before the Haiku summarization pass).
  - **Call notes / user-response memory (`analyzeUserResponse` in `lib/briefing.ts`):** applies
    grounding with user name + person facts before `memoryQueries.create('transcript', ...)`.
    What the user reads in the "What Edge knows" tab is canonical.
  - Tier-1 threshold (edit-distance ≤ 1 post-phonetics) is intentionally conservative — "Derek"
    (3 edits from "Derrick") is left for Tier-2 Haiku; "Derick" (1 edit) is corrected.
  - 6 new tests. 1246/1246 green, tsc clean.
- **2026-06-18** — **Activation Moment data-wiring: 4 bugs fixed, flow wired to real endpoints.**
  - Resolved merge conflict with Cam's activation UI (Cam's visual components win: `ActivationReveal`, `ActivationHeroCard`, `ActivationHeroAligned`, `ActivationLoading`). Step flow: `profile → calendar → activation → hero → priorities → calltime`.
  - **[Bug 1] `ActivationStep.handleAccept` sent no body** — `/api/priorities/derive/accept` requires `{ priorities: string[] }`; was posting empty. Fixed: passes `proposal.priorities.map(p => p.text)`.
  - **[Bug 2] `HeroStep` fetched `/api/edge-score` (404)** — real endpoint is `/api/scores`; field is `edgeScore` (number), not `clarityScore` (object). Fixed.
  - **[Bug 3] `HeroStep` expected `plan.suggestion` (never set)** — `/api/day-plan` returns `{ changes[], scoreBefore, scoreAfter, planId, wellAligned }`. Fixed: maps `changes[0]` to `HeroSuggestion { action, rationale, timeGained }`. `wellAligned===true` or empty changes → `ActivationHeroAligned` (positive state).
  - **[Bug 4] `HeroStep.handleApply` posted to `/api/day-plan/apply` (doesn't exist)** — real endpoint is `POST /api/day-plan/confirm` with `{ planId }`. Fixed: stores `planId` from plan response, calls confirm, reads `newScore` to update Edge Score reveal.
  - Restored `PrioritiesStep` as the manual-entry fallback (deleted in prior core-only commit; needed for Tweak path and thin-data skip).
  - 1240/1240 green, tsc clean, next build clean.
- **2026-06-18** — **FLAGSHIP — Activation Moment: derive-and-reveal after calendar connect (increment 1).**
  - **Replaces the manual priorities step with `ActivationStep`** in `app/onboarding/page.tsx`. New step order: `profile → calendar → activation → calltime`.
  - On mount, `ActivationStep` immediately fires `GET /api/priorities/derive` (no user action needed — auto-starts the moment the step renders, right after the 1.4s calendar-connect celebration).
  - **5 internal states:**
    1. `loading` — shows `PriorityDerivationLoadingCard` (animated skeleton) + "Edge is reading your last few months…"
    2. `proposal` — shows `PriorityDerivationCard` with 2–3 derived anchors, one-line rationale per anchor, evidence tags, data provenance ("Based on N events · M emails · K facts from the last 90 days").
    3. `accepting` — "Setting…" disabled state while POST `/api/priorities/derive/accept` runs, then advances to calltime.
    4. `tweaking` — inline edit mode with pre-filled inputs (Edge's texts); "← Back" returns to proposal.
    5. `fallback` — for sparse calendar / derive failure: loads `/api/onboarding/suggest-priorities` (profile-based suggestions) + shows manual 3-input form identical to the old priorities step. User's entries saved to `/api/onboarding/priorities`.
  - **Graceful degradation:** users who skip calendar connect land in fallback automatically (no calendar events → derive returns null → fallback triggers). No fabricated priorities on thin data.
  - Reuses `PriorityDerivationCard` + `PriorityDerivationLoadingCard` from `components/ui/PriorityDerivationCard.tsx` (Design-owned; no new visual components needed).
  - 1240/1240 green (master-merged tests included), tsc clean, next build clean.
- **2026-06-18** — **Night-queue continuation — priority derivation, T3 grounding complete, score truth, activity labels.**
  - **33 tests for `lib/priorityDerivation.ts` pure helpers** (`normalizeThemeTitle`, `extractCalendarThemes`, `calendarSpanDays`, `buildDerivePrompt`). Fixed 3 test-authoring errors (stop-word set, word-length filter, newline-sanitize assertion). All 33 green.
  - **T3 grounding complete — `createEvent` now grounds its title.** `createEvent` was the only of the 9 mutation tools that skipped `groundTitle`. Raw STT-transcribed meeting titles (e.g., "Meeting with Pfizer" for Faiza) now go through the phonetic correction pass before being written to Google Calendar. All 9 tools now consistently apply Tier-1 grounding.
  - **Priority derivation voice integration.** When priorities are absent or stale (>7d), `derivePriorities()` is called during briefing generation and a `DERIVED PRIORITY PROPOSAL` block is injected into the system prompt with 2–3 data-backed candidates + rationale. New `setPriorities` Vapi tool lets Edge write priorities live mid-call when user confirms ("yes, go with those") — no dashboard trip required. Prompt updated accordingly. Activity label added for `setPriorities`.
  - **`/api/day-plan/confirm` uses full 4-component score.** Both `scoreBefore` and `newScore` in the confirm response were computed with only focus+energy — inconsistent with the dashboard's 4-component Edge Score. Now passes the same `clarityInputs`+`momentumInputs` as `/api/day-plan` GET. Test mock updated.
  - **Activity labels for `fact_update`, `fact_delete`, `setPriorities`.** All three were falling through to the default label. Now: "Updated {category} — {entity}", "Removed {category} — {entity}", "Set N priorities". Audit records for fact ops now include `entity` for concrete labels. Detail sections added.
  - **16 tests for `/api/scores` route — score-stability fallback hardened.** No tests existed for this route. Covers: focusReliable=true (persists, fires notif), focusReliable=false/alignment-null (serves last stored score without persisting — avoids corrupting trend with transient 0s), no-history fallback (calibrating=true), confirmed daily focus drives priorities, auth gate, rate limit.
  - **`applyCalendarPlan` voice tool now passes all plan inputs.** The Vapi `applyCalendarPlan` handler was only passing 5 of 9 args to `buildCalendarPlan` — `alignment`, `recoveryHistory`, `openLoopsDueToday`, and `nowIso` were all missing. Path B (recovery-driven rescheduling), Path C (open-loop block), and Path D (meeting-prep slot) could never fire from voice. Fixed: fetches `openLoopsDueToday` via `openLoopQueries`, computes `nowIso`, and passes all 9 args.
  - 1218/1218 green, tsc clean, next build clean.
- **2026-06-18** — **Trust polish — T3 grounding, scoring tests, fact correction, score changelog, hero-loop paths D + recurring.**
  - **T3 — Grounding on live voice path (all `resolveEvent` call sites).**
    `groundTitle(raw)` helper in `executeTool` (`app/api/vapi/tool-call/route.ts`) loads stored
    person-entity facts once per call, applies `groundProperNouns` to raw event titles from the
    model before passing them to `getEventDetails`, `editEvent`, `researchToEvent`, `deleteEvent`,
    `moveEvent`, `colorEvent`, `draftEmail`. Gym→Jim, Onsi→Ansi, etc. are corrected before event
    resolution; the model never gets the transcription error propagated into the calendar.
  - **Scoring-engine test hardening.**
    12 new `patchAlignmentForPlan` edge-case tests (empty actions clone, same-priority accumulation,
    case-insensitive match, unrecognized title no-op, unmatched move no-op, two-priority independence).
    5 new `computeFocusScore` edge cases (zero committed hours, perPriority summation, routine exclusion,
    topFix null at 100, priority name in description). 4 new `computeMomentumScore` edge cases (cap at 14,
    7d > 14d handled, all-zeros + confirmedToday, drivers always non-empty).
  - **Fact-correction polish — two layers.**
    - `upsertFact` (`lib/db.ts`): now reads `confidence` of the existing row; if `'high'` (user-corrected
      via PATCH), the update is skipped — user's explicit edit wins over any subsequent STT/LLM extraction.
    - `consolidateFacts` (`lib/facts.ts`): sort priority high > low confidence; `bestStatement` prefers
      the high-confidence fact's text even when a longer low-confidence fact exists for the same entity.
    - 5 integration tests (SQLite `:memory:`) + 2 unit tests in `lib/facts.test.ts`.
  - **T3 score changelog — `scoreBefore` + `changeLines` in confirm response.**
    `/api/day-plan/confirm/route.ts` now returns `scoreBefore` (captured before the plan executes) and
    `changeLines: string[]` (up to 3 lines built from `action.reason` or truncated description) so
    `DayPlanCard` can show "Day reshaped — Edge Score +7" toast. Design wires the visual.
  - **Hero-loop: Path D (meeting prep) + recurring-pattern diagnosis.**
    - `findNextMeetingNeedingPrep(events, date, tz, nowIso)` — new exported pure helper. Finds the
      next timed meeting (not routine, not ⚡ Edge block) with a free 15-min window before it;
      returns the prep slot or null. Only fires when `nowIso` is explicitly provided.
    - Path D in `buildCalendarPlan`: when < 3 actions and `nowIso` is passed → propose "Meeting Prep"
      create action before the next eligible meeting. Both route handlers (`/api/day-plan` GET +
      `/api/day-plan/confirm` POST) now pass `new Date().toISOString()` to activate it.
    - `buildDiagnoses` item 4: recurring-pattern — detects non-`recurringEventId` event titles that
      appear ≥3 times in weekEvents after filtering routine entries; surfaces the most-repeated one.
    - 11 new tests (`findNextMeetingNeedingPrep`: 7; Path D: 3; recurring pattern: 4).
  - 1192/1192 green, tsc clean, next build clean.
- **2026-06-17** — **Hero-loop H depth + Activity label audit (Items 4 & 5).**
  - **Item 4 — `buildCalendarPlan` deeper diagnosis (3 new action sources):**
    - **Path C:** if open loops are due today and no focus block was generated by Paths A/B →
      create a 60-min "Commitments — clear open loops" block. Routes (`/api/day-plan` +
      `/api/day-plan/confirm`) fetch open loops via `openLoopQueries.list` and pass them through.
    - **Action 4 — buffer:** when < 3 actions exist and `findFirstTightGap` finds a 1–15 min gap
      between consecutive meetings → create a Buffer event in that gap.
    - **`findFirstTightGap(events, date, tz)`** — new exported pure helper in `lib/calendarPlan.ts`.
      Finds the first consecutive timed-event pair with 1 min < gap < 15 min; returns slot boundaries.
    - **`reason?` on `PlanAction`** — all action paths now set a specific reason string; route
      uses `action.reason || genericFallback` so DayPlanCard shows honest per-action context.
    - 22 new tests covering Path C (singular/plural, no-fire-on-hygiene, empty list),
      `findFirstTightGap` (no gap, 0-gap, tight gap, first-of-multiple, all-day ignored), buffer action,
      3-action cap.
  - **Item 5 — Activity label audit:**
    - `buildLabel` now has explicit cases for every Vapi tool that writes: `cleanupEvents`,
      `cleanupDuplicates`, `colorEventsByEnergy`, `rememberPreference`, `setEnergyLevel`,
      `confirmFocus`, `applyCalendarPlan`. No action type falls to the raw-camelCase default.
  - 1116/1116 green, tsc clean, next build clean.
- **2026-06-17** — **T3 — Transcript grounding layer: deterministic STT proper-noun correction.**
  - **Root cause:** Edge trusts the STT transcript over canonical sources → misread names propagate
    into facts and call summaries. Examples: "Gym's appointment" stored instead of "Jim's", "Onsi"
    stored as "Ansi" despite the calendar spelling it correctly.
  - **`lib/grounding.ts` (new, pure, 0 I/O):**
    - `editDistance(a, b)` — pure Levenshtein.
    - `normalizeForPhonetics(s)` — normalizes common STT confusion patterns before distance comparison:
      `\bgy` → `ji` (gym/jim are homophones: /dʒɪm/), `ph` → `f`, `ck` → `k`, `\bpf` → `f`.
    - `groundProperNouns(text, canonicalNames)` — for each capitalized word (≥ 3 chars) in text,
      computes normalized edit distance to all canonical names; replaces if distance ≤ 1. Skips
      tokens immediately preceded by articles/prepositions ("the Gym" → not a person → no-op).
      Preserves possessives ("Gym's" → "Jim's"). Exact matches are always no-ops.
    - `extractNamesFromEventTitles(titles)` — strips meeting prefixes + stop words, returns
      capitalized candidate name tokens for the canonical list.
  - **`lib/facts.ts` — Tier-1 grounding in `extractAndUpsertFacts`:**
    - Adds optional `calendarEventTitles?: string[]` param.
    - Pre-corrects the transcript via `groundProperNouns` before the Haiku classification call.
    - Calendar event title names added to the canonical set (beyond stored person-entity facts).
    - Tier-2 Haiku `knownNamesLine` hint still handles harder phonetic cases (Pfizer→Faiza).
  - **`app/api/vapi/webhook/route.ts` — Grounding in `saveCallSummaryToCalendar`:**
    - Loads stored person-entity facts, applies `groundProperNouns` to transcript before the
      Haiku summarization call → call summaries saved to calendar also use corrected names.
  - **30 new tests** in `lib/grounding.test.ts`: editDistance, normalizeForPhonetics,
    groundProperNouns (Gym/Jim ✓, Onsi/Ansi ✓, Pfizer/Faiza stays ✓, article-preceded skip ✓,
    possessive ✓, multi-correction ✓), extractNamesFromEventTitles.
  - 1081/1081 green, tsc clean, next build clean.
- **2026-06-17** — **Tickets G + H: Dashboard Hero Loop — diagnose → propose → apply → rescore.**
  - **G (scaffold + diagnose):** `/api/day-plan` GET now returns `diagnoses: string[]` (1–3 concrete
    problem sentences from alignment zero-hours, hygiene flags, low recovery). `DayPlanCard` renders
    them as subtle warning pills above the proposed changes. `buildDiagnoses` pure helper added to
    `lib/calendarPlan.ts`; 8 new tests. All state/handlers already wired in dashboard from prior work.
  - **H1 — More plan actions (dead code replaced):** `buildCalendarPlan` extended with 3 action sources:
    (1) Focus block from `focusScore.topFix` (existing), OR hygiene-flag fallback when no topFix and
    back-to-back meetings exist; (2) Recovery move — when latest Whoop recovery ≤33%, finds the heaviest
    deferrable event and proposes moving to tomorrow (replaces the dead `worstMismatchEventId` path that
    `computeEnergyScore` never set); (3) Alignment gap move — biggest unaligned sink from `topUnaligned`
    that matches a today event → move to tomorrow. New pure helpers: `findHeaviestDeferrableEvent`,
    `patchAlignmentForPlan` (exported; used by route for score projection).
  - **H2 — Real score projection:** `/api/day-plan` GET now computes `scoreBefore` with all 4
    components (Focus+Energy+Clarity+Momentum) using the same `clarityInputs`/`momentumInputs`
    pattern as `/api/scores` — the headline score now matches the dashboard exactly. `scoreAfter`
    computed by patching alignment with plan deltas (`patchAlignmentForPlan`) and recomputing
    `computeCalendarFit` — no more hardcoded `+12/action` guess.
  - **H3 — Always say something:** Route never returns null. When no actions: returns
    `{ wellAligned: true, scoreBefore, scoreAfter: scoreBefore, summary: "well-aligned…" }` so
    the card always renders. `DayPlanCard` shows an "ON TRACK + score" state for `wellAligned`.
  - `/api/day-plan/confirm` updated: passes `alignment` + `recoveryHistory` to `buildCalendarPlan`
    so the plan is deterministic between preview and apply.
  - 31 new tests. 1036/1036 green, tsc clean, next build clean.

- **2026-06-16** — **Ticket A: Recalibrate Focus Score — ratio×coverage replaces aligned/45.** (`df727a3`)
  - **PROBLEM:** Old formula `aligned/45` made a genuinely focused 15-20h week score ~35-45% — "too harsh."
  - **New formula:** `ratio = aligned / max(committed,1)`; `coverage = min(1, committed/15)`; `score = round(100 * ratio * (0.6 + 0.4*coverage))`. A focused 15-18h week with some meetings now scores 70-85. Zero-priority or meeting-dominated weeks stay low.
  - **Routine exclusion:** Added `ROUTINE_TITLES_ALIGNMENT` + `isRoutineTitle()` to `lib/alignment.ts`. Routine events (meals, gym) classified "none" by Haiku are now tracked as `routineHours` (new `AlignmentResult` field) and excluded from `committed`. Previously, lunches inflated the denominator and dragged scores down. Also filtered from `topUnaligned` — meals no longer appear as "time sinks."
  - Tests updated: `makeAlign` factory gains `routineHours=0` default; old fixed-denominator tests replaced with calibrated new ones (focused week→70-85, tiny-focused week→coverage floor, routine exclusion, meeting-heavy→low). 997 green, tsc clean, build clean.
- **2026-06-16** — **Ticket C: Populate notification center — score change, facts learned, activity.** (`c365d9c`)
  - **Problem:** Notification center only showed email reply notifications.
  - **New `lib/notifications.ts`:** 3 fire-and-forget producers (never throw, all wrapped in try/catch):
    - `maybeCreateScoreChangeNotif(userId, todayScore, todayDate)` — fires from `/api/scores` after upsert when Edge Score shifts ≥3 pts vs yesterday; de-duped to 1/day.
    - `maybeCreateFactLearnedNotif(userId, count)` — fires from `extractAndUpsertFacts` when new preferences are stored post-call; de-duped to 1/day.
    - `maybeCreateActivityNotif(userId, toolName, eventTitle)` — fires from `tool-call` route after first successful calendar mutation (create/move/delete/edit/cleanup); de-duped to 1/day.
  - **`lib/db.ts`:** `notificationQueries.existsToday(userId, type)` — UTC midnight check for de-duplication.
  - 997 green, tsc clean, build clean.
- **2026-06-16** — **[BUG FIX — PM hotfix] Time-allocation now credits exercise to fitness goals; never flags unmeasurable priorities (992 green).** (`dd40ab1`)
  - **SYMPTOM (live, Derrick's dashboard):** "Get to 130 lbs" showed <1% allocation over 6 weeks → a false highest-urgency "neglected" focus area, despite regular gym + walks.
  - **ROOT CAUSE (two compounding, in `lib/timeAllocation.ts`):** (1) `gym/workout/walk` were hard-coded in `ROUTINE_TITLES` and excluded from every priority bucket → weight-goal work counted toward nothing; (2) "Get to 130 lbs" has no keyword ≥4 chars that isn't a stopword (get/130/lbs) → `priorityScore` could never credit it → structurally guaranteed 0% → fired the misalignment flag, which [focusRecommendation.ts:232](lib/focusRecommendation.ts) escalates to a high-confidence focus area.
  - **Fix:** `GOAL_CATEGORIES` (fitness) maps a weight/fitness priority to exercise event titles and credits that time to the goal; priority matching now runs BEFORE the routine catch-all (events with no priority match still fall to routine, so non-fitness users' gym time stays routine). `isMeasurablePriority` guards the misalignment flag — a goal with no keyword AND no category is never falsely flagged as neglected. 3 new tests. Darren: extend `GOAL_CATEGORIES` if other short-token goals surface (e.g. reading/learning).
- **2026-06-16** — **[BUG FIX] Alignment hours now count the full current week, not future-only.**
  - **ROOT CAUSE:** `getWeekEvents` used `timeMin: now` — completed events (gym on Monday, meetings from earlier days) were never passed to `computeAlignment`. Edge told Derrick "2.5h on gym" when real completed hours were much higher. Also affected hygiene flags and Edge Score focus%.
  - **Fix:** new `getFullWeekEvents(userId, tz)` in `lib/calendar.ts` — fetches Mon 00:00 through Sun 23:59 in the user's timezone (using `dayRangeUtc` + `todayInTz` for exact UTC bounds). `briefing.ts` runs it in parallel, passes the full-week set to `computeAlignment` + `detectHygieneFlags`. Future-only `weekEvents` kept for calendar display and free-time slots.
  - 1 regression test added (`computeAlignment` counts a completed Monday gym event). 989/989 green, tsc clean, next build clean.
- **2026-06-16** — **Briefing call UX — 5 live improvements (PM dispatch from Derrick's morning call).**
  - **Condense**: max_tokens 450→320; word cap updated to MAX 220 in system prompt.
  - **Hook opener**: 3-part briefing structure replaces 6-section framework. PART 1: "${greeting}, ${firstName}. This is your Nth morning — Edge Score X/100[±delta]." Then ONE energy/sleep line from PROGRESS HOOK data. Then ONE meaningful event only (no meals/gym). Streak line stays.
  - **Anchor to actions**: PART 2 opens with focus proposal ("For today, I'd focus you on… Sound right?") then names concrete first action. No event listing for its own sake. Accountability line + hygiene flag integrated inline.
  - **Buffer handling**: new vapi.ts BUFFER HANDLING bullet — classify FIXED (haircuts, meetings, flights) vs FLEXIBLE (gym, deep work) events. Always create buffer after FIXED; move FLEXIBLE to fill remaining slot. Worked example: haircut 1-2pm + gym → buffer at 2pm + gym at 2:15pm.
  - **Close/capture**: new vapi.ts BRIEFING CLOSE bullet — end with ONE focus-driven question (bans generic "most important thing" fallback), then `editEvent` to capture answer in calendar: "I've noted that in your calendar."
  - `firstName` local const added to `generateDailyBriefing` (was only in helper functions). 988/988 green, tsc clean, next build clean.
- **2026-06-16** — **Whoop Intelligence — baselines, overreaching, calendar actions, deeper correlations, coaching** (5-sub-item PM dispatch).
  - **Sub-item 1: Personal baselines (30-day rolling averages)**
    - `computeWhoopBaselines(recoveryHistory, sleepHistory, strainHistory)` → `WhoopBaseline { recovery30dAvg, sleep30dAvgH, strain30dAvg }` — pure, up to 30 most-recent points per signal.
    - `buildBaselineDeviationNote(todayRecovery, todaySleepMs, baseline)` → string | null — fires on: recovery ≥15 pts below 30d avg OR sleep ≥45 min short of 30d avg. Injected into `whoopContextBlock` as `BASELINE DEVIATION` block.
    - Both wired in `lib/briefing.ts`; deviation note referenced in `lib/vapi.ts` coaching note.
  - **Sub-item 2: Overreaching detection + sleep debt quantity**
    - New `OVERREACHING` flag in `WhoopTrendFlag` — fires when `HIGH_STRAIN_STREAK` + `RECOVERY_DECLINING_3D` co-occur.
    - `sleepAvg7dH` added to `WhoopTrendSummary` (optional, backward-compatible) — populated by `computeWhoopTrends`.
    - `formatTrendForBriefing` updated: OVERREACHING takes highest priority ("overreaching zone — today needs to be a genuine recovery day"); SLEEP_DEBT message now includes average hours when available.
  - **Sub-item 3: ★ Whoop → concrete calendar recommendations**
    - `buildCalendarActionFromRecovery(score)` → string | null — red (≤33%): "name the heaviest deferrable block and offer to move it, don't wait for them to ask"; green (≥67%): "recommend blocking hardest work this morning"; yellow → null.
    - Injected into `whoopContextBlock` as `CALENDAR ACTION` block.
    - `lib/vapi.ts`: new WHOOP COACHING bullet — execute CALENDAR ACTION at the start of the call; reference BASELINE DEVIATION for personalised pacing; drop TOMORROW RECOVERY HINT at the end.
  - **Sub-item 4: Deeper correlations + tomorrow-recovery hint**
    - `lib/whoopCorrelations.ts` refactored — `checkLateMeetingCorrelation` + `checkHighStrainCorrelation` internal helpers; `computeWhoopCorrelations` now accepts optional `strainHistory` and tries both patterns in order.
    - Pattern 2: high strain day (>14) → lower next-day recovery — same confidence gate (≥10 paired days, ≥3 per group, ≥5 pt diff).
    - `predictTomorrowRecoveryHint(todayStrain, strainBaseline30d)` → string | null — fires when today's strain >14 and ≥2 pts above personal baseline; injected as `TOMORROW RECOVERY HINT`.
  - **Sub-item 5: Whoop coaching on call**
    - `lib/vapi.ts` WHOOP COACHING line added (replaces weaker WHOOP TRENDS-only reference).
    - RECOVERY ALERT unchanged; CALENDAR ACTION + BASELINE DEVIATION + TOMORROW RECOVERY HINT now each have explicit voice-call instructions.
  - 28 new tests. 988/988 green, tsc clean, next build clean.
- **2026-06-16** — **Support backend + Memory salience + Focus actionable (PM dispatch — 3 workstreams)**.
  - **Feedback/Support backend**: `support_messages` table (type, message, status, user_id); `supportMessageQueries.insert/list`; `POST /api/support` (auth, rate-limit 10/hr, validates type + message ≤2000 chars). Wires the Design lane's Cam feedback form.
  - **Memory Salience Layer** (`lib/memorySalience.ts`, pure): `scoreFact(fact, allFacts, anchors, today)` → `ScoredFact` with 5-signal weighted composite (recency 25%, type 25%, confidence 15%, reinforcement 20%, relevance 15%). Category weights (goal=0.9 → preference=0.4). High-stakes keyword bonus (+0.15). `rankFacts`, `topFacts(max=20, maxPerCategory=6)`. Wired into `lib/briefing.ts` (replaces raw `factQueries.getAll()`) and `lib/focusRecommendation.ts` (ranked facts + dismissed-title down-weighting). 21 tests.
  - **Focus actionable — complete/dismiss + learning signal**: `dismissed_titles TEXT DEFAULT '[]'` column on `daily_focus` (migration); `dailyFocusQueries.addDismissed/getRecentDismissed`. `POST /api/focus/complete` (audit log). `POST /api/focus/dismiss` (writes to dismissed_titles). `recommendFocusAreas` now returns 6 items (3 shown + 3 candidates); `RECENTLY DISMISSED` block injected into prompt. Route splits `areas[0..2]` + `candidates[3..]` in response. 0 new tests (thin integration layer; pure logic already covered by existing focusRecommendation tests).
  - 960/960 green, tsc clean, next build clean.
- **2026-06-16** — **Email + calendar intelligence deepening (Night-3 queue — Items 3–5)**.
  - **Item 3: Calendar pattern detection** (`lib/calendarPatterns.ts`, pure):
    - `detectCalendarPatterns(events, {timezone})` — analyzes 180d history for: recurring routines (≥3/week), peak meeting hours, inferred focus windows, busy/light days, avg meetings/day, 4-week meeting trend.
    - `formatCalendarPatternsForBriefing()` → compact `CALENDAR PATTERNS` block (section 5 injection: suggest time blocks aligned to inferred focus window).
    - `formatPatternsAsEnergyProfile()` → energy-profile inference for focus rec (complements user-stated profile; labeled "inferred from calendar, not self-reported").
    - Wired: `lib/briefing.ts` (11th parallel fetch; injected before section 5 with guidance), `lib/focusRecommendation.ts` (energy-profile prefix), `lib/vapi.ts` (CALENDAR PATTERNS voice note). 20 new tests.
  - **Item 4: Time-allocation trends** (`lib/timeAllocation.ts`, pure):
    - `computeTimeAllocation(events, priorities, {weeksBack})` — buckets 8-week calendar history into priority / meetings / routine / other buckets via keyword matching (zero LLM cost).
    - `formatTimeAllocationForBriefing()` → `TIME ALLOCATION` block with `%` / `h/week` per bucket + misalignment warning when meetings > 40% and top priority < 10%.
    - `formatTimeAllocationInsight()` → one spoken sentence for Edge mid-call.
    - Wired: `lib/briefing.ts` (injected alongside ALIGNMENT DATA in section 3), `lib/focusRecommendation.ts` (elevates under-served priorities to high-confidence). 18 new tests.
  - **Item 5: Open Loops refinement — snooze, recurring detection, improved call-surfacing**.
    - **Snooze**: `open_loops.snooze_until` column (migration), `openLoopQueries.snooze(userId, id, until)` + `unsnooze()`, `list()` respects snooze (hidden until date passes), `POST /api/open-loops` supports `action='snooze'` with `until: YYYY-MM-DD`.
    - **Recurring detection**: `detectRecurringPatterns(loops, minCount)` groups by normalized description across any status; `formatRecurringPatternsForBriefing()` injects `RECURRING OPEN LOOPS` block with systemic-friction note and "suggest a permanent fix" instruction.
    - **Call-surfacing**: `getUrgentOpenLoops` now uses 3-tier priority — (1) overdue/due-today, (2) neglected ≥7 days (no due date), (3) any remaining commitment/awaiting_you — so no commitment gets buried indefinitely without a due date.
    - `lib/vapi.ts` updated: snooze offer ("want me to snooze that?"), RECURRING LOOPS note.
    - 11 new tests.
  - **Combined**: 49 new tests. 939/939 green, tsc clean, next build clean.
- **2026-06-16** — **Deeper email understanding — deadlines, dollar amounts, VIP senders** (`lib/emailIntel.ts`).
  - **`lib/emailIntel.ts`** — pure enrichment layer (regex + fact lookup, zero I/O, zero LLM cost):
    - `extractDeadlineDate(text, ref)` — finds ISO date, "Month DD", "by Friday", "end of month" patterns; only fires on explicit deadline trigger keywords (due/overdue/deadline/final notice/expires/etc).
    - `extractDollarAmounts(text)` — extracts `$X,XXX`, `$Xk`, `$X million`, `X dollars` patterns as numbers.
    - `isSenderVip(sender, personFacts)` — true when sender name/email matches any stored 'person' fact entity (case-insensitive, partial match on first/last name).
    - `computeUrgencyLevel(item, deadline, dollars, vip, ref)` — critical: deadline ≤2d OR deadline ≤7d+dollar≥$1k; high: deadline ≤7d OR VIP OR isImportant OR dollar≥$5k; normal: everything else.
    - `enrichEmailSignal(items, facts, ref)` — enriches batch of `EmailSignalItem` into `EmailIntelItem[]`.
    - `formatEnrichedEmailForPrompt(items)` — richer prompt block with `[CRITICAL · VIP sender · deadline YYYY-MM-DD · $Xk]` tags.
  - **`lib/openLoops.ts`** — email digest path now enriches signal before passing to Haiku (deadline dates surfaced as explicit `due_date`; dollar amounts + VIP flags as urgency context).
  - **`lib/focusRecommendation.ts`** — `formatEmailSignalForPrompt` uses enriched format when facts available; passes `allFacts` for VIP detection.
  - **`lib/meetingContext.ts`** — VIP email items get +2 score boost in meeting relevance ranking.
  - 37 new tests. 890/890 green, tsc clean, next build clean.
- **2026-06-16** — **★ Meeting prep cross-link — email + calendar + memory** (`lib/meetingContext.ts`, `app/api/meeting-context/route.ts`).
  - **`lib/meetingContext.ts`** — pure keyword-matching layer (no LLM cost):
    - `extractKeywords(text)` — strips stop words, returns ≥4-char tokens.
    - `eventTokens(event)` — attendee first-names (from displayName + email prefix) + event title keywords.
    - `buildMeetingContext(event, emails, facts, loops)` — scores email threads by token overlap (top 3); filters facts by entity token match (top 4); filters open loops by description token match (top 2). Returns null when nothing useful to surface.
    - `buildMeetingContexts(events, emails, facts, loops, opts)` — filters to upcoming timed events within `lookAheadHours` (default 8), returns top N contexts.
    - `formatMeetingContextsForBriefing(contexts, tz)` — compact `MEETING PREP` block with `[EMAIL]`, `[PERSON/GOAL/...]`, `[YOU COMMITTED]`/`[AWAITING]`/`[DEADLINE]` tags.
  - **`lib/briefing.ts`** — `meetingContextBlock` built after open-loops (pure DB read + in-memory matching; degrades to '' on any error). Injected in user prompt with instruction: "weave in ONE specific observation for the most important upcoming meeting."
  - **`app/api/meeting-context/route.ts`** — `GET /api/meeting-context?date=YYYY-MM-DD&hours=N` — returns `{ date, contexts[], total }`. For Cam to render pre-meeting panel without needing a briefing call.
  - **`lib/vapi.ts`** — MEETING PREP voice note: Edge surfaces one sharp observation per meeting ("Your 2pm with Faiza — I noticed your CIBC thread came in this morning"); never reads the full block aloud.
  - 26 new tests. 853/853 green, tsc clean, next build clean.
- **2026-06-15** — **Focus areas always carry their anchor priority** (`lib/focusRecommendation.ts`).
  - **PM dispatch:** "each focus area should show which top priority it ties to — reinforce the hierarchy."
  - **Prompt tightened:** `anchor` field instruction changed to "ALWAYS include this field. Use the EXACT text of the closest matching priority. If nothing fits, write 'standalone'. Never omit."
  - **Post-processing insurance pass:** after parsing the model response, any missing/empty `anchor` gets a fallback: (1) fuzzy keyword match (≥4-char words from priority text) against title+rationale; (2) `'standalone'` when nothing matches or no anchors provided. Model value always wins when present.
  - 5 new tests. 817/817 green, tsc clean, next build clean.
- **2026-06-15** — **★ Open Loops / Commitment Tracking (flagship)** — "Edge caught the thing you forgot."
  - **`lib/openLoops.ts`** — full extraction + DB stub + injection layer:
    - `OpenLoop` type (`id, user_id, description, type, source, due_date, status, created_at, resolved_at`).
    - `openLoopStubQueries` — self-creates `open_loops` table on first use (swap for Vijay's `openLoopQueries` when migration lands; marker comment in file). CRUD: `insert`, `getOpen`, `getAll`, `resolve`, `dismiss`, `existsSimilar` (dedup by first-80-chars prefix).
    - `extractOpenLoopsFromText(text, source, today)` — one Haiku call; extracts up to 8 unresolved loops (commitment_made | awaiting_you | deadline) with optional `due_date` from transcripts or email digests.
    - `extractOpenLoopsFromCalendar(events)` — keyword matching (deadline/due/submit/pay/file/sign/review) on event titles; pure, no LLM.
    - `extractAndUpsertOpenLoops(userId, { transcript?, emailSignal?, calendarEvents? })` — multi-source extraction; deduplicates against existing open loops; fire-and-forget.
    - `getUrgentOpenLoops(userId, today)` — returns loops due today/overdue, plus all commitment_made/awaiting_you (always urgent regardless of due date). Capped at 5.
    - `formatOpenLoopsForBriefing(loops)` — compact block with `[YOU COMMITTED]`, `[AWAITING YOUR RESPONSE]`, `[DEADLINE]` tags + due dates.
  - **`app/api/open-loops/route.ts`** — `GET` (3 buckets: commitment_made / awaiting_you / deadline, total count) + `POST` (body: `{ id, action: 'resolve' | 'dismiss' }`). Rate-limited (`openLoops` key, 60/hr).
  - **`lib/briefing.ts`** — wired: (1) email signal triggers `extractAndUpsertOpenLoops` fire-and-forget alongside fact extraction; (2) `urgentLoopsEarly` fetched before focus rec and passed as `openLoops` opt; (3) `openLoopsBlock` injected into user prompt with surfacing guidance (name loop specifically, offer to close it, max 2 in action items/closing, calm not anxiety-inducing).
  - **`lib/focusRecommendation.ts`** — `RecommendOpts.openLoops?: OpenLoop[]` added; `formatOpenLoopsForBriefing` injected with anchor-link guidance (only surface loop as focus area if tied to a priority anchor and due today/overdue).
  - **`app/api/vapi/webhook/route.ts`** — `extractAndUpsertOpenLoops` fire-and-forget after each completed briefing call transcript.
  - **`lib/vapi.ts`** — OPEN LOOPS voice note: Edge surfaces the most pressing loop naturally in section 4 or 6; mid-call commitment tracking note.
  - **`lib/rateLimit.ts`** — `openLoops` key added (60/hr).
  - 26 new tests. 813/813 green, tsc clean, next build clean.
  - ⚠️ **When Vijay's `open_loops` migration lands on master**: merge + swap stub per the comment at the top of `lib/openLoops.ts` (3-step swap: delete `ensureTable`+`stubQueries`, import `openLoopQueries` from `./db`, remove re-exported `OpenLoop` type).
  - ⚠️ **Cam**: `GET /api/open-loops` returns `{ commitment_made[], awaiting_you[], deadline[], total }`. `POST /api/open-loops` with `{ id, action: 'resolve'|'dismiss' }`. Design the 3-bucket dashboard surface as dispatched.
- **2026-06-15** — **Memory dedup + Edge Score calibrating fix** (live Derrick feedback — Dispatch 3).
  - **[BUG FIX] Memory screen shows duplicate facts.** Two-part fix: (1) Dedup at write time: `extractFactsFromTranscript` gains optional `existingFacts` 4th param; injected into the Haiku prompt as "Already stored facts — return ONLY net-new facts". `extractAndUpsertFacts` passes `storedFacts` (already fetched for `knownNames`) — no extra DB call. (2) Consolidate existing dupes: new `consolidateFacts(userId)` groups by `(category, LOWER(TRIM(entity)))`, keeps the fact with the longest statement (newest as tiebreaker), calls `updateFact` if the kept statement needs upgrading, `deleteFact` on all duplicates. Called fire-and-forget after every upsert wave. 10 new tests.
  - **[BUG FIX] Edge Score showed "calibrating" with calendar + email connected.** Two-part fix: (1) `computeCalendarFit` now uses renormalizing blend: calibrating/absent components are excluded and remaining weights renormalized to sum to 100. This means Energy calibrating → Focus/Clarity/Momentum share the 100% between them, headline is always a real number once Focus is computable. (2) Top-level `CalendarFit.calibrating` is now `true` only when there is genuinely NO signal (priorities.length===0 AND energy calibrating AND no clarity inputs). Per-component `ScoreResult.calibrating` still preserved for the breakdown display. Fixed `boolean | undefined` tsc error on the `&&` expression. Added `calibrating?: boolean` and `edgeScore?: number` to the UI-side `CalendarFit` interface in `components/ui/CalendarFitCard.tsx`. Dashboard now passes `calibrating={calendarFit?.calibrating === true}` (was `energyScore.calibrating`). 4 test assertions updated. `CalendarFitCard.tsx` interface sync'd.
  - **[UX FIX] Edge Score didn't refresh after confirming focus areas.** Covered in prior entry but this commit ties it together end-to-end: `handleConfirmFocus` re-fetches `/api/scores` and `calendarFit?.calibrating` (now correctly computed) goes `false` on first real score.
  - 787/787 green, tsc clean, next build clean.
- **2026-06-15** — **UTC timestamp fix + Edge Score refresh on focus confirm** (live Derrick bugs).
  - **[BUG FIX] Activity/memory dates showed tomorrow in Eastern evenings.** SQLite stores `created_at` as `"2026-06-16 01:20:00"` (space separator, no `Z`). V8 parses that as LOCAL time → dates shifted by the UTC offset. Added module-scope `parseUTC(ts)` helper (normalises to ISO 8601 + `Z` before `new Date()`). Applied to: `ActivityTab.relativeTime()`, `ActivityTab.dayLabel()`, memory-tab `format(m.created_at)`, and facts provenance `format(f.learned_at)` (both paths). Browser now renders all timestamps in the user's correct local timezone.
  - **[BUG FIX] Edge Score didn't update after hitting "Focus on these today".** `handleConfirmFocus` wrote to `daily_focus` (DB) but the stale `/api/scores` result stayed on screen. Added a background `/api/scores` re-fetch after `setConfirmedFocusAreas(areas)` — Focus Score now reads the confirmed `daily_focus` and updates live. `/api/scores` already had the logic to synthesise priorities from confirmed focus areas (per the PM's earlier fix); only the re-fetch on the client side was missing.
  - 777/777 green, tsc clean, next build clean.
- **2026-06-15** — **Email relevance tuning + STT name correction in fact extraction**.
  - **Email relevance** (`lib/focusRecommendation.ts`): replaced the force-promote "HIGHEST-PRIORITY #1" injection (caused Twilio compliance forms + plumbing quotes to surface as runway-protection areas) with anchor-based judgment rules. New `EMAIL JUDGMENT RULES` block: only elevate a thread if it directly moves an overarching anchor (runway = cash/debt/financing; health goal; named priority). Explicit NOISE list (compliance forms, service quotes, SaaS alerts, marketing). If one anchor-relevant thread exists → surface as its own focused area; no grab-bagging. Only claim "runway impact" if the item genuinely affects cash/debt/financing. Changed email tag from `[URGENT/FINANCIAL]` (prescriptive) to `[debt/legal signal]` (descriptive — use your judgment, do not auto-elevate).
  - **STT name correction** (`lib/facts.ts`): `extractFactsFromTranscript` gains optional `knownNames?: string[]` param injected into the Haiku prompt ("prefer these exact spellings when a word sounds similar but may be garbled"). `extractAndUpsertFacts` self-loads known person entity names from stored facts on each call and passes them — callers unchanged. Prevents STT mis-transcriptions like "Pfizer" from overwriting the correct name "Faiza" once it has been stored.
  - 3 test assertions updated to match new label/rules. 777/777 green, tsc clean, next build clean.
- **2026-06-15** — **4-component Edge Score: Intelligence → Clarity rename + Momentum added + `/api/learned`**.
  - **Rename Intelligence → Clarity**: `IntelligenceInputs` → `ClarityInputs`, `computeIntelligenceScore` → `computeClarityScore`, `CalendarFit.intelligenceScore` → `clarityScore`. Same scoring logic, same weights; just the canonical name change per Derrick ("how clear a picture does Edge have of you?").
  - **Momentum Score** (`computeMomentumScore(inputs: MomentumInputs): ScoreResult`): trailing 7–14 day engagement — show-up (completed morning calls 70 pts) + engagement (confirmed focus areas 30 pts). Calibrating when zero calls + zero confirmed focus (day 1). Drivers = "shown up N of last 7 mornings", streak, focus confirmation rate. `MomentumInputs`: `completedCallDays14d`, `completedCallDays7d`, `confirmedFocusDays14d`, `streakDays`.
  - **4-way blend (Focus 30 / Energy 30 / Clarity 20 / Momentum 20)**: `computeCalendarFit` now takes 7th optional param `momentumInputs?`. When both clarity + momentum present: 30/30/20/20. Energy calibrating: 40/0/30/30 (no energy term). Clarity-only: 40/40/20/0. Neither: legacy 50/50. All callers except `/api/scores` pass 4 args — unchanged.
  - **`/api/scores`** gathers Momentum inputs: `briefingQueries.getRecent(30)` → distinct completed days in last 14d/7d + `computeCallStreak` + raw SQL for `confirmed_focus_days`. Returns all 4 scores (focusScore, energyScore, clarityScore, momentumScore) in the JSON response.
  - **`/api/learned`** NEW endpoint: returns `{ recentFacts, totalFacts, isFresh }` (facts learned in last 7 days). When `totalFacts < 10` + calendar connected, triggers `extractAndUpsertFactsFromEmail` fire-and-forget in the background. Design uses this for the "what Edge just learned about you" activation panel on home load. Rate-limited 30/hr.
  - **`FocusRecommendationCard`** adds `selfFetch?: boolean` prop: when `true`, the card fetches `/api/focus/recommend` on mount and manages its own loading state. Design can use `<FocusRecommendationCard selfFetch recommendation={null} onConfirm={...} />` on the home tab without the parent needing to fetch.
  - 11 new tests (computeMomentumScore + 4-way blend). 777/777 green, tsc clean, next build clean.
- **2026-06-15** — **Memory tab — pager moved to header row of Call notes**.
  - Prev/Next + page indicator moved from the bottom of the Call notes list to an inline header row alongside the "Call notes" heading. Now clearly reads as "Call notes — page 1 / 3" rather than appearing to paginate the structured facts above. Same state (`memoryPage`), same behavior, just repositioned. 766/766 green.
- **2026-06-15** — **Intelligence Score — 3rd Edge Score component**.
  - **`computeIntelligenceScore(inputs: IntelligenceInputs)`** new pure function in `lib/calendarScore.ts`. Scores 0–100 from two buckets: connected sources (Calendar 20pt / Gmail read 20pt / Whoop 20pt = 60pt max) + accumulated context (facts count 15pt / memories 10pt / briefing calls 10pt / priorities set 5pt = 40pt max). Returns `ScoreResult` with plain-English drivers + topFix (prioritizes: calendar → gmail → whoop → priorities → briefings → facts).
  - **`CalendarFit`** updated: adds `intelligenceScore?: ScoreResult`. **`computeCalendarFit`** accepts optional 6th param `intelligenceInputs?: IntelligenceInputs`. When provided, blends **focus 40% / energy 40% / intelligence 20%**; when energy is calibrating (no Whoop), falls back to **focus 80% / intelligence 20%**. No-input path unchanged (legacy 50/50 blend) — day-plan, briefing, and vapi-tool callers need no update.
  - **`/api/scores`** gathers intelligence inputs (sync DB reads: `calendarQueries`, `whoopQueries`, `factQueries`, `memoryQueries`, `briefingQueries`) and passes them to `computeCalendarFit`. `intelligenceScore` now included in the route's JSON response alongside `focusScore` and `energyScore`.
  - 17 new tests (intelligence score + blend coverage). 766/766 green, tsc clean, next build clean.
- **2026-06-15** — **Energy Score redefine — Whoop-based weighted average**.
  - **`computeEnergyScore(recoveryHistory, todaySleep)`** replaces the old calendar-demand-matching score. New formula: `sleepPerformancePct * 0.6 + avgRecovery7d * 0.4` (Whoop-only). Degrades to `{ score: 50, calibrating: true }` when no Whoop data. Removed: `taggedEvents`, `energySignal`, `energyProfile` params from score path (calendar demand matching, energy-profile preferences, and per-event mismatch logic all removed from scoring). Kept: `classifyEventsEnergy`, `EnergyProfile`, `parseEnergyProfile`, `colorByEnergy` — still used by hero loop + color tools, unchanged.
  - **`computeCalendarFit` signature** simplified to `(alignment, priorities, recoveryHistory, todaySleep, totalWorkingHours?)`. `worstMismatchEventId`/`worstMismatchEventTitle` still in `ScoreResult` but always `null` with the new score (hero loop degrades gracefully).
  - **All callers updated**: `app/api/scores/route.ts`, `app/api/day-plan/route.ts`, `app/api/day-plan/confirm/route.ts`, `app/api/vapi/tool-call/route.ts` (`applyCalendarPlan` handler), `lib/briefing.ts`. Removed `classifyEventsEnergy` + `energyProfile` block from briefing and score routes (not needed for scoring).
  - 17 new Whoop-based energy score tests. 749/749 green, tsc clean, next build clean.
- **2026-06-15** — **5-item PM dispatch: email→memory, home page IA, sleep score, EdgeScoreCard data, Fix It button**.
  - **[FEATURE] Email → Memory facts**: `extractAndUpsertFactsFromEmail(userId, emailSignal, userName?)` added to `lib/facts.ts` — one Haiku call on the inbox digest extracts durable facts (e.g. "User is in debt negotiation with CIBC") and upserts them into the facts table. Called fire-and-forget from `lib/briefing.ts` right after the email signal is fetched. Degrades silently when `scopeMissing` or no items.
  - **[FEATURE] Home page IA**: Dashboard default tab changed from Briefings → `home`. New "⚡ Home" tab (first in nav) contains greeting + briefing preview + EdgeScoreCard + FocusRecommendationCard + DayPlanCard — the daily cockpit view. Briefings stays its own tab. Score cards removed from "always visible above all tabs."
  - **[FIX] Sleep score in Whoop APIs**: `/api/whoop/status` and `/api/whoop/recovery` now return `sleepScore` (= `performancePct`, 0–100) and `sleepTier` (≥75=green/high, ≥50=yellow/medium, <50=red/low). `RecoveryCard` accepts optional `sleepScore` + `sleepTier` props. Dashboard passes them through. Color rule: ≥75 → green (Derrick's 78 = green).
  - **[FIX] EdgeScoreCard calibrating prop wired**: Dashboard now derives `calibrating` + `calibratingHalf` from `calendarFit.energyScore.calibrating` and passes them to EdgeScoreCard. `ScoreResult` type updated to include `calibrating?: boolean`.
  - **[FIX] Fix It button end-to-end**: `onRequestFix` in EdgeScoreCard now scrolls to the DayPlanCard (via `dayPlanRef`) and re-fetches the plan if it was dismissed. Preview-before-apply flow is fully wired through `DayPlanCard` (shows proposed changes + score delta before Confirm).
  - 759/759 green, tsc clean, next build clean.
- **2026-06-15** — **Email signal wired into focus recommendations** (`lib/focusRecommendation.ts`, `lib/briefing.ts`, `app/api/focus/recommend/route.ts`).
  - **`isUrgentEmail(item)`** — pure helper; returns true when `isImportant` OR subject/sender matches financial/legal/collection keywords (CIBC, "overdue", "final notice", "collections", "attorney", etc.). Exported + tested.
  - **`formatEmailSignalForPrompt(signal)`** — formats inbox digest for LLM context: sender, subject, [URGENT/FINANCIAL] or [unread] tag, 120-char snippet. Returns '' on `scopeMissing` or empty. Exported + tested.
  - **`RecommendOpts.emailSignal`** — new optional field. When provided, injects EMAIL INBOX DIGEST section into the Sonnet prompt. Urgent threads get `INBOX PRIORITY WEIGHTING` instruction telling the model to rank collector/financial/legal emails as `#1` focus candidate above any calendar block.
  - **`basedOn`** includes `"email inbox (N threads, X urgent)"` when signal contributes.
  - **`lib/briefing.ts`** — `getRecentEmailSignal(userId, { days:14, max:20 })` added to the main `Promise.all` (runs in parallel alongside Whoop; degrades to null on scope-missing or error). Passed as `emailSignal` to `recommendFocusAreas`.
  - **`app/api/focus/recommend/route.ts`** — same pattern: fetches email signal in parallel, passes to `recommendFocusAreas`.
  - Degrades gracefully: `scopeMissing:true` → no email section in prompt, no basedOn entry; any fetch error → null → prompt unchanged. Calendar+memory path unaffected.
  - 20 new tests (5 `isUrgentEmail`, 5 `formatEmailSignalForPrompt`, 6 `recommendFocusAreas` email integration, 4 existing suites). 759/759 green, tsc clean, next build clean.
  - ⚠️ **Requires gmail.readonly scope** — Derrick will need to reconnect Google (Settings → disconnect → reconnect Google) to grant this. Once granted, email flows into tomorrow's 9am briefing automatically.
- **2026-06-15** — **Hero Loop briefing fix — `recommendFocusAreas` always fires; 4-step INSTRUCTION; `energy_cost` ref cleanup**.
  - **[FIX] `recommendFocusAreas` now fires on EVERY briefing call** — removed the `priorities.length === 0` guard in `lib/briefing.ts`. When priorities are set, they're passed as `anchors` so each recommendation ladders to a real goal. Previously the engine only ran when no priorities existed, meaning Derrick (who has priorities) never got a focus proposal.
  - **[FEATURE] 4-step HERO LOOP INSTRUCTION** in the `FOCUS RECOMMENDATION` briefing block — guides Edge through: STEP 1 Edge Score → STEP 2 Energy → STEP 3 Focus Proposal (propose → `confirmFocus`) → STEP 4 Reshape Offer (`applyCalendarPlan`). Rationale text is shown alongside each area's anchor priority. Step 3–4 explicitly marked as "the product's magic moment — do not skip."
  - **[CLEANUP] `energy_cost` ref removed from dashboard `Priority` interface** — local `interface Priority` in `app/dashboard/page.tsx` no longer has `energy_cost` field (was unused after UI removal).
  - 739/739 green, tsc clean, next build clean.
- **2026-06-15** — **Score correctness fixes + priorities → Memory sync + remove energy-cost UI**.
  - **[FIX] Focus Score now reads confirmed daily_focus** — `/api/scores` prefers today's confirmed
    `daily_focus` (from `FocusRecommendationCard`) over `getThisWeek`; falls back to `getMostRecent`
    (any week) so stale-week priorities still count. Confirming a recommendation now closes the
    loop and drives the Focus Score immediately.
  - **[FIX] Energy Score no longer fakes 100/70 on empty calendar** — `computeEnergyScore` returns
    `calibrating: true, score: 50` when `taggedEvents.length === 0`. Covers both classification
    failure (`.catch(()=>[])`) and genuinely empty calendars. 5 test expectations updated.
  - **[FEATURE] Priorities → Memory sync** — on every priorities save, `factQueries.syncPriorityFacts`
    clears old `source='priority-sync'` facts and re-inserts current priorities as `category='goal'`
    facts. They appear in "What Edge knows" → Goals and flow into Edge's briefing context.
    `facts.source` column added via migration (nullable TEXT; existing rows default NULL).
  - **[CLEANUP] Per-priority energy-cost UI removed** — `ENERGY_COST_OPTIONS`, `savingCost` state,
    the high/med/low badge row, and `onEnergyCostChange` prop removed from `PrioritiesTab`.
    Backend (`energy_cost` column, `setEnergyCost` query, `/api/priorities/[id]/energy` route) kept.
  - 733/733 green, tsc clean, next build clean.
- **2026-06-15** — **Remove Tasks IA — tab + UI pipeline removed from dashboard**.
  - `TasksTab` component + `TaskRow` component deleted from `app/dashboard/page.tsx`.
  - `Task` interface, `tasks` state, `/api/tasks` fetch, `{ id: 'tasks' }` nav entry, and
    `activeTab === 'tasks'` render block all removed. `activeTab` type narrowed.
  - Underlying task infrastructure kept: `taskQueries`, `/api/tasks/**` routes,
    `extractTasksFromTranscript` pipeline, and briefing accountability logic remain —
    they run silently to power morning briefings. Tab removal only.
  - 733/733 green, tsc clean, next build clean.
- **2026-06-15** — **Energy color-coding — `colorByEnergy` + `colorEventsByEnergy` Vapi tool**.
  - **`lib/calendarScore.ts`**: `colorByEnergy(tags, signal)` pure function — maps `{ eventId, demand }[]` + `EnergySignal` to `EnergyColorAssignment[]` (eventId → Google Calendar colorId). Color logic: low demand → sage ('2') always; medium → banana ('5') on green/yellow days, tangerine ('6') on red; high demand → blueberry ('9') on green (aligned), tangerine ('6') on yellow (caution), tomato ('11') on red (warning), peacock ('8') when no signal. Also exports `EnergyColorAssignment` type.
  - **`app/api/vapi/tool-call/route.ts`**: `colorEventsByEnergy` handler — fetches today's events, classifies with `classifyEventsEnergy` (Haiku), applies `colorByEnergy`, batch-patches Google Calendar events (skips read-only calendars), records undo group, returns spoken summary.
  - **`lib/vapi.ts`**: ENERGY COLORS prompt block — triggers on "color my calendar by energy" / "color-code my events" / "show me my energy on the calendar". Placeholder tool ID comment added.
  - 9 new tests (8 demand/signal combinations + multi-event mapping). 733/733 green, tsc clean, next build clean.
  - ⚠️ External step: create `colorEventsByEnergy` tool in Vapi dashboard. No params required. Paste UUID into `lib/vapi.ts` placeholder and uncomment.
- **2026-06-15** — **Dashboard wiring — EdgeScoreCard + FocusRecommendationCard + DayPlanCard + NotificationCenter**.
  - **`app/api/day-plan/route.ts`** (new GET): builds today's plan via `buildCalendarPlan`, converts Core's `PlanAction[]` to Design's `PlanChange[]` format (wall-clock slot formatting, detail strings), estimates `scoreAfter`, issues a `planId` via `issueDeleteToken`. Returns null when no actions needed (card shows "Your day looks good").
  - **`app/api/day-plan/confirm/route.ts`** (new POST): consumes `planId` via `consumeDeleteToken` (idempotency guard), re-builds plan deterministically, executes creates + moves via Google Calendar API (same logic as Vapi `applyCalendarPlan` handler), records undo group, re-scores + persists. Returns `{ ok, newScore, count }`.
  - **`app/dashboard/page.tsx`** wiring:
    - Imports: `CalendarFitCard` → `EdgeScoreCard`; added `FocusRecommendationCard`, `DayPlanCard`, `NotificationBell`, `NotificationCenter` + types `FocusRecommendation`, `FocusRecommendationArea`, `CalendarPlan as DayPlanType`.
    - State: `focusRec`, `focusRecLoading`, `focusRecDismissed`, `dayPlan`, `dayPlanLoading`, `dayPlanApplied`, `dayPlanAppliedScore`.
    - Fetches in `loadData`: `/api/focus/recommend` → `focusRec`; `/api/day-plan` → `dayPlan`.
    - Handlers: `handleConfirmFocus` (POST `/api/focus/confirm`, dismisses card); `handleConfirmDayPlan` (POST `/api/day-plan/confirm`, sets applied + refreshes score).
    - Landing area: `EdgeScoreCard` replaces `CalendarFitCard`; `FocusRecommendationCard` shown below (dismissible); `DayPlanCard` shown when calendar connected (loading/plan/applied states).
    - Notification bell: inline bespoke `🔔` + dropdown replaced with `NotificationBell` + `NotificationCenter`; preserves "Book a time" via `NotifAction` closure; "Check for replies" button kept as footer.
  - 724/724 green, tsc clean, next build clean.
- **2026-06-15** — **Hero Loop — `applyCalendarPlan` tool + `buildCalendarPlan` pure engine** (`0b6c5af`).
  - **`lib/calendarPlan.ts`** (pure, no I/O):
    - `findFreeSlot(events, date, durationHours, tz, workStart?, workEnd?)` — scans today's events in the user's timezone (decimal wall-clock hours), finds the first contiguous free slot ≥ `durationHours` within working hours, returns wall-clock datetimes ("YYYY-MM-DDTHH:MM:00"). Handles all-day events (filtered out), overlapping blocks, trailing gaps.
    - `buildCalendarPlan(todayEvents, fit, priorities, date, tz)` — composes a 1–2 action plan:
      - **Focus action:** if `focusScore.topFix.op === 'create'`, finds the first free 90-minute slot and plans a `⚡ Focus — <priority>` block. Extracts priority name from topFix description regex; falls back to `priorities[0].text`.
      - **Energy action:** if `energyScore.topFix.op === 'move'` AND `worstMismatchEventId` is set, plans to move the mismatch event to tomorrow (same wall-clock time, via `newDate = date + 1 day`).
      - Returns `CalendarPlan { actions[], summary (Edge speaks this), generatedAt }`.
    - Deterministic: same inputs → same plan between step-1 preview and step-2 execute.
  - **`lib/calendarScore.ts`**: `worstMismatchEventId?: string | null` + `worstMismatchEventTitle?: string | null` added to `ScoreResult`. `computeEnergyScore` populates them from the internal `worstMismatch` tracker.
  - **`applyCalendarPlan` tool handler** in `app/api/vapi/tool-call/route.ts` (two-step confirmToken pattern, same as `cleanupDuplicates`):
    - Step 1 (no token): gathers full context (`getCalendarEvents`, `getWeekEvents`, Whoop, `computeAlignment`, `classifyEventsEnergy`, `computeCalendarFit`), builds plan, returns spoken summary + `issueDeleteToken`.
    - Step 2 (with token): executes creates (`cal.events.insert`, `colorId:'9'`), executes moves (searches `calIds` for correct calendar, `timedEventDateMove`, `cal.events.patch`). Move undo = `type:'patch'` back to original start/end. Records plan-level undo group. Re-fetches + re-classifies + re-scores after; persists new `calendarScoreQueries.upsert`; reports edge score delta ("Your day just got better").
  - **`lib/vapi.ts`**: HERO LOOP prompt block — when user says "reshape my day" / "fix my calendar" / "optimize my schedule" / "apply the plan" → call `applyCalendarPlan`. Read summary, wait for yes, call again with confirmToken. Placeholder tool ID comment added.
  - 17 new tests (8 × `findFreeSlot`, 9 × `buildCalendarPlan`). 724/724 green, tsc clean, next build clean.
  - ⚠️ External step: create `applyCalendarPlan` tool in Vapi dashboard. Params: `confirmToken` (string, optional). Paste UUID into `lib/vapi.ts` toolIds placeholder and uncomment.
- **2026-06-15** — **ONE Edge Score (0–100) + Energy fix** (`4ab5aaa`).
  - **`CalendarFit`** extended: `edgeScore: number` (the ONE headline number) + `calibrating: boolean`. Sub-scores `focusScore` + `energyScore` kept as breakdown.
  - **`computeCalendarFit`**: `edgeScore = avg(focus, energy)` when both real; falls back to `focusScore` alone when energy is calibrating.
  - **`computeEnergyScore` bug fixes:**
    - `null signal` → `calibrating: true, score: 50` (never presented as a real score). Previously returned a fake 50 with no calibrating flag.
    - **Medium-demand on red day now carries a partial penalty (×0.5)** — a packed "medium" day on low recovery was silently scoring 100%; now scores ~50%. Supersedes the old "medium is never penalized in MVP" rule.
  - **`lib/db.ts`**: `edge_score` column added to `calendar_scores` via migration; `calendarScoreQueries.upsert` signature requires `edgeScore`; `CalendarScore` interface updated.
  - **`app/api/scores/route.ts`**: persists `edgeScore`.
  - **`lib/briefing.ts`**: CALENDAR FIT prompt leads with Edge Score + calibrating note.
  - **`lib/vapi.ts`**: CALENDAR SCORES voice note updated to ONE Edge Score framing.
  - 8 new tests. 685/685 green, tsc clean, preflight clean.
- **2026-06-15** — **Focus Recommendation engine v1 — day-scoped, energy-aware, anchor-referencing** (`7264397`).
  - **UNIT = TODAY.** `recommendFocusAreas(userId, opts)` now outputs 3 focus areas **for TODAY** (not the week).
  - **`lib/db.ts`**: `daily_focus` table + `idx_daily_focus_user_date` + `dailyFocusQueries` (upsert, getToday, confirm). `DailyFocusRecord` interface.
  - **`lib/focusRecommendation.ts`**: `FocusArea.anchor` (ladders to stable priority), `FocusRecommendation.date`, `EnergySignal`, `RecommendOpts`. LLM prompt updated: TODAY scope, energy tier context (green/yellow/red capacity), anchor ladder-up instructions, today's calendar load section.
  - **`GET /api/focus/recommend`**: assembles Whoop recovery → energySignal, today's calendar, stable anchors (getMostRecent) in parallel before calling recommendFocusAreas.
  - **`POST /api/focus/confirm`**: writes to `daily_focus` (upsert+confirm) — no longer touches `priorities`. Accepts FocusArea objects or plain strings. Timezone-aware date derivation.
  - **`confirmFocus` tool handler**: writes to `daily_focus`, derives today's date from user timezone. Speaks "your focus today" framing.
  - **`lib/briefing.ts`**: recommendFocusAreas receives energySignal + todayEvents + date after main Promise.all resolves.
  - 15 new tests (26 total in focusRecommendation.test.ts). 677/677 green, tsc clean, next build clean.
  - ⚠️ External step: create `confirmFocus` in Vapi dashboard → `areas` param (array of strings, required) → paste UUID into `lib/vapi.ts` toolIds placeholder and uncomment.
- **2026-06-15** — **Focus Recommendation engine — Edge TELLS the user their weekly focus areas** (`a516ee1`).
  - **`lib/calendar.ts`**: `getPastCalendarEvents(userId, days)` — raw event fetch for analysis workloads, capped at 250/calendar. Used by the recommendation engine.
  - **`lib/focusRecommendation.ts`** (new, pluggable): `FocusRecommendation / FocusArea` contract; `aggregateEventThemes()` pure helper; `recommendFocusAreas(userId)` — parallel source assembly (calendar 180d + call facts + notes) + one Sonnet call → top 1–3 focus areas + rationale + confidence. Degrades gracefully on thin data or LLM failure.
  - **`app/api/focus/recommend/route.ts`**: `GET /api/focus/recommend` → `FocusRecommendation` (dashboard consumption).
  - **`app/api/focus/confirm/route.ts`**: `POST /api/focus/confirm` — accepts `{ areas: string[] }`, replaces this week's priorities store; scores + scoreboard keep working unchanged.
  - **`app/api/vapi/tool-call/route.ts`**: `confirmFocus` handler — validates areas, deletes + re-creates priorities, returns spoken confirmation.
  - **`lib/vapi.ts`**: `confirmFocus()` tool doc + FOCUS RECOMMENDATION prompt block. `confirmFocus` toolId placeholder added (⚠️ **External step**: create `confirmFocus` in Vapi dashboard → `areas` param (array of strings, required) → paste UUID here and uncomment).
  - **`lib/briefing.ts`**: when no current-week priorities → `recommendFocusAreas` runs in parallel with the main data fetches; FOCUS RECOMMENDATION block injected into the briefing prompt so Edge proposes verbally on the morning call.
  - **20 new tests** (`lib/focusRecommendation.test.ts`). 662/662 green, tsc clean, next build clean.
- **2026-06-14** — **CalendarFitCard wired as dashboard landing view.**
  - `app/dashboard/page.tsx`: added `calendarFit: CalendarFit | null` + `calendarFitLoading: boolean` state. Background-fetches `GET /api/scores` in `loadData` (non-blocking, alongside energy/milestones fetches). `sparse` = `priorities.length === 0 || calendarConnected === false`.
  - `<CalendarFitCard>` rendered at the top of `<main>` in a `mb-6` wrapper, above the tab content — always visible regardless of which tab is active.
  - Imports: `CalendarFitCard` + `CalendarFit` from `@/components/ui` (already exported via index).
  - 641/641 green, tsc clean, next build clean.
- **2026-06-14** — **Scoring engine MVP simplification — pure-quant Focus % + LLM-tagged Energy %.**
  - **Stripped** the two-component judgment layer (deferred — see `specs/calendar-scores.md`). No more `quantScore`, `judgmentScore`, `weights`, `ScoreFeedback`, `JudgmentRule`, or the four deterministic rules.
  - **`ScoreResult` (MVP):** `{ score /*0–100*/, drivers[], topFix }`.
  - **Focus Score:** `focusAlignedHours / totalWorkingHours * 100` (default 45h/week). Pure, no events needed — just `alignment` + `priorities`. Drivers: per-area hours / zero warnings + biggest time sink. topFix: blocks uncovered area, trims unaligned, or adds time (by score tier).
  - **`classifyEventsEnergy(events)`:** async batch LLM call (Haiku). Classifies every timed event → `{ type: EventType, demand: 'high'|'medium'|'low' }`. Returns `TaggedEvent[]`. Falls back to `{type:'other', demand:'medium'}` on any LLM failure. Designed for fast-follow cache swap-in (Security's `event_energy_tags` table).
  - **Energy Score:** `computeEnergyScore(taggedEvents, signal, profile)` → 0–100. Penalty = weighted mismatch: high-demand on red day (w=2); high-demand in trough window (w=2). Score = `(1 − penaltyWeight/totalWeight) × 100`. Special cases: no signal → 50; no events + red → 100 (protected). topFix targets the worst mismatch or suggests profile setup.
  - **`computeCalendarFit`** signature updated: `(taggedEvents, alignment, priorities, energySignal, energyProfile, totalWorkingHours?)`.
  - **`app/api/scores/route.ts`:** `classifyEventsEnergy(todayEvents)` now runs in parallel with `computeAlignment`.
  - **`lib/briefing.ts`:** same — `classifyEventsEnergy(calendarEvents)` in parallel with `computeAlignment`; CALENDAR FIT prompt block updated to `%` framing.
  - **`lib/vapi.ts`:** CALENDAR SCORES note updated (0–100%, threshold 50, "Focus is at X%").
  - Tests: rewrote `lib/calendarScore.test.ts` (49 tests, all pure — no LLM in tests). Previous judgment tests removed.
  - 641/641 green, tsc clean, next build clean.
- **2026-06-14** — **Focus/Energy scoring engine V2 — two-component blend (quant + judgment).**
  - `ScoreResult` extended: `{ score, quantScore, judgmentScore, weights: {quant, judgment}, drivers[], topFix }`.
    Both halves populate `drivers` — no black box. Weights are tunable params (default 50/50).
  - **Focus Score — Judgment half** (2 deterministic expert rules, 55%/45% within judgment):
    - `ruleF_DiminishingReturns`: >5h/week on one area past saturation → penalty; worse when another area is starved at 0h. Scale: 2 (critical) → 4 (rebalance needed) → 7 (mild saturation) → 9 (healthy).
    - `ruleF_DomainArchetypes`: deep work + fundraising priorities need ≥90min/60min blocks respectively; fragmented sessions → score 4 + driver. Fitness/leadership archetypes don't have block-length requirements (generalizable norms, not personal prefs).
  - **Energy Score — Judgment half** (2 deterministic expert rules, 60%/40%):
    - `ruleE_DayTypeAppropriateness`: energy level as a capacity MULTIPLIER — red day + any high-demand = score 2 (costs more than it earns); green day + high-demand outside peak = score 6 (leaving capacity on table); green + in peak = 10 (optimal).
    - `ruleE_RecoveryInsurance`: ≥2 late-evening events (after 7 PM) = score 2; 1 late event = score 5; back-to-back demanding events (<15 min gap) = score 5; clean day = score 9.
  - **`ScoreFeedback` interface** (hook only, not used V1): `{ ruleId, delta, note? }` — architectural placeholder for the human-in-the-loop tuning loop. Keeps generalizable principles separate from personal tuning.
  - **`app/api/scores/route.ts`**: now uses `energyProfileQueries.get(userId)` (structured DB profile, fall back to `parseEnergyProfile`); persists each computed score via `calendarScoreQueries.upsert`. Non-fatal on persistence failure.
  - **`lib/briefing.ts`**: same `energyProfileQueries.get` + fallback pattern added.
  - 634/634 green, tsc clean, next build clean.
- **2026-06-14** — **Focus/Energy scoring engine V1 (`lib/calendarScore.ts`) — the headline scores.**
  - **`lib/calendarScore.ts`** (pure, 0 I/O, 33 new tests):
    - `ScoreResult { score: 1-10, drivers: string[], topFix }` + `CalendarFit` + `EnergyProfile` — shared contract.
    - `parseEnergyProfile(statements)` — parses peak/trough windows from free-text preference facts.
    - `computeFocusScore(events, priorities, alignment)` — 4 weighted components: coverage (35%), aligned share (30%), protected blocks ≥90min (20%), balance vs ranking (15%).
    - `computeEnergyScore(events, energySignal, energyProfile, priorities)` — 3 components: demand↔window match (40%), load vs capacity (35%), recovery protection (25%).
    - `computeCalendarFit(...)` — both scores + `computedAt`.
    - Both scores always populate `drivers` (plain-English reasons) and `topFix` (the single most impactful change) so Edge can say why and offer one fix.
    - Degrades gracefully: no priorities → score 1 + setup message; no energy signal → score 5; no profile → neutral match score.
  - **`lib/briefing.ts`**: parses energy profile from preference facts; calls `computeCalendarFit`; injects CALENDAR FIT block (both scores + drivers + topFix) into `userPrompt` — Edge opens every call with the scores.
  - **`lib/vapi.ts`**: CALENDAR SCORES note — open with "Focus X, Energy Y — here's why", offer topFix immediately; act on yes.
  - **`app/api/scores/route.ts`** (`GET /api/scores`): fetches today's events + alignment + energy; returns `CalendarFit` for dashboard. 603/603 green, tsc clean, next build clean.
- **2026-06-14** — **Focus Scoreboard — milestone check-offs + per-area progress + briefing momentum.**
  - **`lib/db.ts`**: `focus_milestones` table (cascades on priority delete; `done_at` tracks completion time);
    `FocusMilestone` interface; `focusMilestoneQueries { listForUser, listForPriority, create, setDone, remove }`.
    Index on `(user_id, priority_id)`.
  - **`lib/focusProgress.ts`** (pure, 0 I/O): `buildFocusProgress(priorities, alignment, milestones)` →
    `FocusProgress[]` per area: `hoursThisWeek` (from alignment), `milestonesDone/Total`, `isComplete`
    (all milestones done + ≥1 exist), `neglected` (< 0.5h this week). `formatFocusScoreboardForBriefing`
    builds FOCUS SCOREBOARD prompt block: momentum line per area, CELEBRATE block for milestones completed
    in the last 26h, NEGLECTED block with free-slot offer instruction. 14 new tests.
  - **`lib/briefing.ts`**: fetches all milestones for user; builds `focusProgress` + `recentlyDoneMilestones`
    (26h window); injects FOCUS SCOREBOARD block into `userPrompt` after ALIGNMENT DATA.
  - **`lib/vapi.ts`**: FOCUS SCOREBOARD live-call note — celebrate milestone wins, proactively offer to
    block time for neglected areas (findTime + createEvent on yes).
  - **API routes** (all user-scoped):
    - `GET /api/milestones` — list all milestones for user (bulk dashboard fetch)
    - `GET /api/priorities/[id]/milestones` — list milestones for one priority
    - `POST /api/priorities/[id]/milestones` — add milestone (`text`)
    - `PATCH /api/milestones/[id]` — toggle done (`done: boolean`)
    - `DELETE /api/milestones/[id]` — remove milestone
  - **Dashboard** (`app/dashboard/page.tsx`): `milestones` state; loaded via `GET /api/milestones` in
    `loadData`. `PrioritiesTab` extended: per-priority milestone checklist (check-off, inline add with
    Enter/Escape/blur, hover-delete ×). Handlers: `onMilestoneAdd` (POST), `onMilestoneToggle` (optimistic
    state + PATCH), `onMilestoneDelete` (optimistic state + DELETE). Design owns visual polish.
  - 24 new tests. 558/558 green, tsc clean, next build clean.
- **2026-06-14** — **Energy OS MVP — daily energy signal + priority cost tags + dashboard setter.**
  - **`lib/energy.ts`** (pure, 0 I/O): `EnergyLevel`, `EnergySignal`, `whoopTierToLevel(score)`,
    `deriveEnergySignal(log, whoopScore)` (precedence: stored override > stored manual > Whoop auto > null),
    `formatEnergyForBriefing(signal, priorities, firstName)` (ENERGY STATE + FOCUS-AREA ENERGY COSTS +
    RED DAY ACTION blocks), `formatEnergyForCall(signal, firstName)` (compact line or ask-early prompt).
    18 new tests in `lib/energy.test.ts`.
  - **`lib/db.ts`**: `energy_log` table (UNIQUE(user_id, date) ensures one row per day; upsert-on-conflict);
    `energyLogQueries.upsert()` + `.getToday()`. `energy_cost` column on `priorities` (migration-safe ALTER);
    `priorityQueries.setEnergyCost()`. `Priority.energy_cost` optional (new migration column may be absent).
    `EnergyLog` interface.
  - **`lib/briefing.ts`**: derives today's energy signal from stored log or Whoop recovery; calls
    `formatEnergyForBriefing` and injects ENERGY block into `userPrompt` between priorities and calendar.
    Fixed `{firstName}` placeholder — now passes real first name.
  - **`lib/vapi.ts`**: 11th `energyText` param in `initiateCall`; injected after WHOOP DATA section.
    `setEnergyLevel` tool guidance bullet (level red/yellow/green, source manual/override).
  - **`lib/scheduler.ts`**: `currentEnergyText(userId)` — derives signal from log or Whoop recovery;
    both `scheduleBriefingCall` and `scheduleOpenCall` pass it as the 11th arg to `initiateCall`.
  - **`app/api/energy/today/route.ts`** (new): `GET` returns today's energy signal (log or Whoop-derived);
    `POST` upserts a manual entry.
  - **`app/api/priorities/[id]/energy/route.ts`** (new): `PATCH` sets `energy_cost` on a priority.
  - **`app/api/vapi/tool-call/route.ts`**: `setEnergyLevel` handler — validates level/source, upserts to
    `energy_log`, returns spoken confirmation.
  - **Dashboard**: `energySignal` state; loaded via `/api/energy/today` in `loadData`. Sidebar energy
    quick-set card (Red / Yellow / Green buttons; active level highlighted; POST to `/api/energy/today`
    on click; source 'override' if Whoop was the prior source). Priorities tab: per-priority energy-cost
    badges (high/medium/low); click to set or toggle off; PATCH `/api/priorities/[id]/energy`.
  - 18 new tests. 534/534 green, tsc clean, next build clean.
  - ⚠️ **External step (PM):** Create `setEnergyLevel` tool in Vapi dashboard. Params: `level` (string, required — red/yellow/green), `source` (string, optional — manual/override). Paste UUID into `lib/vapi.ts` toolIds.
- **2026-06-13** — **Stronger Whoop recommendations — baseline-relative + composite signal (Priority 4).**
  - `buildBaselineContext(recovery, recoveryHistory, recentSleepMs, recentStrain)` pure helper
    added to `lib/briefing.ts`. Computes "today 45% · 7-day avg 63% · −18 pts" baseline line.
    Adds a COMPOSITE SIGNAL block when ≥2 signals compound (red recovery + sleep debt <6.5h avg +
    high strain >15 on Whoop's 0–21 scale). Frame is coaching grounded in numbers — never
    medical claims. Degrades to null when fewer than 3 history points.
  - Injected into `whoopContextBlock` in `generateDailyBriefing` as "BASELINE (use these numbers
    when coaching pacing...)" — placed after the tier line so the model can cite concrete delta
    in section 1 ("18 points below your weekly average") and tie pacing advice to the actual gap.
  - Sleep history sorted newest-first before slicing so the most recent 7 days are always used.
  - 8 new tests. 490/490 green, tsc clean, next build clean.
- **2026-06-13** — **Voice polish + call status + copy-transcript (Priorities 7, 3, 8).**
  - **P7 — Voice pronunciation avoid-list (prompt-only):** Added WORD CHOICE line to `lib/vapi.ts`
    system prompt. Instructs Edge to say "wrap up" not "wind up", "finish" not "wind down", and to
    avoid homographs ElevenLabs mispronounces. ~1 line addition to the NATURAL LANGUAGE cluster.
  - **P3 — Call status + report-missed-call:**
    - `GET /api/briefing/today-status` — queries today's briefings for the logged-in user (by
      `scheduled_for LIKE <today>%`), returns `{ status, scheduledFor }` or `{ status: 'none' }`.
    - `POST /api/briefing/retry-call` — guards against double-calling (409 if already completed
      or calling); calls `scheduleBriefingCall(userId)` which generates a fresh briefing + initiates
      Vapi call; returns `{ success, briefingId }`.
    - Dashboard sidebar: fetches today's status on load. Shows "✓ Call done for today" (green),
      "● In progress…" (accent), or "Missed today / Call failed" + "Call me now" button when
      status is missed/failed. Button fires retry endpoint; sidebar optimistically shows "Calling
      you now…" on success.
  - **P8 — Copy-transcript button:** In the expanded briefing detail (Briefings tab), the CALL
    TRANSCRIPT header row now has a "Copy" button. On click → `navigator.clipboard.writeText`
    with the full transcript text → "Copied ✓" for 2s then reverts. `copiedTranscriptId` state
    tracks which card has the active confirmation so multiple cards don't interfere.
  - 482/482 green, tsc clean, next build clean.
- **2026-06-13** — **Fact trustworthiness + profile-name fix (Priorities 1, 2).**
  - **P1 — Profile-name fix:** `extractFactsFromTranscript(transcript, userName?)` now injects the
    correct user name into the Haiku prompt so STT mis-spellings ("Derek" for "Derrick") are
    corrected at extraction time. `isSelfEntity(entity, userName)` secondary guard skips `person`
    facts about the user themselves. `extractAndUpsertFacts` updated to pass `user.name` from the
    webhook caller.
  - **P2 — Fact trustworthiness:** `confidence TEXT ('high'|'low')` and `source_briefing_id`
    columns added to `facts` table (migration-safe ALTERs). `upsertFact` accepts both; Haiku
    returns `"confidence":"low"` for STT-risky entities (unusual names, street addresses). Dashboard
    shows "⚠ verify" badge on low-confidence facts; "learned from your <date> call ↗" provenance
    link on facts with a source briefing.
  - 9 new tests. 482/482 green, tsc clean, next build clean.
- **2026-06-13** — **Call-time in prompt + location awareness + edit/delete facts.** (`75589c4`)
  - **Call-time in system prompt (addendum 1):** `initiateCall` gains a `callTime` 10th arg (default `''`).
    Injects `SCHEDULED CALL TIME: <HH:MM tz>` into the live-call prompt so Edge can answer "when do
    you call me?" directly without relying on the calendar block. Both briefing + open-call scheduler
    paths pass `user.call_time || ''`.
  - **Location awareness (addendum 2, prompt-only):** LOCATION AWARENESS bullet added to `lib/vapi.ts`.
    Edge calls `rememberPreference("CURRENT LOCATION: <address>")` when user says where they are, and
    `"NAMED PLACE: <alias> = <address>"` for place nicknames ("up north = 119 Scandia Lane"). "Near me"
    / "nearby" searches look up the stored CURRENT LOCATION fact rather than using freshly-transcribed
    speech (which STT commonly mishears). Always echoes address back before storing.
  - **Edit/delete facts (addendum 3):** `factQueries.updateFact(userId, id, statement, entity)` and
    `factQueries.deleteFact(userId, id)` added to `lib/db.ts` — both enforce `AND user_id = ?`.
    New `PATCH /api/memory/facts` and `DELETE /api/memory/facts` routes (401 unauth, 400 on missing
    fields). Dashboard Memory tab: per-fact ✏ (inline textarea → Save/Cancel) and × (inline confirm →
    Delete). Optimistic state update. CORRECTING MEMORIES prompt bullet: when user says Edge got
    something wrong → apologise, correct for this call, point to "What Edge knows" on dashboard.
  - 5 new tests (updateFact/deleteFact mock contract + user-scoping). 476/476 green, tsc clean, next build clean.
- **2026-06-13** — **Call-time reminder sync + research misheard-address retry.** (`8d25e4f`)
  - **T1 — Call-time change syncs calendar reminder:** `buildBriefingReminderBody` (pure, tested)
    and `resyncBriefingReminder(userId)` extracted to `lib/calendar.ts`. ONLY-IF-EXISTS: finds
    existing reminder masters and recreates them at the new time; never force-creates for users
    who skipped setup. Called fire-and-forget from the call-time route. `findBriefingReminderMasters`
    shared with the reminder POST route (no drift). 4 new tests.
  - **T2 — Research on garbled address retries:** `lib/vapi.ts` prompt extended: when a local
    business search returns no results, treat it as a likely-bad query (misheard address), re-confirm
    location + terms, and retry before reporting "nothing found." Never save a NORESULTS block.
  - 471/471 green, tsc clean, next build clean.
- **2026-06-10** — **QA bug batch — 5 bugs fixed** (3 commits `0390c63`→`dfc0bf2`). All from autonomous audit:
  - **Bug 1 [MEDIUM, data-destructive]** `moveEvent` silently converted timed events to all-day when model supplied only `newStartDate`. Root: `dateMove = isAllDay || !!newStartDate` fell into the date-only patch path for timed events. Fix: 3 explicit branches — (a) all-day → date patch, (b) timed + date-only input → new `timedEventDateMove()` that extracts wall-clock time via Intl and preserves duration, (c) full datetime → unchanged. `timedEventDateMove` added to `lib/time.ts` with 4 tests.
  - **Bug 2 [HIGH]** Outreach emails showed availability slots with no timezone label — recipients couldn't tell which timezone "2:00 PM" referred to. Fix: `buildOutreachBody()` now accepts `userTimezone` and derives a short abbreviation (e.g. "PDT") via Intl, inserting it into the slot header. Threaded through `composeOutreachEmail()` and the `draftEmail` handler in `route.ts`. 2 new tests.
  - **Bug 3 [LOW-MED]** `bookEventTimes` silently clamped late-evening + long-duration bookings to `23:59`, shortening meetings. Fix: roll end into the next calendar day via `nextDay()` instead of clamping. Updated 2 existing tests that had asserted the wrong behavior.
  - **Bug 4 [LOW]** `recipientsFromNotes()` could pick a non-name first line (e.g. "Best plumber in Austin") as the recipient name. Fix: prefer an explicit `Name:` line; validate fallback by rejecting URLs, email addresses, and lines longer than 80 chars. 5 new tests.
  - **Bug 5 [LOW]** (a) `generatePreviewBriefing` interpolated `user.call_time` (can be null) into the LLM prompt. Guarded with `?? '07:00'`. (b) Preview endpoint could return inconsistent text on concurrent first-loads. Fix: re-read from DB after `INSERT OR IGNORE` so the response always matches storage.
  172/172 tests, tsc clean, build clean.
- **2026-06-10** — **Day-1 preview briefing SHIPPED** (`d724556`) — activation "aha" on first dashboard load.
  - New `GET /api/briefing/preview`: checks for existing preview, generates if absent (one LLM call per user, never repeated), returns JSON `{ content }`.
  - New `generatePreviewBriefing(userId)` in `lib/briefing.ts`: priorities-first, calendar optional (degrades gracefully if not connected), ~200-word welcoming tone — distinct from the daily briefing format.
  - New `preview_briefings` table in `lib/db.ts` (additive — `UNIQUE on user_id`, `INSERT OR IGNORE` handles races). Claimed in Status Board before touching.
  - Dashboard (`app/dashboard/page.tsx`): triggers preview fetch once `onboarding_complete && briefings.length === 0`; shows a spinner ("Edg3 is putting together your preview…") while generating, then a labeled card "✦ HERE'S WHAT EDG3 ALREADY KNOWS ABOUT YOUR WEEK". Preview disappears once the user has real briefings. 160/160 tests, tsc clean, build clean.
- **2026-06-10** — **readCalendar response cap + prompt trim re-apply** (`tool-call/route.ts`,
  `lib/vapi.ts`). Two latency-hardening changes in one commit:
  - `readCalendar` now drops `status=cancelled` events (recurring-event expansions include them)
    and hard-caps at **25 active events** with a `(Showing first 25 of N…)` trailer. Fixes the
    late-call lag: each readCalendar call was growing the Vapi context by 50+ event lines; now
    bounded. Security's idempotency guards (`claimEventCreate`, `confirmToken`) fully preserved.
  - System prompt re-trimmed (~25% reduction) — Security's batch had reverted to the old verbose
    version (their branch was behind Core's `942a497`). Re-applied the trim with Security's new
    `confirmToken` delete-confirm language incorporated (model must pass back the server-issued
    token, not `confirmed:true`). 117/117 tests, tsc clean, build clean.
- **2026-06-10** — **Chief-of-Staff calendar API SHIPPED** (`app/api/admin/calendar/events/route.ts`,
  `lib/calendar.ts`). Two new admin endpoints guarded by `x-admin-secret`:
  - `GET /api/admin/calendar/events?email=...&days=7` — upcoming events for the next N days
    (1–90, default 7), returned as trimmed objects (id, title, start, end, allDay, description,
    location, status). Fetches all non-hidden calendars in parallel via new `getUpcomingEvents()`.
  - `POST /api/admin/calendar/events` — creates an event on the user's primary calendar.
    Body: `{ email, title, start, end, description?, timezone? }`. Validates ISO parse + end > start.
    Returns `{ success, eventId, title, start, end, timezone }`.
  No new Google scopes needed. 80/80 tests, tsc clean, build clean (52 routes).
- **2026-06-10** — **System-prompt trim + honest-failure guardrail** (`lib/vapi.ts`). Trimmed the
  static system prompt by ~25% (~300 tokens / call): collapsed the 7-line named-days block into a
  compact single-line format, merged 6 error-handling bullets into one `HONEST FAILURE` bullet,
  removed the redundant tool-name list (model knows tools from toolIds), tightened conditionals,
  scope, and personality text. Added a clearer honest-failure rule: "Never say 'done' unless the
  tool returned success. Never fabricate a result. A clear 'I couldn't do that' is always better
  than a false 'done.'" All critical behaviors preserved (all-day date range, confirm-delete,
  undo, timezone passthrough, NEVER INVENT FACTS, disambiguation, draftEmail draft-only).
  Caching finding: **Vapi does NOT expose Anthropic `cache_control`** — `systemPrompt` is a plain
  string with no `cacheControl`/`anthropicConfig` passthrough, so per-turn prompt caching is
  unavailable; trimming is the only lever. 80/80 tests, tsc clean, build clean.
- **2026-06-10** — **Deduplicated `recipientsFromNotes`** — removed the inline copy from the `draftEmail` handler in `app/api/vapi/tool-call/route.ts`; now imports the canonical, tested version from `lib/outreach`. tsc clean, 80/80 tests.
- **2026-06-10** — ★ **Recent Activity tab SHIPPED** — per-row undo feed in the dashboard.
  - New **Activity** tab (⏪) in the sidebar nav; shows the last 20 actions Edge took on the user's calendar, newest first.
  - Each row: action label (e.g. "created 'Team Meeting' on June 25"), relative timestamp, and an **↩ Undo** button that reverses that specific action in place.
  - Already-undone rows are shown greyed out (full audit trail — nothing hidden). Only one undo runs at a time to prevent race conditions.
  - API changes (all additive, backward-compatible):
    - `GET /api/undo?list=1` → returns `{ actions: [{id, label, undone, created_at}] }` for the feed.
    - `POST /api/undo` with `{ id: N }` → undoes that specific log entry (cross-user guarded); without `id` still undoes the latest (existing sidebar button unaffected).
    - `undoQueries.listRecent(userId, limit)` + `undoQueries.getById(userId, id)` added to `lib/db.ts` (Shared — claimed before editing; additive only).
  - The quick-undo button in the sidebar remains for the most recent action; the Activity tab is for browsing and selective undo of any past action.
  - Acceptance: user can open Activity tab and undo any individual Edge action without a voice call. ✅ tsc clean, 61/61 tests.
- **2026-06-09** — ★ **Email drafting SHIPPED (draft-only)** — `draftEmail` handler wired in
  `app/api/vapi/tool-call/route.ts` (Shared, claimed first; additive) + tool/system-prompt guidance in
  `lib/vapi.ts`. Flow: `emailableRecipients` (skip no-email contacts, report them) → `findFreeSlots` over a
  one-week window (default today→+6, or `startDate`/`endDate`) → `formatSlotsForEmail` → per recipient
  `composeOutreachEmail` (lib/outreach.ts) → Security's `createDraft(userId, {to, subject, body})`
  (lib/gmail.ts, guarded/draft-only) → `recordUndo` with one `deleteDraft` op per draft. Never sends.
  `GmailScopeError` → tells the user to reconnect Google (re-consent); `GmailRateLimitError` → reports the
  cap and keeps/undoes drafts already made. Returns "Drafted N emails in your Gmail — review and send."
  Verified green: tsc clean, 61/61 tests, eslint clean (only pre-existing `_e` warnings).
  - ⚠️ **External step (Vapi dashboard) — the model can't call `draftEmail` until its tool is created there.**
    Add a new tool named **`draftEmail`** with these params:
    - `recipients` — **array** of objects `{ name (string), email (string) }`. The people to email (from research results). Required.
    - `ask` — **string**. What to ask them, e.g. "when they can come by this week". Required.
    - `proposeAvailability` — **boolean**. Include the user's real open calendar slots in the email. Default true.
    - `startDate` — **string** (YYYY-MM-DD), optional. Start of the availability window. Defaults to today.
    - `endDate` — **string** (YYYY-MM-DD), optional. End of the availability window. Defaults to 6 days after start (this week).
    - `subject` — **string**, optional. Overrides the auto-generated subject.
    Then paste the tool's Vapi ID into the `toolIds` array in `lib/vapi.ts` (placeholder comment marks the spot).
- **2026-06-09** — Ownership-split fix (PM ruling, ROADMAP §3): both lanes had created `lib/gmail.ts`.
  Resolved — `lib/gmail.ts`/`lib/google-auth.ts` are 🔒 Security's (the Gmail access primitive +
  guarded `createDraft`); Core's **composition** lives in new `lib/outreach.ts`. Deleted my
  `lib/gmail.ts`/`lib/gmail.test.ts`; ported the composition helpers to `lib/outreach.ts`
  (`emailableRecipients`, `formatSlotsForEmail`, `buildOutreachBody`, `composeOutreachEmail` →
  `{recipient, subject, body}`) with unit tests in `lib/outreach.test.ts` (6 pure-helper tests). Dropped
  the Gmail primitives (`buildRawMessage`/`createGmailDraft`/`deleteGmailDraft`) — those are Security's;
  the future `draftEmail` handler will call Security's `createDraft` + `deleteDraft` undo op. Full suite
  39/39 green, tsc + eslint clean. Frees the `gmail.ts` filename so Security's foundation merges cleanly.
  - ⏳ **Still gated on 🔒 Security** (Gmail scope + `createDraft` + `deleteDraft` UndoOp on master).
    On the PM's "scope landed" signal: `git merge master`, claim `tool-call/route.ts` (Shared), wire
    `draftEmail`, merge. Then user adds `draftEmail` params to the Vapi dashboard. Remaining wiring steps
    documented in `lib/outreach.ts` header.
- **2026-06-09** — Shipped both **Now** tickets in one pass (`app/api/vapi/tool-call/route.ts` + `lib/vapi.ts`):
  - **Multi-day all-day + editable all-day.** `createEvent` all-day branch now takes an inclusive
    `endDate` and writes one spanning event (Google `end.date = nextDay(endDate)`) instead of forcing
    a per-day loop. `moveEvent` now re-dates all-day events via date-only `newStartDate`/`newEndDate`
    (auto-detected for any all-day target), so "make it just the 26th" / "extend it to the 30th" works;
    delete already worked. System prompt in `lib/vapi.ts` instructs the model to make ONE spanning
    event for a range and to use `moveEvent` date params to fix it.
  - **Research replaces, not piles up.** `researchToEvent` wraps findings in `--- Edge research ---`
    delimiters; each call strips the prior research block and writes only the latest, while preserving
    the user's own typed notes (`stripResearchBlock`).
  - ⚠️ **External step (Vapi dashboard, cannot be done from code):** the tool param schemas live in
    Vapi (referenced by `toolIds` in `lib/vapi.ts`), not the repo. Add `endDate` (string, date) to the
    **createEvent** tool and `newStartDate`/`newEndDate` (string, date) to the **moveEvent** tool so the
    model can pass them. Until then route.ts degrades safely (single-day all-day; re-date still works for
    detected all-day events via the existing datetime params sliced to a date).
  - 🤝 **Security coupling (#3 idempotency):** this rewrite makes the all-day path a *single* insert
    (was a model-driven multi-call loop), so it reduces — not increases — duplicate-on-retry surface.
    No dedupe added here (Security's lane). Sync before the `tool-call/route.ts` master merge.
- **2026-06-09** — Lane created (renamed from "Builder" → "Core"). Mandate set:
  ship new user-facing features for the Edg3 voice/calendar assistant. Backlog
  below is a **seed** — the PM refines it from user feedback.

---

## Mandate
Ship new **user-facing features** for the Edg3 voice + calendar assistant —
improving the dashboard, briefing, calendar, and onboarding experiences. Move
product value fast while staying inside the Core ownership lane (constitution
§3); hand anything touching auth/secrets/infra to the Security lane.

## How priorities are ranked
By user-visible value shipped per day, inside the Core-owned surface. The PM sets
priority from user feedback.

## Backlog (seed — PM refines from user feedback)
### Now
- [ ] **★★★ Focus Scoreboard (the OUTCOME layer — the heart of the vision)** — _Derrick, 2026-06-14._
  The product's success metric: "am I getting more of my focus areas DONE?" We built the engine
  (input + energy scheduling) but NOT the scoreboard. Full vision: `specs/energy-os.md` (Layer 3 + NEXT MVP).
  - Present the 3 priorities as **"your areas of focus"** (each with energy cost).
  - **Progress per area:** time invested this week (from alignment engine) + optional **milestones**
    the user checks off (additive `focus_milestones` schema — coordinate 🔒 Security).
  - **"Done" feels good:** checking off a milestone / completing an area → visible progress + a moment
    of celebration; Edge acknowledges warmly on the next call.
  - **Edge surfaces it:** momentum ("6h on fundraising"), neglected focus → offer to block time, celebrate completions.
  - Lanes: 🛠️ Core (progress logic + milestones + briefing/call surfacing), 🎨 Design (scoreboard + check-off + celebration), 🔒 Security (milestones schema).
- [x] **★★ Energy OS — MVP** — ✅ SHIPPED 2026-06-14 (`7024d91`, 543 green): energy signal red/yellow/green (Whoop-auto/dashboard/call), energy-cost tags, energy-driven day recs. Design's visual polish reconciling. `setEnergyLevel` Vapi tool pending (needs key).
- [ ] **★ Briefing V2 — proactive, goal-driven, relational** — _from Derrick's 10/10 call feedback, 2026-06-14._
  Make the morning briefing PROACTIVE (not report-and-react). **Full spec: `specs/briefing-v2-proactive.md`.**
  - **Quick prompt wins (do first, low risk):** recovery → motivating encouragement tied to the
    actual event + tonight's sleep; proactively offer to fill the first free slot with a stated
    priority and ACT on yes; offer choices among goals for free time; look ahead to TOMORROW; warmly
    engage personal events (e.g. "Dad's Birthday" → ask + offer help).
  - **Needs stored facts:** strain goal (Derrick's = ">10"); dinner/nutrition for the 130lb goal.
  - **★ Needs infra (highest trust):** remember + COMPLETE unfinished committed actions across calls
    (e.g. the gym move that failed repeatedly) — open the next call by finishing it. Coordinate with
    🔒 Security on the action/audit log.
- [ ] **★ Whoop V3 — Proactive recovery defense + correlations** — _PM + user decision, 2026-06-13. The "magic tier" of the Whoop integration; user explicitly queued it after V1/V2 shipped._
  - **Context:** V1 (recovery-aware pacing) and V2 (energy-matched blocking) are live. Security shipped the history primitives (`getRecoveryHistory` / `getSleepHistory` / `getStrainHistory`, 14-day, in `lib/whoop.ts`). The dashboard RecoveryCard is wired (`/api/whoop/recovery`, PM commit `bf35921`). This ticket builds the two things on top of that data.
  - **Part A — Proactive recovery defense (briefing + live).**
    - **Goal:** When recovery is RED (≤33%) **or drops sharply vs the recent baseline** (e.g. ≥20-pt drop from the trailing-7-day average), Edge *proactively* proposes lightening today — names the heaviest / most-deferrable block(s) and offers to move or shrink them. Edge offers → user confirms → Edge acts via the existing `moveEvent`/`deleteEvent`/`createEvent` tools. Never auto-edits without consent.
    - **Impl:** pure helper, e.g. `detectRecoveryDrop(today, history)` in `lib/whoop*`/`lib/briefing.ts` → returns `{ red | sharp_drop, deltaVsBaseline, suggestion }` or `null`. Inject a `RECOVERY ALERT` block into the briefing prompt; add a matching live-call note in `lib/vapi.ts` so a mid-call "how's my recovery" with a low score triggers the same offer. Degrades to `null` when history is thin — never fabricate.
    - **Honesty guard:** only claim a drop the data supports; never say Whoop measured something intraday it didn't (reuse the V2 honesty wording).
  - **Part B — Correlations over time (the high-value piece).**
    - **Goal:** With ≥~10–14 days of data, surface 1–2 plain-English patterns tied to a concrete calendar action: e.g. *"Your recovery runs ~X% lower the day after evenings with a meeting past 7pm — want me to keep this week's evenings clear after 7?"* or *"You sleep ~N min less when your last event ends after 9pm."*
    - **Impl:** new pure module `lib/whoopCorrelations.ts` — input = Whoop history (recovery/sleep/strain by date) **+ the user's recent calendar history**; output = ranked plain-English insights with a confidence/sample-size gate. Returns `null`/empty below the data threshold (briefing simply omits the section). Surface at most ONE correlation in the briefing when confidence is sufficient; pair it with an offer to act.
    - **⚠️ Key dependency / scoping decision (flag before building):** correlations need **historical calendar context**, but today we only fetch the *current* day's calendar. Two options — Core to pick:
      1. **Pull a 14-day past window from Google** (`timeMin`/`timeMax` in the past) at briefing time and correlate by date — *no new storage, simplest, preferred.*
      2. Log a lightweight daily event-summary snapshot going forward (new table) — more durable but slower to produce signal and needs a Security-coordinated schema add.
      Start with option 1 unless it proves too heavy.
    - **Strictness:** never assert a correlation without enough days; phrase with the implicit window ("over the last two weeks"); never fabricate a number.
  - **Acceptance:** (A) On a red/sharp-drop recovery morning, the briefing proactively offers to lighten the day with a specific block; "yes" → Edge moves it. (B) After ~2 weeks of data, the briefing surfaces one real, data-backed sleep/recovery↔calendar pattern with an offer to act; below the threshold it stays silent (no invented patterns).
  - **Coordination:** `lib/briefing.ts` + new `lib/whoop*` modules are Core-owned. Live-call note touches Shared `lib/vapi.ts` (claim in Status Board). History primitives already exist (Security) — no new Security work unless Core picks option 2 (then coordinate a schema add). Update `specs/whoop-integration.md` (V2.5/V3 sections) + this changelog when shipped.
- [x] **Multi-day all-day events + ability to edit/fix them** — _from a real user call, 2026-06-09._ **✅ Shipped 2026-06-09 (see changelog).**
  - **Symptom:** User asked Edge to "create all-day events from June 25–28." Edge made four separate one-day all-day events instead of one spanning event, then could not fix it when asked.
  - **Root cause:**
    - `createEvent` all-day branch (`app/api/vapi/tool-call/route.ts:279`) hardcodes `end: { date: nextDay(dateOnly) }` → it can only make a *single-day* all-day event. No range param, so the model is forced to loop one-per-day.
    - No tool can re-date an all-day event afterward: `editEvent` only changes description/location; `moveEvent` takes datetimes, not date-only. So "fix it" is structurally impossible.
  - **Fix:**
    1. Add an inclusive `endDate` param to the all-day path; set Google `end.date = nextDay(endDateInclusive)` so one event spans the range (25→28 inclusive ⇒ start `2026-06-25`, end `2026-06-29`).
    2. Make all-day events editable — let `moveEvent`/`editEvent` (or a new path) change an all-day event's start/end *dates*, so "make it just the 26th" / "extend it to the 30th" works.
    3. Update the `createEvent` tool schema + system-prompt guidance in `lib/vapi.ts` so the model passes one spanning all-day event for a date range instead of looping.
  - **Acceptance:** "Create an all-day event from June 25 to 28" → one event spanning 25–28. "Actually just the 26th" → adjusts in place. "Remove it" → gone in one action.
  - **Coordination:** touches `app/api/vapi/tool-call/route.ts` + `lib/vapi.ts` (Shared — constitution §5). Core owns the calendar behavior; ping Security since these are vapi-path files.
- [x] **Research notes should replace, not pile up** — _from a real user call, 2026-06-09 (Hong Kong gyms w/ sauna)._ **✅ Shipped 2026-06-09 (see changelog).**
  - **Symptom:** Re-running research on an event stacks the new findings on top of the old research. Notes should show only the newest / most relevant, not an accumulating pile.
  - **Root cause:** `researchToEvent` (`app/api/vapi/tool-call/route.ts:268`) always appends — `description: e.description ? \`${e.description}\n\n${block}\` : block`. No replace/dedupe of prior research.
  - **Fix:** Wrap each research block in a recognizable delimiter (e.g. a marker header). On every research call, strip any prior research block(s) and write only the fresh findings, while **preserving the user's own (non-research) notes** in the description. Keep the existing "most relevant first, up to 6" prompt.
  - **Acceptance:** Researching the same event twice → description shows only the latest research plus any user-typed notes; no duplicated/stacked piles.
  - **Coordination:** same Shared file as the all-day ticket (`tool-call/route.ts`) — batch them; both touch event description/creation logic.

### Next (decided)
- [ ] **★★★ Focus RECOMMENDATION engine — Edge TELLS you your focus** — _Derrick "aha" 2026-06-15. Full spec: `specs/focus-recommendation.md`. Likely the single most differentiating feature; HOLDING dispatch for Derrick's go + ChatGPT-source clarification._
  - **The flip:** instead of the user declaring 3 focus areas, Edge analyzes the data and PROPOSES them; user confirms/tweaks in one breath. A real chief of staff figures out what matters FOR an overwhelmed person.
  - **Data (Derrick: "pull all of these"):** past ~6mo calendar (extend `getPastCalendarDays` 14d→180d) + call memory (`factQueries` + memories) + Whoop (energy input) + **★ email (ELEVATED — core source; foreclosures/financial/life-admin live there; needs gmail.readonly + Security + strong privacy; CASA/verif implication)**. v1 = calendar + memory (ready); fold in Whoop + email as they land.
  - **Build:** `recommendFocusAreas(userId)` → top 3 proposed focus areas + rationale + confidence (one LLM call over assembled history); surface on the briefing call + dashboard; one-yes confirm writes to the priorities store (scores/scoreboard unchanged). Degrade on thin data.
  - **Upstream of the scores** — feeds the same priorities the Focus Score measures. Lane split: Core (engine + past-fetch + confirm flow + surfacing), Design (the propose/confirm UI), Security (ChatGPT/email ingestion + privacy if/when added).
- [ ] **★★★ Focus Score + Energy Score — the proprietary calendar-intelligence engine** — _Derrick + PM, 2026-06-14. Full spec: `specs/calendar-scores.md`. Flagship "spend real time, make it proprietary" build. SEQUENCE right after the Focus Scoreboard._
  - **What:** Edge scans the calendar and grades it with **two 1–10 scores**, recomputed daily + before every call. **Focus Score** = does the calendar reflect the 3 areas of focus? **Energy Score** = does what's booked match the user's energy? Loop: scan → score → propose add/move/delete/recolor → re-score.
  - **Engine** `lib/calendarScore.ts` (pure, tested): `computeFocusScore(events, priorities, alignment)` + `computeEnergyScore(events, energySignal, energyProfile, energyCosts)`, each → `{ score, drivers[], topFix }`. Deterministic + explainable (Edge can always say *why* + offer the single best fix). Builds on `lib/alignment.ts` + the energy signal.
  - **Surfacing:** headline on the morning call ("Focus 6, Energy 4 — want me to fix it?") + top of the dashboard Scoreboard as two gauges = **"Calendar Fit (today)"** above the existing **"Progress (over time)"**.
  - ⚠️ **Naming:** resolve clash — "Focus Score" (calendar quality, point-in-time) ≠ "Focus Scoreboard" (progress over time). Unify on one Scoreboard surface holding both halves (see spec).
  - **Then (same theme, sequenced):**
    - **Energy color-coding** — Google Calendar `colorId` so the calendar is a visual energy map (peak/trough colors; mismatches visible). New `colorByEnergy` action/tool + `lib/calendar.ts` write. Needs the energy profile (peak/trough windows). Coordinate w/ Security on batch-write idempotency/audit.
    - **Energy detection from the morning call** — **DECIDED transcript-first:** infer red/yellow/green from the call transcript (LLM classify) when the user didn't state it; `energy_log` `source:'inferred-call'`; user override wins. Precedence: explicit > dashboard override > inferred-call > Whoop > none. **Calibration:** energy perception calibrates over **~10 calls** (per-user baseline) — show "Edge is learning your energy — call N of 10" until calibrated; don't act on a shaky read before then. **v2 = voice prosody** (proprietary path) — full research + build plan in `specs/voice-energy.md`.
    - **Score-driven reshaping** — when a score is low, Edge proposes + (on yes) executes the `topFix`.
  - **Lane split:** Core = engine + surfacing + color-coding + call inference + reshaping; 🔒 Security = daily-score history schema (additive) + energy-profile storage + batch-recolor idempotency/audit + inferred-energy privacy; 🎨 Design = two-gauge Calendar Fit viz + energy color legend + "why a 6?" explanation UI.
- [ ] **★★★ THE HERO LOOP — "diagnose → propose → one yes → reshaped week"** — _Derrick + PM, 2026-06-14. THE magic moment the whole product serves. Sits on top of the scoring engine above. See `specs/energy-os.md` "magic moment"._
  - **Experience:** on the morning call Edge opens with the diagnosis (focus score + energy score + why), then "here's what I'll change," proposes **a few high-leverage changes** (the scores' `topFix`es), the user does **as little as possible** (one "yes," maybe one tweak), and Edge **reshapes the whole week** — then re-scores to prove it ("focus went 6 → 8"). Walk away feeling "whoa, that improved my week."
  - **Core principle:** minimum user effort. Edge LEADS with specific proposals, not open questions. Default to action.
  - **The missing capability — a calendar PLAN abstraction (batch propose+execute):** today Edge edits one event at a time with per-op confirms. Build:
    - **Plan composition** — from the scores, assemble a `CalendarPlan` = ordered ops (create/move/delete/recolor), each with a plain-English description + which score it improves. (Pure/testable: `lib/calendarPlan.ts`.)
    - **Read-back + partial approval** — Edge states the plan; user can accept all, tweak, or drop items ("yes but skip the gym one").
    - **Batch execute as ONE undoable unit** — new `applyCalendarPlan` tool (generalizes the `cleanupEvents` batch+single-confirmToken pattern to mixed op types); records a **plan-level undo group** so one undo reverts the whole reshape; one Activity entry for the reshape.
    - **Re-score after** — recompute Focus/Energy scores and report the lift.
  - **Trust:** read-back before executing + one-tap undo-the-whole-reshape + Activity log. (Future: auto-apply low-risk changes with notification+undo — NOT MVP; MVP is one-yes.)
  - **Depends on:** the scoring engine (`lib/calendarScore.ts`) for `topFix`; energy color-coding for recolor ops; undo/Activity (have). **Lane split:** Core = plan composition + `applyCalendarPlan` + re-score + call flow; 🔒 Security = batch idempotency/atomicity + plan-level undo durability + audit; 🎨 Design = the "here's your plan / done — score lift" moment on dashboard + call-summary.
- [ ] **★★ Dashboard IA reset — Scores as the landing screen + REMOVE Tasks** — _Derrick + PM, 2026-06-14._
  - **Landing page = the Scoreboard** (Calendar Fit: Focus Score + Energy Score gauges, with Progress below). This is what the user sees first on the dashboard — the daily "is my calendar set up right + am I getting it done?" view. (Depends on the scoring engine above.)
  - **REMOVE Tasks** — the Tasks tab is overwhelming/stress-inducing and off-vision (people manage tasks their own way). Remove the Tasks tab + the task list as a user surface. **Scope nuance (PM interpretation — Derrick correct me if wrong):** also retire the task-extraction → briefing "did you do X?" accountability, since **focus-area milestones (Focus Scoreboard) now carry "what you're working on."** Update `lib/briefing.ts` so it no longer references tasks; remove/clean `app/api/tasks/**`, the dashboard Tasks tab, `extractTasksFromTranscript` surfacing, and any Tasks nav. Keep the change reversible (git).
  - **KEEP:** Briefings, **Activity** (trust/transparency), **Memory** ("what Edge knows"). No change to those beyond the nav reshuffle.
  - **Lane split:** Core = remove tasks code + briefing cleanup + dashboard IA/data; 🎨 Design = new landing/nav (Scoreboard-first, Tasks gone, remaining tabs reflowed).
- [ ] **★★ Notifications, re-aimed at Focus × Energy** — _Derrick + PM, 2026-06-14. Full spec: `specs/notifications.md`. SEQUENCE AFTER the Focus Scoreboard lands._
  - **Principle:** notifications are Edge's voice between calls; every one must ladder up to focus or energy, be few + high-signal, and be **actionable** (one tap does the thing). Web-app notifications only (not SMS).
  - **Keep** the generic notification center (table / `notificationQueries` / `/api/notifications` / bell).
  - **REMOVE (off-vision email-assistant feature):** email-reply→calendar chain — reply watching (`watched_threads`, `lib/replies.ts`, `checkOutreachReplies`, `checkReplies` handler + Vapi tool ID), `type:'reply'` notifications, and the **Book-it** endpoint `app/api/calendar/book/route.ts` + its dashboard UI. (Coordinate with Security on retiring `watched_threads`.) **`draftEmail` is PARKED, not removed** (see IDEAS.md).
  - **MVP build (decided):** (1) **Type 1 celebration** producers — fire a notification when a milestone is checked off / a focus area completes (ties into the Focus Scoreboard). (2) **Type 4 energy one-tap** — "How's your energy today?" notification with one-tap 🔴🟡🟢 that writes the daily energy record. Then Type 2 (drift nudges), later Type 3 (proactive-action transparency + undo).
  - **Actionable endpoints:** set-energy-from-notif, "block it", check-off, undo — one tap each.
  - **Lane split:** Core = producers + removal + action endpoints; 🔒 Security = schema cleanup (retire `watched_threads`, adjust `notifications.type`) + keep title/body encryption + auth/idempotent action endpoints; 🎨 Design = notification center as a control surface + celebration visual (shared with Scoreboard).
- [ ] **★ Selectable voice — add a female voice option (user choice)** — _Derrick, 2026-06-14. DEFERRED (not now — single user), but committed to the roadmap._
  - **Why:** as the ICP broadens (high-performers incl. female users), a single male voice (ElevenLabs "Daniel") limits appeal. Let users pick their Edge voice.
  - **Scope:** add ≥1 high-quality **female** ElevenLabs voice; a `voice` preference on the user profile; pass the chosen voice ID into `initiateCall` (`lib/vapi.ts` voice config). Onboarding + Settings voice picker (ideally a play-sample preview).
  - **Effort:** small. **Lane split:** Core = profile setting + pass-through + picker behavior; 🔒 Security owns the `lib/vapi.ts` voice config slot (coordinate — Shared file); 🎨 Design = the picker UI + sample-preview affordance.
- [x] ~~**Email-reply tracking → proactive surfacing in the briefing**~~ — **SHIPPED 2026-06-10; ⚠️ being REMOVED 2026-06-14 (off-vision — see Notifications ticket above).** `lib/replies.ts` (`checkOutreachReplies` + `understandReply`); `lib/briefing.ts` calls it; `draftEmail` registers `threadId` → `watched_threads`; `lib/gmail.ts` `readThread` (Security); `notifications` table + `notificationQueries`. Degrades safely if `gmail.readonly` not yet granted.
- [x] **Notifications v1: in-app notification center** — **✅ SHIPPED 2026-06-10 (by PM session directly to master)**. Bell icon + unread badge + panel in dashboard; `/api/notifications` GET/POST; `notificationQueries` CRUD. Replies trigger notifications at briefing time + on-demand via "↻ Check for replies" button.
- [x] **★ TOP PRIORITY: Email drafting — outreach with calendar availability (draft-only Gmail)** — _PM decision 2026-06-09, user request._ **✅ SHIPPED & working end-to-end 2026-06-09 (after fixing moveEvent trailing-space key + setting the draftEmail tool server URL). Left here for reference; superseded by the reply-tracking ticket above.**
  - **Goal:** After research (e.g. plumbers), Edge drafts a personalized outreach email per contact asking their availability this week and **proposing the user's real open calendar slots**, saved as a **Gmail draft** for the user to review + send. Draft-only — Edge NEVER sends.
  - **Depends on 🔒 Security:** the Gmail OAuth scope + a safe draft-create helper (see `ROADMAP-SECURITY.md` "Gmail access"). Gate on that landing first.
  - **New tool:** `draftEmail` in `tool-call/route.ts` — params: `recipients` (name + email, from research results), `ask` (e.g. "when can you come this week"), `proposeAvailability` (bool), `dateRange` (defaults to this week).
  - **Implementation:** (a) pull availability by reusing `findFreeSlots` → format proposed times in the user's tz; (b) compose a short, polite plain-text email per recipient (Claude) including the ask + proposed slots; (c) create the draft via `gmail.users.drafts.create` (new `lib/gmail.ts` wrapper using the OAuth client Security extends); (d) gracefully skip recipients with no email ("Email: not found") and tell the user which lacked one; (e) `recordUndo` = delete the draft.
  - **Trust:** never call `messages.send`. Confirm back: "Drafted N emails in your Gmail — review and send."
  - **Acceptance:** After researching plumbers, "draft emails asking when they can come this week and suggest my availability" → N Gmail drafts, each with the ask + the user's real open slots; nothing sent.
  - **Coordination:** touches Shared `tool-call/route.ts`; `lib/gmail.ts` is Core-owned but rides on the OAuth scope/token Security manages. Effort ~2–3d after scope lands.
- [x] **"Recent activity" review surface** — _PM decision 2026-06-09._ **✅ Shipped 2026-06-10 (see changelog).**
  - **Why:** The user keeps discovering messy calendar edits mid-call (duplicate all-day events, piled-up research). A dashboard feed of what Edge did — with one-tap undo/correct — turns silent frustration into something visible and fixable.
  - **Scope:** Dashboard view listing recent actions Edge took (newest first): what changed, when, on which event, with an **Undo** affordance per row (reuse the existing `undo_log` inverse ops shipped in `28f364d`).
  - **Dependency (cross-lane):** wants a clean, append-only activity feed as its data source → **Security item #7 (harden audit log: before/after snapshots, append-only table)**. Two-phase: Security #7 builds the backbone, Core builds the view on top. A quick v0 can read the current `undo_log` if we want something shippable before #7 lands.
  - **Acceptance:** From the dashboard the user can see the last N actions Edge took and undo any one of them without a voice call.

- [x] ~~**Travel price lookup (flights + hotels) → trip event**~~ — ❌ **DROPPED 2026-06-09.** Rationale: low-frequency (people book travel a few times/year) and a commoditized space with strong incumbents (Google Flights, Kayak) — hard to beat the user's existing workflow. Refocusing on **research** instead (high-frequency, unique to Edge's research→save→act chain). _PM + user decision._
  - **Goal:** On a call, Edge looks up **real** flight/hotel prices and saves the options to a calendar trip event. Voice flow: "What are flights to Hong Kong on June 25?" → Edge fetches options → reads them back → attaches them to a trip event.
  - **Data source (decided):** a real travel-pricing API, **not** web search — fares must be quotable with confidence. Candidate: **Amadeus Self-Service** (flight offers search + hotel search, free test tier). Wrap in a new `lib/travel.ts`.
  - **New tool:** `researchTravel` in `tool-call/route.ts` — params: `type` (flight|hotel), `origin`, `destination`, `departDate` (YYYY-MM-DD), `returnDate?`, `passengers?`, `nights?`. Format results as clean plain-text (reuse the `researchToEvent` note-cleaning), then patch onto a trip event (create one if none exists) via the same `recordUndo` path.
  - **Trust:** only quote prices the API returned — keep the "NEVER INVENT TRAVEL FACTS" guardrail (now Edge can cite the API). Include currency and a "fetched <date>" stamp since fares change. Follows the research-replace rule (don't pile up stale quotes).
  - **Coordination (Security):** introduces a new external API credential (`AMADEUS_*`) → **Security owns provisioning + securing the secret, env config, and a rate-limit/cost guardrail** (these calls cost money / are rate-limited). Coordinate before merging. Also touches the Shared `tool-call/route.ts`.
  - **Acceptance:** "Find flights to Hong Kong June 25 returning July 2" → Edge returns real fare options sourced from the API, timestamped, saved to a HK trip event. Re-running replaces stale quotes rather than stacking them.
  - **Effort:** ~2–4d.

### Chief of Staff calendar tools (2026-06-10)
- [x] **Admin calendar API — read + create events on Derrick's behalf** ✅ Shipped 2026-06-10 (see changelog). — _Chief of Staff session needs direct Google Calendar access so it can book events without going through Edge or manual entry._
  - **Scope:** Two new admin endpoints, protected by `x-admin-secret` header (same pattern as `app/api/admin/latest-briefing/route.ts`):
    1. `GET /api/admin/calendar/events?email=derrick@deltaedg3.com&days=7` — returns upcoming events for the next N days using the existing `lib/calendar.ts` helpers + stored OAuth token.
    2. `POST /api/admin/calendar/events` — creates a calendar event. Body: `{ email, title, start (ISO), end (ISO), description? }`. Reuse existing `createCalendarEvent` logic from `lib/calendar.ts`.
  - **Auth:** same `checkAdminAuth` pattern as other admin routes — `x-admin-secret` header checked against `ADMIN_SECRET` env var.
  - **No new scopes needed** — calendar read/write is already granted.
  - **Acceptance:** Chief of Staff session can fetch Derrick's upcoming calendar and create events (reminders, focus blocks) directly via these endpoints.
  - **Effort:** ~1–2h. Self-contained, additive, no Shared files touched.

### Dashboard polish (from dogfooding 2026-06-10) — small, quick
- [x] **Re-link flow shouldn't route through onboarding.** **✅ Fixed 2026-06-10 (PM session).** Callback now redirects already-onboarded users to `/dashboard?linked=1` with a "Google account linked ✓" toast; first-time users still continue to onboarding.
- [x] **Profile page: "Your Profile" section is too long.** **✅ Fixed 2026-06-10 (PM session).** Section is now collapsible — collapsed to ~3 lines by default with a "▼ Show more" toggle.
- [x] **"Next call" section: the Undo button is unclear.** **✅ Addressed 2026-06-10.** Sidebar button now shows only when an undoable action exists, labeled "Edge's last calendar change — {what}". Full per-action undo lives in the new Activity tab (⏪).

### UX/UI — Onboarding v2 (2026-06-10, from designer audit · PM sign-off pending)
> Goal: get a new user to their first moment of value in under 90 seconds. Current profile step is the #1 drop-off risk. Batch these together — they ship as one onboarding rewrite.

- [ ] **Flip onboarding step order + defer profile** — _UX audit 2026-06-10. ~0.5d_
  - **Problem:** Step 1 sends users out of the app to ChatGPT before they've seen any value. Highest drop-off risk in the entire funnel.
  - **Fix:** New order: **Calendar → Priorities → Call Time → Profile (optional, post-signup)**. Profile step becomes a dashboard prompt ("Help Edg3 know you better") shown after the first briefing, when the user is already bought in. Profile is still supported — just not gating.
  - **Acceptance:** A new user can complete onboarding and reach the dashboard without ever touching the profile step.

- [ ] **Rewrite calendar step value prop** — _UX audit 2026-06-10. ~1h_
  - **Problem:** "Read-only access. EDG3 sees your events to build smarter briefings. Nothing is modified." doesn't motivate action.
  - **Fix:** Replace with: *"Edg3 tells you when your week doesn't match your priorities. That only works if it can see your week."* Also: note is currently inaccurate (calendar access is read-write, not read-only — needed for creating/moving events). Fix copy to reflect reality while staying reassuring.
  - **Acceptance:** Copy is accurate and motivating. No mention of "read-only."

- [ ] **Day 1 preview briefing post-onboarding** — _UX audit 2026-06-10. ~1d_
  - **Problem:** If the user misses or declines the intro call, there's a 12–24hr gap before any value arrives. No designed aha moment.
  - **Fix:** Immediately after onboarding completes, auto-generate and display a briefing preview on the dashboard using the data already collected (priorities + calendar if connected). Label it clearly: *"Here's what Edg3 already knows about your week."* This is the aha moment — it should happen in seconds, not tomorrow morning.
  - **Acceptance:** Every new user sees a personalized preview on first dashboard load, regardless of whether they took the intro call.

- [ ] **International users: phone number fallback message** — _UX audit 2026-06-10. ~1h_
  - **Problem:** Call Time step requires a US/Canada number with no recovery path for international users — dead end with zero explanation.
  - **Fix:** Below the phone input, add: *"Outside the US or Canada? Skip for now — you'll receive web briefings instead, and can add a number later."* Add a skip link that completes setup without a phone number.
  - **Acceptance:** Non-US users can complete onboarding without a phone number and reach the dashboard.

---

### UX/UI — Dashboard v2 (2026-06-10, from designer audit · PM sign-off pending)
> Goal: answer "what matters today?" within 3 seconds of opening the dashboard. Current layout buries today's focus behind tabs and leads with an input box.

- [ ] **Move UpdateBox (chat) below the briefing list** — _UX audit 2026-06-10. ~1h_
  - **Problem:** The "Tell Edge something" chat box is the first element a user sees on every dashboard load. It's a secondary input flow masquerading as the primary one.
  - **Fix:** Move `<UpdateBox />` below the briefing list/Today view. The hero of the dashboard should be today's briefing.
  - **Acceptance:** Dashboard opens on the briefing/Today content; chat box is reachable by scrolling.

- [ ] **Hide notification bell at zero-state** — _UX audit 2026-06-10. ~30min_
  - **Problem:** The bell icon renders for all users at all times, adding chrome for a feature most new users won't trigger in their first 30 days.
  - **Fix:** Render the bell only when `notifUnread > 0` or when the user has at least one watched thread. Zero-state = no bell.
  - **Acceptance:** A brand-new user's dashboard has no notification bell. Bell appears once there's something to notify about.

- [ ] **"Today" consolidated tab as default dashboard view** — _UX audit 2026-06-10. ~1–2d_
  - **Problem:** The briefings tab shows a collapsed history list; tasks and priorities require separate tab clicks. Opening the dashboard doesn't answer "what matters today?"
  - **Fix:** Add a **Today** tab (or rename Briefings → Today) that shows in a single view: (1) latest briefing content expanded by default, (2) today's tasks, (3) current priorities. This becomes the landing tab. Briefing history moves to a "Past briefings" collapsible section below.
  - **Acceptance:** A user opening the dashboard at 9am sees their briefing, today's tasks, and priorities without clicking any tabs.

- [ ] **Collapse to 3 tabs: Today / Memory / Settings** — _UX audit 2026-06-10. ~1d_
  - **Problem:** Five tabs (Briefings / Tasks / Priorities / Memory / Profile) cause decision fatigue and split content that belongs together.
  - **Fix:** Merge into three tabs: **Today** (briefing + tasks + priorities), **Memory** (unchanged), **Settings** (profile summary + call settings + calendar connect — currently split across Profile tab and sidebar). Remove the standalone Priorities and Tasks tabs.
  - **Note:** Coordinate with the Today tab ticket above — ship together.
  - **Acceptance:** Dashboard has exactly 3 tabs. All existing functionality is reachable within them.

---

### UX/UI — 30-Day Retention (2026-06-10, from designer audit · PM sign-off pending)
> These address the habit-formation gap: nothing currently pulls a user back after missed calls or a streak break.

- [ ] **Priority drift prompt at 7 days** — _UX audit 2026-06-10. ~0.5d_
  - **Problem:** No mechanism prompts users to keep priorities current. Stale priorities = stale briefings = lower perceived value.
  - **Fix:** If `priorities.updated_at` is older than 7 days, show a dashboard banner: *"Are these still your top priorities this week? [Update] [Yes, keep them]"*. Tapping "Yes, keep them" updates the timestamp; tapping Update opens the priorities editor inline.
  - **Acceptance:** Users who haven't updated priorities in 7+ days see the prompt on dashboard load. Users who dismiss it don't see it again for another 7 days.

- [ ] **Streak/consistency indicator in sidebar** — _UX audit 2026-06-10. ~0.5d_
  - **Problem:** No visual feedback for consistent engagement. Users don't feel the cost of breaking a streak, so there's no loss-aversion hook.
  - **Fix:** Add a simple call-streak counter below the "Next call" card in the sidebar: *"🔥 7-day streak"* (increments on completed briefing calls, resets on a missed day). No gamification overload — one number, one label.
  - **Acceptance:** Sidebar shows current streak. Streak increments after a completed call. Resets to 0 after a missed day.

- [ ] **Weekly summary email/digest** — _UX audit 2026-06-10. ~1d (needs email infra confirmation)_
  - **Problem:** If a user misses several calls in a row, nothing brings them back. The product goes silent.
  - **Fix:** A short weekly email (Sunday evening or Monday morning): what Edg3 observed this week, whether the user's calendar matched their priorities, any open threads or unresolved tasks. Plain text, personal tone. Opt-out in one click.
  - **Dependency:** Needs an email sender (Resend / SendGrid / similar). Confirm with PM before building — if no sender is configured, this stays in Later.
  - **Acceptance:** Users receive a weekly digest. Unsubscribe works in one click. Digest is generated from existing briefing + priority data with no new data collection.

---

## ✅ PM DISPATCH — 2026-06-18 (T2-4 — Briefing accuracy regression tests) — **DONE 0975089**

`buildBriefingContext(user, data, today?)` extracted from `lib/briefing.ts`. 10 spec-driven regression assertions in `lib/briefing.test.ts`. 1828/1828 green.

---

## ✅ PM DISPATCH — 2026-06-18 (M3-1 + DC2-2 + DC2-4 — Briefing context quality) — **DONE**

- **T1 (M3-1):** 90-day stale filter via `isStaleForBriefing` + `filterStale: true` in all `topFacts` calls. Signal priority order matches spec. `buildBriefingContext` tests verify order + exclusion.
- **T2 (DC2-2):** `buildPersonalizationPromptBlock(salientFacts.length)` in PART 3; `buildBriefingContext` 3-signal floor + fill-the-gap tests added.
- **T3 (DC2-4):** `[DC2-4]` section-size log at line 1093; MAX 220 words guard; alignment check "one sentence" + pattern memory "ONE sentence only, omit if doesn't change recommendation" guards. 1828/1828 green.

---

## 📥 PM DISPATCH — 2026-06-18 (T3-1 part B — factPatterns.ts category fix)

> Master at `87af54d`. `git merge master` first. 10-minute ticket. Coordinate with Vijay — do part B only after Vijay's DB constraint migration (T3-1 part A) merges to master.

### Ticket 1 — Store pattern facts with category='pattern' in `lib/factPatterns.ts` (T3-1)

**The gap:** `lib/factPatterns.ts` stores detected patterns as `category='fact'` + `source='historical-pattern'`. The dashboard has a dedicated Patterns section (`app/dashboard/page.tsx:2589`, ORDER includes `'pattern'`) but it's always empty. After Vijay adds `'pattern'` to the DB CHECK constraint, switch `factPatterns.ts` to use the correct category.

**Fix:** In `lib/factPatterns.ts`, change the `upsertFact` calls from `category: 'fact'` to `category: 'pattern'`. Check for any type assertion that would need updating — the TypeScript type is updated as part of Vijay's DB change. Also update the briefing context assembly in `lib/briefing.ts` if it queries facts by `category='fact'` + `source='historical-pattern'` — switch it to `category='pattern'` after this lands.

- **Files:** `lib/factPatterns.ts`, possibly `lib/briefing.ts` if it has a pattern-specific query
- **Gate:** Do not merge until Vijay's T3-1 part A is in master (otherwise DB constraint will reject 'pattern' inserts)
- **Test:** Trigger pattern detection, verify a row with `category='pattern'` appears in facts; verify it shows in "What Edge knows" Patterns section

---

## 📥 PM DISPATCH — 2026-06-18 (DC3-1 — Voice anchor phrases, 1 ticket)

> Master at `3e2d129`. `git merge master` first. Short ticket — 30 min. Spec: `content/edge-voice-anchor-phrases.md`.

### Ticket 1 — Add 5 voice anchor phrases to `lib/vapi.ts` (PILLAR-DAILY-CALL DC3-1)

The spec is written. Add a `VOICE CONSISTENCY / ANCHOR PHRASES` block to `lib/vapi.ts` (in the PART 1 section, after GROUNDED & DECISIVE):

```
ANCHOR PHRASES — use these forms consistently every call. Content varies; structure stays fixed:
- GREETING: "Morning [firstName] — [single most important thing]." Under 15 words after the dash. No pleasantries. No warm-up.
- CALENDAR TRANSITION: "On the calendar today: [top 2–3 events]." One sentence. No narrating every item.
- WHOOP NOTE (when data present): "[Recovery level] today — [one plain-English implication]." Never "your Whoop says." Just "Recovery's high today — good day to go after the hard stuff."
- CLOSING QUESTION: One concrete action Edge can do RIGHT NOW. Never "is there anything else?" or "how does that sound?"
- END OF CALL: "Got it. [Optional one-line action note.] Talk tomorrow." Three sentences max. No "have a great day."
```

This is content-only — no logic changes. One commit. Preflight must be green. Update Status Board.

---

### Later / candidates (not yet committed)
- [ ] **🤝 Chief-of-Staff ↔ Edg3 bridge (founder tooling / intensive dogfooding)** — _user idea 2026-06-10. Build RIGHT AFTER the core loop is verified (the end-to-end test)._ Expose Edg3's capabilities (start with `draft_email` w/ availability, then `find_free_time` / `read_calendar` / `research`) to the **Chief of Staff agent** so it can *act through* Edg3 to help Derrick day-to-day. **Form:** a small **MCP server** (preferred) or CLI the CoS calls. **Value:** (a) makes Derrick effective now; (b) the CoS using Edg3 daily is the best bug-finder we have → de-risks launch. **Tradeoff:** internal tooling, not the product (scope vs the Sept freeze) — justified by the dogfooding payoff. **⚠️ Auth (🔒 Security):** needs a token that acts as the user against Edg3's API (account-level access) — coordinate with Security; for a single-user pre-launch tool a static `AGENT_TOKEN`-gated endpoint acting as user 1 is acceptable but must be deliberate. **Sequencing:** gated on (1) the core verified working, (2) Security building the token endpoint. Start with ONE capability (email drafting), prove the loop, expand.
- [ ] **🔮 V2 / POST-LAUNCH — Google Drive / Sheets awareness** (PM-deferred 2026-06-10, user idea). Edge pulls the doc/spreadsheet tied to a calendar event (e.g. the weekly P&L sheet for the "P&L review" block) and works it into the briefing. **Deferred because:** it's another *restricted* Google scope (compounds the verification we haven't started), it's new scope against the September freeze, and summarizing financial spreadsheets accurately is high-trust/high-risk. Lighter near-term paths if ever needed: (a) surface the doc *link* in the briefing (no new scope); (b) `drive.file` + file-picker so the user designates only specific docs (non-restricted scope).
- [ ] Onboarding: smoother first-run (connect calendar → first briefing) flow.
- [ ] Briefing: richer briefing content / personalization controls.
- [ ] Calendar: better event review & edit UX from the dashboard.

### Later
- [ ] _…_

---

## Guardrails for this lane
- Stay in the Core-owned files (constitution §3). For `lib/db.ts` schema changes,
  follow the Shared-file protocol (§5).
- New writes that create calendar events must be **idempotency-aware** — coordinate
  with the Security lane so features don't reintroduce duplicate-on-retry bugs.
- Don't weaken any destructive-action confirmation or undo behavior the Security
  lane has shipped.
