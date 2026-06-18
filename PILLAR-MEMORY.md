# 🧠 PILLAR: MEMORY
_Permanent backlog. If your dispatch is exhausted, work through this in order. If this is exhausted too, run the QA checklist at the bottom._

> **The thesis:** The model never changes. The context compounds. The longer someone uses Edge, the more irreplaceable it becomes — because no one else has their history. Every item in this pillar deepens the moat. Ship them in order.

**Lane ownership:** Core (Darren) leads. Security (Vijay) contributes schema + encryption items. Design (Cam) contributes the "What Edge knows" UI items.

---

## Tier 1 — Storage (ground truth, correct and complete)

### M1-1 — Episode store ingestion: wire all call sources (Core) — ✅ **LIVE (Round 5)**
**Shipped:** `lib/episodeStore.ts` wired in `app/api/vapi/webhook/route.ts` (dynamic import, line 170, fire-and-forget); inserts episode per call with userId, source='call', transcript, extracted topics + commitments.
~~**The risk:** The episode store exists but may not be receiving data from every call type. If calls aren't creating episodes, the entire self-learning flywheel has no fuel.~~
- Audit the vapi webhook handler: after every call, does it write an episode to the `episodes` table?
- If not: add `episodeQueries.insert(userId, 'call', occurredAt, encryptedTranscript, topics, commitments)` after transcript processing
- Verify calendar events also produce episodes when they occur (or at briefing time)
- Test: complete a call, verify episode row exists with correct userId, source, occurred_at, and encrypted content

### M1-2 — Bi-temporal facts: conflict resolution in the extraction pipeline (Core) — ✅ **LIVE (Round 5)**
**Shipped:** `factQueries.upsertFact` checks for existing active fact (valid_until IS NULL) on same entity+category; if conflict: snapshot to history → retire old (set valid_until) → insert new. High-confidence facts not overwritten by extraction. All briefing reads filter active facts only.
~~**The status:** Security ships the schema (valid_from/valid_until columns). Core wires the logic.~~
- In `lib/facts.ts` `upsertFact`: before inserting, check for an active fact with the same entity + category
- If conflict: call `factQueries.retire(userId, existingFactId)` then insert new fact
- Active = `valid_until IS NULL`. Never hard-delete — retired facts are historical record
- All briefing/memory reads filter to active facts only
- Test: upsert a fact, then upsert a conflicting fact on the same entity+category, verify first is retired and second is active

### M1-3 — Fact extraction quality: completeness + deduplication (Core) — ✅ **LIVE (Round 5)**
**Shipped:** `factQueries.upsertFact` deduplicates by (category, entity, active) — for facts with entity: exact entity match (case-insensitive); for entity-null facts: 80-char prefix match on decrypted statement. `consolidateFacts` post-pass cleans Jaccard-similar near-dups per (category, entity) group. Net-new count drives the "new fact learned" notification — counting raw upserts was fixed to count only actual row increases.
~~**The risk:** The extraction pipeline may be producing duplicate facts...~~

### M1-4 — Memory versioning: snapshot before destructive updates (Core) — ✅ **LIVE (Round 5)**
**Shipped:** `snapshotFactToHistory(factId, userId, source)` called before every bi-temporal retire; `fact_history` table is a read-only audit trail — no modifications after insert. Source recorded as 'extraction-update', 'manual', or 'consolidation'.
~~**The risk:** If a bad fact extraction run overwrites good data, there's no way to recover. The memory is gone.~~
- Before retiring a fact (bi-temporal update): write its current value to a `fact_history` table (`factId`, `statement`, `retiredAt`, `retiredReason`)
- This is a read-only audit trail — nothing modifies `fact_history` after insert
- Test: retire a fact, verify the old value is preserved in `fact_history`

---

## Tier 2 — Learning (memory that improves between calls)

