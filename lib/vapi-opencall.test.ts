import { describe, it, expect } from 'vitest';
import { buildOpenCallSystemPrompt } from './vapi';

const base = { firstName: 'Derrick', userName: 'Derrick Fung', timezone: 'America/Toronto', prioritiesText: '', memoryText: '', language: 'en' };

describe('buildOpenCallSystemPrompt — R40 T1 time awareness', () => {
  it('injects an EVENING framing when isEvening is true', () => {
    const p = buildOpenCallSystemPrompt({ ...base, currentTime: '9:45 PM', isEvening: true });
    expect(p).toContain('TIME AWARENESS');
    expect(p).toContain('9:45 PM');
    expect(p).toContain('EVENING call');
    expect(p).toContain('ALREADY HAPPENED');
    expect(p).not.toContain('Standard daytime framing');
  });

  it('uses standard daytime framing before 5 PM', () => {
    const p = buildOpenCallSystemPrompt({ ...base, currentTime: '8:05 AM', isEvening: false });
    expect(p).toContain('TIME AWARENESS');
    expect(p).toContain('8:05 AM');
    expect(p).toContain('Standard daytime framing');
    expect(p).not.toContain('ALREADY HAPPENED');
  });

  it('omits the time-awareness block when no currentTime is supplied (backward compatible)', () => {
    const p = buildOpenCallSystemPrompt(base);
    expect(p).not.toContain('TIME AWARENESS');
  });

  it('injects evening framing in the Cantonese prompt too', () => {
    const p = buildOpenCallSystemPrompt({ ...base, language: 'yue', currentTime: '晚上 9:45', isEvening: true });
    expect(p).toContain('時間意識');
    expect(p).toContain('已經發生咗');
  });
});
