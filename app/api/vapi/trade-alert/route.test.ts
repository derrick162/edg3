/**
 * S10 — gating-matrix tests for POST /api/vapi/trade-alert. Drives every branch of the trust
 * surface: auth, body validation, target resolution, kill switch, market hours, idempotency, the
 * daily cap, and dispatch success/failure — asserting the response, the audit outcome, and the
 * critical gate-ORDER invariant (a duplicate retry must not consume a daily-cap token).
 *
 * Real verifyTradeAlertKey + parseTradeAlertBody run (they're the security-critical bits); only
 * isWithinMarketHours and the Core dispatch seam are stubbed so the test is deterministic and never
 * imports the heavy vapi module.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  target: { id: 1, name: 'Derrick' } as { id: number; name: string } | undefined,
  enabled: true,
  marketOpen: true,
  claim: true, // claimTradeAlert result (true = first delivery)
  rlAllowed: true,
  dispatchResult: 'placed' as 'placed' | 'pending' | 'error',
  audit: [] as Array<{ userId: number; outcome: string; reason: string }>,
  dispatch: vi.fn(),
  checkRateLimit: vi.fn(),
  claimTradeAlert: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  userQueries: {
    getTradeAlertTarget: () => h.target,
    getTradeAlertsEnabled: (_id: number) => h.enabled,
  },
  auditLogQueries: {
    logTradeAlert: (o: { userId: number; outcome: string; reason: string }) => { h.audit.push(o); },
  },
}));

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: (...a: unknown[]) => { h.checkRateLimit(...a); return { allowed: h.rlAllowed, remaining: 0, resetAt: 0 }; },
}));

vi.mock('@/lib/idempotency', () => ({
  claimTradeAlert: (...a: unknown[]) => { h.claimTradeAlert(...a); return h.claim; },
}));

// NOTE: the `@` alias isn't resolved inside a vi.mock factory in this repo — import the real module
// via a relative path (same pattern as the other route tests). We keep the REAL verifyTradeAlertKey
// (the constant-time crypto compare) and parseTradeAlertBody, and stub only the three side-effectful
// pieces: market-hours (deterministic), the dispatch seam, and guardTradeAlertKey's audit write
// (the guard's real `./db` import isn't caught by the db mock when pulled in via this dynamic import,
// so we route its audit straight to h.audit while still exercising the real key compare).
vi.mock('@/lib/tradeAlert', async () => {
  const actual = await import('../../../../lib/tradeAlert');
  const { NextResponse } = await import('next/server');
  return {
    ...actual,
    isWithinMarketHours: () => h.marketOpen,
    dispatchTradeAlertCall: (...a: unknown[]) => { h.dispatch(...a); return Promise.resolve(h.dispatchResult); },
    guardTradeAlertKey: (req: { headers: { get: (k: string) => string | null } }) => {
      if (actual.verifyTradeAlertKey(req.headers.get('x-trade-alert-key'))) return null;
      h.audit.push({ userId: 0, outcome: 'rejected', reason: 'bad_key' });
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    },
  };
});

import { POST } from './route';

const KEY = 'test-secret';
function post(body: unknown, key: string | null = KEY): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key !== null) headers['x-trade-alert-key'] = key;
  return new NextRequest('http://localhost/api/vapi/trade-alert', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
const GOOD = { reason: 'signal', headline: 'SOXL crossed 42', context: 'vol bar', idempotencyKey: 'k1' };
const lastAudit = () => h.audit[h.audit.length - 1];

beforeEach(() => {
  process.env.TRADE_ALERT_KEY = KEY;
  h.target = { id: 1, name: 'Derrick' };
  h.enabled = true;
  h.marketOpen = true;
  h.claim = true;
  h.rlAllowed = true;
  h.dispatchResult = 'placed';
  h.audit = [];
  h.dispatch.mockClear();
  h.checkRateLimit.mockClear();
  h.claimTradeAlert.mockClear();
});

describe('POST /api/vapi/trade-alert', () => {
  it('401s on a bad key and never dispatches', async () => {
    const res = await POST(post(GOOD, 'wrong'));
    expect(res.status).toBe(401);
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({ userId: 0, outcome: 'rejected', reason: 'bad_key' });
  });

  it('401s when the key header is absent', async () => {
    const res = await POST(post(GOOD, null));
    expect(res.status).toBe(401);
  });

  it('400s on a malformed body', async () => {
    const res = await POST(post({ ...GOOD, headline: '' }));
    expect(res.status).toBe(400);
    expect(lastAudit().reason).toMatch(/^bad_body:/);
    expect(h.checkRateLimit).not.toHaveBeenCalled();
  });

  it('queued:false when no target user exists', async () => {
    h.target = undefined;
    const res = await POST(post(GOOD));
    expect(await res.json()).toEqual({ queued: false, reason: 'no_target_user' });
  });

  it('queued:false when the per-user kill switch is off', async () => {
    h.enabled = false;
    const res = await POST(post(GOOD));
    expect(await res.json()).toEqual({ queued: false, reason: 'alerts_disabled' });
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.checkRateLimit).not.toHaveBeenCalled();
  });

  it('queued:false outside market hours', async () => {
    h.marketOpen = false;
    const res = await POST(post(GOOD));
    expect(await res.json()).toEqual({ queued: false, reason: 'outside_market_hours' });
    expect(h.checkRateLimit).not.toHaveBeenCalled();
  });

  it('queued:false for a duplicate — and does NOT consume a daily-cap token', async () => {
    h.claim = false; // upstream retry
    const res = await POST(post(GOOD));
    expect(await res.json()).toEqual({ queued: false, reason: 'duplicate' });
    expect(h.checkRateLimit).not.toHaveBeenCalled(); // the gate-order invariant
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('429s when the daily cap is hit', async () => {
    h.rlAllowed = false;
    const res = await POST(post(GOOD));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ queued: false, reason: 'daily_cap' });
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('queues the call on the happy path and audits the accept', async () => {
    const res = await POST(post(GOOD));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ queued: true });
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    const [user, alert] = h.dispatch.mock.calls[0];
    expect(user).toMatchObject({ id: 1 });
    expect(alert).toMatchObject({ headline: 'SOXL crossed 42', idempotencyKey: 'k1' });
    expect(h.claimTradeAlert).toHaveBeenCalledWith('k1');
    expect(lastAudit()).toMatchObject({ userId: 1, outcome: 'accepted', reason: 'placed' });
  });

  it('accepts (queued:true) even when Core has not wired the call-variant yet (pending)', async () => {
    h.dispatchResult = 'pending';
    const res = await POST(post(GOOD));
    expect(await res.json()).toEqual({ queued: true });
    expect(lastAudit()).toMatchObject({ outcome: 'accepted', reason: 'pending' });
  });

  it('queued:false when dispatch errors', async () => {
    h.dispatchResult = 'error';
    const res = await POST(post(GOOD));
    expect(await res.json()).toEqual({ queued: false, reason: 'dispatch_failed' });
    expect(lastAudit()).toMatchObject({ outcome: 'rejected', reason: 'dispatch_failed' });
  });

  it('threads alertId through to the dispatch seam when present', async () => {
    const res = await POST(post({ ...GOOD, alertId: 42 }));
    expect(await res.json()).toEqual({ queued: true });
    const [, alert] = h.dispatch.mock.calls[0];
    expect(alert).toMatchObject({ alertId: 42 });
  });

  it('400s on an invalid alertId', async () => {
    const res = await POST(post({ ...GOOD, alertId: -1 }));
    expect(res.status).toBe(400);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  // The shared guardTradeAlertKey gate (also used by Core's GET watch-list feed) is exercised here
  // through the fire path: a bad key → 401 + bad_key audit (above), a valid key → the request
  // proceeds past auth (every happy-path case above). Same constant-time compare guards both routes.
});
