# Round 6 Engineering Spec — Memory Self-Learning
_Shared spec for Darren (Core) and Vijay (Security). June 2026._
_Foundation: `content/memory-research-applied.md` (MemGPT/Letta/Zep synthesis)._

---

## Status at round start (2026-06-18)

| Item | Owner | Status |
|---|---|---|
| Bi-temporal facts (valid_from/valid_until + conflict resolution) | Core (logic) + Security (schema) | ✅ **Live** — `lib/db.ts` migrations + `factQueries.upsertFact` |
| Sleep-time consolidation agent | Core | ✅ **Live** — `lib/facts.ts:runSleepTimeConsolidation`, wired in webhook |
| In-call memory trigger (immediate overwrite on correction) | Core | ✅ **Live** — `rememberPreference` handler retires + replaces |
| Pattern detection (weekly job) | Core | ✅ **Live** — `lib/patternMemory.ts`, `lib/factPatterns.ts`, injected in briefing |
| Memory versioning (fact_history, snapshotFactToHistory) | Core | ✅ **Live** — called before every bi-temporal retire |
| Predictive context loading (11pm cron + buildBriefingContextPack) | Security (cron) + Core (fn) | ✅ **Live** — `lib/scheduler.ts` 11pm UTC + `lib/briefing.ts` export |
| Confidence decay schema (confidence_score column + weekly decay job) | Security | ✅ **Live** — `lib/db.ts` + `lib/scheduler.ts` 4am Sunday |
| Outcome-weighted reliability signal (M4-2) | Core | ✅ **Live** — `lib/accountabilityMemory.ts` + `getReliabilitySignal` |

---

## Remaining Round 6 work

### Core Ticket 2 — Mid-call reconfirmation trigger for low-confidence facts
**Gate:** Requires bi-temporal ✅ + confidence decay ✅ — both live. **Build now.**

**What it does:**
Query for facts with `confidence_score < 0.3` at briefing assembly time. If any exist, inject ONE reconfirmation question naturally into the call — not a list, not a survey. One per call maximum.

**Where to build:**
- `lib/briefing.ts`: in the briefing context assembler, add a `reconfirmationBlock` alongside the existing fact injection. Select the single lowest-confidence active fact per call.
- `lib/vapi.ts`: add a `RECONFIRMATION` instruction block — if a reconfirmation question is injected, Edge asks it naturally once, early in the call. If user confirms (no correction): call `factQueries.confirmFact(userId, factId)`. If user corrects: the existing `rememberPreference` in-call trigger handles the retirement + replacement.

**Prioritization rules:**
- Skip facts in deeply personal categories if asking would feel intrusive (relationship health, medical). Flag those in the dashboard instead.
- Prefer goal and priority facts (highest leverage if stale).
- Never ask the same reconfirmation twice in 7 days — check `last_confirmed_at`.

**Function signature (Core exports from `lib/briefing.ts`):**
```typescript
export function buildReconfirmationBlock(
  userId: number,
  facts: Fact[],  // active facts with confidence_score < 0.3
): string | null  // null = nothing to reconfirm; string = the reconfirmation injection
```

**Test:**
- Set a fact's `confidence_score` to 0.2 via direct DB update.
- Run briefing assembly — verify `reconfirmationBlock` is non-null and contains a natural-language question about that fact.
- Simulate user confirming → verify `confidence_score` resets to 1.0 and `last_confirmed_at` is updated.
- Simulate user correcting → verify old fact is retired, new fact inserted.

---

### Core Ticket 4 — Social mental models: `people_models` table
**Status: BLOCKED** — gated on People-extraction cleanup (hallucinated contacts must be resolved first).

When the People-extraction trust fix merges (PILLAR-TRUST T2-1, Darren in-flight), this unblocks. Do not build before that lands.

---

## Schema reference (all shipped, for shared awareness)

```sql
-- Bi-temporal facts (Security schema, Core logic)
facts:
  valid_from       TEXT DEFAULT (datetime('now'))
  valid_until      TEXT              -- NULL = active; SET = retired
  confidence_score REAL DEFAULT 1.0  -- 0.0–1.0; decays weekly; < 0.3 = reconfirm
  last_confirmed_at TEXT             -- reset to now() on every reconfirmation

-- Fact version history (Core)
fact_history:
  id, fact_id, user_id, statement, action ('created'|'retired'), occurred_at, source

-- Episode store (Core + Security)
episodes:
  id, user_id, source, occurred_at, content_raw (encrypted), topics (JSON), commitments (JSON)

-- Pre-warmed briefing context (Security)
briefing_context_packs:
  id, user_id, pack_date (YYYY-MM-DD), context_pack (encrypted), generated_at
  UNIQUE(user_id, pack_date); pruned after 7 days
```

---

## Decay schedule (Security — weekly job, 4am UTC Sunday)

```typescript
const VOLATILE_CATEGORIES = ['goal', 'priority', 'preference'];
const VOLATILE_DECAY = 0.1;   // -10% confidence per week if not reconfirmed

const STABLE_CATEGORIES = ['people', 'pattern', 'accountability'];
const STABLE_DECAY = 0.03;    // -3% confidence per week
```

Facts start at `confidence_score = 1.0`. A volatile fact not reconfirmed for 10 weeks decays to 0.0. The sleep-time consolidation agent can re-raise confidence when a fact is mentioned again in a transcript.

---

## How the pieces connect (end-to-end)

```
11pm UTC nightly
  └── scheduler: buildBriefingContextPack(userId) → briefing_context_packs

7am call
  └── briefing.ts reads pack (or falls back to live assembly)
      includes: active facts (confidence > 0.3 stated confidently;
                              0.1–0.3 hedged; < 0.1 omitted)
      includes: ONE reconfirmation question if any fact < 0.3 [Ticket 2]

During call
  └── user corrects fact → rememberPreference → retire old, insert new (confidence = 1.0)
  └── user confirms reconfirmation → confirmFact → confidence = 1.0

Post-call webhook
  └── runSleepTimeConsolidation → reconcile stale facts, update confidence on mentioned facts

4am UTC every Sunday
  └── decayFactConfidenceScores → VOLATILE -10%/week, STABLE -3%/week
```

---

## What Round 6 shipped (summary for the record)

The full self-learning flywheel is now operational:
- **Storage:** bi-temporal facts + memory versioning = no data ever lost, every change is auditable
- **Learning:** sleep-time consolidation + in-call memory triggers = memory updates happen within minutes, not days
- **Pattern detection:** weekly job identifies commitment reliability, recovery predictors, focus windows, stress precursors, goal drift
- **Predictive loading:** tomorrow's briefing context is pre-warmed at 11pm so the 7am call opens fast with warm context
- **Confidence decay:** volatile facts decay weekly so Edge hedges stale claims rather than stating them confidently
- **Outcome-weighted language:** Edge calibrates how it talks about commitments based on historical follow-through

**One item remains:** mid-call reconfirmation trigger (Core Ticket 2, above). Social mental models (Core Ticket 4) is blocked on people-extraction cleanup.

---

_Kevin (PM/CTO), June 2026. Route questions to Darren (Core) or Vijay (Security) via their lane sessions._
