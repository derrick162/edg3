// R14 T5 — pure matcher for forgetFact: which active facts does a spoken topic refer to?
// Matches a fact when the topic overlaps its entity or statement. The handler retires
// all matches (bi-temporal retire — reversible, never hard-deleted).

import { normalizeTitle } from './eventMatch';

export interface ForgettableFact { id: number; entity: string | null; statement: string }

export function factsMatchingTopic<T extends ForgettableFact>(facts: T[], topic: string): T[] {
  // normalizeTitle strips ALL whitespace, so derive word tokens from the raw topic.
  const nTopic = normalizeTitle(topic || '');           // whole-phrase, no spaces
  if (!nTopic) return [];
  const topicWords = (topic || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4);
  return facts.filter(f => {
    const nEntity = normalizeTitle(f.entity ?? '');
    const nStmt = normalizeTitle(f.statement ?? '');
    if (nEntity && (nEntity.includes(nTopic) || nTopic.includes(nEntity))) return true;
    if (nStmt.includes(nTopic)) return true;
    // Token overlap: a meaningful topic word (≥4 chars) appearing in entity/statement.
    return topicWords.some(w => nEntity.includes(w) || nStmt.includes(w));
  });
}
