// Structured fact extraction for compounding memory (Core-owned).
//
// Extracts DURABLE structured facts from call transcripts using one Haiku call,
// then deduplicates + upserts them. Facts compound over time instead of accumulating
// noise because each fact is keyed by (category, entity) and updated in-place.
//
// Design: always degrades safely — any failure is a no-op that never blocks post-call
// processing. Extraction failure === no new facts stored, existing facts unchanged.

import { factQueries, type Fact } from './db';
import { maybeCreateFactLearnedNotif } from './notifications';
import { groundProperNouns, extractNamesFromEventTitles } from './grounding';
import type { calendar_v3 } from 'googleapis';
import type { EmailSignal } from './gmail';

export type ExtractedFact = {
  category: 'person' | 'project' | 'goal' | 'preference' | 'fact';
  statement: string;
  entity?: string | null;
  confidence?: 'high' | 'low';
};

const VALID_CATEGORIES = new Set(['person', 'project', 'goal', 'preference', 'fact']);

/**
 * ONE Haiku call: parse up to 10 durable structured facts from a transcript.
 * userName is injected so the model uses the correct spelling (not STT's version).
 * knownNames lets the model correct STT garbling of known contacts.
 * existingFacts tells the model which facts are already stored so it only returns NET-NEW.
 * Returns [] on any error or when nothing durable was found.
 */
export async function extractFactsFromTranscript(
  transcript: string,
  userName?: string,
  knownNames?: string[],
  existingFacts?: Array<{ category: string; statement: string; entity?: string | null }>,
): Promise<ExtractedFact[]> {
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    // Inference only — transcript sent to Anthropic to extract structured facts.
    // This function returns facts but does not persist anything; callers persist.
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const userLine = userName
      ? `The user's name is "${userName}". Speech-to-text often mis-spells it in the transcript (e.g. "Derek" for "Derrick", "Sun Yat-Sen" as "Yassen"). Always refer to the user by their correct name "${userName}" in statements. Do NOT create a "person" fact about the user themselves — only about OTHER people.\n`
      : '';

    const knownNamesLine = knownNames && knownNames.length > 0
      ? `Known people in this user's world (prefer these exact spellings when a word sounds phonetically similar but may be garbled — e.g. if you see "Pfizer" in a people context but "Faiza" is a known contact, use "Faiza"): ${knownNames.join(', ')}.\n`
      : '';

    const existingFactsLine = existingFacts && existingFacts.length > 0
      ? `Already stored facts (return ONLY net-new facts — skip anything already captured here or a paraphrase of it):\n${existingFacts.slice(0, 30).map(f => `- [${f.category}${f.entity ? ` | ${f.entity}` : ''}] ${f.statement}`).join('\n')}\n`
      : '';

    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Extract up to 10 DURABLE facts about the user from this call transcript.
Return ONLY a JSON array — no preamble, no markdown.
${userLine}${knownNamesLine}${existingFactsLine}
Each item: {"category":"<category>","statement":"<one clear sentence>","entity":"<name or null>","confidence":"high"|"low"}

Categories:
- "person"     — someone important to the user (investor, client, team member, family — NOT the user themselves)
- "project"    — a project or initiative the user is building or running
- "goal"       — a stated goal, aspiration, or deadline
- "preference" — how the user likes to work, communicate, or make decisions
- "fact"       — any other durable fact about the user's life or business

Rules:
- "statement" must be a timeless sentence (not "today" / "yesterday").
- "entity" = the name or identifier this fact is about (person, company, project). null if none.
- "confidence": set to "low" if the entity is a name or address that speech-to-text may have garbled (unknown spelling, unusual name, street address). Set "high" for everything else.
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
      .map(f => ({
        ...f,
        entity: (f as ExtractedFact).entity?.trim() || null,
        confidence: (f as ExtractedFact).confidence === 'low' ? 'low' as const : 'high' as const,
      }));
  } catch {
    return [];
  }
}

/** Returns true if entityName is close enough to the user's own name that we should skip the fact. */
function isSelfEntity(entity: string | null | undefined, userName?: string): boolean {
  if (!entity || !userName) return false;
  const e = entity.trim().toLowerCase();
  const u = userName.trim().toLowerCase();
  const firstName = u.split(' ')[0];
  return e === u || e === firstName;
}

