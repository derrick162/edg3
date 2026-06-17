// T4: Historical pattern detection from bi-temporal fact history (extends M3).
//
// One Haiku call per week analyzes how the user's goals/priorities/preferences
// have evolved over time (using retired + active facts from T1) to detect:
//   - commitment_follow_through: commitments kept vs dropped
//   - priority_drift: how often priorities shift and in what direction
//
// Results stored as 'fact' category rows with source='historical-pattern' so they
// appear in "What Edge knows" AND feed into the briefing §3 alignment block via
// pickBestPattern (same interface as M3 PatternInsight).
//
// Degrades silently: not enough history → returns []. Any error → returns [].

import { factQueries } from './db';
import type { PatternInsight } from './patternMemory';

const HISTORICAL_SOURCE = 'historical-pattern';
const WEEKLY_MS = 6.5 * 24 * 60 * 60 * 1000;
const MIN_RETIRED_FACTS = 3;

/**
 * Run a weekly historical pattern detection pass for the given user.
 * Returns PatternInsight[] (may be empty). Writes results as fact rows.
 *
 * Throttled: if a historical-pattern fact was stored < 6.5 days ago,
 * returns the cached insights from the fact store without an API call.
 */
export async function runHistoricalPatternDetection(userId: number): Promise<PatternInsight[]> {
  const allFacts = factQueries.getAllIncludingRetired(userId);
  const retiredFacts = allFacts.filter(f => f.valid_until);

  if (retiredFacts.length < MIN_RETIRED_FACTS) return [];

  // Throttle: check if we ran recently
  const activeFacts = allFacts.filter(f => !f.valid_until);
  const recentRun = activeFacts
    .filter(f => f.source === HISTORICAL_SOURCE)
    .sort((a, b) => (b.learned_at ?? '').localeCompare(a.learned_at ?? ''))[0];
  if (recentRun?.learned_at) {
    const age = Date.now() - new Date(recentRun.learned_at).getTime();
    if (age < WEEKLY_MS) {
      // Return cached patterns from fact store
      return activeFacts
        .filter(f => f.source === HISTORICAL_SOURCE)
        .map(f => {
          try { return JSON.parse(f.statement) as PatternInsight; } catch { return null; }
        })
        .filter((p): p is PatternInsight => p !== null);
    }
  }

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Build a chronological fact timeline for the Haiku model
    const timeline = allFacts
      .filter(f => f.category === 'goal' || f.category === 'preference' || f.category === 'project')
      .map(f =>
        `[${f.learned_at?.slice(0, 10) ?? 'unknown'}] [${f.category}${f.entity ? ` | ${f.entity}` : ''}] ${f.statement}${f.valid_until ? ` (retired ${f.valid_until.slice(0, 10)})` : ' (active)'}`
      )
      .join('\n');

    if (!timeline.trim()) return [];

    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `You are analyzing a user's fact history to detect meaningful behavioral patterns.
Below is a chronological timeline of their goals, preferences, and projects — including facts that were later retired (overwritten).

FACT TIMELINE:
${timeline.slice(0, 2500)}

Identify at most 2 clear, honest patterns from this history. Only report what the data actually shows.
Return a JSON array (or [] if no clear pattern): each item must match exactly:
{"type":"commitment_follow_through"|"priority_drift","summary":"<one plain-English sentence, specific>","confidence":"high"|"medium","sampleDays":<number of evidence points>}
- "commitment_follow_through": pattern in which stated commitments or goals were kept vs frequently revised
- "priority_drift": pattern in how often/quickly stated priorities change direction
Only return patterns where you have ≥3 data points and the pattern is genuinely informative (not "user has goals").
Return [] if no clear pattern exists.`,
      }],
    });

    const raw = res.content
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { type: string; text?: string }) => b.text ?? '')
      .join('')
      .trim();

    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];

    const patterns = JSON.parse(match[0]) as PatternInsight[];
    const valid = patterns.filter(
      p => (p.type === 'commitment_follow_through' || p.type === 'priority_drift') &&
           typeof p.summary === 'string' && p.summary.length > 0 &&
           (p.confidence === 'high' || p.confidence === 'medium') &&
           typeof p.sampleDays === 'number',
    ).slice(0, 2);

    // Retire any existing historical-pattern facts first
    for (const old of activeFacts.filter(f => f.source === HISTORICAL_SOURCE)) {
      factQueries.retire(userId, old.id);
    }

    // Store each pattern as a fact row (serialized JSON) so it persists across briefings
    for (const p of valid) {
      factQueries.upsertFact(userId, 'fact', JSON.stringify(p), `pattern:${p.type}`, 'high');
    }

    if (valid.length > 0) {
      console.log(`[factPatterns] Stored ${valid.length} historical patterns for user ${userId}`);
    }
    return valid;
  } catch (err) {
    console.error('[factPatterns] runHistoricalPatternDetection failed:', err);
    return [];
  }
}

/**
 * Read already-computed historical patterns from the fact store (no API call).
 * Call this from the briefing synchronous block — never blocks.
 */
export function getHistoricalPatterns(userId: number): PatternInsight[] {
  try {
    return factQueries.getAll(userId)
      .filter(f => f.source === HISTORICAL_SOURCE)
      .map(f => {
        try { return JSON.parse(f.statement) as PatternInsight; } catch { return null; }
      })
      .filter((p): p is PatternInsight => p !== null);
  } catch {
    return [];
  }
}
