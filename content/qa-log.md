# EDG3 — QA Log

_Log of pillar QA checklist results. Code-verifiable items verified in-session; live-call items require manual verification during a real 7am call._

---

## 2026-06-18 (overnight loop 2) — Pillar loop additions (Core lane)

- [x] **M2-3 Pattern #5 — Priority drift detection** shipped. `detectPriorityDriftPattern()` in `lib/patternMemory.ts` — week-over-week Jaccard similarity on 8 weeks of priority history. STABLE signal (one priority anchored ≥70% of weeks, still current) → positive reinforcement in briefing. CHURN signal (avg sim < 0.34, no anchor) → one-line anchor invitation. Null on thin data (<3 weeks) or ambiguous middle band. `priorityQueries.getRecentWeeks()` added to `lib/db.ts`. Wired into `generateDailyBriefing` alongside the 4 existing calendar patterns. 10 new tests. 1747/1747.
- [x] **M2-4 — Context pack wiring** complete. `generateDailyBriefing` reads `briefing_context_packs` at call time, logs `[M2-4] context pack HIT/MISS`. When live Whoop fetch fails (all three null) and pack has HEALTH DATA section: uses pack's Whoop data as fallback, labeled "(using last night's context pack data)". Addresses DC2-3b edge case where token expires between 11pm pack-build and 7am call.
- [x] **UX-4 / T2-3 — 403 friendlyError** improved. Old: "reconnect your calendar." New: acknowledges BOTH causes (expired token OR organizer restriction). Applies to deleteEvent, editEvent, and all other mutation tools that hit `friendlyError`.
- [ ] **MANUAL (live call):** priority drift needs 3+ weeks of weekly priority rows to fire — verify once data accumulates.

---

## 2026-06-18 (overnight loop 1) — Pillar loop additions (Core lane)

- [x] **M4-1 / Round 6 T2 — mid-call reconfirmation** shipped. `lib/factConfidence.ts` (25 tests) consumes Security's `confidence_score`/`last_confirmed_at`; briefing injects ONE RECONFIRM block (category-weighted: goals first); `confirmFact` tool resets confidence on confirmation. Dual signal (score < 0.3 OR not-confirmed 30+ days) so it works before decay-categories align. **Note:** dormant for fresh accounts (correct — nothing stale yet); activates as facts age.
- [x] **DC0-2 — call-to-briefing latency** measured via `Promise.allSettled` over the 5 post-call memory jobs → `post_call_ms` on learning_status + `[DC0-2] HEALTH:` warn past 2 min.
- [x] **UX-4 — no false hedging** rule added to vapi + briefing prompts (state known facts plainly; only RECONFIRM facts hedged). **This is the item most likely to make tomorrow's call sharper.**
- [x] **DC2-0 verified airtight** (NO PREAMBLE + 2-sentence Part 1). **DC2-3b verified** (inline WHOOP STATUS block; removed my earlier duplicate). **DC0-1b verified** (extraction categories correct; auto-fetches calendar names for grounding).
- [x] **Flaky preflight FIXED** — `facts.test.ts` + `call-to-briefing.test.ts` now mock `./calendar` so `extractAndUpsertFacts`' auto event-fetch is deterministic. 3 consecutive clean full runs at 1737/1737.
- [ ] ⚠️ **Security flag:** `lib/scheduler.ts` decay-job categories don't match the `facts` CHECK constraint → decay updates 0 rows (detail in ROADMAP-CORE changelog). Reconfirmation still works via recency path.
- [ ] **MANUAL (live call):** reconfirmation won't fire until a fact is 30+ days unconfirmed; verify once data ages. confirmFact needs the Vapi dashboard tool created first.

---

## 2026-06-18 — Round 6 / Pillar Pass (Core lane)

### PILLAR-MEMORY — Code-level verification

**Storage**
- [x] episode insertion wired in webhook handler — `episodeQueries.insert` called after every call
- [x] fact extraction pipeline correct — categories (goal/person/project/preference/fact) with entity grounding, self-entity filter, assistant-entity filter, activity-word filter
- [x] bi-temporal conflict: upsertFact retires old + inserts new on statement change; verified in `lib/db-facts.test.ts`
- [x] `fact_history` audit trail: every fact write (created/retired/user-edit/extraction-update) logged; verified in db-facts tests
- [ ] **MANUAL: Complete a call → verify within 30 min: episode record in DB, ≥1 fact extracted, commitment in tasks table**
- [ ] **MANUAL: Tell Edge something new → Open "What Edge knows" → verify correct category**
- [ ] **MANUAL: Contradict a known fact → verify old fact retired (valid_until set), new one active**

**Learning**
- [x] sleep-time consolidation: duplicate active fact reconciliation (same entity+category) shipped (M2-1)
- [x] in-call memory trigger: updateFact always writes even for high-confidence facts (M2-2)
- [x] `extractAndUpsertFacts` returns count; 0 facts flags call for sleep-time review (DC0-1)
- [ ] **MANUAL: Check Railway logs for sleep-time consolidation after last call**
- [ ] **MANUAL: Mid-call correction ("actually X is Y now") → verify next briefing reflects Y**

**Retrieval**
- [x] 90-day hard cutoff in topFacts (filterStale: true) — stale facts no longer auto-inject into briefing (M3-1)
- [x] `searchMemory` Vapi tool wired (M3-2) — searches facts + episodes + memories on-demand
- [x] commitment tracking: 7-day window, oldest-first (M3-3) — most overdue commitment opens briefing
- [x] stale fact hedging: `[UNCONFIRMED >90d]` tag + "last I heard…" instruction (T2-2)
- [ ] **MANUAL: Ask Edge "what do you know about my gym schedule?" — verify correct answer**
- [ ] **MANUAL: Check briefing — outstanding commitments in first section?**

