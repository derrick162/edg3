/**
 * S10 — unit tests for the trade-alert guardrail helpers (constant-time key compare, market-hours
 * window, body validation). These are the security-critical, HTTP-free pieces of the endpoint.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { verifyTradeAlertKey, isWithinMarketHours, parseTradeAlertBody, TRADE_ALERT_MAX_PER_DAY } from './tradeAlert';

describe('verifyTradeAlertKey', () => {
  const saved = process.env.TRADE_ALERT_KEY;
  afterEach(() => { process.env.TRADE_ALERT_KEY = saved; });

  it('returns false when the env secret is unset (endpoint disabled)', () => {
    delete process.env.TRADE_ALERT_KEY;
    expect(verifyTradeAlertKey('anything')).toBe(false);
  });

  it('returns false for a missing/empty presented key', () => {
    process.env.TRADE_ALERT_KEY = 's3cr3t';
    expect(verifyTradeAlertKey(null)).toBe(false);
    expect(verifyTradeAlertKey(undefined)).toBe(false);
    expect(verifyTradeAlertKey('')).toBe(false);
  });

  it('returns false for a wrong key (incl. a wrong key of different length)', () => {
    process.env.TRADE_ALERT_KEY = 's3cr3t';
    expect(verifyTradeAlertKey('nope')).toBe(false);
    expect(verifyTradeAlertKey('s3cr3t-plus-extra')).toBe(false);
    expect(verifyTradeAlertKey('S3CR3T')).toBe(false); // case-sensitive
  });

  it('returns true for the exact key', () => {
    process.env.TRADE_ALERT_KEY = 's3cr3t';
    expect(verifyTradeAlertKey('s3cr3t')).toBe(true);
  });
});

describe('isWithinMarketHours (09:30–16:00 ET, Mon–Fri)', () => {
  // 2026-07-31 is a Friday in EDT (UTC-4); 2026-01-30 is a Friday in EST (UTC-5).
  it('is true at the 09:30 ET open (EDT)', () => {
    expect(isWithinMarketHours(new Date('2026-07-31T13:30:00Z'))).toBe(true);
  });
  it('is false one minute before the open', () => {
    expect(isWithinMarketHours(new Date('2026-07-31T13:29:00Z'))).toBe(false);
  });
  it('is true at 15:59 ET', () => {
    expect(isWithinMarketHours(new Date('2026-07-31T19:59:00Z'))).toBe(true);
  });
  it('is false at the 16:00 ET close (exclusive)', () => {
    expect(isWithinMarketHours(new Date('2026-07-31T20:00:00Z'))).toBe(false);
  });
  it('handles EST (winter) — 09:30 EST is 14:30 UTC', () => {
    expect(isWithinMarketHours(new Date('2026-01-30T14:30:00Z'))).toBe(true);
    expect(isWithinMarketHours(new Date('2026-01-30T14:29:00Z'))).toBe(false);
  });
  it('is false on the weekend even at midday ET', () => {
    expect(isWithinMarketHours(new Date('2026-08-01T16:00:00Z'))).toBe(false); // Saturday
    expect(isWithinMarketHours(new Date('2026-08-02T16:00:00Z'))).toBe(false); // Sunday
  });
});

describe('parseTradeAlertBody', () => {
  const good = { reason: 'signal', headline: 'SOXL crossed 42', context: 'volume bar', idempotencyKey: 'abc123' };

  it('accepts a valid body and trims fields', () => {
    const r = parseTradeAlertBody({ ...good, headline: '  SOXL crossed 42  ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.headline).toBe('SOXL crossed 42');
  });

  it('allows an empty context (pre-written by the monitor, may be blank)', () => {
    const r = parseTradeAlertBody({ ...good, context: '' });
    expect(r.ok).toBe(true);
  });

  it('rejects a non-object body', () => {
    expect(parseTradeAlertBody(null).ok).toBe(false);
    expect(parseTradeAlertBody('str').ok).toBe(false);
  });

  it('rejects missing required fields', () => {
    expect(parseTradeAlertBody({ ...good, reason: '' }).ok).toBe(false);
    expect(parseTradeAlertBody({ ...good, headline: '   ' }).ok).toBe(false);
    expect(parseTradeAlertBody({ ...good, idempotencyKey: undefined }).ok).toBe(false);
  });

  it('rejects an over-long context (prompt-stuffing guard)', () => {
    const r = parseTradeAlertBody({ ...good, context: 'x'.repeat(501) });
    expect(r.ok).toBe(false);
  });
});

it('daily cap constant is 3', () => {
  expect(TRADE_ALERT_MAX_PER_DAY).toBe(3);
});
