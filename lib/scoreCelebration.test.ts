import { describe, it, expect } from 'vitest';
import { shouldCelebrateScoreRise, SCORE_RISE_THRESHOLD } from './scoreCelebration';

describe('shouldCelebrateScoreRise (R25 T7 Part B)', () => {
  it('celebrates when the score rose ≥ threshold and is above the last seen score', () => {
    // 54 → 60 (the reported scenario): +6 over prior, and higher than anything seen before.
    expect(shouldCelebrateScoreRise({ edgeScore: 60, priorScore: 54, lastSeen: 0 })).toBe(true);
  });

  it('does not celebrate a rise below the threshold', () => {
    expect(shouldCelebrateScoreRise({ edgeScore: 56, priorScore: 54, lastSeen: 0 })).toBe(false);
    // exactly threshold-1 is still below
    expect(shouldCelebrateScoreRise({ edgeScore: 54 + SCORE_RISE_THRESHOLD - 1, priorScore: 54, lastSeen: 0 })).toBe(false);
  });

  it('fires exactly at the threshold boundary', () => {
    expect(shouldCelebrateScoreRise({ edgeScore: 54 + SCORE_RISE_THRESHOLD, priorScore: 54, lastSeen: 0 })).toBe(true);
  });

  it('does not replay once the rise has already been celebrated (lastSeen ≥ current)', () => {
    // Same score on a refresh later in the day — already celebrated at 60.
    expect(shouldCelebrateScoreRise({ edgeScore: 60, priorScore: 54, lastSeen: 60 })).toBe(false);
  });

  it('does not celebrate when prior or current score is missing', () => {
    expect(shouldCelebrateScoreRise({ edgeScore: 60, priorScore: null, lastSeen: 0 })).toBe(false);
    expect(shouldCelebrateScoreRise({ edgeScore: null, priorScore: 54, lastSeen: 0 })).toBe(false);
    expect(shouldCelebrateScoreRise({ edgeScore: undefined, priorScore: undefined, lastSeen: 0 })).toBe(false);
  });

  it('does not celebrate a score drop', () => {
    expect(shouldCelebrateScoreRise({ edgeScore: 48, priorScore: 54, lastSeen: 0 })).toBe(false);
  });
});