### M2-1 — Sleep-time consolidation agent: stale fact reconciliation (Core) — ✅ **LIVE (Round 5)**
**Shipped:** `runSleepTimeConsolidation(userId, transcript, userName)` in `lib/facts.ts`; wired fire-and-forget from webhook after call end; reconciles stale/contradicted facts; logs `{factsAdded, factsRetired, factsUpdated}` per run; `background_job_failures` table catches any failure.
~~**The status:** Dispatched in Round 5. This item deepens it once T2 is live.~~
- After the consolidation agent runs: verify it checks for facts that haven't been confirmed in 60+ days and flags them as `confidence < 0.5` (once the confidence column lands)
- Add a reconciliation step: if two active facts on the same entity+category exist (shouldn't happen, but check), retire the older one
- Log every consolidation run: how many facts updated, how many retired, how many added

### M2-2 — In-call memory trigger: immediate overwrite on correction (Core) — ✅ **LIVE (Round 5)**
**Shipped:** `rememberPreference` tool-call handler in `app/api/vapi/tool-call/route.ts` (line 1109): retires conflicting active fact + inserts new one immediately (bi-temporal); before/after state logged to `fact_history`; spoken confirmation: "Got it — I've updated that in your memory."
~~**The status:** Dispatched in Round 5 T3. This item adds verification.~~
- When `rememberPreference` fires: log the before/after state to `fact_history`
- Return spoken confirmation to the user: "Got it — I've updated [X]"
- Test: during a call, say "actually my goal is now Y not X" — verify fact is updated before call ends and the next call's briefing reflects Y

### M2-3 — Pattern detection: deepen M3 with temporal history (Core) — ✅ **LIVE (Round 5)**
**Shipped:** `lib/patternMemory.ts` + `lib/factPatterns.ts` + `lib/calendarPatterns.ts`; weekly job detects commitment reliability, recovery predictors, focus windows, stress precursors, goal drift; pattern facts stored under category `pattern`; injected into briefing via `patternMemoryBlock`.
~~**The status:** Dispatched in Round 5 T4. This item defines the specific patterns to detect.~~
Priority patterns to detect (in order of value):
1. **Commitment reliability by category:** what % of same-day commitments does Derrick keep vs. long-horizon ones?
2. **Recovery predictors:** which week structures correlate with high vs. low Whoop recovery scores?
3. **Focus window:** which time slots consistently have the most productive calendar blocks (no back-to-backs, adequate buffer)?
4. **Stress precursors:** which people/event types appear on the calendar before Derrick reports feeling overwhelmed?
5. **Goal drift:** how have Derrick's stated priorities shifted over the last 90 days?
Output: structured pattern facts stored under category `pattern` in the `facts` table — NOT raw prose. Each pattern fact should be a falsifiable statement ("gym attendance is 80% on MWF, 40% on TTh").

### M2-4 — Predictive context loading: pre-call prep pack (Security + Core) — ✅ **LIVE (Round 6)**
**Shipped:** Security wired 11pm UTC nightly cron in `lib/scheduler.ts`; Core exported `buildBriefingContextPack(userId)` from `lib/briefing.ts`; cron calls it, writes to `briefing_context_packs` table (encrypted); morning call reads pre-warmed pack, falls back to live assembly on miss; pruned after 7 days. `{userId, packDate, packSize, generatedAt, durationMs}` logged per pack.
~~**The status:** Dispatched in Round 6. This item adds quality verification once it's live.~~
- After the 11pm job runs: verify the pack was written and is non-empty for every active user
- Log: `{userId, packDate, packSize, generatedAt, durationMs}` — visible in Railway
- If a pack is missing at call time (job failed or user added late): fall back to live assembly seamlessly
- Test: trigger the job manually, verify pack exists in `briefing_context_packs`, verify the morning call reads it

---

## Tier 3 — Retrieval (the right memory at the right moment)

### M3-1 — Briefing context relevance audit (Core) — ✅ **LIVE (Darren + Loop 7)**
**Shipped:** `filterStale: true` passed to all `topFacts` calls in `lib/briefing.ts` (live 7am path + 11pm context-pack path). Loop 7 added `isStaleForBriefing(fact, today)` in `lib/memorySalience.ts` — 3-condition guard: old (>90d) AND confidence_score < 0.7 AND last_confirmed_at stale. Recently-reconfirmed old facts stay in context; truly abandoned facts are excluded. Fixed gap: `salientFactsEarly` was missing `filterStale: true` (11pm pack had it, 7am call didn't — now consistent).
~~**The risk:** The briefing context assembler may be including stale, low-signal, or irrelevant facts — wasting context space that could go to higher-signal content.~~

### M3-2 — On-demand memory retrieval mid-call (Core) — ✅ **LIVE (Round 5)**
**Shipped:** `searchMemory` tool registered in `app/api/vapi/tool-call/route.ts`; searches `facts` + `episodes` + `memories` by query; `lib/vapi.ts` prompt registers trigger phrases ("what did I tell you about…", "do you remember…", "what's my…"). External: create `searchMemory` tool in Vapi dashboard (param `query`, string, required) + paste UUID into `lib/vapi.ts` toolIds.
~~**The risk:** If Derrick asks "what did I say about X?" during a call, Edge can only answer from what's in the current context. If the fact was archived, Edge says "I don't know" — which is wrong.~~

### M3-3 — Commitment tracking: outstanding loops surfaced correctly (Core) — ✅ **LIVE (Round 5/6)**
**Shipped:** Outstanding `source='edg3'` tasks from yesterday appear in briefing section 1 before anything else; sorted by age; `getOpenCommitments` feeds the accountability snapshot; briefing PART 1 instruction explicitly names commitments as the first item after the opener.
~~**The risk:** The accountability memory tracks commitments. But if the briefing doesn't surface outstanding loops prominently, they get forgotten.~~

---

## Tier 4 — Compounding (memory that gets better over time)

### M4-1 — Confidence decay: weight briefing content by recency (Core) — ✅ **LIVE (Round 6)**
**Shipped:** `confidence_score REAL DEFAULT 1.0` column on facts; weekly decay job (4am UTC Sunday) — volatile categories (goal/priority/preference) -10%/week, stable (people/pattern/accountability) -3%/week; `factQueries.confirmFact` resets to 1.0 on mention/reconfirmation; briefing hedges facts confidence < 0.5 with "last I heard…"; T2-2 provides the UX layer. Mid-call reconfirmation trigger for facts < 0.3 is Round 6 Ticket 2 (Darren, in-flight).
~~**The status:** Dispatched in Round 6. This item defines the UX once the schema lands.~~
- In the briefing prompt: facts with confidence < 0.5 should be prefaced with "last I heard..." rather than stated as current truth
- Facts with confidence < 0.3: inject ONE reconfirmation question per call ("Still aiming for X?")
- Facts with confidence > 0.9 (recently confirmed): state confidently, no hedge
- Test: artificially lower a fact's confidence, verify briefing hedges it appropriately

### M4-2 — Outcome-weighted memory: extend M4 accountability (Core) — ✅ **LIVE (Round 6)**
**Shipped:** `getReliabilitySignal(userId, category?)` in `lib/accountabilityMemory.ts` returns 0.0–1.0 reliability score by commitment category; briefing builder calibrates language based on signal: high (>0.7) = confident nudge, medium (0.4–0.7) = offer to block time, low (<0.4) = question whether it's the right priority; sleep-time agent updates reliability signal after each transcript.
~~**The status:** Dispatched in Round 6 T3. This item defines the weighting logic.~~
- Reliability signal by category: `{sameDay: 0.8, thisWeek: 0.6, longHorizon: 0.3}` (example values — seed from real data after 30+ calls)
- In the briefing: when surfacing a commitment, use the reliability signal to calibrate language
  - High reliability (>0.7): "You said you'd do X — you're good at these"
  - Medium (0.4–0.7): "You mentioned X — want to block time for it?"
  - Low (<0.4): "X has been on the list for a while — is it still the right priority, or should we let it go?"
- Test: populate different reliability scores, verify briefing language calibrates accordingly

### M4-3 — Episodic-to-semantic consolidation (Core)
**The gate:** Needs 30+ calls of data. Do not build before this threshold is met. Check episode count first.
- When 5+ episodes exist on the same topic within 60 days: auto-generate a semantic fact summarizing the pattern
- Example: 8 episodes where Derrick mentions pre-investor-call anxiety → semantic fact: "Pre-investor-call anxiety is a recurring pattern. Optimal briefing: acknowledge, pivot to preparation."
- Semantic facts are stored with category `semantic` and carry a `source_episode_ids` reference
- Test: insert 5 episodes with a shared theme, trigger consolidation, verify semantic fact is generated

### M4-3b — Memory block versioning + rollback (Core) — ✅ **LIVE (Darren)**
**Shipped:** `lib/db.ts` `upsertFact` both INSERT paths now call `snapshotFactToHistory(newId, userId, 'created')` — every fact creation logged to `fact_history`. `factHistoryQueries.rollbackFact(userId, historyId)` — reads history row, retires current active fact, re-inserts historical statement as new active with `confidence='high'`. Statement ciphertext copied byte-for-byte (no re-encryption). 6 new tests in `lib/db-facts.test.ts`. 1712/1712 green.
~~**The gap (Kevin):** Letta uses git-backed memory — every write is a commit, every bad extraction is a revert.~~

### M4-4 — Social mental models: per-person context (Core)
**BLOCKED:** Gated on People-extraction cleanup merge (hallucinated contacts must be fixed first).
- When unblocked: `people_models` table stores relationship state per person (goals, communication style, health score, last interaction, what they likely need from Derrick now)
- Sleep-time agent updates models after every call where a person is mentioned
- Briefing builder: when a person appears on tomorrow's calendar, inject their model into context
- Test: mention a person on 3 consecutive calls with different context, verify their model updates each time

---

## QA Checklist — run when pillar backlog is exhausted

> **QA rule (Kevin):** When this backlog is exhausted, the lane writes and runs END-TO-END tests for each pillar item — not unit tests. Unit tests verify code. End-to-end tests verify the live path.

Work through each item manually. Log result (pass/fail/partial) in `content/qa-log.md` with date and notes.

### Storage
- [ ] Complete a call. Within 1 hour, verify: episode record exists, at least 3 facts extracted, transcript stored in briefings table
- [ ] Tell Edge something new. Open "What Edge knows." Does the new fact appear in the correct category?
- [ ] Tell Edge something that contradicts a known fact. Verify the old fact is retired (valid_until is set) and the new one is active
- [ ] Check `fact_history` after a fact update — does the old value appear?
- [ ] Count rows in `episodes` — does it match the number of calls made?

### Learning
- [ ] Check Railway logs for sleep-time consolidation: did it run after the last call? How many facts were updated?
- [ ] Make a correction mid-call ("actually X is Y now"). By the NEXT call, is the fact correct?
- [ ] After 7+ calls: check the `facts` table for pattern-category rows. Are any patterns detected?
- [ ] Check `briefing_context_packs` — is there a pack for today's date?

### Retrieval
- [ ] Ask Edge "what do you know about my gym schedule?" on a call. Does it answer correctly?
- [ ] Ask Edge "what did I say about fundraising?" — does it surface the right history?
- [ ] Check the briefing — are outstanding commitments in the first section?
- [ ] Check the briefing — are any facts older than 90 days being stated as current truth without hedging?

### Compounding
- [ ] Find a fact that hasn't been confirmed in 60+ days. Does Edge hedge it in the next briefing?
- [ ] Make a commitment 3 calls in a row and don't complete it. Does Edge's language soften over time?
- [ ] Check the `facts` table for `category = 'semantic'` rows. If 30+ calls exist, are there any?
- [ ] Run `npm run preflight` — should be green

### Memory health overall
- [ ] Open "What Edge knows." Is every fact accurate? Correct any that aren't
- [ ] Is there anything Edge should know that it doesn't? Tell it on the next call
- [ ] Is there anything Edge thinks it knows that's wrong? Delete or correct it
- [ ] Does the briefing feel like it knows you, or does it feel generic? Note which sections feel weakest

### ★ End-to-end smoke test — run this first, every time
- [ ] **★ 7am live-path test:** trigger a call → say something new → verify transcript stored within 5 min → verify fact extracted and in `facts` table → verify NEXT MORNING's briefing references that fact. This is the single most important thing to verify. 1592 unit tests do NOT cover this path. If this fails, everything else is secondary.
- [ ] Run `tests/e2e/call-to-briefing.test.ts` if it exists (Darren owns writing it — PILLAR-TRUST T0-3)
- [ ] **Correction path:** say "actually X is Y now" on a call. Verify by next briefing the old fact is retired and the new one is active.
- [ ] **Rollback path:** find a fact in `fact_history`, roll it back, verify the previous version is now active.
