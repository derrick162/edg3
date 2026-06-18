import { describe, it, expect } from 'vitest';
import { scoreFact, rankFacts, topFacts } from './memorySalience';
import type { Fact } from './db';

const TODAY = '2026-06-15';

function fact(overrides: Partial<Fact> & { statement: string }): Fact {
  return {
    id: 1,
    user_id: 1,
    category: 'fact',
    entity: null,
    learned_at: TODAY,
    confidence: 'high',
    source_briefing_id: null,
    source: null,
    ...overrides,
  };
}

// ── scoreFact — recency ───────────────────────────────────────────────────────

describe('scoreFact — recency', () => {
  it('scores 1.0 for a fact learned today', () => {
    const f = fact({ statement: 'Has CIBC meeting' });
    const s = scoreFact(f, [f], [], TODAY);
    expect(s.scoreBreakdown.recency).toBeCloseTo(1, 5);
  });

  it('scores ~0.5 at 45 days old', () => {
    const f = fact({ statement: 'Gym at 7am', learned_at: '2026-05-01' });
    const s = scoreFact(f, [f], [], TODAY);
    // 45 days → 1 - 45/90 = 0.5
    expect(s.scoreBreakdown.recency).toBeCloseTo(0.5, 1);
  });

  it('scores 0 at 90 days old', () => {
    const f = fact({ statement: 'Old note', learned_at: '2026-03-17' });
    const s = scoreFact(f, [f], [], TODAY);
    expect(s.scoreBreakdown.recency).toBeCloseTo(0, 1);
  });
});

// ── scoreFact — type/consequence ─────────────────────────────────────────────

describe('scoreFact — type', () => {
  it('goal category scores 0.9', () => {
    const f = fact({ category: 'goal', statement: 'Ship the onboarding flow this sprint' });
    const s = scoreFact(f, [f], [], TODAY);
    expect(s.scoreBreakdown.type).toBeCloseTo(0.9, 5);
  });

  it('preference category scores 0.4', () => {
    const f = fact({ category: 'preference', statement: 'Likes dark mode' });
    const s = scoreFact(f, [f], [], TODAY);
    expect(s.scoreBreakdown.type).toBeCloseTo(0.4, 5);
  });

  it('financial keyword adds bonus (capped at 1)', () => {
    const f = fact({ category: 'fact', statement: 'Debt payment due to CIBC' });
    const s = scoreFact(f, [f], [], TODAY);
    // category='fact' base=0.5, bonus=0.15 → 0.65
    expect(s.scoreBreakdown.type).toBeCloseTo(0.65, 5);
  });

  it('health keyword adds bonus', () => {
    const f = fact({ category: 'preference', statement: 'Had surgery last year' });
    const s = scoreFact(f, [f], [], TODAY);
    expect(s.scoreBreakdown.type).toBeCloseTo(0.55, 5);
  });
});

// ── scoreFact — confidence ────────────────────────────────────────────────────

describe('scoreFact — confidence', () => {
  it('high confidence scores 1.0', () => {
    const f = fact({ statement: 'Works at CIBC', confidence: 'high' });
    expect(scoreFact(f, [f], [], TODAY).scoreBreakdown.confidence).toBe(1);
  });

  it('low confidence scores 0.5', () => {
    const f = fact({ statement: 'Maybe a lawyer', confidence: 'low' });
    expect(scoreFact(f, [f], [], TODAY).scoreBreakdown.confidence).toBe(0.5);
  });
});

// ── scoreFact — reinforcement ─────────────────────────────────────────────────

describe('scoreFact — reinforcement', () => {
  it('scores 0 when no other facts overlap', () => {
    const f = fact({ id: 1, statement: 'Likes jazz music in evenings' });
    const other = fact({ id: 2, statement: 'Has a cat named Whiskers' });
    expect(scoreFact(f, [f, other], [], TODAY).scoreBreakdown.reinforcement).toBe(0);
  });

  it('counts facts sharing the same entity', () => {
    const f1 = fact({ id: 1, entity: 'Faiza', statement: 'Decision-maker at CIBC' });
    const f2 = fact({ id: 2, entity: 'Faiza', statement: 'Sent proposal last week' });
    const f3 = fact({ id: 3, entity: 'Faiza', statement: 'Wants answer by Friday' });
    const all = [f1, f2, f3];
    // f1 has 2 others with same entity → reinforcement = min(1, 2/5) = 0.4
    expect(scoreFact(f1, all, [], TODAY).scoreBreakdown.reinforcement).toBeCloseTo(0.4, 5);
  });

  it('caps reinforcement at 1.0 with 5+ overlapping facts', () => {
    const base = fact({ id: 1, entity: 'CIBC', statement: 'CIBC negotiation ongoing' });
    const others = Array.from({ length: 6 }, (_, i) =>
      fact({ id: i + 2, entity: 'CIBC', statement: `CIBC update ${i}` }),
    );
    const all = [base, ...others];
    expect(scoreFact(base, all, [], TODAY).scoreBreakdown.reinforcement).toBe(1);
  });

  it('counts token overlap (>=2 shared tokens) as reinforcement', () => {
    const f1 = fact({ id: 1, statement: 'CIBC fundraising round closing soon' });
    const f2 = fact({ id: 2, statement: 'CIBC fundraising deal terms sent' });
    // 'cibc' + 'fundraising' = 2 overlaps → counts
    const all = [f1, f2];
    expect(scoreFact(f1, all, [], TODAY).scoreBreakdown.reinforcement).toBeGreaterThan(0);
  });
});

