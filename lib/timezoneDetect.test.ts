import { describe, it, expect } from 'vitest';
import { pickTimezoneUpdate } from './timezoneDetect';

describe('pickTimezoneUpdate (R35)', () => {
  it('returns the detected zone when none is stored (the unset-timezone bug)', () => {
    expect(pickTimezoneUpdate(null, 'America/Toronto')).toBe('America/Toronto');
    expect(pickTimezoneUpdate('', 'America/Toronto')).toBe('America/Toronto');
    expect(pickTimezoneUpdate('   ', 'America/Toronto')).toBe('America/Toronto');
  });

  it('returns null when stored matches the detected zone (no needless POST)', () => {
    expect(pickTimezoneUpdate('America/Toronto', 'America/Toronto')).toBeNull();
  });

  it('returns the detected zone when stored differs (user moved cities)', () => {
    expect(pickTimezoneUpdate('America/Toronto', 'America/New_York')).toBe('America/New_York');
  });

  it('returns null when no zone could be detected (SSR / Intl unavailable)', () => {
    expect(pickTimezoneUpdate('America/Toronto', null)).toBeNull();
    expect(pickTimezoneUpdate(null, null)).toBeNull();
    expect(pickTimezoneUpdate(null, '')).toBeNull();
  });
});