/**
 * Extract facts from transcript and upsert them for the given user.
 * Fire-and-forget safe: any error is logged but never propagated.
 * userName ensures STT mis-spellings are corrected; sourceBriefingId provides provenance.
 * calendarEventTitles (optional) — today's event titles used to extract additional canonical
 * names for the grounding pre-pass (e.g. "Call with Faiza" → "Faiza" added to known names).
 */
export async function extractAndUpsertFacts(
  userId: number,
  transcript: string,
  userName?: string,
  sourceBriefingId?: number,
  calendarEventTitles?: string[],
): Promise<void> {
  try {
    // Pass previously stored facts so the model returns only net-new items.
    // Also pass known person names so STT garbling is corrected (e.g. "Pfizer" → "Faiza").
    const storedFacts = factQueries.getAll(userId);
    const knownNames = storedFacts
      .filter(f => f.category === 'person' && typeof f.entity === 'string' && (f.entity as string).trim().length > 0)
      .map(f => f.entity as string);

    // Tier-1 grounding: deterministic pre-pass corrects 1-edit-distance STT garbling
    // (e.g. "Gym" → "Jim", "Onsi" → "Ansi") before the Haiku model sees the transcript.
    // Calendar event titles add canonical names: prefer exact event spelling over STT re-spell.
    // Auto-fetch today's events when not supplied — so the webhook call site stays simple.
    let resolvedEventTitles = calendarEventTitles;
    if (!resolvedEventTitles) {
      try {
        const { getCalendarEvents } = await import('./calendar');
        const evts = await getCalendarEvents(userId);
        resolvedEventTitles = evts.map(e => e.summary ?? '').filter(Boolean);
      } catch { resolvedEventTitles = []; }
    }
    const eventNames = extractNamesFromEventTitles(resolvedEventTitles);
    // Combine person facts + event title names for both Tier-1 pre-pass AND Haiku hint.
    const allCanonical = [...new Set([...knownNames, ...eventNames])];
    const groundedTranscript = groundProperNouns(transcript, allCanonical);

    // Pass allCanonical (not just knownNames) so the Haiku model uses exact event-title
    // spellings when a transcribed name is a near-miss (e.g. event "1:1 Jim" → prefer "Jim").
    const facts = await extractFactsFromTranscript(groundedTranscript, userName, allCanonical, storedFacts);
    let stored = 0;
    for (const f of facts) {
      // Never file a "person" fact about the user themselves.
      if (f.category === 'person' && isSelfEntity(f.entity, userName)) continue;
      factQueries.upsertFact(userId, f.category, f.statement.slice(0, 500), f.entity, f.confidence ?? 'high', sourceBriefingId);
      stored++;
    }
    if (stored > 0) {
      console.log(`[facts] Upserted ${stored} structured facts for user ${userId}`);
    }
    // Consolidate near-duplicate facts (same category + similar entity) after each write.
    const removed = consolidateFacts(userId);
    if (removed > 0) {
      console.log(`[facts] Consolidated ${removed} duplicate facts for user ${userId}`);
    }
    // Notify ONLY on genuinely NEW facts the user will actually see in the memory tab —
    // the net row increase after upserts (which UPDATE existing facts, not just insert) AND
    // consolidation (which removes near-dups). Counting raw upserts overstated "6 new" when the
    // memory tab showed nothing new — a trust bug. netNew matches exactly what's rendered.
    const netNew = factQueries.getAll(userId).length - storedFacts.length;
    if (netNew > 0) {
      maybeCreateFactLearnedNotif(userId, netNew);
    }
  } catch (err) {
    console.error('[facts] extractAndUpsertFacts failed:', err);
  }
}

/**
 * Consolidate near-duplicate facts for a user.
 * Groups by (category, LOWER(TRIM(entity))); keeps the fact with the highest confidence
 * (user-corrected high > auto-extracted low), then longest statement, then most recent.
 * Merges the best available statement onto the keeper before deleting duplicates.
 * Entity-null facts are never merged — they can't be reliably matched.
 */
