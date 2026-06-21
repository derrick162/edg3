import { describe, it, expect } from 'vitest';
import { factsMatchingTopic, type ForgettableFact } from './factForget';

const facts: ForgettableFact[] = [
  { id: 1, entity: 'home address', statement: 'Lives at 123 Main St' },
  { id: 2, entity: 'gym', statement: 'Prefers boutique gyms over chains' },
  { id: 3, entity: 'wake time', statement: 'Wakes up at 6am' },
  { id: 4, entity: 'Faiza', statement: 'Investor at CIBC' },
];

describe('factsMatchingTopic (R14 T5)', () => {
  it('matches by entity substring', () => {
    expect(factsMatchingTopic(facts, 'home address').map(f => f.id)).toEqual([1]);
  });

  it('matches by topic word appearing in the statement', () => {
    expect(factsMatchingTopic(facts, 'where I live').map(f => f.id)).toContain(1); // "live" → "Lives at"
  });

  it('matches a single-word topic against the entity', () => {
    expect(factsMatchingTopic(facts, 'gym').map(f => f.id)).toEqual([2]);
  });

  it('returns [] when nothing matches', () => {
    expect(factsMatchingTopic(facts, 'favorite color')).toEqual([]);
  });

  it('empty topic → no matches', () => {
    expect(factsMatchingTopic(facts, '')).toEqual([]);
  });

  it('can match multiple facts sharing a topic word', () => {
    const two: ForgettableFact[] = [
      { id: 1, entity: 'wake time', statement: 'Wakes at 6' },
      { id: 2, entity: 'morning routine', statement: 'Walks after waking' },
    ];
    expect(factsMatchingTopic(two, 'wake').map(f => f.id)).toEqual([1]);
  });
});
