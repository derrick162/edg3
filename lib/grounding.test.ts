import { describe, it, expect } from 'vitest';
import { editDistance, normalizeForPhonetics, groundProperNouns, extractNamesFromEventTitles, canonicalNamesFromProfile } from './grounding';

describe('editDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(editDistance('hello', 'hello')).toBe(0);
  });

  it('gym vs jim — raw distance is 2 (different letters, handled via normalization)', () => {
    expect(editDistance('gym', 'jim')).toBe(2);
  });

  it('onsi vs ansi — 1 substitution', () => {
    expect(editDistance('onsi', 'ansi')).toBe(1);
  });

  it('pfizer vs faiza — large distance (does not get corrected by deterministic pass)', () => {
    expect(editDistance('pfizer', 'faiza')).toBeGreaterThan(1);
  });

  it('empty string vs word', () => {
    expect(editDistance('', 'abc')).toBe(3);
  });

  it('word vs empty string', () => {
    expect(editDistance('abc', '')).toBe(3);
  });

  it('colour vs color — 1 insertion', () => {
    expect(editDistance('colour', 'color')).toBe(1);
  });
});

describe('normalizeForPhonetics', () => {
  it('gym → jim (gy at word start becomes ji)', () => {
    expect(normalizeForPhonetics('gym')).toBe('jim');
  });

  it('ph → f', () => {
    expect(normalizeForPhonetics('phone')).toBe('fone');
  });

  it('no change for a name already in canonical form', () => {
    expect(normalizeForPhonetics('jim')).toBe('jim');
    expect(normalizeForPhonetics('ansi')).toBe('ansi');
  });

  it('gy mid-word is not affected (only at word start)', () => {
    // \bgy only matches at word boundaries; mid-word "gy" stays
    expect(normalizeForPhonetics('egypt')).toBe('egypt');
  });
});

describe('groundProperNouns', () => {
  it('corrects Gym → Jim when Jim is a known contact (homophone via normalization)', () => {
    expect(groundProperNouns("shorten Gym's appointment", ['Jim'])).toBe("shorten Jim's appointment");
  });

  it('corrects Onsi → Ansi when Ansi is a known contact (1 char vowel shift)', () => {
    expect(groundProperNouns('call with Onsi tomorrow', ['Ansi'])).toBe('call with Ansi tomorrow');
  });

  it('does NOT correct Pfizer → Faiza (normalized edit distance > 1 — falls to Haiku hint)', () => {
    expect(groundProperNouns('Pfizer called about the deal', ['Faiza'])).toBe('Pfizer called about the deal');
  });

  it('skips correction when preceded by "the" (likely a place, not a person)', () => {
    expect(groundProperNouns('going to the Gym at five', ['Jim'])).toBe('going to the Gym at five');
  });

  it('skips correction when preceded by "at"', () => {
    expect(groundProperNouns('workout at Gym', ['Jim'])).toBe('workout at Gym');
  });

  it('does not change already-correct spelling', () => {
    expect(groundProperNouns('Jim agreed to that', ['Jim'])).toBe('Jim agreed to that');
  });

  it('handles empty text', () => {
    expect(groundProperNouns('', ['Jim'])).toBe('');
  });

  it('handles empty canonical list', () => {
    expect(groundProperNouns('Gym said yes', [])).toBe('Gym said yes');
  });

  it('preserves possessive after replacement', () => {
    expect(groundProperNouns("Onsi's startup raised a round", ['Ansi'])).toBe("Ansi's startup raised a round");
  });

  it('corrects a name mid-sentence surrounded by context', () => {
    expect(groundProperNouns('I spoke with Onsi about funding', ['Ansi'])).toBe('I spoke with Ansi about funding');
  });

  it('handles multiple corrections in one string', () => {
    const result = groundProperNouns('Gym said he met Onsi yesterday', ['Jim', 'Ansi']);
    expect(result).toBe('Jim said he met Ansi yesterday');
  });

  it('prefers exact canonical spelling over near-match when both are known', () => {
    // "Jim" is in canonical list; text says "Jim" → exact match, no-op
    const result = groundProperNouns('Jim called', ['Jim', 'Tim']);
    expect(result).toBe('Jim called');
  });

  it('picks closest match when two canonicals are both 1 away (normalized)', () => {
    // "Onsi" normalized = "onsi", distance to "ansi" = 1, to "insi" = 1 — picks first found
    const result = groundProperNouns('meet Onsi', ['Ansi', 'Insi']);
    // Either replacement is valid; important thing is it is replaced
    expect(result).not.toBe('meet Onsi');
  });
});

describe('canonicalNamesFromProfile', () => {
  it('splits a full name into tokens', () => {
    expect(canonicalNamesFromProfile('Derrick Fung')).toEqual(['Derrick', 'Fung']);
  });

  it('returns single-token name as a one-element array', () => {
    expect(canonicalNamesFromProfile('Derrick')).toEqual(['Derrick']);
  });

  it('returns empty array for empty string', () => {
    expect(canonicalNamesFromProfile('')).toEqual([]);
  });

  it('filters out tokens shorter than 3 chars', () => {
    expect(canonicalNamesFromProfile('Al Wong')).toEqual(['Wong']);
  });

  it('deduplicates repeated tokens', () => {
    expect(canonicalNamesFromProfile('Anne Anne')).toEqual(['Anne']);
  });

  it('profile name feeds groundProperNouns to fix Derick → Derrick (1-edit off)', () => {
    // "Derick" differs from "Derrick" by 1 char (missing one 'r') — within Tier-1 threshold.
    // "Derek" is 3 edits away and requires Tier-2 (Haiku) — conservatively left unchanged.
    const canonicals = canonicalNamesFromProfile('Derrick Fung');
    expect(groundProperNouns('Derick mentioned this', canonicals)).toBe('Derrick mentioned this');
  });
});

describe('extractNamesFromEventTitles', () => {
  it('extracts name from "Call with Faiza"', () => {
    expect(extractNamesFromEventTitles(['Call with Faiza'])).toContain('Faiza');
  });

  it('extracts name from "1:1 Jim"', () => {
    expect(extractNamesFromEventTitles(['1:1 Jim'])).toContain('Jim');
  });

  it('does not extract stop-word-only title tokens', () => {
    const names = extractNamesFromEventTitles(['Team standup']);
    // "Team" is a stop word, "standup" is also a stop word
    expect(names.length).toBe(0);
  });

  it('does not extract "Focus" from an edge-icon focus block', () => {
    const names = extractNamesFromEventTitles(['⚡ Focus block']);
    expect(names).not.toContain('Focus');
  });

  it('deduplicates repeated names across titles', () => {
    const names = extractNamesFromEventTitles(['Call with Faiza', 'Follow-up with Faiza']);
    expect(names.filter(n => n === 'Faiza').length).toBe(1);
  });

  it('extracts multiple names from multiple titles', () => {
    const names = extractNamesFromEventTitles(['Call with Faiza', '1:1 Jim']);
    expect(names).toContain('Faiza');
    expect(names).toContain('Jim');
  });
});
