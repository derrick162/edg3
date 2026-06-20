import { describe, it, expect } from 'vitest';
import { soundex, matchesSelfName } from './selfName';

describe('soundex', () => {
  it('maps phonetic name variants to the same code (Derek ≈ Derrick)', () => {
    expect(soundex('Derek')).toBe(soundex('Derrick'));
  });

  it('produces stable letter+3-digit codes', () => {
    expect(soundex('Robert')).toBe('R163');
    expect(soundex('Rupert')).toBe('R163');
    expect(soundex('Tymczak')).toBe('T522');
  });

  it('returns empty for non-alpha input', () => {
    expect(soundex('123')).toBe('');
    expect(soundex('')).toBe('');
  });
});

describe('matchesSelfName', () => {
  const NAME = 'Derrick Fung';

  it('matches the exact full name', () => {
    expect(matchesSelfName('Derrick Fung', NAME)).toBe(true);
  });

  it('matches the first name', () => {
    expect(matchesSelfName('Derrick', NAME)).toBe(true);
  });

  it('matches a phonetic/STT first-name variant (derek → true)', () => {
    expect(matchesSelfName('derek', NAME)).toBe(true);
    expect(matchesSelfName('Derek', NAME)).toBe(true);
  });

  it('matches the last name', () => {
    expect(matchesSelfName('Fung', NAME)).toBe(true);
    expect(matchesSelfName('fung', NAME)).toBe(true);
  });

  it('matches initial + last name forms', () => {
    expect(matchesSelfName('D. Fung', NAME)).toBe(true);
    expect(matchesSelfName('D Fung', NAME)).toBe(true);
    expect(matchesSelfName('d.fung', NAME)).toBe(true);
  });

  it('is case-insensitive and trims/strips trailing dots', () => {
    expect(matchesSelfName('  DERRICK ', NAME)).toBe(true);
    expect(matchesSelfName('Derrick.', NAME)).toBe(true);
  });

  it('does NOT match genuinely different people', () => {
    expect(matchesSelfName('Faiza', NAME)).toBe(false);
    expect(matchesSelfName('Kevin', NAME)).toBe(false);
    expect(matchesSelfName('Faiza Khan', NAME)).toBe(false);
  });

  it('returns false for empty entity or userName', () => {
    expect(matchesSelfName('', NAME)).toBe(false);
    expect(matchesSelfName('Derrick', '')).toBe(false);
    expect(matchesSelfName(null, NAME)).toBe(false);
    expect(matchesSelfName('Derrick', undefined)).toBe(false);
  });

  it('handles a single-token user name without a last name', () => {
    expect(matchesSelfName('Derrick', 'Derrick')).toBe(true);
    expect(matchesSelfName('derek', 'Derrick')).toBe(true);
    expect(matchesSelfName('Fung', 'Derrick')).toBe(false);
  });
});
