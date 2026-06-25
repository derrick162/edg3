import { describe, it, expect } from 'vitest';
import { buildOpenCommitmentsBlock, pickContinuitySource } from './briefing';

const NOW = new Date('2026-06-24T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe('buildOpenCommitmentsBlock (R34 T1)', () => {
  it('surfaces a recent commitment as a "did that happen?" line', () => {
    const out = buildOpenCommitmentsBlock(
      [{ category: 'commitment', statement: 'tackle the Railway fix today', learned_at: hoursAgo(20) }],
      NOW,
    );
    expect(out).toContain('tackle the Railway fix today');
    expect(out).toContain('did that happen?');
  });

  it('ignores non-commitment categories', () => {
    const out = buildOpenCommitmentsBlock(
      [{ category: 'goal', statement: 'reach 135 lbs', learned_at: hoursAgo(10) }],
      NOW,
    );
    expect(out).toBeNull();
  });

  it('drops commitments older than 72h', () => {
    const out = buildOpenCommitmentsBlock(
      [{ category: 'commitment', statement: 'old promise', learned_at: hoursAgo(80) }],
      NOW,
    );
    expect(out).toBeNull();
  });

  it('caps at 2 (most recent first)', () => {
    const out = buildOpenCommitmentsBlock([
      { category: 'commitment', statement: 'first', learned_at: hoursAgo(60) },
      { category: 'commitment', statement: 'second', learned_at: hoursAgo(40) },
      { category: 'commitment', statement: 'third', learned_at: hoursAgo(5) },
    ], NOW);
    const lines = (out ?? '').split('\n');
    expect(lines).toHaveLength(2);
    expect(out).toContain('third');   // most recent
    expect(out).toContain('second');
    expect(out).not.toContain('first');
  });
});

describe('pickContinuitySource (R34 T4)', () => {
  it('returns the most recent completed transcript within 48h', () => {
    const out = pickContinuitySource([
      { scheduled_for: hoursAgo(30), status: 'completed', transcript: 'talked about fundraising stress' },
      { scheduled_for: hoursAgo(70), status: 'completed', transcript: 'older call' },
    ], NOW);
    expect(out).toBe('talked about fundraising stress');
  });

  it('returns null when the last call was more than 48h ago', () => {
    const out = pickContinuitySource([
      { scheduled_for: hoursAgo(60), status: 'completed', transcript: 'too old' },
    ], NOW);
    expect(out).toBeNull();
  });

  it('skips rows with no transcript content', () => {
    const out = pickContinuitySource([
      { scheduled_for: hoursAgo(5), status: 'completed', transcript: '   ' },
    ], NOW);
    expect(out).toBeNull();
  });

  it('ignores non-completed calls', () => {
    const out = pickContinuitySource([
      { scheduled_for: hoursAgo(5), status: 'calling', transcript: 'in progress' },
    ], NOW);
    expect(out).toBeNull();
  });
});
