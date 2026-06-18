// Fact confidence + reconfirmation logic (M4-1 / Round 6 Ticket 2).
//
// Security's weekly decay job (lib/scheduler.ts) lowers `confidence_score` on active
// facts over time; `last_confirmed_at` records when a fact was last verified. This module
// is the Core-side consumer: it decides which facts Edge should HEDGE ("last I heard…")
// and which single fact is worth a gentle RECONFIRMATION question on the call.
//
// Pure + zero-I/O — fully unit-testable. Degrades safely when the confidence columns are
// absent (legacy fixtures / pre-migration rows): a missing score is treated as fully
// confident (1.0) and a missing last_confirmed_at falls back to learned_at.

import type { Fact } from './db';

// Thresholds (from the Round 6 dispatch):
//  < 0.3 confidence  → unverified → eligible for a reconfirmation question
//  < 0.5 confidence  → hedge ("last I heard…") but don't necessarily ask
//  > 0.9 confidence  → state confidently, no hedge
export const UNVERIFIED_SCORE = 0.3;
export const HEDGE_SCORE = 0.5;
// Recency fallback (Esther's framing): a fact not confirmed in 30+ days is also stale,
// independent of the decay job — covers the case where decay categories don't align yet.
export const STALE_DAYS = 30;

// Categories/topics where asking "is that still true?" out loud would feel intrusive.
// These get flagged for dashboard surfacing instead of a spoken reconfirmation.
const SENSITIVE_KEYWORDS = [
  'health', 'illness', 'sick', 'diagnos', 'therapy', 'therapist', 'medication', 'depress',
  'anxiety', 'mental health', 'divorce', 'breakup', 'broke up', 'death', 'died', 'grief',
  'funeral', 'weight', 'salary', 'debt', 'fired', 'laid off',
];

/** Effective confidence score for a fact. Missing column → fully confident (1.0). */
export function factConfidence(fact: Pick<Fact, 'confidence_score'>): number {
  const s = fact.confidence_score;
  return typeof s === 'number' && !isNaN(s) ? s : 1.0;
}

/** Days since the fact was last confirmed (or learned, if never explicitly confirmed). */
export function daysSinceConfirmed(
  fact: Pick<Fact, 'last_confirmed_at' | 'learned_at'>,
  today: string,
): number {
  const ref = fact.last_confirmed_at || fact.learned_at;
  if (!ref) return 0;
  const ms = Date.parse(today) - Date.parse(ref);
  if (isNaN(ms) || ms < 0) return 0;
  return Math.floor(ms / 86_400_000);
}

/** True if the fact's statement touches a sensitive topic we shouldn't probe aloud. */
export function isSensitiveFact(fact: Pick<Fact, 'statement'>): boolean {
  const s = (fact.statement || '').toLowerCase();
  return SENSITIVE_KEYWORDS.some(k => s.includes(k));
}

/** Unverified = low confidence OR not confirmed in a long time. Reconfirmation candidate. */
export function isUnverified(
  fact: Pick<Fact, 'confidence_score' | 'last_confirmed_at' | 'learned_at'>,
  today: string,
): boolean {
  return factConfidence(fact) < UNVERIFIED_SCORE || daysSinceConfirmed(fact, today) >= STALE_DAYS;
}

/** Should this fact be hedged ("last I heard…") rather than stated as current truth? */
export function shouldHedge(
  fact: Pick<Fact, 'confidence_score' | 'last_confirmed_at' | 'learned_at'>,
  today: string,
): boolean {
  return factConfidence(fact) < HEDGE_SCORE || daysSinceConfirmed(fact, today) >= STALE_DAYS;
}

// How much each category is worth reconfirming aloud. A stale GOAL ("still targeting 500K?")
// makes the call far sharper than a stale trivia fact, so weight the question toward facts
// that actually change and matter day-to-day. Lower number = higher priority.
const CATEGORY_PRIORITY: Record<Fact['category'], number> = {
  goal: 0,
  project: 1,
  preference: 2,
  person: 3,
  fact: 4,
};

/**
 * Pick the single best fact to reconfirm on the call, or null if none qualifies.
 * Ranks by category importance (goals first), then lowest confidence, then most stale.
 * Never returns a sensitive fact (those route to dashboard surfacing instead).
 */
export function selectReconfirmationFact(facts: Fact[], today: string): Fact | null {
  const candidates = facts.filter(f =>
    (f.valid_until == null) &&          // active only
    isUnverified(f, today) &&
    !isSensitiveFact(f) &&
    f.statement?.trim().length > 0,
  );
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const pa = CATEGORY_PRIORITY[a.category] ?? 9, pb = CATEGORY_PRIORITY[b.category] ?? 9;
    if (pa !== pb) return pa - pb;                 // most-important category first
    const ca = factConfidence(a), cb = factConfidence(b);
    if (ca !== cb) return ca - cb;                 // then lowest confidence
    return daysSinceConfirmed(b, today) - daysSinceConfirmed(a, today); // then most stale
  });
  return candidates[0];
}

/**
 * Build the briefing-prompt instruction for the chosen reconfirmation fact.
 * Returns null when there's nothing to reconfirm. One question, woven in naturally.
 */
export function buildReconfirmationPromptBlock(fact: Fact | null): string | null {
  if (!fact) return null;
  const subject = fact.entity ? `${fact.entity}: ${fact.statement}` : fact.statement;
  return `RECONFIRM ONE FACT (it's been a while since this was verified — don't state it as current truth): "${subject}". Fold a SHORT inline check into the moment this fact is naturally relevant (Part 1 or 2) — e.g. "Last I heard ${lowerFirst(fact.statement)} — still right?" Keep it to a half-sentence; this does NOT replace or duplicate the Part 3 closing question, and it is the ONLY fact you re-verify this call. If it's not naturally relevant to today, skip it rather than forcing it in.`;
}

function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