// ── scoreFact — relevance ─────────────────────────────────────────────────────

describe('scoreFact — relevance', () => {
  it('scores 0 when no anchors provided', () => {
    const f = fact({ statement: 'Fundraising round closing' });
    expect(scoreFact(f, [f], [], TODAY).scoreBreakdown.relevance).toBe(0);
  });

  it('scores > 0 when statement overlaps an anchor', () => {
    const f = fact({ statement: 'Fundraising round closing this quarter' });
    const anchors = [{ text: 'Close fundraising round' }];
    expect(scoreFact(f, [f], anchors, TODAY).scoreBreakdown.relevance).toBeGreaterThan(0);
  });

  it('scores higher with more matching anchors (proportional)', () => {
    // Fact overlaps only 'weight' anchor, not 'runway' anchor
    const f = fact({ statement: 'Weight training session this week' });
    const oneAnchor  = [{ text: 'Get to 135 lbs weight goal' }];
    // Two anchors: fact matches 1/2 → score uses matched/len denominator
    const twoAnchors = [{ text: 'Get to 135 lbs weight goal' }, { text: 'Improve runway' }];
    const s1 = scoreFact(f, [f], oneAnchor, TODAY).scoreBreakdown.relevance;  // 1/1 → 1.0
    const s2 = scoreFact(f, [f], twoAnchors, TODAY).scoreBreakdown.relevance; // 1/2 → 0.7
    // s1 > s2 because same matches but denominator is smaller
    expect(s1).toBeGreaterThan(s2);
  });
});

// ── rankFacts ─────────────────────────────────────────────────────────────────

describe('rankFacts', () => {
  it('sorts by score descending', () => {
    const recent = fact({ id: 1, category: 'goal', statement: 'Fundraising round imminent', learned_at: TODAY });
    const old    = fact({ id: 2, category: 'preference', statement: 'Likes jazz music', learned_at: '2026-01-01' });
    const ranked = rankFacts([old, recent], [], TODAY);
    expect(ranked[0].id).toBe(1);
  });

  it('returns all facts even when one scores poorly', () => {
    const facts = [
      fact({ id: 1, statement: 'Important goal', category: 'goal' }),
      fact({ id: 2, statement: 'Minor pref', category: 'preference', learned_at: '2026-01-01' }),
    ];
    expect(rankFacts(facts, [], TODAY)).toHaveLength(2);
  });
});

// ── topFacts ──────────────────────────────────────────────────────────────────

describe('topFacts', () => {
  it('limits to max (with sufficient per-category allowance)', () => {
    const facts = Array.from({ length: 30 }, (_, i) => fact({ id: i, statement: `item ${i}` }));
    expect(topFacts(facts, [], TODAY, { max: 10, maxPerCategory: 10 })).toHaveLength(10);
  });

  it('limits per category', () => {
    const facts = Array.from({ length: 20 }, (_, i) =>
      fact({ id: i, category: 'preference', statement: `pref ${i}` }),
    );
    const result = topFacts(facts, [], TODAY, { max: 20, maxPerCategory: 4 });
    const prefs = result.filter(f => f.category === 'preference');
    expect(prefs.length).toBeLessThanOrEqual(4);
  });

  it('returns empty for empty input', () => {
    expect(topFacts([], [], TODAY)).toEqual([]);
  });

  it('M3-1 filterStale: excludes facts older than 90 days when filterStale=true', () => {
    const fresh = fact({ id: 1, statement: 'Recent goal', category: 'goal', learned_at: TODAY });
    const stale = fact({ id: 2, statement: 'Old pref', category: 'preference', learned_at: '2025-01-01' }); // >90 days ago
    const result = topFacts([fresh, stale], [], TODAY, { filterStale: true });
    expect(result.map(f => f.id)).toContain(1);
    expect(result.map(f => f.id)).not.toContain(2);
  });

  it('M3-1 filterStale: includes stale facts when filterStale=false (default)', () => {
    const stale = fact({ id: 2, statement: 'Old pref', category: 'preference', learned_at: '2025-01-01' });
    const result = topFacts([stale], [], TODAY, { filterStale: false });
    expect(result).toHaveLength(1);
  });

  it('M3-1 filterStale: fact exactly at 90-day boundary has recency 0 and is excluded', () => {
    // 90 days before TODAY (2026-06-15) = 2026-03-17
    const boundaryFact = fact({ id: 3, statement: 'Old goal', category: 'goal', learned_at: '2026-03-17' });
    const result = topFacts([boundaryFact], [], TODAY, { filterStale: true });
    expect(result).toHaveLength(0);
  });
});
