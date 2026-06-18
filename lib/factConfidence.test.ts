import { describe, it, expect } from 'vitest';
import {
  factConfidence,
  daysSinceConfirmed,
  isSensitiveFact,
  isUnverified,
  shouldHedge,
  selectReconfirmationFact,
  buildReconfirmationPromptBlock,
  UNVERIFIED_SCORE,
  HEDGE_SCORE,
  STALE_DAYS,
} from './factConfidence';
import type { Fact } from './db';

const TODAY = '2026-06-18';

function fact(overrides: Partial<Fact> = {}): Fact {
  return {
    id: 1,
    user_id: 1,
    category: 'goal',
    statement: 'Raising a 500K seed round',
    entity: null,
    learned_at: '2026-06-15',
    confidence: 'high',
    source_briefing_id: null,
    valid_from: '2026-06-15',
    valid_until: null,
    confidence_score: 1.0,
    last_confirmed_at: '2026-06-15',
    ...overrides,
  };
}

describe('factConfidence', () => {
  it('returns the score when present', () => {
    expect(factConfidence(fact({ confidence_score: 0.4 }))).toBe(0.4);
  });
  it('defaults to 1.0 when score is missing (legacy rows)', () => {
    expect(factConfidence({ confidence_score: undefined })).toBe(1.0);
  });
  it('defaults to 1.0 when score is NaN', () => {
    expect(factConfidence({ confidence_score: NaN })).toBe(1.0);
  });
});

describe('daysSinceConfirmed', () => {
  it('counts days from last_confirmed_at', () => {
    expect(daysSinceConfirmed(fact({ last_confirmed_at: '2026-06-08' }), TODAY)).toBe(10);
  });
  it('falls back to learned_at when last_confirmed_at is null', () => {
    expect(daysSinceConfirmed(fact({ last_confirmed_at: null, learned_at: '2026-06-01' }), TODAY)).toBe(17);
  });
  it('returns 0 for future / invalid dates', () => {
    expect(daysSinceConfirmed(fact({ last_confirmed_at: '2026-12-01' }), TODAY)).toBe(0);
  });
});

describe('isSensitiveFact', () => {
  it('flags health-related statements', () => {
    expect(isSensitiveFact({ statement: 'Started therapy last month' })).toBe(true);
    expect(isSensitiveFact({ statement: 'Targeting 135 pounds bodyweight' })).toBe(true);
  });
  it('does not flag normal business facts', () => {
    expect(isSensitiveFact({ statement: 'Raising a 500K seed round' })).toBe(false);
  });
});

describe('isUnverified', () => {
  it('true when confidence below 0.3', () => {
    expect(isUnverified(fact({ confidence_score: 0.2, last_confirmed_at: TODAY }), TODAY)).toBe(true);
  });
  it('true when not confirmed in 30+ days even if score high', () => {
    expect(isUnverified(fact({ confidence_score: 1.0, last_confirmed_at: '2026-05-01' }), TODAY)).toBe(true);
  });
  it('false when fresh and confident', () => {
    expect(isUnverified(fact({ confidence_score: 0.9, last_confirmed_at: '2026-06-15' }), TODAY)).toBe(false);
  });
  it('boundary: exactly STALE_DAYS old is unverified', () => {
    const d = new Date(Date.parse(TODAY) - STALE_DAYS * 86_400_000).toISOString().slice(0, 10);
    expect(isUnverified(fact({ confidence_score: 1.0, last_confirmed_at: d }), TODAY)).toBe(true);
  });
});

describe('shouldHedge', () => {
  it('hedges in the 0.3–0.5 band even when fresh', () => {
    expect(shouldHedge(fact({ confidence_score: 0.45, last_confirmed_at: TODAY }), TODAY)).toBe(true);
  });
  it('does not hedge a fresh high-confidence fact', () => {
    expect(shouldHedge(fact({ confidence_score: 0.95, last_confirmed_at: '2026-06-17' }), TODAY)).toBe(false);
  });
  it('uses the documented thresholds', () => {
    expect(UNVERIFIED_SCORE).toBe(0.3);
    expect(HEDGE_SCORE).toBe(0.5);
  });
});

describe('selectReconfirmationFact', () => {
  it('returns null when nothing is unverified', () => {
    const facts = [fact({ id: 1 }), fact({ id: 2, confidence_score: 0.8, last_confirmed_at: '2026-06-15' })];
    expect(selectReconfirmationFact(facts, TODAY)).toBeNull();
  });

  it('picks the lowest-confidence unverified fact', () => {
    const facts = [
      fact({ id: 1, confidence_score: 0.25, last_confirmed_at: TODAY, statement: 'A' }),
      fact({ id: 2, confidence_score: 0.1, last_confirmed_at: TODAY, statement: 'B' }),
      fact({ id: 3, confidence_score: 0.9, last_confirmed_at: TODAY, statement: 'C' }),
    ];
    expect(selectReconfirmationFact(facts, TODAY)?.id).toBe(2);
  });

  it('skips sensitive facts even if they are the lowest confidence', () => {
    const facts = [
      fact({ id: 1, confidence_score: 0.05, statement: 'Going through a divorce', last_confirmed_at: TODAY }),
      fact({ id: 2, confidence_score: 0.2, statement: 'Hiring a VP of Sales', last_confirmed_at: TODAY }),
    ];
    expect(selectReconfirmationFact(facts, TODAY)?.id).toBe(2);
  });

  it('ignores retired (valid_until set) facts', () => {
    const facts = [fact({ id: 1, confidence_score: 0.1, last_confirmed_at: TODAY, valid_until: '2026-06-10' })];
    expect(selectReconfirmationFact(facts, TODAY)).toBeNull();
  });

  it('breaks confidence ties by most-stale', () => {
    const facts = [
      fact({ id: 1, confidence_score: 0.2, last_confirmed_at: '2026-06-10', statement: 'A' }),
      fact({ id: 2, confidence_score: 0.2, last_confirmed_at: '2026-05-10', statement: 'B' }),
    ];
    expect(selectReconfirmationFact(facts, TODAY)?.id).toBe(2);
  });
});

describe('buildReconfirmationPromptBlock', () => {
  it('returns null for null fact', () => {
    expect(buildReconfirmationPromptBlock(null)).toBeNull();
  });
  it('includes the statement and a confirmation cue', () => {
    const block = buildReconfirmationPromptBlock(fact({ statement: 'Raising a 500K seed round', entity: null }));
    expect(block).toContain('Raising a 500K seed round');
    expect(block).toContain('RECONFIRM ONE FACT');
    expect(block?.toLowerCase()).toContain('still right');
  });
  it('prefixes the entity when present', () => {
    const block = buildReconfirmationPromptBlock(fact({ statement: 'is the CFO', entity: 'Sarah' }));
    expect(block).toContain('Sarah: is the CFO');
  });
});
