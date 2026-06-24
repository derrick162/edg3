// Structured fact extraction for compounding memory (Core-owned).
//
// Extracts DURABLE structured facts from call transcripts using one Haiku call,
// then deduplicates + upserts them. Facts compound over time instead of accumulating
// noise because each fact is keyed by (category, entity) and updated in-place.
//
// Design: always degrades safely — any failure is a no-op that never blocks post-call
// processing. Extraction failure === no new facts stored, existing facts unchanged.

import { factQueries, peopleProfileQueries, peopleModelQueries, briefingQueries, type Fact, type PeopleModelFields } from './db';
import { maybeCreateFactLearnedNotif } from './notifications';
import { groundProperNouns, extractNamesFromEventTitles } from './grounding';
import { matchesSelfName } from './selfName';
import { isUngroundedHealthFact } from './factGuards';
import type { calendar_v3 } from 'googleapis';
import type { EmailSignal } from './gmail';
import { isLikelySpam } from './emailActivityFilter';

export type ExtractedFact = {
  category: 'person' | 'project' | 'goal' | 'preference' | 'fact' | 'commitment';
  statement: string;
  entity?: string | null;
  confidence?: 'high' | 'low';
};

const VALID_CATEGORIES = new Set(['person', 'project', 'goal', 'preference', 'fact', 'commitment']);

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
- "person"     — a clearly-named HUMAN in a real relationship with the user (investor, client, colleague, family member). NOT the user themselves. NOT the AI assistant (Edge/Edg3). NOT activities or objects (gym, lunch, workout, class). NOT companies (use "fact" for orgs).
- "project"    — a project or initiative the user is building or running
- "goal"       — a stated goal, aspiration, or deadline
- "preference" — how the user likes to work, communicate, or make decisions
- "fact"       — any other durable fact about the user's life or business
- "commitment" — something the user said THEY WILL DO, especially near-term ("I'm going to tackle the Railway fix today", "I'll call the bank tomorrow", "I plan to finish the deck this week", "I need to get to the gym"). Capture the action as the statement, entity null. These are NOT timeless — they're for next-call accountability, so do extract them even though they're time-bound (this overrides the "timeless only" rule for commitments). One commitment per distinct intention.

Rules:
- ATTRIBUTION: Only extract preferences, goals, beliefs, or facts that the USER stated about themselves. NEVER attribute anything the assistant (Edge/Edg3) said as a user preference or belief. The assistant deflecting, redirecting, or suggesting (e.g. "let's save that for another time", "let's keep focused") is the ASSISTANT's behavior, NOT a user preference — ignore it entirely. When unsure who said something, do not extract it.
- EXPLICIT REMEMBER REQUESTS (highest priority): Any statement the user prefaces with "please remember", "remember that", "make a note that", or "don't forget" is a MANDATORY high-confidence fact — always extract it regardless of how durable it seems; it's an explicit instruction, not an inference. Use the right category and entity: a fact about another person → "person" with that person's name as the entity (e.g. "remember that Patrick grew up in Dallas" → {"category":"person","entity":"Patrick","statement":"Patrick grew up in Dallas","confidence":"high"}); a fact about the user → "preference"/"goal"/"fact" as fits.
- "statement" must be a timeless sentence (not "today" / "yesterday").
- "entity" = the name or identifier this fact is about (person, company, project). null if none.
- "confidence": set to "low" if the entity is a name or address that speech-to-text may have garbled (unknown spelling, unusual name, street address). Set "high" for everything else.
- Skip ephemeral items: task completions, calendar changes, weather, today's schedule.
- Only facts that would still be true and useful in 2 weeks.
- Prefer CONCRETE details: "Derrick's dad's birthday is June 15" NOT "Derrick's father has a birthday." Include dates, roles, companies, or amounts when they appear.
- NEVER infer health metrics, weight, or body measurements. Only record a weight/measurement if the user EXPLICITLY states the number in the transcript (e.g. "I weigh 122"). Do not carry these over from prior context.
- DO capture preferences when the user expresses how they like to work, communicate, schedule, or decide ("I prefer mornings", "keep meetings short", "text me, don't call") — these are easy to miss but valuable.
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

// R29 — universally cumulative memory. Merged facts are capped so a fact can't grow unbounded.
const ENRICH_MAX = 500;

