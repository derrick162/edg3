# What Charles, Sarah, and Daniel built — and how Edge applies it
_Research synthesis: June 2026. Purpose: translate the three leading memory architectures into concrete Edge builds._

---

## The core insight all three share

The AI model doesn't need to get smarter. The **context does.**

Charles, Sarah, and Daniel all arrived at the same conclusion from different angles: you don't need to retrain model weights to make an AI system improve over time. You just need to give it better, richer, more accurate context at the moment it speaks to a user. The model stays the same. The memory compounds. That's the moat.

Edge is already doing this — every call adds to what Edge knows. The question is: how do we make the compounding *deliberate* and *continuous* rather than passive and lossy?

---

## 1. Charles Packer & Sarah Wooders — MemGPT / Letta
**Paper:** [MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560) (arXiv:2310.08560)

### What they built

The MemGPT insight was simple and radical: treat the LLM like a CPU and memory like an operating system. LLMs have a limited "working memory" (the context window). MemGPT taught the model how to manage its own memory — what to keep in fast working memory, what to page out to disk (external storage), and when to retrieve things back.

**The three memory tiers:**
- **Core memory** ("RAM") — always in context. Pinned facts about the user and agent persona. Small, current, highest priority.
- **Recall memory** ("SSD") — full conversation history, searchable outside context. Everything said on every call, indexed.
- **Archival memory** ("disk") — long-term knowledge, facts extracted and stored in a vector/graph database.

**The self-editing mechanism:**
The agent is given explicit *memory tools* it can call during a conversation:
- `memory_replace` — rewrite a specific memory block with new content
- `memory_search` — retrieve from archival memory when a question comes up
- `memory_archive` — move something from working memory to long-term storage

The model doesn't just respond — it decides in real time whether the new information it just heard should update a memory block, and if so, calls the tool to do it. The memory edits are visible, reversible, and logged.

**Letta's extension — "sleep-time compute":**
Letta added something MemGPT didn't have: a background agent that runs *between* sessions. After a call ends and before the next one starts, a sleep-time process:
1. Reviews the raw call transcript
2. Identifies what changed (new goals, new relationships, completed commitments)
3. Rewrites the relevant memory blocks
4. Consolidates — if the "human" block is getting stale or contradictory, it reconciles it

This is how the agent gets smarter between calls, not just during them.

**Letta's key principle — "continual learning in token space":**
Instead of retraining weights (expensive, slow, opaque), you update the *context*. If Edge gave the wrong advice because it didn't know Derrick's gym schedule changed, the fix isn't a model update — it's a memory update. Two instances of the same model with different context behave as completely different agents. Edge's edge isn't its model. It's its context.

### How Edge applies this right now

**What's already built:**
- Core memory ✅ — `memories` table stores extracted facts (goals, relationships, patterns)
- Recall memory ✅ — call transcripts stored per briefing
- Archival memory (partial) 🟡 — facts extracted but not as a ground-truth episode store

**What's missing:**

**A. Self-editing memory tools for Edge's calls**
Currently Edge extracts facts passively after calls via a batch pipeline. The MemGPT approach would make Edge *proactive* — during the call itself, when Derrick says "I'm pushing my gym to 7am now," Edge should immediately invoke a memory update rather than waiting for post-call extraction. This ensures the *next* call has the corrected context, not a call after the next one.

*Dispatch to Core: add a mid-call memory update trigger. When the vapi tool-call handler sees a `rememberPreference` or similar call, it should also check whether existing facts need to be overwritten, not just appended.*

**B. Sleep-time compute — the nightly memory consolidation agent**
Edge's biggest current gap. After each call ends, a background job should run:
1. Read the raw transcript
2. Ask: "what has changed since the last call? What was committed to? What was completed? What's new in their life?"
3. Rewrite the relevant memory blocks (goals, people, patterns) rather than just appending new facts
4. Check for conflicts: "Edge has two facts that contradict — 'gym is Monday/Wednesday/Friday' and 'gym moved to every day at 7am'. Reconcile."

This runs at low cost (Haiku-level model, structured output), runs on no user-facing clock, and makes every next call materially better than the last.

**C. Memory block versioning**
Letta uses git-backed memory — every memory update is a commit. Edge should version memory snapshots so:
- You can roll back if a fact was extracted wrong
- You can see *when* Edge learned each thing
- Derrick can see his own context evolution in the "What Edge knows" tab

