import { describe, it, expect } from 'vitest';
import { detectTranscriptSignals } from './transcriptSignals';

describe('detectTranscriptSignals (R41 T1)', () => {
  it('counts hesitation markers per 100 user words (user turns only)', () => {
    const t = [
      'User: Um, I think, like, the plan is, you know, sort of working out.',
      'AI: That sounds great — um, tell me more.',  // assistant hesitations must NOT count
    ].join('\n');
    const s = detectTranscriptSignals(t);
    // user words ~12; markers: um, like, you know, sort of = 4 → ~33/100
    expect(s.hesitationDensity).toBeGreaterThan(20);
  });

  it('extracts explicit emotional states with their topic', () => {
    const t = 'User: I\'m really stressed about fundraising, but I feel good about the product.';
    const s = detectTranscriptSignals(t);
    expect(s.explicitStateDeclarations).toContainEqual({ topic: 'fundraising', state: 'stressed' });
    expect(s.explicitStateDeclarations).toContainEqual({ topic: 'the product', state: 'good' });
  });

  it('computes question density (user questions ÷ user sentences)', () => {
    const t = 'User: What should I do first? I have three things. Can you help me prioritize?';
    const s = detectTranscriptSignals(t);
    // 3 sentences, 2 questions → ~0.67
    expect(s.questionDensity).toBeGreaterThan(0.5);
    expect(s.questionDensity).toBeLessThanOrEqual(1);
  });

  it('returns zeroed signals for an empty transcript', () => {
    expect(detectTranscriptSignals('')).toEqual({ hesitationDensity: 0, explicitStateDeclarations: [], questionDensity: 0 });
  });

  it('treats a transcript with no role markers as all user text', () => {
    const s = detectTranscriptSignals('I am overwhelmed about the move and um, not sure where to start.');
    expect(s.explicitStateDeclarations).toContainEqual({ topic: 'the move', state: 'overwhelmed' });
    expect(s.hesitationDensity).toBeGreaterThan(0);
  });

  it('dedupes repeated identical state declarations', () => {
    const t = 'User: I am excited. I am excited! Really, I am excited.';
    const s = detectTranscriptSignals(t);
    expect(s.explicitStateDeclarations.filter(d => d.state === 'excited')).toHaveLength(1);
  });
});