/**
 * R29 — merge two facts about the same subject into ONE statement that preserves ALL information.
 * Additive details combine; on a direct contradiction the NEW statement wins for that point only,
 * everything else is kept. Uses one cheap Haiku call; on ANY failure (or empty output) it falls
 * back to a simple concatenation. Never throws. Used by `rememberPreference` and post-call
 * extraction so re-stating something about a known subject enriches rather than overwrites.
 */
export async function enrichFact(oldStatement: string, newStatement: string): Promise<string> {
  const oldS = (oldStatement ?? '').trim();
  const newS = (newStatement ?? '').trim();
  if (!oldS) return newS.slice(0, ENRICH_MAX);
  if (!newS) return oldS.slice(0, ENRICH_MAX);
  // Nothing to add — the new statement is already contained in the old one.
  if (oldS.toLowerCase().includes(newS.toLowerCase())) return oldS.slice(0, ENRICH_MAX);

  const concatFallback = () => `${oldS} ${newS}`.trim().slice(0, ENRICH_MAX);

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Merge these two facts about the same subject into one concise statement.
Preserve ALL information from both. If they contradict on a specific claim, the second statement wins for just that claim. Keep the result under 400 chars.
Old: "${oldS}"
New: "${newS}"
Return only the merged statement, nothing else.`,
      }],
    });
    const merged = res.content
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { type: string; text?: string }) => b.text ?? '')
      .join('')
      .trim()
      .replace(/^["']+|["']+$/g, '') // strip wrapping quotes the model sometimes adds
      .trim();
    return merged ? merged.slice(0, ENRICH_MAX) : concatFallback();
  } catch {
    return concatFallback();
  }
}

// ─── M4-5 — Hierarchical call summarization (per-call → weekly → lifetime) ──────
// Per-call extraction is the leaf (extractAndUpsertFacts). These two helpers add the higher tiers:
// a weekly synthesis that preserves cross-call causal chains, and a lifetime profile that compounds
// the weeks into a stable "who this person is". Both degrade silently and never throw.

const WEEKLY_MIN_CALLS = 3;       // a week with fewer completed calls isn't worth synthesizing
const WEEKLY_MAX_ACTIVE = 3;      // keep the 3 most recent weekly summaries; retire older
const LIFETIME_MIN_WEEKLIES = 10; // only build a lifetime profile once there's real history

async function haikuText(prompt: string, maxTokens: number): Promise<string> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  return res.content
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { type: string; text?: string }) => b.text ?? '')
    .join('')
    .trim();
}

/**
 * M4-5 Tier 2 — weekly synthesis. Over the last 7 days of completed-call transcripts (gate: ≥3 calls),
 * one Haiku call produces a 3–5 sentence "week narrative" capturing the through-line across calls.
 * Stored as a `weekly_summary` fact keyed by `week_of_YYYY-MM-DD` (replace semantics for a re-run of
 * the same week); the 3 most recent are kept, older ones retired. Returns true when a summary was written.
 */
export async function runWeeklySynthesis(userId: number): Promise<boolean> {
  try {
    const since = Date.now() - 7 * 86400000;
    const recent = briefingQueries.getRecent(userId, 30)
      .filter(b => b.status === 'completed')
      .filter(b => { const t = Date.parse(b.scheduled_for ?? ''); return Number.isFinite(t) && t >= since; });
    if (recent.length < WEEKLY_MIN_CALLS) return false;

    const transcripts = recent
      .map(b => (b.user_response || b.content || '').trim())
      .filter(Boolean)
      .map((t, i) => `Call ${i + 1}: ${t.slice(0, 1500)}`)
      .join('\n\n');
    if (!transcripts) return false;

    const narrative = await haikuText(
      `Synthesize this week's calls into a 3-5 sentence "week narrative" for the user. Capture the through-line ACROSS calls — recurring themes, momentum or friction building over the week, and how decisions connect (e.g. "mentioned Railway three times with rising frustration"). Plain prose, no bullet points, no preamble.\n\n${transcripts}`,
      400,
    );
    if (!narrative) return false;

    const weekOf = new Date().toISOString().slice(0, 10);
    const entity = `week_of_${weekOf}`;
    // Replace (not merge) a same-week re-run: retire the prior week's summary first so upsert inserts fresh.
    for (const f of factQueries.getByCategory(userId, 'weekly_summary').filter(f => f.entity === entity)) {
      factQueries.retire(userId, f.id);
    }
    factQueries.upsertFact(userId, 'weekly_summary', narrative.slice(0, 1500), entity, 'high');

    // Cap active weekly summaries at the most recent N.
    const active = factQueries.getByCategory(userId, 'weekly_summary')
      .sort((a, b) => (b.learned_at ?? '').localeCompare(a.learned_at ?? ''));
    for (const old of active.slice(WEEKLY_MAX_ACTIVE)) factQueries.retire(userId, old.id);
    return true;
  } catch (e) {
    console.error('[runWeeklySynthesis]', e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * M4-5 Tier 3 — lifetime profile. Once the user has ≥10 active weekly summaries, one Haiku call over
 * all of them produces a ~150-word "who this person is" profile, stored as a single `lifetime_profile`
 * fact (retire + insert each run). Injected first in the call memory block. Returns true when written.
 */
export async function runLifetimeSynthesis(userId: number): Promise<boolean> {
  try {
    const weeklies = factQueries.getByCategory(userId, 'weekly_summary');
    if (weeklies.length < LIFETIME_MIN_WEEKLIES) return false;

    const input = [...weeklies]
      .sort((a, b) => (a.learned_at ?? '').localeCompare(b.learned_at ?? ''))
      .map((w, i) => `Week ${i + 1}: ${w.statement}`)
      .join('\n\n');

    const profile = await haikuText(
      `From these weekly summaries, write a ~150-word "who this person is" profile — their durable traits, goals, working style, key relationships, and what matters most to them. Plain prose, no preamble, no bullet points.\n\n${input}`,
      300,
    );
    if (!profile) return false;

    for (const f of factQueries.getByCategory(userId, 'lifetime_profile')) factQueries.retire(userId, f.id);
    factQueries.upsertFact(userId, 'lifetime_profile', profile.slice(0, 1200), null, 'high');
    return true;
  } catch (e) {
    console.error('[runLifetimeSynthesis]', e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * Returns true if entityName is close enough to the user's own name that we should skip the fact.
 * Delegates to the shared self-name matcher, which catches nickname/STT/initial variants
 * ("derek" for "Derrick", "Fung", "D. Fung") that the old exact-match guard missed.
 */
function isSelfEntity(entity: string | null | undefined, userName?: string): boolean {
  return matchesSelfName(entity, userName);
}

/** Returns true if entityName refers to the AI assistant — should never be stored as a person contact. */
const ASSISTANT_ENTITY_NAMES = new Set(['edge', 'edg3', 'edge ai', 'edg3 ai', 'the assistant', 'ai']);
function isAssistantEntity(entity: string | null | undefined): boolean {
  if (!entity) return false;
  return ASSISTANT_ENTITY_NAMES.has(entity.trim().toLowerCase());
}

/** Returns true if entityName refers to an activity or object rather than a real person. */
const ACTIVITY_WORDS = new Set(['gym', 'workout', 'walk', 'run', 'jog', 'swim', 'yoga', 'pilates', 'cycling', 'lunch', 'dinner', 'breakfast', 'brunch', 'coffee', 'class', 'session']);
function isActivityEntity(entity: string | null | undefined): boolean {
  if (!entity) return false;
  return ACTIVITY_WORDS.has(entity.trim().toLowerCase());
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
): Promise<number> {
  try {
    // Pass previously stored facts so the model returns only net-new items.
    // Also pass known person names so STT garbling is corrected (e.g. "Pfizer" → "Faiza").
    const storedFacts = factQueries.getAll(userId);
    const knownNames = storedFacts
      .filter(f => f.category === 'person' && typeof f.entity === 'string' && (f.entity as string).trim().length > 0)
      .map(f => f.entity as string);

    // Fix 2: Load M2 relationship profiles to ground low-confidence person facts.
    // Low-confidence people that have no match in real contacts (M2 or existing high-conf facts) are dropped.
    let knownRealContactNames = new Set<string>();
    try {
      const { peopleProfileQueries: ppq } = await import('./db');
      const profiles = ppq.listForUser(userId);
      for (const p of profiles) {
        knownRealContactNames.add(p.canonical_name.toLowerCase());
        const fn = p.canonical_name.split(' ')[0].toLowerCase();
        if (fn.length >= 3) knownRealContactNames.add(fn);
      }
    } catch { /* degrade — no filter applied */ }
    // Also trust existing high-confidence person facts as known
    for (const f of storedFacts) {
      if (f.category === 'person' && f.confidence === 'high' && f.entity)
        knownRealContactNames.add(f.entity.toLowerCase());
    }
    const hasM2Data = knownRealContactNames.size > 0;

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

    // R29 — universally cumulative memory: when extraction surfaces new info about a subject we
    // already have an active fact for, ENRICH (merge) it rather than overwrite. Entity-keyed facts
    // (person/project/goal-with-topic) merge via Haiku here; null-entity facts fall through to
    // upsertFact, whose high-confidence path now merges by concatenation.
    const activeByKey = new Map<string, Fact>();
    for (const sf of storedFacts) {
      if (sf.entity && sf.entity.trim()) activeByKey.set(`${sf.category}|${sf.entity.trim().toLowerCase()}`, sf);
    }

    let stored = 0;
    for (const f of facts) {
      // Anti-hallucination: never store a health/body measurement whose number the
      // user didn't actually say. Catches inferred facts like "weighs 122 lbs".
      if (isUngroundedHealthFact(f.statement, transcript)) {
        console.warn(`[facts] dropped ungrounded health fact for user ${userId}: "${f.statement.slice(0, 60)}"`);
        continue;
      }
      if (f.category === 'person') {
        // Never file a "person" fact about the user themselves.
        if (isSelfEntity(f.entity, userName)) continue;
        // Never file a "person" fact about the AI assistant.
        if (isAssistantEntity(f.entity)) continue;
        // Never file a "person" fact that is actually an activity or object.
        if (isActivityEntity(f.entity)) continue;
        // Fix 2: Low-confidence person with no real contact match → drop (when M2 data available).
        if (f.confidence === 'low' && f.entity && hasM2Data) {
          const eLower = f.entity.trim().toLowerCase();
          const isKnown = [...knownRealContactNames].some(k => k.includes(eLower) || eLower.includes(k));
          if (!isKnown) continue;
        }
      }
      // R29 — enrich an existing entity-keyed fact instead of overwriting it.
      const existingActive = f.entity?.trim()
        ? activeByKey.get(`${f.category}|${f.entity.trim().toLowerCase()}`)
        : undefined;
      if (existingActive && existingActive.statement.trim().toLowerCase() !== f.statement.trim().toLowerCase()) {
        const merged = await enrichFact(existingActive.statement, f.statement);
        factQueries.updateFact(userId, existingActive.id, merged.slice(0, 500), f.entity ?? existingActive.entity ?? null);
        existingActive.statement = merged; // keep the map current if another extracted fact targets the same subject
      } else {
        factQueries.upsertFact(userId, f.category, f.statement.slice(0, 500), f.entity, f.confidence ?? 'high', sourceBriefingId);
      }
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
    return stored;
  } catch (err) {
    console.error('[facts] extractAndUpsertFacts failed:', err);
    return 0;
  }
}

/**
 * Consolidate near-duplicate facts for a user.
 * Groups by (category, LOWER(TRIM(entity))); keeps the fact with the highest confidence
 * (user-corrected high > auto-extracted low), then longest statement, then most recent.
 * Merges the best available statement onto the keeper before deleting duplicates.
 * Entity-null facts are never merged — they can't be reliably matched.
 */
// Normalize a string for dedup comparison: lowercase, expand number ranges (30-60-90 → 30 60 90),
// collapse all non-alphanumeric to spaces. Returns a set of non-empty tokens.
function tokenizeForDedup(s: string): Set<string> {
  const normalized = s
    .toLowerCase()
    .replace(/(\d+)[-/](\d)/g, '$1 $2') // "30-60-90" → "30 60 90"
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return new Set(normalized.split(' ').filter(t => t.length > 0));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const t of a) { if (b.has(t)) intersection++; }
  return intersection / (a.size + b.size - intersection);
}

// Normalize an entity string for containment checks: remove hyphens/slashes between
// digits (so "30-60-90" and "30/60/90" and "30 60 90" all normalize to "30 60 90").
function normalizeEntity(e: string): string {
  return e
    .toLowerCase()
    .replace(/(\d+)[-/](\d)/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

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

  // Helper: sort and reduce a group to its best fact, deleting the rest.
  function reduceGroup(group: typeof allFacts): void {
    if (group.length <= 1) return;

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

    // R25 T6 — preserve the ORIGINAL learn date. When a goal/fact is re-stated on a later call
    // it merges into the kept row; the kept row may not be the earliest, so the "learned MMM d"
    // stamp could jump forward to today. Anchor it to the oldest learned_at across the group.
    const oldestLearnedAt = group.reduce(
      (oldest, f) => (f.learned_at && f.learned_at < oldest ? f.learned_at : oldest),
      keep.learned_at,
    );
    if (oldestLearnedAt && oldestLearnedAt !== keep.learned_at) {
      factQueries.updateLearnedAt(userId, keep.id, oldestLearnedAt);
    }

    for (const dup of sorted.slice(1)) {
      factQueries.deleteFact(userId, dup.id);
      removed++;
    }
  }

  // Pass 0: null-entity goal/preference dedup via Jaccard token overlap.
  // Catches "30-60-90 plan" stored with slight variations (no entity key to group on).
  // Threshold: Jaccard ≥ 0.4 on normalized token sets → consider same goal/preference.
  const JACCARD_THRESHOLD = 0.4;
  const NULL_ENTITY_CATS = new Set(['goal', 'preference']);
  const nullEntityFacts = allFacts.filter(f => !f.entity?.trim() && NULL_ENTITY_CATS.has(f.category));
  const tokenSets = nullEntityFacts.map(f => tokenizeForDedup(f.statement));
  const claimedNull = new Set<number>(); // indexes of already-merged facts
  for (let i = 0; i < nullEntityFacts.length; i++) {
    if (claimedNull.has(i)) continue;
    const cluster: typeof nullEntityFacts = [nullEntityFacts[i]];
    for (let j = i + 1; j < nullEntityFacts.length; j++) {
      if (claimedNull.has(j)) continue;
      if (nullEntityFacts[i].category !== nullEntityFacts[j].category) continue;
      if (jaccardSimilarity(tokenSets[i], tokenSets[j]) >= JACCARD_THRESHOLD) {
        cluster.push(nullEntityFacts[j]);
        claimedNull.add(j);
      }
    }
    claimedNull.add(i);
    if (cluster.length > 1) reduceGroup(cluster);
  }

  // Pass 1: exact-match grouping (same category + same entity, case-insensitive).
  for (const group of groups.values()) {
    reduceGroup(group);
  }

  // Pass 2: fuzzy containment — merge groups where one entity is a substring of the other
  // (same category). Uses normalized entity strings (hyphens/slashes expanded) so
  // "30-60-90" and "30/60/90" and "30 60 90" all match.
  // Guard: both entities ≥3 chars, shared portion ≥4 chars.
  // People-guard: shorter entity must be ≥6 chars OR one fully contains the other (prevents
  // merging "Sam" with "Samsung").
  const remainingFacts = factQueries.getAll(userId);
  const entityGroups = new Map<string, typeof remainingFacts>();
  for (const f of remainingFacts) {
    if (!f.entity || !f.entity.trim()) continue;
    const key = `${f.category}::${f.entity.trim().toLowerCase()}`;
    if (!entityGroups.has(key)) entityGroups.set(key, []);
    entityGroups.get(key)!.push(f);
  }

  const keys = [...entityGroups.keys()];
  const merged = new Set<string>(); // keys already consumed by a merge

  for (let i = 0; i < keys.length; i++) {
    if (merged.has(keys[i])) continue;
    const [catI, rawEntI] = keys[i].split('::');
    const entI = normalizeEntity(rawEntI);

    for (let j = i + 1; j < keys.length; j++) {
      if (merged.has(keys[j])) continue;
      const [catJ, rawEntJ] = keys[j].split('::');
      const entJ = normalizeEntity(rawEntJ);

      if (catI !== catJ) continue;
      if (entI.length < 3 || entJ.length < 3) continue;

      const shorter = entI.length <= entJ.length ? entI : entJ;
      const longer  = entI.length <= entJ.length ? entJ : entI;

      // Shared portion must be at least 4 chars.
      if (shorter.length < 4) continue;

      // One must contain the other (substring check on normalized forms).
      if (!longer.includes(shorter)) continue;

      // People guard: shorter string must be ≥6 chars OR the longer fully starts with shorter
      // (prevents merging first names like "Sam" with "Samsung").
      const isSameCategoryPeople = catI === 'person';
      if (isSameCategoryPeople && shorter.length < 6 && !longer.startsWith(shorter + ' ') && longer !== shorter) {
        continue;
      }

      // Merge: prefer shorter entity key as canonical. Combine both groups into one.
      const canonicalKey = entI.length <= entJ.length ? keys[i] : keys[j];
      const otherKey     = entI.length <= entJ.length ? keys[j] : keys[i];

      const canonicalGroup = entityGroups.get(canonicalKey) ?? [];
      const otherGroup     = entityGroups.get(otherKey) ?? [];

      // Update the other group's facts entity to match the canonical entity.
      const canonicalEntity = canonicalKey.split('::')[1];
      for (const f of otherGroup) {
        if (f.entity?.toLowerCase() !== canonicalEntity) {
          factQueries.updateFact(userId, f.id, f.statement, canonicalEntity);
        }
      }

      // Now reduce the combined group.
      const combined = [...canonicalGroup, ...otherGroup];
      reduceGroup(combined);

      merged.add(otherKey);
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
    // Round 7: skip likely-spam/promotional threads before extraction (defense-in-depth —
    // getRecentEmailSignal already skips them for body-fetch; this guards the snippet path too).
    const usableItems = emailSignal.items.filter(item => !isLikelySpam(item.subject, item.sender));
    if (usableItems.length === 0) return;
    const digest = usableItems
      .map(item => {
        // Prefer the full body when present (fullBodies fetch); fall back to the snippet.
        const content = (item.body?.trim() || item.snippet || '').slice(0, 2000);
        return `From: ${item.sender} | Subject: ${item.subject}\n${item.body ? 'Body' : 'Snippet'}: ${content}`;
      })
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

Email digest (headers + body text when available, else snippet):
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

      // Anti-hallucination: drop ungrounded health/body metrics (number must appear in the digest).
      if (isUngroundedHealthFact(fact.statement, digest)) {
        console.warn(`[facts] dropped ungrounded health fact (email) for user ${userId}: "${fact.statement.slice(0, 60)}"`);
        continue;
      }

      // Apply the same person-entity guards as the transcript path.
      if (fact.category === 'person') {
        if (isSelfEntity(fact.entity, userName)) continue;
        if (isAssistantEntity(fact.entity)) continue;
        if (isActivityEntity(fact.entity)) continue;
      }

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
 * Clean up bad people facts that have accumulated in existing data.
 * Idempotent — safe to call multiple times. Removes:
 *   - Self-entity facts (user filed as their own contact)
 *   - Assistant-entity facts (Edge/Edg3 filed as a contact)
 *   - Activity-entity facts (Gym, Lunch, etc. filed as a person)
 *   - Low-confidence person facts with no matching M2 real contact (when M2 data is available)
 * High-confidence facts are protected from the M2 cross-check (only low-conf unmatched are dropped).
 * Calls consolidateFacts at the end to merge any remaining fuzzy duplicates.
 * Returns { removed } count of deleted facts.
 */
export async function cleanupPeopleFacts(
  userId: number,
  userName?: string,
): Promise<{ removed: number }> {
  // Load M2 real contact names.
  let knownRealContactNames = new Set<string>();
  try {
    const profiles = peopleProfileQueries.listForUser(userId);
    for (const p of profiles) {
      knownRealContactNames.add(p.canonical_name.toLowerCase());
      const fn = p.canonical_name.split(' ')[0].toLowerCase();
      if (fn.length >= 3) knownRealContactNames.add(fn);
    }
  } catch { /* degrade */ }

  // Also trust existing high-confidence person facts as known real contacts.
  const allFacts = factQueries.getAll(userId);
  for (const f of allFacts) {
    if (f.category === 'person' && f.confidence === 'high' && f.entity)
      knownRealContactNames.add(f.entity.toLowerCase());
  }
  const hasM2Data = knownRealContactNames.size > 0;

  const personFacts = allFacts.filter(f => f.category === 'person');
  let removed = 0;

  for (const f of personFacts) {
    // Always drop: self, assistant, activity
    if (isSelfEntity(f.entity, userName) || isAssistantEntity(f.entity) || isActivityEntity(f.entity)) {
      factQueries.deleteFact(userId, f.id);
      removed++;
      continue;
    }

    // Drop low-confidence facts with no M2 match (only when M2 data is available).
    // High-confidence facts are protected from the M2 cross-check.
    if (f.confidence === 'low' && f.entity && hasM2Data) {
      const eLower = f.entity.trim().toLowerCase();
      const isKnown = [...knownRealContactNames].some(k => k.includes(eLower) || eLower.includes(k));
      if (!isKnown) {
        factQueries.deleteFact(userId, f.id);
        removed++;
      }
    }
  }

  // Merge remaining fuzzy duplicates (e.g. "Pfizer" vs "Pfizer CIBC").
  consolidateFacts(userId);

  return { removed };
}

/**
 * Run goal/preference dedup for a user: calls the improved consolidateFacts which
 * handles null-entity Jaccard dedup + normalized entity containment. Safe to run
 * repeatedly (idempotent). Returns the number of duplicate facts removed.
 * Called from the admin memories cleanup endpoint and from sleep-time consolidation.
 */
export function cleanupGoalFacts(userId: number): { removed: number } {
  try {
    const before = factQueries.getAll(userId).length;
    consolidateFacts(userId);
    const after = factQueries.getAll(userId).length;
    return { removed: Math.max(0, before - after) };
  } catch (err) {
    console.error('[facts] cleanupGoalFacts failed:', err);
    return { removed: 0 };
  }
}

/**
 * Sleep-time consolidation agent (T2).
 * After each call, one Haiku call reviews the transcript against stored facts and
 * applies explicit contradictions/updates via the bi-temporal pipeline (T1).
 * Fire-and-forget safe — any failure is a no-op.
 */
export async function runSleepTimeConsolidation(
  userId: number,
  transcript: string,
  userName?: string,
): Promise<void> {
  if (!transcript || transcript.length < 50) return;
  try {
    const activeFacts = factQueries.getAll(userId);

    // M2-1: reconcile any duplicate active facts (same entity+category). Shouldn't happen
    // normally but race conditions or import bugs can produce them. Keep the most-recent, retire the rest.
    const seen = new Map<string, { id: number; learned_at: string }>();
    let reconciled = 0;
    for (const f of activeFacts) {
      const key = `${f.category}|${(f.entity ?? '').toLowerCase()}`;
      const existing = seen.get(key);
      if (!existing) { seen.set(key, { id: f.id, learned_at: f.learned_at }); continue; }
      // Retire whichever is older; keep the newer one.
      const retireId = f.learned_at >= existing.learned_at ? existing.id : f.id;
      const keepId = retireId === existing.id ? f.id : existing.id;
      factQueries.retire(userId, retireId);
      seen.set(key, { id: keepId, learned_at: retireId === existing.id ? f.learned_at : existing.learned_at });
      reconciled++;
    }
    if (reconciled > 0) console.log(`[facts] Sleep-time consolidation: reconciled ${reconciled} duplicate active facts for user ${userId}`);

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const factsContext = activeFacts.slice(0, 40)
      .map(f => `[${f.category}${f.entity ? ` | ${f.entity}` : ''}] ${f.statement}`)
      .join('\n');
    const userLine = userName ? `User name: "${userName}".\n` : '';

    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `You are a memory consolidation agent. Review this call transcript against the user's stored facts and identify ONLY explicit contradictions or clear updates — things where the user clearly said something changed.
${userLine}
STORED FACTS (active):
${factsContext || '(none yet)'}

TRANSCRIPT (last call):
${transcript.slice(0, 2000)}

Return a JSON array of ONLY items where the transcript explicitly contradicts or updates a stored fact. Return [] if nothing changed or you are uncertain.
Each item: {"action":"update"|"retire"|"add","category":"...","entity":"..."|null,"old":"..."|null,"new":"..."|null,"reason":"..."}
- "update": stored fact changed (user said something different). Include both old and new.
- "retire": stored fact is no longer true (goal achieved, habit changed). Include old only.
- "add": durable new fact not yet in stored list.
Only return HIGH-CONFIDENCE changes where the user explicitly stated the change. Return [] for ambiguous cases.`,
      }],
    });

    const raw = res.content
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { type: string; text?: string }) => b.text ?? '')
      .join('')
      .trim();

    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return;

    type ConsolidationUpdate = {
      action: 'update' | 'retire' | 'add';
      category: string;
      entity?: string | null;
      old?: string | null;
      new?: string | null;
      reason?: string;
    };
    const updates = JSON.parse(match[0]) as ConsolidationUpdate[];
    let applied = 0;

    for (const u of updates) {
      if (!VALID_CATEGORIES.has(u.category as ExtractedFact['category'])) continue;

      if ((u.action === 'update' || u.action === 'add') && u.new) {
        // Apply the SAME guards as the primary extraction path — this is a second write
        // door into the fact store, so without these it could silently re-introduce the
        // exact bugs the extraction guards block (ungrounded health metrics, self/assistant/
        // activity person facts).
        if (isUngroundedHealthFact(u.new, transcript)) {
          console.warn(`[facts] consolidation dropped ungrounded health fact for user ${userId}: "${u.new.slice(0, 60)}"`);
          continue;
        }
        if (u.category === 'person' &&
            (isSelfEntity(u.entity, userName) || isAssistantEntity(u.entity) || isActivityEntity(u.entity))) {
          continue;
        }
        factQueries.upsertFact(userId, u.category, u.new.slice(0, 500), u.entity ?? null, 'high');
        applied++;
      } else if (u.action === 'retire' && u.entity) {
        const active = factQueries.getByCategory(userId, u.category)
          .find(f => f.entity?.toLowerCase() === (u.entity as string).toLowerCase());
        if (active) { factQueries.retire(userId, active.id); applied++; }
      }
    }

    if (applied > 0) {
      console.log(`[facts] Sleep-time consolidation: ${applied} updates applied for user ${userId}`);
    }

    // M4-4: keep social mental models in sync with person facts. After consolidation, rebuild each
    // mentioned person's model from their active person-category facts (deterministic, no extra LLM).
    try {
      const personFacts = factQueries.getByCategory(userId, 'person'); // newest-first
      const byPerson = new Map<string, string[]>();
      for (const f of personFacts) {
        const name = f.entity?.trim();
        if (!name) continue;
        if (!byPerson.has(name)) byPerson.set(name, []);
        byPerson.get(name)!.push(f.statement);
      }
      let modelsSynced = 0;
      for (const [name, statements] of byPerson) {
        const fields = derivePersonModelFields(statements);
        if (fields.goals || fields.communicationStyle || fields.relationshipState) {
          peopleModelQueries.upsert(userId, name, fields);
          modelsSynced++;
        }
      }
      if (modelsSynced > 0) console.log(`[facts] Sleep-time consolidation: synced ${modelsSynced} person model(s) for user ${userId}`);
    } catch (e) {
      console.error('[facts] person-model sync failed:', e);
    }
  } catch (err) {
    console.error('[facts] runSleepTimeConsolidation failed:', err);
  }
}

// M4-4: heuristically derive a person's social-model fields from their person-category fact
// statements (newest-first). Pure. Goals/communication-style matched by keyword; relationship_state
// + last_interaction default to the most recent statement (best proxy for "what we last knew").
const PERSON_GOAL_HINTS = ['trying to', 'wants to', 'working on', 'goal', 'closing', 'raising', 'building', 'launching', 'aiming', 'planning to', 'hoping to', 'focused on'];
const PERSON_COMM_HINTS = ['prefers', 'async', 'brief', 'direct', 'formal', 'responds', 'communicat', 'over text', 'over email', 'by phone', 'concise', 'detailed', 'likes to'];

export function derivePersonModelFields(statements: string[]): PeopleModelFields {
  const clean = statements.map(s => s.trim()).filter(Boolean);
  if (!clean.length) return {};
  const find = (hints: string[]) => clean.find(s => hints.some(h => s.toLowerCase().includes(h))) ?? null;
  const relationshipState = clean[0] ?? null;
  return {
    goals: find(PERSON_GOAL_HINTS),
    communicationStyle: find(PERSON_COMM_HINTS),
    relationshipState,
    lastInteraction: relationshipState,
  };
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
