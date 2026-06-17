/**
 * Tests for lib/consent.ts — data consent enforcement helpers.
 *
 * The key invariants:
 * - isImproveConsented: true ONLY for explicit 'improve' opt-in
 * - isPrivacyMode: true for null / undefined / 'privacy' (safe default)
 * - No user data should flow to improvement pathways unless isImproveConsented returns true
 */
import { describe, it, expect } from 'vitest';
import { isImproveConsented, isPrivacyMode } from './consent';

describe('isImproveConsented', () => {
  it('returns true when data_consent is exactly "improve"', () => {
    expect(isImproveConsented({ data_consent: 'improve' })).toBe(true);
  });

  it('returns false when data_consent is "privacy"', () => {
    expect(isImproveConsented({ data_consent: 'privacy' })).toBe(false);
  });

  it('returns false when data_consent is null (column not yet set by Core)', () => {
    expect(isImproveConsented({ data_consent: null })).toBe(false);
  });

  it('returns false when data_consent is undefined (column not yet in DB)', () => {
    expect(isImproveConsented({ data_consent: undefined })).toBe(false);
  });

  it('returns false when data_consent field is absent from the object', () => {
    // Core hasn't added the column yet — User has no data_consent property
    expect(isImproveConsented({})).toBe(false);
  });

  it('safe default: new users (null consent) are treated as privacy-mode, not improve', () => {
    // This verifies the CASA compliance posture: opt-IN required for improvement use,
    // not opt-out. A user who hasn't chosen yet must not have their data included.
    const newUser = { data_consent: null as 'improve' | 'privacy' | null };
    expect(isImproveConsented(newUser)).toBe(false);
  });
});

describe('isPrivacyMode', () => {
  it('returns true when data_consent is "privacy"', () => {
    expect(isPrivacyMode({ data_consent: 'privacy' })).toBe(true);
  });

  it('returns true when data_consent is null', () => {
    expect(isPrivacyMode({ data_consent: null })).toBe(true);
  });

  it('returns true when data_consent is undefined', () => {
    expect(isPrivacyMode({ data_consent: undefined })).toBe(true);
  });

  it('returns false when data_consent is "improve"', () => {
    expect(isPrivacyMode({ data_consent: 'improve' })).toBe(false);
  });

  it('is the complement of isImproveConsented for all inputs', () => {
    const cases: Array<{ data_consent: 'improve' | 'privacy' | null | undefined }> = [
      { data_consent: 'improve' },
      { data_consent: 'privacy' },
      { data_consent: null },
      { data_consent: undefined },
    ];
    for (const c of cases) {
      expect(isPrivacyMode(c)).toBe(!isImproveConsented(c));
    }
  });
});
