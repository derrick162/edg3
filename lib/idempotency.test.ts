import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mock the DB layer ────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  claim: vi.fn(() => true),
  issue: vi.fn(() => 'AB12CD34'),
  consume: vi.fn(() => true),
  webhookClaim: vi.fn(() => true),
  webhookPrune: vi.fn(),
  tcClaim: vi.fn(() => true),
  tcRecord: vi.fn(),
  tcGetCached: vi.fn<() => string | null>(() => null),
  tcPrune: vi.fn(),
}));

vi.mock('./db', () => ({
  eventDedupeQueries: { claim: h.claim },
  deleteConfirmQueries: { issue: h.issue, consume: h.consume },
  webhookDedupeQueries: { claim: h.webhookClaim, prune: h.webhookPrune },
  toolCallDedupeQueries: { claim: h.tcClaim, recordResult: h.tcRecord, getCached: h.tcGetCached, prune: h.tcPrune },
}));

import { buildEventDedupeKey, claimEventCreate, issueDeleteToken, consumeDeleteToken, claimWebhookEvent, claimToolCall, recordToolCallResult, getToolCallCached } from './idempotency';

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

// ── issueDeleteToken ─────────────────────────────────────────────────────────
describe('issueDeleteToken', () => {
  it('returns the token string from the DB layer', () => {
    h.issue.mockReturnValue('DEADBEEF');
    expect(issueDeleteToken(1)).toBe('DEADBEEF');
  });

  it('passes userId, current timestamp, and 2-minute TTL to the DB layer', () => {
    const before = Date.now();
    issueDeleteToken(42);
    const after = Date.now();
    const [userId, nowMs, ttlMs] = (h.issue.mock.calls as any[])[0] as [number, number, number];
    expect(userId).toBe(42);
    expect(nowMs).toBeGreaterThanOrEqual(before);
    expect(nowMs).toBeLessThanOrEqual(after);
    expect(ttlMs).toBe(2 * 60 * 1000);
  });
});

// ── consumeDeleteToken ───────────────────────────────────────────────────────
describe('consumeDeleteToken', () => {
  it('returns true when the DB layer succeeds (valid token)', () => {
    h.consume.mockReturnValue(true);
    expect(consumeDeleteToken(1, 'AB12CD34')).toBe(true);
    expect(h.consume).toHaveBeenCalledWith('AB12CD34', 1, expect.any(Number));
  });

  it('returns false when the DB layer returns false (expired / wrong user / already used)', () => {
    h.consume.mockReturnValue(false);
    expect(consumeDeleteToken(1, 'STALETOKEN')).toBe(false);
  });

  it('returns false (fails closed) if the DB layer throws', () => {
    h.consume.mockImplementation(() => { throw new Error('db fault'); });
    // A fault during token validation should DENY the delete, not allow it (fail closed).
    expect(consumeDeleteToken(1, 'any')).toBe(false);
  });
});

// ── T4-4: claimWebhookEvent ──────────────────────────────────────────────────
describe('claimWebhookEvent', () => {
  it('returns true on first delivery (new event key)', () => {
    h.webhookClaim.mockReturnValue(true);
    expect(claimWebhookEvent('call_abc', 'end-of-call-report')).toBe(true);
    expect(h.webhookClaim).toHaveBeenCalledWith('call_abc:end-of-call-report');
  });

  it('returns false on duplicate delivery (same callId + type)', () => {
    h.webhookClaim.mockReturnValue(false);
    expect(claimWebhookEvent('call_abc', 'end-of-call-report')).toBe(false);
  });

  it('scopes the key to callId+type so different types on same call are independent', () => {
    claimWebhookEvent('call_xyz', 'call-ended');
    expect(h.webhookClaim).toHaveBeenCalledWith('call_xyz:call-ended');
  });

  it('fails open — returns true if DB layer throws', () => {
    h.webhookClaim.mockImplementation(() => { throw new Error('db fault'); });
    expect(claimWebhookEvent('call_err', 'end-of-call-report')).toBe(true);
  });
});

// ── T4-4: claimToolCall / recordToolCallResult / getToolCallCached ────────────
describe('claimToolCall', () => {
  it('returns true on first invocation (new toolCallId)', () => {
    h.tcClaim.mockReturnValue(true);
    expect(claimToolCall('tc_001')).toBe(true);
    expect(h.tcClaim).toHaveBeenCalledWith('tc_001');
  });

  it('returns false on duplicate (same toolCallId — Vapi retry)', () => {
    h.tcClaim.mockReturnValue(false);
    expect(claimToolCall('tc_001')).toBe(false);
  });

  it('fails open — returns true if DB layer throws', () => {
    h.tcClaim.mockImplementation(() => { throw new Error('db fault'); });
    expect(claimToolCall('tc_err')).toBe(true);
  });
});

describe('recordToolCallResult', () => {
  it('delegates to the DB layer with toolCallId and result', () => {
    recordToolCallResult('tc_001', 'Created event "Lunch" at 12:00');
    expect(h.tcRecord).toHaveBeenCalledWith('tc_001', 'Created event "Lunch" at 12:00');
  });
});

describe('getToolCallCached', () => {
  it('returns the cached result when available', () => {
    h.tcGetCached.mockReturnValue('Moved "Gym" to 7am');
    expect(getToolCallCached('tc_001')).toBe('Moved "Gym" to 7am');
  });

  it('returns null when no cached result exists (first call still in flight)', () => {
    h.tcGetCached.mockReturnValue(null);
    expect(getToolCallCached('tc_002')).toBeNull();
  });
});
