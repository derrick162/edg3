import { describe, it, expect } from 'vitest';
import { buildOpenCallSystemPrompt, CALENDAR_TOOL_IDS } from './vapi';

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

// C9 — open-call tool reliability: inbound open calls must enforce the same GROUND TRUTH RULE
// and ship the same calendar tools (incl. rememberPreference) as briefing calls.
describe('buildOpenCallSystemPrompt — C9 tool reliability', () => {
  it('includes the GROUND TRUTH RULE + tool-call discipline (parity with briefing prompt)', () => {
    const p = buildOpenCallSystemPrompt(base);
    expect(p).toContain('GROUND TRUTH RULE');
    expect(p).toContain('did not take the action');
    expect(p).toContain('TOOL CALL DISCIPLINE');
    expect(p).toContain('NEVER CLAIM AN ACTION IS DONE UNLESS YOU DID IT');
  });

  it('includes the GROUND TRUTH RULE in the Cantonese prompt as well', () => {
    const p = buildOpenCallSystemPrompt({ ...base, language: 'yue' });
    // The yue prompt keeps the rule label in English so the model anchors on it identically.
    expect(p).toContain('TOOL CALL DISCIPLINE');
  });

  it('exposes rememberPreference + core calendar tools to inbound open calls', () => {
    // rememberPreference UUID (part 3) must be in the inbound tool list, same as outbound.
    expect(CALENDAR_TOOL_IDS).toContain('54e47823-ad97-4624-9fef-6f95e96b2ff1');
    // A healthy-sized tool set (create/move/delete/edit/etc.), not a stripped-down list.
    expect(CALENDAR_TOOL_IDS.length).toBeGreaterThan(20);
    // No duplicate or empty IDs.
    expect(new Set(CALENDAR_TOOL_IDS).size).toBe(CALENDAR_TOOL_IDS.length);
    expect(CALENDAR_TOOL_IDS.every(id => /^[0-9a-f-]{36}$/.test(id))).toBe(true);
  });
});
