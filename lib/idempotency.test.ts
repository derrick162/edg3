import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mock the DB layer ────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  claim: vi.fn(() => true),
}));

vi.mock('./db', () => ({
  eventDedupeQueries: { claim: h.claim },
}));

import { buildEventDedupeKey, claimEventCreate } from './idempotency';

beforeEach(() => vi.clearAllMocks());

// ── buildEventDedupeKey ──────────────────────────────────────────────────────
describe('buildEventDedupeKey', () => {
  it('produces a stable key from a timed ISO start', () => {
    const k = buildEventDedupeKey('Lunch with Sarah', '2026-06-10T12:30:00');
    expect(k).toBe('event:lunch with sarah:2026-06-10T12:30');
  });

  it('strips the ⚡ prefix so voice and web paths share the same key', () => {
    const voice = buildEventDedupeKey('⚡ Lunch with Sarah', '2026-06-10T12:30:00');
    const web   = buildEventDedupeKey('Lunch with Sarah',    '2026-06-10T12:30:00');
    expect(voice).toBe(web);
  });

  it('handles date-only strings (all-day events)', () => {
    const k = buildEventDedupeKey('Team off-site', '2026-06-15');
    expect(k).toBe('event:team off-site:2026-06-15');
  });

  it('trims whitespace and lowercases the title', () => {
    const k = buildEventDedupeKey('  DENTIST  ', '2026-06-10T09:00:00');
    expect(k).toBe('event:dentist:2026-06-10T09:00');
  });

  it('minute-level precision — seconds difference still maps to the same key', () => {
    const k1 = buildEventDedupeKey('Stand-up', '2026-06-10T09:00:00');
    const k2 = buildEventDedupeKey('Stand-up', '2026-06-10T09:00:59');
    expect(k1).toBe(k2);
  });

  it('different start minutes produce different keys (no false deduplication)', () => {
    const k1 = buildEventDedupeKey('Stand-up', '2026-06-10T09:00:00');
    const k2 = buildEventDedupeKey('Stand-up', '2026-06-10T09:30:00');
    expect(k1).not.toBe(k2);
  });
});

// ── claimEventCreate ─────────────────────────────────────────────────────────
describe('claimEventCreate', () => {
  it('returns true when the DB claim succeeds (first call)', () => {
    h.claim.mockReturnValue(true);
    expect(claimEventCreate(1, 'event:lunch:2026-06-10T12:00')).toBe(true);
    expect(h.claim).toHaveBeenCalledWith(1, 'event:lunch:2026-06-10T12:00', expect.any(Number), 300_000);
  });

  it('returns false when the DB claim fails (duplicate within TTL)', () => {
    h.claim.mockReturnValue(false);
    expect(claimEventCreate(1, 'event:lunch:2026-06-10T12:00')).toBe(false);
  });

  it('passes a 5-minute TTL to the DB layer', () => {
    claimEventCreate(99, 'some-key');
    const ttl = (h.claim.mock.calls as any[])[0][3] as number;
    expect(ttl).toBe(5 * 60 * 1000);
  });

  it('fails open — returns true if the DB layer throws', () => {
    h.claim.mockImplementation(() => { throw new Error('db fault'); });
    expect(claimEventCreate(1, 'any-key')).toBe(true); // never block a legitimate write
  });
});
