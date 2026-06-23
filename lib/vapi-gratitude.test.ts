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
    // No trailing weather fragment — date immediately followed by closing quote.
    expect(p).toContain('Today is Tuesday, June 23." Then ask warmly');
  });

  it('includes quote instruction when quoteEnabled=true', () => {
    const p = buildGratitudeSystemPrompt('Derrick', 'Monday, June 22', null, true, 'rebuilding');
    expect(p).toContain('rebuilding');
    expect(p).toContain('QUOTE');
    expect(p).toContain('NOT a productivity briefing');
  });

  it('excludes quote instruction when quoteEnabled=false (default)', () => {
    const p = buildGratitudeSystemPrompt('Derrick', 'Monday, June 22', null);
    expect(p).not.toContain('QUOTE');
  });
});
