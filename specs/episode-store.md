# Spec — Ground-Truth Episode Store (the episodic memory tier)

_From Esther's deep research (2026-06-17): 103 agents, adversarial verification. Derrick: prioritize
ASAP. Companion to [`memory-architecture.md`](memory-architecture.md) — this builds the missing
**episodic** tier. The moat isn't the architecture (open-source: Letta/Zep/LangMem); it's the
**per-user episodes accumulated in the product** — unreplicable._

## The gap
Edg3 today stores **(a)** LLM-extracted facts (`facts` table — semantic/profile) and **(b)** call
summaries (`briefings`). Research (ICLR 2025 benchmark; MemMachine, arXiv:2604.04853, Apr 2026) shows
**lossy extraction degrades long-term recall** — ground-truth episode storage materially outperforms
extracted summaries. What's missing is a **preserved episode record**: not just what we extracted, but
what actually happened, queryable with temporal context.

**Why it's the moat:** extracted facts can be replicated by surveying a user for 20 minutes. **Episode
records from 18 months of daily calls cannot be replicated at any price.** That's the switching cost.

## Three-tier memory (target)
1. **Short-term** — in-context (current call + today's calendar). ✅ done
2. **Episodic** — ground-truth episode store (preserve the call, not just the extraction). 🔴 **THIS SPEC**
3. **Semantic/profile** — the `facts` table. ✅ done

Episodes are the SUBSTRATE: facts (semantic) and M2/M3/M4 memory (relationships/patterns/accountability)
are derived *from* episodes, but the raw episode is never thrown away.

## Build

**🔒 Security (Vijay) — owns the schema + encryption (`lib/db.ts`).**
New `episodes` table:
```
id           INTEGER PK
user_id      INTEGER NOT NULL  (indexed)
source       TEXT NOT NULL     ('call' | 'calendar' | 'email')
occurred_at  TEXT NOT NULL     (ISO; indexed with user_id)
content_raw  TEXT NOT NULL     (encrypted at rest — the preserved transcript / lightly-processed record)
topics       TEXT              (JSON array, tagged)
commitments  TEXT              (JSON array, tagged)
created_at   TEXT DEFAULT now
```
Index `(user_id, occurred_at)`. `content_raw` encrypted via `encryptField` (it's the rawest PII we hold —
consent-gated + retention policy + authz so it never leaks cross-user). `episodeQueries`: `insert`,
`recent(userId, limit)`, `search(userId, {topic?, since?, unresolvedCommitments?})`.

**🛠️ Core (Darren) — owns ingestion + query (`lib/briefing.ts` + the call/webhook path).**
- **Write:** after each call (and optionally calendar/email signal), persist an episode — the preserved
  (raw or lightly-processed) transcript + `occurred_at` + tagged `topics` + tagged `commitments`. This is
  SEPARATE from the existing facts extraction + briefing summary (keep both; add this).
- **Query at briefing time:** pull the relevant past episodes into the briefing context — e.g. the last
  3 times the user discussed a current priority, or prior commitments not yet resolved — so Edge can say
  "last time you talked fundraising you committed to X — did that happen?" This is what makes memory
  *feel* real and compounding.
- Reuse the T4 grounding for tagging; reuse M1 tagging categories for `topics`.

## Principles
- Preserve the episode; never rely solely on lossy extraction. Facts/relationships/patterns derive FROM
  episodes.
- Encrypted at rest, user-scoped, consent-gated (respect `data_consent`), retention-bounded.
- Honest + degrade gracefully on thin history. Ship: schema → write path → briefing query.

## Licensing (research conclusion — for the record)
NOT a near-term play. Memory infra is open-source + mature (Letta/Zep/LangMem); Mem0's traction claims
failed adversarial verification. The moat is the accumulated per-user episode data, not the
infrastructure. **Build the better episode store; don't build a licensing business.**