export function consolidateFacts(userId: number): number {
  const allFacts = factQueries.getAll(userId);
  const groups = new Map<string, typeof allFacts>();

  for (const f of allFacts) {
    if (!f.entity || !f.entity.trim()) continue;
    const key = `${f.category}::${f.entity.trim().toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }

  let removed = 0;
  for (const group of groups.values()) {
    if (group.length <= 1) continue;

    // Sort priority: confidence high > low, then longest statement (>20 char diff), then recency.
    const sorted = [...group].sort((a, b) => {
      const confA = a.confidence === 'high' ? 1 : 0;
      const confB = b.confidence === 'high' ? 1 : 0;
      if (confB !== confA) return confB - confA; // high confidence first
      const lenDiff = b.statement.length - a.statement.length;
      if (Math.abs(lenDiff) > 20) return lenDiff;
      return (b.learned_at ?? '').localeCompare(a.learned_at ?? '');
    });

    const keep = sorted[0];
    // Best statement: prefer the high-confidence one if present; otherwise the longest.
    const highConf = sorted.find(f => f.confidence === 'high');
    const bestStatement = highConf
      ? highConf.statement
      : sorted.reduce((best, f) => f.statement.length > best.length ? f.statement : best, sorted[0].statement);

    if (bestStatement !== keep.statement) {
      factQueries.updateFact(userId, keep.id, bestStatement, keep.entity ?? null);
    }

    for (const dup of sorted.slice(1)) {
      factQueries.deleteFact(userId, dup.id);
      removed++;
    }
  }

  return removed;
}

/**
 * Format up to 10 stored preference statements into a compact system-prompt section.
 * Returns empty string when no preferences exist so the caller can skip the whole section.
 * Pure — no DB or API calls.
 */
export function buildPreferencesPrompt(preferences: string[]): string {
  if (!preferences.length) return '';
  return preferences.slice(0, 10).map(p => `- ${p}`).join('\n');
}

/**
 * Extract durable facts from an email inbox signal and upsert them for the user.
 * One Haiku call on the formatted digest. Never blocks the caller — any failure is a no-op.
 * Requires gmail.readonly to have been granted (caller passes the fetched signal).
 */
export async function extractAndUpsertFactsFromEmail(
  userId: number,
  emailSignal: EmailSignal,
  userName?: string,
): Promise<void> {
  if (emailSignal.scopeMissing || emailSignal.items.length === 0) return;
  try {
    const digest = emailSignal.items
      .map(item => `From: ${item.sender} | Subject: ${item.subject}\nSnippet: ${item.snippet.slice(0, 120)}`)
      .join('\n\n');

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const userLine = userName
      ? `The user's name is "${userName}". Do NOT create a "person" fact about the user themselves.\n`
      : '';

    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Extract up to 5 DURABLE facts about the user's life or situation from this email inbox digest.
Return ONLY a JSON array — no preamble, no markdown.
${userLine}
Each item: {"category":"<category>","statement":"<one clear timeless sentence>","entity":"<name or null>","confidence":"high"|"low"}

Categories: "person" | "project" | "goal" | "preference" | "fact"
Rules:
- Focus on DURABLE context: ongoing negotiations, relationships, financial situations, legal matters, projects.
- Example of good fact: "User is in debt negotiation with CIBC" or "User owes a past-due balance to a collection agency."
- Statement must be timeless (not "today"/"yesterday"). Entity = company or person name.
- confidence "low" if name/entity may be garbled; "high" otherwise.
- Skip: newsletters, promotions, casual social email, meeting invites.
- Return [] if nothing durable found.

Email digest (header + snippet only):
${digest}`,
      }],
    });

    const raw = res.content
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { type: string; text?: string }) => b.text ?? '')
      .join('')
      .trim();

    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return;

    const parsed: unknown[] = JSON.parse(match[0]);
    let stored = 0;
    for (const f of parsed) {
      if (
        typeof f !== 'object' || f === null ||
        !('category' in f) || !('statement' in f) ||
        !VALID_CATEGORIES.has((f as ExtractedFact).category) ||
        typeof (f as ExtractedFact).statement !== 'string' ||
        !(f as ExtractedFact).statement.trim()
      ) continue;

      const fact = f as ExtractedFact;
      factQueries.upsertFact(
        userId,
        fact.category,
        fact.statement.trim().slice(0, 500),
        fact.entity?.trim().slice(0, 200) || null,
        fact.confidence === 'low' ? 'low' : 'high',
        null,
      );
      stored++;
    }
    if (stored > 0) {
      console.log(`[facts] Upserted ${stored} facts from email signal for user ${userId}`);
    }
  } catch (err) {
    console.error('[facts] extractAndUpsertFactsFromEmail failed:', err);
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
