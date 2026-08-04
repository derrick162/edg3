/**
 * C13 — STT tuning. English calls get a Deepgram nova-2 transcriber pinned to English (no
 * auto-language Hindi leakage) with keyword boosting for trading vocabulary; Cantonese keeps the
 * OpenAI transcriber unchanged.
 */
import { describe, it, expect } from 'vitest';
import { selectTranscriber, buildEnTranscriber, TRADING_KEYTERMS } from './vapi';

describe('selectTranscriber (C13 STT tuning)', () => {
  it('en → tuned Deepgram nova-2 pinned to English with keyword boosting', () => {
    const t = selectTranscriber('en');
    expect(t.provider).toBe('deepgram');
    expect(t.model).toBe('nova-2');
    expect(t.language).toBe('en');
    expect(t.keywords).toContain('SOXL:2');
    expect(t.keywords).toContain('puts:2');
    expect(t.keywords).toContain('Derrick:2');
  });

  it('yue → OpenAI transcriber unchanged (no en pin, no keywords)', () => {
    const t = selectTranscriber('yue');
    expect(t.provider).toBe('openai');
    expect(t.model).toBe('gpt-4o-transcribe');
    expect(t.language).toBeUndefined();
    expect(t.keywords).toBeUndefined();
  });

  it('defaults an unknown language to the tuned English transcriber', () => {
    expect(selectTranscriber('').provider).toBe('deepgram');
  });

  it('buildEnTranscriber boosts every trading keyterm', () => {
    expect(buildEnTranscriber().keywords).toHaveLength(TRADING_KEYTERMS.length);
    expect(buildEnTranscriber().keywords.every(k => k.endsWith(':2'))).toBe(true);
  });

  // INCIDENT GUARD (Aug 1-3 2026): Vapi 400s the ENTIRE call if any keyword is not
  // 'word' or 'word:number' — 'credit spread' (space) silently killed every outbound
  // call for 3 days. Every boosted keyword must match Vapi's accepted format exactly.
  it("every boosted keyword matches Vapi's 'word:number' format (no spaces/colons in the word)", () => {
    for (const k of buildEnTranscriber().keywords) {
      expect(k).toMatch(/^[^\s:]+:\d+$/);
    }
  });
});
