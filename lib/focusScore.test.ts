import { describe, it, expect } from 'vitest';
import { computeFocusScore, formatFocusScoreForBriefing, type FocusScoreInput } from './focusScore';

const base: FocusScoreInput = { recoveryScore: 70, priorityHoursThisWeek: 3, hasBreathingRoom: true, followThroughRate: 0.9 };

describe('computeFocusScore (R16 T2)', () => {
  it('all-high inputs → 100, high tier', () => {
    const r = computeFocusScore(base);
    expect(r.score).toBe(100); // 40 + 35 + 25
    expect(r.tier).toBe('high');
    expect(r.breakdown).toEqual({ recovery: 40, schedule: 35, followThrough: 25 });
  });

  it('all-null/neutral inputs → 20+8+18 = 46, medium', () => {
    const r = computeFocusScore({ recoveryScore: null, priorityHoursThisWeek: 0, hasBreathingRoom: false, followThroughRate: null });
    expect(r.score).toBe(46);
    expect(r.tier).toBe('medium');
  });

  it('low recovery only drags the score', () => {
    const r = computeFocusScore({ ...base, recoveryScore: 20 });
    expect(r.breakdown.recovery).toBe(10);
    expect(r.score).toBe(70); // 10 + 35 + 25
  });

  it('no breathing room → schedule drops to one-condition (20)', () => {
    const r = computeFocusScore({ ...base, hasBreathingRoom: false });
    expect(r.breakdown.schedule).toBe(20);
    expect(r.score).toBe(85);
  });

  it('neither schedule condition met → schedule 8', () => {
    const r = computeFocusScore({ ...base, priorityHoursThisWeek: 0, hasBreathingRoom: false });
    expect(r.breakdown.schedule).toBe(8);
  });

  it('low follow-through → 5', () => {
    const r = computeFocusScore({ ...base, followThroughRate: 0.3 });
    expect(r.breakdown.followThrough).toBe(5);
    expect(r.score).toBe(80);
  });

  it('mid recovery (34–66) → 24', () => {
    expect(computeFocusScore({ ...base, recoveryScore: 50 }).breakdown.recovery).toBe(24);
  });

  it('mid follow-through (0.5–0.79) → 15', () => {
    expect(computeFocusScore({ ...base, followThroughRate: 0.6 }).breakdown.followThrough).toBe(15);
  });

  it('worst-case inputs → low tier', () => {
    const r = computeFocusScore({ recoveryScore: 10, priorityHoursThisWeek: 0, hasBreathingRoom: false, followThroughRate: 0.2 });
    expect(r.score).toBe(23); // 10 + 8 + 5
    expect(r.tier).toBe('low');
  });

  it('boundary: exactly 70 is high, 69 is medium, 45 is medium, 44 is low', () => {
    expect(computeFocusScore({ recoveryScore: 20, priorityHoursThisWeek: 3, hasBreathingRoom: true, followThroughRate: 0.9 }).tier).toBe('high'); // 10+35+25=70
    expect(computeFocusScore({ recoveryScore: 50, priorityHoursThisWeek: 3, hasBreathingRoom: false, followThroughRate: 0.6 }).tier).toBe('medium'); // 24+20+15=59
    expect(computeFocusScore({ recoveryScore: 10, priorityHoursThisWeek: 0, hasBreathingRoom: false, followThroughRate: null }).score).toBe(36); // low
  });
});

describe('formatFocusScoreForBriefing (R16 T2)', () => {
  it('high tier sentence names the strengths', () => {
    const s = formatFocusScoreForBriefing(computeFocusScore(base));
    expect(s).toMatch(/^Focus Score 100 —/);
    expect(s).toMatch(/recovery's strong/);
  });

  it('low tier sentence flags protecting energy', () => {
    const s = formatFocusScoreForBriefing(computeFocusScore({ recoveryScore: 10, priorityHoursThisWeek: 0, hasBreathingRoom: false, followThroughRate: 0.2 }));
    expect(s).toMatch(/protecting your energy/);
  });

  it('medium tier sentence is a single spoken line', () => {
    const s = formatFocusScoreForBriefing(computeFocusScore({ recoveryScore: 50, priorityHoursThisWeek: 0, hasBreathingRoom: false, followThroughRate: 0.6 }));
    expect(s.startsWith('Focus Score')).toBe(true);
    expect(s.endsWith('.')).toBe(true);
  });
});
