import { describe, it, expect } from 'vitest';
import { deriveConnectState, canContinue } from './onboardingConnect';

describe('onboarding connect step (R24)', () => {
  it('no connections → Continue disabled, Whoop optional/unconnected', () => {
    const s = deriveConnectState({ calendar: { connected: false, email: null } }, { connected: false });
    expect(s.calendarConnected).toBe(false);
    expect(s.calendarEmail).toBeNull();
    expect(s.whoopConnected).toBe(false);
    expect(canContinue(s.calendarConnected)).toBe(false);
  });

  it('calendar pre-connected → Continue enabled, shows email', () => {
    const s = deriveConnectState({ calendar: { connected: true, email: 'dad@example.com' } }, { connected: false });
    expect(s.calendarConnected).toBe(true);
    expect(s.calendarEmail).toBe('dad@example.com');
    expect(canContinue(s.calendarConnected)).toBe(true);
  });

  it('Whoop is optional: Continue stays enabled when calendar is connected but Whoop is skipped', () => {
    const s = deriveConnectState({ calendar: { connected: true, email: 'a@b.com' } }, null);
    expect(s.whoopConnected).toBe(false);
    expect(canContinue(s.calendarConnected)).toBe(true);
  });

  it('degrades safely on null/absent responses', () => {
    const s = deriveConnectState(null, undefined);
    expect(s).toEqual({ calendarConnected: false, calendarEmail: null, whoopConnected: false });
    expect(canContinue(s.calendarConnected)).toBe(false);
  });
});
