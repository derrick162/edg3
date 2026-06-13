import { describe, it, expect } from 'vitest';
import { buildFallbackBriefing } from './briefing';

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
