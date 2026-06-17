// Pure: deterministic pre-pass for correcting STT-garbled proper nouns in transcripts.
//
// Two-tier approach:
//   Tier 1 (this file) — phonetic normalization + edit distance ≤ 1. Zero API cost.
//     Catches: "Gym" → "Jim" (homophones), "Onsi" → "Ansi" (1-char vowel shift).
//   Tier 2 (facts.ts knownNamesLine) — Haiku model hint.
//     Handles harder phonetic cases: "Pfizer" → "Faiza" (large edit distance but sounds alike).

/** Levenshtein edit distance between two strings (pure character comparison). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const m = a.length, n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);

  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }

  return dp[n];
}

/**
 * Normalize common STT phonetic confusion patterns before edit-distance comparison.
 * "gym" → "jim" (homophones: /dʒɪm/ rendered as "gym" by STT),
 * "ph" → "f",  "ck" → "k", etc.
 * Operates on lowercased strings.
 */
export function normalizeForPhonetics(s: string): string {
  return s
    .replace(/\bgy/, 'ji')  // gym → jim  (STT hears /dʒɪm/, types "gym")
    .replace(/ph/g, 'f')    // phone → fone
    .replace(/ck/g, 'k')    // back → bak (length-preserving is not the goal; distance is)
    .replace(/\bpf/, 'f')   // pfizer → fizer (reduces distance to "faiza" slightly)
    .replace(/qu/g, 'kw');  // queen → kween
}

// Prepositions/articles that precede location nouns, not person names.
// Candidate tokens immediately following these are skipped.
const SKIP_PRECEDING = new Set([
  'the', 'a', 'an', 'at', 'to', 'into', 'from', 'in', 'by', 'near', 'of', 'and', 'or',
]);

/**
 * Pre-correct STT-garbled proper nouns in `text` using a list of canonical names.
 *
 * Rules:
 * - Only considers words that are capitalized and ≥ 3 characters (potential proper nouns).
 * - Applies phonetic normalization before comparing, then replaces when normalized edit
 *   distance ≤ 1. This catches homophones like Gym/Jim (edit distance 2 raw, 0 normalized).
 * - Skips replacement when the immediately preceding word is an article/preposition
 *   (e.g. "the Gym" is likely the fitness center, not a person named "Jim").
 * - Preserves possessives ("Gym's" → "Jim's").
 * - Never replaces an already-correct spelling (exact match short-circuits).
 *
 * Pure — no I/O, no side effects.
 */
export function groundProperNouns(text: string, canonicalNames: string[]): string {
  if (!text || !canonicalNames.length) return text;

  const normCanonicals = canonicalNames
    .map(n => n.trim())
    .filter(n => n.length >= 3)
    .map(n => ({ original: n, lower: n.toLowerCase(), phonetic: normalizeForPhonetics(n.toLowerCase()) }));

  if (!normCanonicals.length) return text;

  // Match capitalized words (≥ 3 lowercase letters after the capital), optionally with 's.
  return text.replace(/\b([A-Z][a-z]{2,})('s)?\b/g, (full, word, possessive = '', offset: number) => {
    // Find the word immediately before this match to detect article/preposition context.
    const before = text.slice(0, offset).match(/\b(\w+)\s*$/);
    if (before && SKIP_PRECEDING.has(before[1].toLowerCase())) return full;

    const wordLower = word.toLowerCase();
    const wordPhonetic = normalizeForPhonetics(wordLower);
    let bestMatch: string | null = null;
    let bestDist = 2; // threshold: accept normalized distance ≤ 1

    for (const { original, lower, phonetic } of normCanonicals) {
      if (lower === wordLower) return full; // already the canonical spelling — no-op
      const dist = editDistance(wordPhonetic, phonetic);
      if (dist < bestDist) {
        bestDist = dist;
        bestMatch = original;
      }
    }

    return bestMatch !== null ? bestMatch + possessive : full;
  });
}

/**
 * Extract proper-noun tokens from a user profile name for use as canonical names.
 * "Derrick Fung" → ["Derrick", "Fung"]. Tokens < 3 characters are skipped (too
 * short for safe phonetic matching). Deduplicates automatically.
 * Pure — no I/O.
 */
export function canonicalNamesFromProfile(userName: string): string[] {
  if (!userName) return [];
  return [
    ...new Set(
      userName
        .split(/\s+/)
        .map(t => t.replace(/[^a-zA-Z]/g, ''))
        .filter(t => t.length >= 3)
    ),
  ];
}

// Words stripped when extracting person names from calendar event titles.
const EVENT_STOP_WORDS = new Set([
  'with', 'and', 'the', 'or', 'for', 'from', 'a', 'an',
  'meeting', 'call', 'sync', 'chat', 'catch', 'up', 'intro',
  'check', 'in', 'review', 'debrief', 'session', 'update',
  'weekly', 'daily', 'monthly', 'quarterly', 'annual',
  'standup', 'standby', 'followup', 'prep', 'planning',
  'strategy', 'team', 'all', 'hands', 'kickoff',
  // Generic productivity/calendar terms unlikely to be person names:
  'focus', 'block', 'deep', 'work', 'time', 'office', 'break',
  'lunch', 'dinner', 'breakfast', 'gym', 'workout', 'travel', 'commute',
]);

/**
 * Extract candidate person names from a list of calendar event titles.
 * Strips common meeting prefixes and stop words; returns capitalized tokens ≥ 2 chars.
 * Used to build a canonical-names list for `groundProperNouns`.
 *
 * Pure — no I/O.
 */
export function extractNamesFromEventTitles(titles: string[]): string[] {
  const names: string[] = [];

  for (const title of titles) {
    const cleaned = title
      .replace(/^⚡\s*/, '')
      .replace(/^(call|meeting|sync|chat|1:1|1on1)\s+(with\s+)?/i, '')
      .trim();

    for (const chunk of cleaned.split(/[\s\-\/|:,;()+]+/)) {
      const bare = chunk.replace(/[^a-zA-Z]/g, '');
      if (
        bare.length >= 2 &&
        /^[A-Z]/.test(bare) &&
        !EVENT_STOP_WORDS.has(bare.toLowerCase())
      ) {
        names.push(bare);
      }
    }
  }

  return [...new Set(names)];
}