**Compounding**
- [x] `rollbackFact(userId, historyId)` added to `factHistoryQueries` — restores historical version (M4-3b)
- [x] every fact INSERT logs 'created' row to `fact_history` (M4-3b)
- [x] outcome-weighted reliability signal + commitment language calibration (M4-2)
- [x] `rememberPreference` undo: retireFact (new insert) / rollbackFact (update) wired (T4-5)
- [ ] **BLOCKED: M4-1 (confidence decay) — waiting on Security Round 6 T2 (confidence column)**
- [ ] **GATED: M4-3 (episodic-to-semantic) — needs 30+ calls of data**
- [ ] **BLOCKED: M4-4 (social mental models) — waiting on people-data cleanup**

---

### PILLAR-TRUST — Code-level verification

**User-facing trust basics**
- [x] UX-1: Landing page copy correct — "Edg3" throughout, "3 minutes" (not 5) — verified in `app/page.tsx`
- [x] UX-2: Duplicate contacts/facts guarded — entity grounding filter + 7 new tests (self, Edge, Edg3, activity words, repeated fact)
- [x] UX-3: Name spelling — STT correction in `lib/facts.ts` + userName hint in extraction prompt
- [ ] **MANUAL: Open dashboard → scan for any loading spinner that never resolves or stale data**

**Foundation**
- [x] T0-3: End-to-end smoke test `lib/call-to-briefing.test.ts` — 18 tests covering post-call chain
- [ ] **DELEGATED: T0-1 (DB backup off-box), T0-2 (encryption key custody), T0-4 (scheduler resilience) → Security lane**

**Accuracy**
- [x] T2-1: Fact grounding — extraction prompt + entity filters prevent hallucinated contacts
- [x] T2-2: Stale fact hedging in briefings (>90 days → [UNCONFIRMED] + "last I heard…")
- [x] T2-3: Honest failure messages — all tool-call failure paths audited; copyEvents vague message fixed
- [x] T2-4: Briefing accuracy regression suite — 6 tests covering Whoop signal, brand names, word count

**Transparency**
- [x] T3-1: "What Edge knows" completeness — all 5 DB categories (goal/project/person/preference/fact) rendered; pattern forward-compat
- [ ] **DELEGATED: T3-2 (activity log completeness), T3-3 (data export), T3-4 (account deletion) → Security lane**

**Resilience**
- [x] T4-5: Undo coverage — `planWeek` now records `deleteMany`; `rememberPreference` records `retireFact`/`rollbackFact`; new UndoOp types in `lib/undo.ts`
- [ ] **DELEGATED: T4-1–T4-4 (token refresh, Vapi resilience, SQLite concurrency, write-idempotency) → Security lane**

---

### PILLAR-DAILY-CALL — Code-level verification

**Flywheel integrity**
- [x] DC0-1: Per-call learning_status — `updateLearningStatus` tracks facts_ok/facts_extracted/extraction_ms/flagged_for_review
- [x] DC0-1b: Commitment extraction wired — `extractTasksFromTranscript` creates tasks with `source='edg3'` and due date; people + goal extraction categories correct in `extractFactsFromTranscript`
- [x] DC0-2: Timing log live — `[briefing] parallel-fetch Xms | whoop={...}` in Railway logs; fact extraction_ms in briefings table
- [ ] **MANUAL: Complete a call at 10pm → verify facts appear in next morning's briefing**

**Briefing quality**
- [x] DC2-0: No-preamble rule enforced — `CRITICAL — NO PREAMBLE` in briefing.ts; `OPENER RULE (DC2-0)` in vapi.ts
- [x] DC2-1: Opener skips routine events — breakfast/lunch/gym/meal-prep explicitly excluded from GREETING instruction
- [x] DC2-2: Personalization signal — `buildPersonalizationPromptBlock` closes with personal-context question when <3 stored facts
- [x] DC2-3: Commitment surfacing — `edg3Commitment` (oldest unresolved, 7-day window) moves into Part 1 before Edge Score
- [x] DC2-3b: Whoop honest acknowledgment — when connected but data null, briefing injects `WHOOP CONNECTED BUT DATA UNAVAILABLE` instruction
- [x] DC2-4: Briefing length calibration — "2 sentences MAX" Part 1, "3–4 sentences MAX" Part 2, 290 max_tokens, word-count warning at 250+

**Call experience**
- [x] DC3-3 (T2-3): Honest failure mid-call — tool-call failures return specific honest messages; no silent success/failure

---

### Items requiring live-call validation (run on next morning call)

Priority order:
1. **★ 7am live-path test**: call → say something new → verify in DB within 5 min → verify in next morning's briefing
2. Commitment test: say "I'll do X by Friday" → verify task with source='edg3' and dueDate in tasks table
3. People test: "I'm meeting Sarah tomorrow" → verify person-category fact created
4. Correction test: "actually my gym is now at 7am" → verify old fact retired, new one active
5. Memory retrieval test: "what do you know about my priorities?" → verify searchMemory returns correct results
6. Whoop test: with Whoop connected, run briefing → verify recovery score in Part 1
7. Undo test: "undo that" → verify last calendar mutation reversed
8. Rollback test: find a fact in fact_history, rollback, verify previous version now active
