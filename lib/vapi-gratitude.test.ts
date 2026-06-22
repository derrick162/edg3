import { describe, it, expect } from 'vitest';
import { buildGratitudeSystemPrompt } from './vapi';

describe('buildGratitudeSystemPrompt (R20)', () => {
  it('includes the first name and date, and weaves in the weather when provided', () => {
    const p = buildGratitudeSystemPrompt('Derrick', 'Monday, June 22', 'Sunny, high of 24');
    expect(p).toContain('Derrick');
    expect(p).toContain('Monday, June 22');
    expect(p).toContain('Sunny, high of 24');
    expect(p).toContain('recordGratitude');
    // Tone guard: never a productivity briefing.
    expect(p).toContain('NOT a productivity briefing');
  });

  it('omits the weather clause when weather is null', () => {
    const p = buildGratitudeSystemPrompt('Sam', 'Tuesday, June 23', null);
    expect(p).toContain('Today is Tuesday, June 23.');
    // No double space / trailing weather fragment after the date.
    expect(p).toContain('Today is Tuesday, June 23. Before the day');
  });
});
