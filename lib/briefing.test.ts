import { describe, it, expect } from 'vitest';
import { buildFallbackBriefing, buildWhoopSection, buildEnergyMatchingBlock } from './briefing';
import type { Fact } from './db';

function makePref(statement: string, id = 1): Fact {
  return { id, user_id: 1, category: 'preference', statement, entity: null, learned_at: '2026-06-13T00:00:00', confidence: 'high', source_briefing_id: null };
}

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

  it('formats sleep duration as spoken hours and minutes', () => {
    // 5h 12m = 312 minutes = 18720000 ms
    const result = buildWhoopSection(null, { durationMs: 18_720_000, performancePct: 82, efficiencyPct: 91 }, null);
    expect(result).toContain('SLEEP: 5 hours 12 minutes (score 82%)');
  });

  it('drops minutes when the duration is a whole number of hours', () => {
    // 6h 05m = 365 minutes = 21900000 ms — spoken, not "6h05m" (misread as "6 H 5 meters")
    const result = buildWhoopSection(null, { durationMs: 21_900_000, performancePct: 88, efficiencyPct: 93 }, null);
    expect(result).toContain('SLEEP: 6 hours 5 minutes (score 88%)');
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
    expect(result).toBe('RECOVERY: 72% · SLEEP: 7 hours (score 90%) · STRAIN: 8.5');
  });

  it('returns just the available parts when some are null', () => {
    const result = buildWhoopSection({ recoveryScore: 55, hrv: 60, restingHeartRate: 60 }, null, { strain: 12.1, avgHeartRate: 105 });
    expect(result).toContain('RECOVERY: 55%');
    expect(result).toContain('STRAIN: 12.1');
    expect(result).not.toContain('SLEEP');
  });
});

describe('buildEnergyMatchingBlock', () => {
  it('returns null when no preferences', () => {
    expect(buildEnergyMatchingBlock([], null)).toBeNull();
  });

  it('returns null when preferences exist but none are energy-related', () => {
    const prefs = [makePref('User prefers email over Slack for async communication')];
    expect(buildEnergyMatchingBlock(prefs, null)).toBeNull();
  });

  it('returns a block when a preference mentions "peak"', () => {
    const prefs = [makePref('User\'s peak hours are 9–11am for deep creative work')];
    const result = buildEnergyMatchingBlock(prefs, null);
    expect(result).not.toBeNull();
    expect(result).toContain('ENERGY PROFILE');
    expect(result).toContain('peak hours');
  });

  it('includes all matching energy preferences', () => {
    const prefs = [
      makePref('User\'s peak hours are 9–11am', 1),
      makePref('User considers vibe-coding high energy work', 2),
      makePref('User prefers to handle email in the afternoon trough', 3),
      makePref('User prefers Slack for quick questions', 4),
    ];
    const result = buildEnergyMatchingBlock(prefs, null)!;
    expect(result).toContain('peak hours');
    expect(result).toContain('high energy work');
    expect(result).toContain('afternoon trough');
    expect(result).not.toContain('Slack for quick questions');
  });

  it('adds green recovery tier line when recovery is high', () => {
    const prefs = [makePref('User\'s energy peaks 9–11am')];
    const result = buildEnergyMatchingBlock(prefs, { recoveryScore: 80, hrv: 70, restingHeartRate: 50 })!;
    expect(result).toContain('80%');
    expect(result).toContain('full capacity');
  });

  it('adds red recovery tier line when recovery is low', () => {
    const prefs = [makePref('User has a deep work focus block each morning')];
    const result = buildEnergyMatchingBlock(prefs, { recoveryScore: 25, hrv: 40, restingHeartRate: 68 })!;
    expect(result).toContain('25%');
    expect(result).toContain('protect');
  });

  it('omits recovery line when recovery is null', () => {
    const prefs = [makePref('User prefers deep work in the morning peak window')];
    const result = buildEnergyMatchingBlock(prefs, null)!;
    expect(result).not.toContain('Whoop recovery');
  });

  it('matches "admin" keyword', () => {
    const prefs = [makePref('User batches admin tasks into the 2–3pm afternoon window')];
    const result = buildEnergyMatchingBlock(prefs, null);
    expect(result).not.toBeNull();
    expect(result).toContain('admin tasks');
  });
});