---

## 2. Daniel Chalef — Zep / Graphiti
**Paper:** [Zep: A Temporal Knowledge Graph Architecture for Agent Memory](https://arxiv.org/abs/2501.13956) (arXiv:2501.13956)

### What he built

Graphiti is a temporal knowledge graph — a graph database where every node (entity: person, goal, habit) and every edge (relationship: "Derrick trains with", "Derrick's goal is") has an explicit timestamp for when it was valid.

**The key innovation: bi-temporal fact storage**

Every graph edge has two timestamps:
- `t_valid` — when this fact became true in the real world
- `t_invalid` — when this fact stopped being true (null if still current)

This means Graphiti never deletes an outdated fact — it *retires* it. If Derrick had a goal of "raise $500K by June" and then that changed to "close Series A by September," Graphiti doesn't overwrite the first goal. It marks it as `(t_valid: April, t_invalid: June)` and stores the new one as `(t_valid: June, t_invalid: null)`. The historical record is preserved. Patterns become visible.

**Conflict resolution:**
When a new fact comes in that contradicts an existing one, Graphiti:
1. Uses semantic search to find the conflicting existing node/edge
2. Checks temporal metadata to determine which is more recent
3. Updates or invalidates the old fact — never silently discards it
4. Preserves the old version as historical record

**Retrieval — why this beats vector RAG:**
Vector RAG finds facts by semantic similarity — "what's most similar to this query?" That's fine for static documents, but breaks for personal memory where *recency* and *relationship structure* matter.

Graphiti uses a hybrid retrieval approach:
- Semantic search (embedding similarity)
- Keyword search (BM25)
- Graph traversal (follow relationships — "what does Edge know about people Derrick works with?")

No LLM call during retrieval. P95 latency: 300ms. Near-constant time regardless of how much history exists.

**Result:** Zep outperformed MemGPT on the Deep Memory Retrieval benchmark (94.8% vs 93.4%) and improved by 18.5% on LongMemEval (long-term memory evaluation).

### How Edge applies this

**What's missing in Edge today:**
Edge stores facts as flat rows in a table — no relationships between them, no timestamps on *when* things changed. Two problems this causes right now:

1. **Fact collision:** If Derrick tells Edge on Monday "my top priority is fundraising" and tells Edge on Friday "my top priority is weight gain," Edge has two conflicting priority facts with no way to know which is current.

2. **Relationship blindness:** Edge knows "Faiza is a colleague" and "Faiza is organizing a meeting." But it doesn't know that "Faiza → schedules meetings" is a pattern, or that the relationship has a history.

**The Graphiti model applied to Edge:**

Build a simple bi-temporal layer on top of the existing `memories` table:
- Add `valid_from` (timestamp) and `valid_until` (timestamp, nullable) columns
- When a new fact comes in, check if it conflicts with an existing fact on the same entity+topic
- If yes: set `valid_until = now()` on the old fact, insert the new one
- Never hard-delete facts — they become historical record

This is not a full graph database rebuild. It's a schema addition and a conflict-resolution step in the fact-extraction pipeline. Three columns and a query change.

**The self-learning payoff:**
With temporal facts, Edge can now ask: "What patterns do I see in how Derrick's priorities shift over time?" "Who does he consistently mention before stressful weeks?" "What commitments has he made and not kept?" These become *pattern memory* — the layer that doesn't exist yet but is the most valuable one in the moat.

---

## 3. The synthesis: how to make Edge continuously self-learning

This is the big question. Here's the concrete answer, built from all three architectures.

### What "self-learning" means for Edge

Edge learns in one direction today: a call happens → facts are extracted → they're stored. That's passive accumulation. Self-learning means Edge gets *better at knowing Derrick* over time, not just *bigger*. More accurate, more predictive, more proactive. Here's how.

---

### The five self-learning mechanisms to build (in priority order)

**1. Sleep-time consolidation agent** *(highest leverage — build next)*

After every call ends, a lightweight background job runs. It doesn't need to be real-time. It runs in the background on Railway, triggered by the webhook after a call completes.

What it does:
1. Reads the raw transcript of the call that just ended
2. Reads Edge's current "human" memory block (goals, priorities, key relationships)
3. Asks: "What changed? What should be updated? What should be retired?"
4. Outputs structured updates: `{action: 'update', category: 'priorities', old: '...', new: '...', reason: '...'}`
5. Applies those updates — overwrites stale facts rather than appending new ones
6. Logs the change with a timestamp so Derrick can see it in "What Edge knows"

*Cost: one Haiku call per briefing. ~$0.001 per user per day.*

---

**2. Bi-temporal fact storage** *(enables patterns — build alongside episodes store)*

Add `valid_from` and `valid_until` to the `memories` table. The extraction pipeline, when inserting a new fact, first checks: "does a fact exist with the same entity, category, and similar content?" If yes, close the old one (`valid_until = now()`). If no, insert fresh.

This single change unlocks:
- Conflict-free fact updates (no more two contradictory priorities)
- Historical timeline of how Derrick has changed
- Foundation for pattern detection ("priorities shift every 3 weeks")

---

**3. In-call memory triggers** *(closes the gap between "said" and "learned")*

Right now, if Derrick corrects Edge during a call — "no, my gym is now at 7am, not 6am" — that correction is in the transcript but may take until the next consolidation run to become a memory update. The fix: when the vapi tool-call handler receives a `rememberPreference` call, it should also:
- Check the existing memory for a conflicting fact on the same topic
- If found: overwrite immediately (don't wait for sleep-time)
- Return confirmation: "Got it — I've updated your gym time to 7am"

This is Charles Packer's self-editing trigger applied to Edge's live call context.

---

**4. Pattern detection pass** *(the memory layer that builds the moat)*

Once you have enough temporal data (30+ calls), a weekly background job should run a pattern detection pass. This is a Haiku call that looks at the last 30 days of memory history and asks:

- "What commitments does Derrick make that he doesn't keep? What does he always follow through on?"
- "What types of weeks produce his best recovery scores?"
- "Are there recurring people/meetings that consistently appear before stressful periods?"
- "How do his stated priorities compare to how he actually spends his calendar time?"

Output: structured `pattern_memory` facts stored as a new memory category. These become the input to briefing section 3 (alignment check) — but now data-backed, not guessed.

*This is what makes Edge irreplaceable at month 6. Nobody else has 6 months of Derrick.*

---

**5. Memory quality scoring** *(prevents drift — prevents the moat from leaking)*

The biggest risk to the memory moat is degraded memory — facts that are stale, contradictory, or wrong, but still in the system influencing briefings. A weekly "memory health check" should:
- Scan all active facts for age (facts >90 days old with no confirmation get flagged as "unverified")
- Surface stale facts to Derrick: "Edge still has these things stored — are they still true?"
- Score memory quality per category (goals, priorities, relationships, patterns)
- Report the score to Derrick in the dashboard as a trust signal

This maps to Zep's insight that outdated-but-unretired facts actively hurt retrieval quality. Clean memory = better briefings = higher trust = lower churn.

---

## The self-learning flywheel

```
Call → transcript stored (raw episode)
   ↓
Sleep-time agent → facts extracted, stale facts retired, conflicts resolved
   ↓  
Bi-temporal memory → history of changes preserved
   ↓
Pattern detection (weekly) → patterns identified from history
   ↓
Better briefing → more accurate, more proactive, more aligned
   ↓
User trusts Edge more → shares more → better data
   ↓
Better data → better patterns → better briefings
   ↓
[repeat — moat deepens with every cycle]
```

The model never changes. The context compounds. That's the moat.

---

## Dispatch summary — what to build

| Feature | Lane | Priority | Complexity |
|---|---|---|---|
| Sleep-time consolidation agent | Core | **P1** | Medium — one background job, Haiku call |
| Bi-temporal facts (`valid_from`/`valid_until`) | Security (schema) + Core (logic) | **P1** | Low — 2 columns + query change |
| In-call memory triggers (overwrite on conflict) | Core | **P2** | Low — modify existing `rememberPreference` handler |
| Pattern detection pass (weekly) | Core | **P2** | Medium — new scheduled job, structured output |
| Memory quality scoring + stale-fact surfacing | Core + Design | **P3** | Medium — new UI component + scoring logic |
| Raw episode store (ground truth) | Core + Security | **P2** | Medium — new table, encryption, retention |

---

_Research: Esther (CoS) and Vijay (Security), June 2026. Primary sources: MemGPT arXiv:2310.08560, Zep arXiv:2501.13956, Letta blog (continual-learning, memory-blocks, agent-memory)._
