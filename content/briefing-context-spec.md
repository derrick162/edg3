# Briefing Context Assembly Spec
_PM/content spec for M3-1 (briefing context relevance) + DC2-2 (personalization floor) + DC2-4 (length calibration). Route to Darren (Core) — audit `lib/briefing.ts` against this spec._

---

## The problem this spec addresses

The briefing context assembler in `lib/briefing.ts` grew organically — sections were added over time without a governing signal priority. The risk: lower-signal sections crowd out higher-signal ones; briefings run long; new users with thin data get generic output.

This spec defines: (a) the correct signal priority order, (b) the personalization floor, (c) the target length, and (d) what to cut after 90 days.

---

## Signal priority order (highest → lowest)

When assembling the context that feeds the briefing prompt, inject sections in this order. The model processes earlier content more reliably than later content.

| Priority | Section | Source | Notes |
|---|---|---|---|
| 1 | **Outstanding commitments** (yesterday/this week) | `tasks` table, source='edg3', incomplete | Must appear FIRST. DC2-3: opens the call. |
| 2 | **Today's calendar** | Google Calendar API | Key events only — anything with a decision/time-sensitivity. Routine items (gym, meals, habits) get minimal space. |
| 3 | **Active goals / priorities** | `priorities` table + top goal-category facts | User's P1/P2/P3. Never generic. |
| 4 | **Whoop recovery** | Whoop API | If connected. One compact block. If null: acknowledge ("Whoop unavailable") rather than skip. |
| 5 | **Pattern memory** | `facts` table (category='pattern') + `lib/patternMemory.ts` | Only if notable pattern exists (non-null from `computeWhoopTrends` or `patternMemoryBlock`). |
| 6 | **Recent facts** (last 30 days) | `facts` table, active, learned_at >= 30d ago | Active facts only. Exclude facts older than 90 days from auto-injection (they can still be retrieved on-demand). |
| 7 | **Relationship context** | people-category facts | Only inject for people who appear on today's calendar. Not bulk-injected. |
| 8 | **Episode memory** | `lib/episodeStore.ts` `buildEpisodeMemoryBlock()` | Recent decisions and what was said. Brief. |
| 9 | **Briefing context pack** | `briefing_context_packs` table (pre-warmed 11pm) | Fall back to live assembly if pack is missing or stale. |

**Rule:** If the total context string exceeds 4,000 tokens, truncate from the bottom (lowest priority) first. Never truncate from the top.

---

## Personalization floor (DC2-2)

A briefing that doesn't reference anything specific to this user is a generic briefing. Define a floor:

**Minimum 3 user-specific signals per briefing:**
1. At least one active goal or priority (by name)
2. At least one recent fact (a preference, pattern, or relationship note)
3. Either: a Whoop recovery note, OR an outstanding commitment, OR a person from today's calendar with context

**If the floor can't be met** (new user, thin data): Edge should ask ONE fill-the-gap question rather than briefing generically. Example: "I don't have much context on your priorities yet — what's the most important thing you're working on this week?" This surfaces intent rather than pretending to know.

**Test for this:** compare two synthetic test users — same calendar, different facts tables. The briefings must differ meaningfully. If they're identical, the personalization floor isn't being applied.

---

## Target length (DC2-4)

**Target:** core briefing content (commitments + priorities + calendar + closing question) fits in **~400 words at normal speech pace (~3 minutes)**. Total call including user responses: under 5 minutes.

**What causes bloat:**
- Briefing section 3 (alignment check) when it generates long prose instead of one punchy observation
- Pattern memory block when it surfaces multiple patterns instead of the single most relevant one
- Calendar narration when it lists every event instead of the 2–3 that matter

**Fix for each:**
- Section 3: one observation + one offer ("your top priority has zero calendar blocks — want me to fix that?"). Two sentences max.
- Pattern memory: one sentence, the single most relevant pattern, only when it changes the recommendation.
- Calendar: lead with the most time-sensitive event. The model doesn't need to narrate the whole day.

**Audit method:** take the last 5 real briefing transcripts, count words in the briefing text before the user first speaks. If median > 500 words, identify which section is longest and tighten its instruction.

---

## What to remove from auto-injection after 90 days (M3-1)

Facts older than 90 days should NOT be injected into the briefing context by default. They can still be retrieved on-demand (via `searchMemory` tool, when it ships). But auto-injection of stale facts wastes context space and risks sounding confidently wrong.

Current rule (T2-2 / confidence decay): facts with `confidence_score < 0.5` get hedged with "last I heard…". This partially addresses the problem.

**Additional rule to add:** when assembling the context, filter out any fact with:
- `learned_at < (now - 90 days)` AND `last_confirmed_at IS NULL` AND `confidence_score < 0.7`

This keeps recently-confirmed old facts (user mentioned it again → still relevant) while removing truly stale ones from the live briefing context.

---

## Implementation notes for Darren

1. **Audit `lib/briefing.ts` context assembly order** against the priority table above. Reorder any section that's out of place.
2. **Add the personalization floor check** — if fewer than 3 user-specific signals are available, inject a fill-the-gap question instead of proceeding generically.
3. **Add the 90-day stale fact filter** to the context assembly query.
4. **Instrument section sizes** — add a dev-mode log of `{section, tokenEstimate}` per section so we can identify bloat without listening to every call.
5. **No new API calls** — this is all assembly-layer work in `lib/briefing.ts`. No schema changes needed.

---

_PM/CTO: Kevin, June 2026. Sources: PILLAR-DAILY-CALL.md DC2-2/DC2-4, PILLAR-MEMORY.md M3-1._
