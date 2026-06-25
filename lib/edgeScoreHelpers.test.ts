import { describe, it, expect } from 'vitest';
import {
  scoreColor,
  scoreSummary,
  scoreGlow,
  scoreCardBorder,
  scoreCardBg,
  prepareSparklineData,
} from './edgeScoreHelpers';

describe('scoreColor', () => {
  it('returns peak color for score >= 85', () => {
    expect(scoreColor(85)).toBe('var(--gauge-peak)');
    expect(scoreColor(100)).toBe('var(--gauge-peak)');
  });
  it('returns high color for 65–84', () => {
    expect(scoreColor(65)).toBe('var(--gauge-high)');
    expect(scoreColor(84)).toBe('var(--gauge-high)');
  });
  it('returns mid color for 35–64', () => {
    expect(scoreColor(35)).toBe('var(--gauge-mid)');
    expect(scoreColor(64)).toBe('var(--gauge-mid)');
  });
  it('returns low color for < 35', () => {
    expect(scoreColor(0)).toBe('var(--gauge-low)');
    expect(scoreColor(34)).toBe('var(--gauge-low)');
  });
});

describe('scoreSummary', () => {
  it('returns correct summary per tier', () => {
    expect(scoreSummary(90)).toContain("set up well");
    expect(scoreSummary(70)).toContain("Good shape");
    expect(scoreSummary(50)).toContain("changes could make");
    expect(scoreSummary(20)).toContain("needs some work");
  });
});

describe('scoreGlow', () => {
  it('returns peak glow for >= 85', () => expect(scoreGlow(85)).toBe('var(--gauge-glow-peak)'));
  it('returns high glow for 65–84', () => expect(scoreGlow(65)).toBe('var(--gauge-glow-high)'));
  it('returns low glow for < 65', () => expect(scoreGlow(64)).toBe('var(--gauge-glow-low)'));
});

describe('scoreCardBorder', () => {
  it('covers all four tiers', () => {
    expect(scoreCardBorder(90)).toContain('peak');
    expect(scoreCardBorder(70)).toContain('high');
    expect(scoreCardBorder(50)).toContain('mid');
    expect(scoreCardBorder(20)).toContain('low');
  });
});

describe('scoreCardBg', () => {
  it('returns transparent for high tier', () => expect(scoreCardBg(70)).toBe('transparent'));
  it('returns token string for other tiers', () => {
    expect(scoreCardBg(90)).toContain('peak');
    expect(scoreCardBg(50)).toContain('mid');
    expect(scoreCardBg(20)).toContain('low');
  });
});

describe('prepareSparklineData', () => {
  const day = (date: string, score: number) => ({ date, score });

  it('returns null when history has 0 entries (crash guard)', () => {
    expect(prepareSparklineData([], 72, '2026-06-25')).toBeNull();
  });

  it('returns null when history has 1 entry', () => {
    expect(prepareSparklineData([day('2026-06-25', 60)], 65, '2026-06-25')).toBeNull();
  });

  it('returns null when history has 1 entry and todayScore is null', () => {
    expect(prepareSparklineData([day('2026-06-25', 60)], null, '2026-06-25')).toBeNull();
  });

  it('returns data when history has 2 consecutive entries ending on referenceDate', () => {
    const history = [day('2026-06-24', 55), day('2026-06-25', 70)];
    const result = prepareSparklineData(history, null, '2026-06-25');
    expect(result).not.toBeNull();
    expect(result!.extended).toHaveLength(2);
    expect(result!.delta).toBe(15);
    expect(result!.stroke).toBe('var(--gauge-peak)');
  });

  it('overrides last slot with todayScore', () => {
    const history = [day('2026-06-24', 55), day('2026-06-25', 70)];
    const result = prepareSparklineData(history, 80, '2026-06-25');
    expect(result!.extended[result!.extended.length - 1].score).toBe(80);
    expect(result!.delta).toBe(25); // 80 - 55
  });

  it('returns flat stroke when delta is 0', () => {
    const history = [day('2026-06-24', 60), day('2026-06-25', 60)];
    const result = prepareSparklineData(history, null, '2026-06-25');
    expect(result!.delta).toBe(0);
    expect(result!.stroke).toBe('var(--text-muted)');
  });

  it('returns low stroke when trending down', () => {
    const history = [day('2026-06-24', 80), day('2026-06-25', 50)];
    const result = prepareSparklineData(history, null, '2026-06-25');
    expect(result!.delta).toBe(-30);
    expect(result!.stroke).toBe('var(--gauge-low)');
  });

  it('does not mutate the original history array', () => {
    const history = [day('2026-06-24', 55), day('2026-06-25', 70)];
    prepareSparklineData(history, 80, '2026-06-25');
    expect(history[1].score).toBe(70); // unchanged
  });

  // Gap-fill: history ends on Sunday, referenceDate is Wednesday
  it('fills missing days up to referenceDate with last known score', () => {
    const history = [day('2026-06-22', 60), day('2026-06-23', 70)]; // Mon–Tue data, ref = Thu
    const result = prepareSparklineData(history, null, '2026-06-25');
    expect(result).not.toBeNull();
    // Mon, Tue, Wed, Thu = 4 days
    expect(result!.extended).toHaveLength(4);
    expect(result!.extended[0]).toEqual({ date: '2026-06-22', score: 60 });
    expect(result!.extended[1]).toEqual({ date: '2026-06-23', score: 70 });
    // Wed and Thu carry forward Tue's score (70)
    expect(result!.extended[2]).toEqual({ date: '2026-06-24', score: 70 });
    expect(result!.extended[3]).toEqual({ date: '2026-06-25', score: 70 });
  });

  it('gap-fill with todayScore override replaces the final slot', () => {
    const history = [day('2026-06-22', 60), day('2026-06-23', 70)];
    const result = prepareSparklineData(history, 85, '2026-06-25');
    expect(result!.extended).toHaveLength(4);
    expect(result!.extended[3]).toEqual({ date: '2026-06-25', score: 85 });
    expect(result!.delta).toBe(25); // 85 - 60
  });

  it('handles a single-day gap in the middle', () => {
    // Mon score=60, skip Tue, Wed score=80
    const history = [day('2026-06-22', 60), day('2026-06-24', 80)];
    const result = prepareSparklineData(history, null, '2026-06-24');
    expect(result!.extended).toHaveLength(3);
    expect(result!.extended[1]).toEqual({ date: '2026-06-23', score: 60 }); // gap filled
    expect(result!.extended[2]).toEqual({ date: '2026-06-24', score: 80 });
    expect(result!.delta).toBe(20);
  });
});
