import { describe, it, expect } from 'vitest';
import { buildFallbackBriefing, buildWhoopSection } from './briefing';

describe('buildFallbackBriefing', () => {
  it('uses first name only, not full name', () => {
    const result = buildFallbackBriefing('Good morning', 'Derrick Fung', '', '');
    expect(result).toContain('Good morning, Derrick');
    expect(result).not.toContain('Fung');
  });

  it('includes calendar events when present', () => {
    const result = buildFallbackBriefing('Good morning', 'Derrick', '9 AM: Investor call\n2 PM: Team sync', '1. Fundraising');
    expect(result).toContain('Investor call');
    expect(result).toContain('Team sync');
  });

  it('acknowledges no calendar events gracefully', () => {
    const result = buildFallbackBriefing('Good afternoon', 'Derrick', '', '1. Fundraising');
    expect(result).toMatch(/don.t see any events/i);
  });

  it('includes priorities when present', () => {
    const result = buildFallbackBriefing('Good morning', 'Derrick', '', '1. Fundraising\n2. Product');
    expect(result).toContain('Fundraising');
    expect(result).toContain('Product');
  });

  it('skips priorities section when none set', () => {
    const result = buildFallbackBriefing('Good morning', 'Derrick', '', 'No priorities set for this week.');
    expect(result).not.toContain('priorities this week are');
  });

  it('always ends with a closing question', () => {
    const result = buildFallbackBriefing('Good morning', 'Derrick', '', '');
    expect(result).toContain("What's the most important thing");
  });

  it('returns a plain-text string with no markdown', () => {
    const result = buildFallbackBriefing('Good morning', 'Derrick', '9 AM: Meeting', '1. Fundraising');
    expect(result).not.toMatch(/[*_#`]|^\d+\./m);
  });
});

describe('buildWhoopSection', () => {
  it('returns null when all inputs are null (not connected)', () => {
    expect(buildWhoopSection(null, null, null)).toBeNull();
  });

  it('includes recovery score when provided', () => {
    const result = buildWhoopSection({ recoveryScore: 34, hrv: 55, restingHeartRate: 58 }, null, null);
    expect(result).toContain('RECOVERY: 34%');
  });

  it('formats sleep duration as hours and minutes', () => {
    // 5h 12m = 312 minutes = 18720000 ms
    const result = buildWhoopSection(null, { durationMs: 18_720_000, performancePct: 82, efficiencyPct: 91 }, null);
    expect(result).toContain('SLEEP: 5h12m');
  });

  it('pads single-digit minutes with a leading zero', () => {
    // 6h 05m = 365 minutes = 21900000 ms
    const result = buildWhoopSection(null, { durationMs: 21_900_000, performancePct: 88, efficiencyPct: 93 }, null);
    expect(result).toContain('SLEEP: 6h05m');
  });

  it('includes strain when provided', () => {
    const result = buildWhoopSection(null, null, { strain: 14.2, avgHeartRate: 112 });
    expect(result).toContain('STRAIN: 14.2');
  });

  it('joins all three parts with middot separator', () => {
    const result = buildWhoopSection(
      { recoveryScore: 72, hrv: 68, restingHeartRate: 52 },
      { durationMs: 25_200_000, performancePct: 90, efficiencyPct: 94 }, // 7h00m
      { strain: 8.5, avgHeartRate: 98 },
    );
    expect(result).toBe('RECOVERY: 72% · SLEEP: 7h00m · STRAIN: 8.5');
  });

  it('returns just the available parts when some are null', () => {
    const result = buildWhoopSection({ recoveryScore: 55, hrv: 60, restingHeartRate: 60 }, null, { strain: 12.1, avgHeartRate: 105 });
    expect(result).toContain('RECOVERY: 55%');
    expect(result).toContain('STRAIN: 12.1');
    expect(result).not.toContain('SLEEP');
  });
});
