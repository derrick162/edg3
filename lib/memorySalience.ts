// Memory Salience — Core-owned.
//
// Scores each fact by multiple signals so the most meaningful context
// surfaces first in briefings and focus recommendations.
// Pure — no I/O, no LLM calls.

import type { Fact } from './db';

export interface ScoredFact extends Fact {
  score: number;        // 0–1, higher = more salient
  scoreBreakdown: {
    recency:       number;  // 0–1
    type:          number;  // 0–1
    confidence:    number;  // 0–1
    reinforcement: number;  // 0–1
    relevance:     number;  // 0–1
  };
}

// ─── Category weights ─────────────────────────────────────────────────────────
// Higher-consequence categories score higher.
const CATEGORY_WEIGHTS: Record<Fact['category'], number> = {
  goal:       0.9,
  project:    0.8,
  person:     0.7,
  pattern:    0.6,  // derived behavioral insight — meaningful signal, below directly-stated facts
  fact:       0.5,
  preference: 0.4,
  commitment: 0.3,  // R34 — time-bound; surfaced by its own briefing block, not general salience
  weekly_summary:   0.85, // M4-5 — synthesized cross-call narrative, high signal
  lifetime_profile: 1.0,  // M4-5 — the most stable, highest-signal context Edge has
};

// Bonus for facts that touch high-stakes domains, regardless of category.
const HIGH_STAKES_RE = /\b(money|debt|loan|payment|legal|lawsuit|contract|health|medical|cancer|surgery|diagnosis|revenue|investor|funding|equity|tax|irs|bankruptcy)\b/i;

// ─── Tokenizer ────────────────────────────────────────────────────────────────
const STOP = new Set(['the','a','an','and','or','is','are','was','were','in','of','to','at','for','on','by','with','from','that','this','has','have','had','will','can','not','i','he','she','they','we','you','it','be','been','do','did','as','but','so']);

function tokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP.has(w));
}

function overlap(a: string[], b: string[]): number {
  const setB = new Set(b);
  return a.filter(w => setB.has(w)).length;
}

// ─── Recency score ────────────────────────────────────────────────────────────
// Full weight for the past week; linear decay to 0 at 90 days.
function recencyScore(learnedAt: string, today: string): number {
  const ms = Date.parse(today) - Date.parse(learnedAt);
  if (isNaN(ms) || ms < 0) return 1;
  const days = ms / 86_400_000;
  return Math.max(0, 1 - days / 90);
}

// ─── Reinforcement score ──────────────────────────────────────────────────────
// Count of OTHER facts that share the same entity (exact match) OR have
// ≥ 2 token overlaps with this fact. Normalized: 5+ reinforcements → 1.0.
function reinforcementScore(fact: Fact, allFacts: Fact[]): number {
  const factTokens = tokenize((fact.entity ?? '') + ' ' + fact.statement);
  let count = 0;
  for (const other of allFacts) {
    if (other.id === fact.id) continue;
    if (fact.entity && other.entity &&
        fact.entity.toLowerCase() === other.entity.toLowerCase()) {
      count++;
      continue;
    }
    const otherTokens = tokenize((other.entity ?? '') + ' ' + other.statement);
    if (overlap(factTokens, otherTokens) >= 2) count++;
  }
  return Math.min(1, count / 5);
}

// ─── Relevance score ──────────────────────────────────────────────────────────
// Keyword overlap between this fact and the user's stated focus areas.
function relevanceScore(fact: Fact, anchors: { text: string }[]): number {
  if (!anchors.length) return 0;
  const factTokens = tokenize((fact.entity ?? '') + ' ' + fact.statement);
  let matched = 0;
  for (const anchor of anchors) {
    const anchorTokens = tokenize(anchor.text);
    if (overlap(factTokens, anchorTokens) >= 1) matched++;
  }
  return matched > 0 ? 0.4 + 0.6 * Math.min(1, matched / anchors.length) : 0;
}

// ─── Main scorer ─────────────────────────────────────────────────────────────

const WEIGHTS = {
  recency:       0.25,
  type:          0.25,
  confidence:    0.15,
  reinforcement: 0.20,
  relevance:     0.15,
};

export function scoreFact(
  fact: Fact,
  allFacts: Fact[],
  anchors: { text: string }[],
  today: string,
): ScoredFact {
  const recency       = recencyScore(fact.learned_at, today);
  const typeBase      = CATEGORY_WEIGHTS[fact.category] ?? 0.5;
  const typeBonus     = HIGH_STAKES_RE.test(fact.statement) ? 0.15 : 0;
  const type          = Math.min(1, typeBase + typeBonus);
  const confidence    = fact.confidence === 'high' ? 1 : 0.5;
  const reinforcement = reinforcementScore(fact, allFacts);
  const relevance     = relevanceScore(fact, anchors);

  const score =
    recency       * WEIGHTS.recency +
    type          * WEIGHTS.type +
    confidence    * WEIGHTS.confidence +
    reinforcement * WEIGHTS.reinforcement +
    relevance     * WEIGHTS.relevance;

  return { ...fact, score, scoreBreakdown: { recency, type, confidence, reinforcement, relevance } };
}

// ─── Batch ranking ────────────────────────────────────────────────────────────

export function rankFacts(
  facts: Fact[],
  anchors: { text: string }[],
  today: string,
): ScoredFact[] {
  return facts
    .map(f => scoreFact(f, facts, anchors, today))
    .sort((a, b) => b.score - a.score);
}

// ─── Top-N filter for prompt injection ────────────────────────────────────────
// Returns top N ranked facts, split by category for diversity.
// Ensures at most `maxPerCategory` facts per category so no single
// category dominates the context window.
// M3-1: returns true for facts that should be excluded from auto-injection.
// Stale = older than 90 days AND not recently confirmed AND low confidence.
// Recently-confirmed old facts (user mentioned again → high confidence) are kept.
export function isStaleForBriefing(fact: Fact, today: string): boolean {
  if (recencyScore(fact.learned_at, today) > 0) return false; // < 90 days old
  if ((fact as Fact & { confidence_score?: number }).confidence_score !== undefined &&
      (fact as Fact & { confidence_score?: number }).confidence_score! >= 0.7) return false; // confirmed recently
  const lastConfirmed = (fact as Fact & { last_confirmed_at?: string | null }).last_confirmed_at;
  if (lastConfirmed && recencyScore(lastConfirmed, today) > 0) return false; // confirmed in last 90 days
  return true; // stale: old + unconfirmed + low confidence
}

export function topFacts(
  facts: Fact[],
  anchors: { text: string }[],
  today: string,
  opts: { max?: number; maxPerCategory?: number; filterStale?: boolean } = {},
): ScoredFact[] {
  const { max = 20, maxPerCategory = 6, filterStale = false } = opts;
  // M3-1: hard-cutoff for stale facts in default briefing context.
  // Facts >90 days old with no recent confirmation are excluded from auto-injection.
  // They remain in the DB and can be retrieved on-demand via searchMemory (M3-2).
  const scored = filterStale
    ? rankFacts(facts, anchors, today).filter(f => !isStaleForBriefing(f, today))
    : rankFacts(facts, anchors, today);

  const catCount: Record<string, number> = {};
  const result: ScoredFact[] = [];

  for (const f of scored) {
    if (result.length >= max) break;
    const cat = f.category;
    catCount[cat] = (catCount[cat] ?? 0);
    if (catCount[cat] >= maxPerCategory) continue;
    catCount[cat]++;
    result.push(f);
  }

  return result;
}
