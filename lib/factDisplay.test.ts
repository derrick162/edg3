import { describe, it, expect } from 'vitest';
import { factDisplayStatement } from './factDisplay';

describe('factDisplayStatement (T3-1)', () => {
  it('renders the summary for a pattern fact, not the raw JSON', () => {
    const stmt = JSON.stringify({
      type: 'priority_drift',
      summary: 'Your stated priorities have shifted three times in the last month.',
      confidence: 'high',
      sampleDays: 5,
    });
    expect(factDisplayStatement('pattern', stmt)).toBe(
      'Your stated priorities have shifted three times in the last month.',
    );
  });

  it('passes non-pattern categories through unchanged', () => {
    expect(factDisplayStatement('goal', 'Raise the seed round by Q3')).toBe('Raise the seed round by Q3');
    expect(factDisplayStatement('person', 'Sarah is the lead investor')).toBe('Sarah is the lead investor');
    expect(factDisplayStatement('fact', '{"not":"a pattern"}')).toBe('{"not":"a pattern"}');
  });

  it('falls back to the raw statement when a pattern fact is not valid JSON', () => {
    expect(factDisplayStatement('pattern', 'manually edited prose')).toBe('manually edited prose');
  });

  it('falls back to raw when the JSON has no usable summary', () => {
    expect(factDisplayStatement('pattern', JSON.stringify({ type: 'x', confidence: 'low' }))).toBe(
      JSON.stringify({ type: 'x', confidence: 'low' }),
    );
    expect(factDisplayStatement('pattern', JSON.stringify({ summary: '   ' }))).toBe(
      JSON.stringify({ summary: '   ' }),
    );
  });
});
