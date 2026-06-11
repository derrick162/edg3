// Structured fact extraction for compounding memory (Core-owned).
//
// Extracts DURABLE structured facts from call transcripts using one Haiku call,
// then deduplicates + upserts them. Facts compound over time instead of accumulating
// noise because each fact is keyed by (category, entity) and updated in-place.
//
// Design: always degrades safely — any failure is a no-op that never blocks post-call
// processing. Extraction failure === no new facts stored, existing facts unchanged.

import { factQueries, type Fact } from './db';
import type { calendar_v3 } from 'googleapis';

export type ExtractedFact = {
  category: 'person' | 'project' | 'goal' | 'preference' | 'fact';
  statement: string;
  entity?: string | null;
};

const VALID_CATEGORIES = new Set(['person', 'project', 'goal', 'preference', 'fact']);

/**
 * ONE Haiku call: parse up to 10 durable structured facts from a transcript.
 * Returns [] on any error or when nothing durable was found.
 */
export async function extractFactsFromTranscript(transcript: string): Promise<ExtractedFact[]> {
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Extract up to 10 DURABLE facts about the user from this call transcript.
Return ONLY a JSON array — no preamble, no markdown.

Each item: {"category":"<category>","statement":"<one clear sentence>","entity":"<name or null>"}

Categories:
- "person"     — someone important to the user (investor, client, team member, family)
- "project"    — a project or initiative the user is building or running
- "goal"       — a stated goal, aspiration, or deadline
- "preference" — how the user likes to work, communicate, or make decisions
- "fact"       — any other durable fact about the user's life or business

Rules:
- "statement" must be a timeless sentence (not "today" / "yesterday").
- "entity" = the name or identifier this fact is about (person, company, project). null if none.
- Skip ephemeral items: task completions, calendar changes, weather, today's schedule.
- Only facts that would still be true and useful in 2 weeks.
- Return [] if nothing durable found.

Transcript (first 2000 chars):
${transcript.slice(0, 2000)}`,
      }],
    });

    const raw = res.content
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { type: string; text?: string }) => b.text ?? '')
      .join('')
      .trim();

    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];

    const parsed: unknown[] = JSON.parse(match[0]);
    return parsed
      .filter((f): f is ExtractedFact =>
        typeof f === 'object' && f !== null &&
        'category' in f && 'statement' in f &&
        VALID_CATEGORIES.has((f as ExtractedFact).category) &&
        typeof (f as ExtractedFact).statement === 'string' &&
        (f as ExtractedFact).statement.trim().length > 0
      )
      .slice(0, 10)
      .map(f => ({ ...f, entity: f.entity?.trim() || null }));
  } catch {
    return [];
  }
}

/**
 * Extract facts from transcript and upsert them for the given user.
 * Fire-and-forget safe: any error is logged but never propagated.
 */
export async function extractAndUpsertFacts(userId: number, transcript: string): Promise<void> {
  try {
    const facts = await extractFactsFromTranscript(transcript);
    for (const f of facts) {
      factQueries.upsertFact(userId, f.category, f.statement, f.entity);
    }
    if (facts.length > 0) {
      console.log(`[facts] Upserted ${facts.length} structured facts for user ${userId}`);
    }
  } catch (err) {
    console.error('[facts] extractAndUpsertFacts failed:', err);
  }
}

/**
 * Match this week's/today's calendar events to stored facts by entity name.
 * Returns up to 3 most relevant (event, fact) pairs for briefing annotation.
 * Pure function — no DB or API calls.
 */
export function linkEventsToFacts(
  events: calendar_v3.Schema$Event[],
  facts: Fact[],
): { eventTitle: string; fact: Fact }[] {
  const entityFacts = facts.filter(f => f.entity && f.entity.trim().length >= 2);
  const matches: { eventTitle: string; fact: Fact }[] = [];
  const seen = new Set<string>(); // avoid duplicate event-fact pairs

  for (const event of events) {
    const title = (event.summary || '').trim();
    if (!title) continue;
    const titleLower = title.toLowerCase();

    for (const fact of entityFacts) {
      const entityLower = fact.entity!.toLowerCase();
      if (titleLower.includes(entityLower)) {
        const key = `${title}::${fact.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          matches.push({ eventTitle: title, fact });
        }
      }
    }
  }

  // Return up to 3 matches; prefer goals and projects over preferences
  const CATEGORY_RANK: Record<string, number> = { goal: 0, project: 1, person: 2, fact: 3, preference: 4 };
  return matches
    .sort((a, b) => (CATEGORY_RANK[a.fact.category] ?? 5) - (CATEGORY_RANK[b.fact.category] ?? 5))
    .slice(0, 3);
}
