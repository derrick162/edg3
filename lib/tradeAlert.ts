// S10 — trust surface for the trade-alert endpoint (POST /api/vapi/trade-alert).
//
// Derrick's separate trade-monitor service POSTs market alerts here; on accept, Edge places an
// outbound call to Derrick with the alert (Core's C14 call-variant). This module holds the pure,
// unit-testable guardrails — constant-time key compare, market-hours window, body validation — plus
// the seam that hands an accepted alert to the Core call-variant. The endpoint route orchestrates
// these; keeping the tricky bits here means they can be tested without HTTP.
//
// Threat model: a leaked TRADE_ALERT_KEY is a robocall vector. Defense in depth = constant-time key
// compare + per-user kill switch + market-hours window + idempotency dedupe + a hard ≤3/day cap.

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { auditLogQueries, type User } from './db';

export const TRADE_ALERT_MAX_PER_DAY = 3;
export const MARKET_OPEN_MINUTES = 9 * 60 + 30; // 09:30 ET
export const MARKET_CLOSE_MINUTES = 16 * 60; // 16:00 ET
const CONTEXT_MAX = 500;
const HEADLINE_MAX = 200;
const REASON_MAX = 100;

/**
 * Constant-time comparison of the presented `x-trade-alert-key` against the `TRADE_ALERT_KEY` env
 * secret. Returns false if the secret is unset (endpoint effectively disabled) or the header is
 * absent. Both sides are SHA-256'd to a fixed 32 bytes before `timingSafeEqual`, so a length
 * mismatch neither throws (which would leak timing) nor short-circuits — the compare is constant
 * time regardless of input. The key is never logged anywhere in this module.
 */
export function verifyTradeAlertKey(presented: string | null | undefined): boolean {
  const secret = process.env.TRADE_ALERT_KEY;
  if (!secret || !presented) return false;
  const a = crypto.createHash('sha256').update(presented).digest();
  const b = crypto.createHash('sha256').update(secret).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * True iff `now` falls within US equity regular trading hours: 09:30–16:00 America/New_York,
 * Monday–Friday. Uses the ET wall clock via Intl, so EST/EDT is handled automatically. Market
 * holidays are intentionally NOT modeled — a holiday alert is a rare, low-harm miss, and a
 * hardcoded holiday calendar would rot; the daily cap + kill switch are the real backstops.
 */
export function isWithinMarketHours(now: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0; // some ICU builds emit '24' for midnight under hour12:false
  const minute = parseInt(get('minute'), 10);
  const mins = hour * 60 + minute;
  return mins >= MARKET_OPEN_MINUTES && mins < MARKET_CLOSE_MINUTES;
}

export interface TradeAlertBody {
  reason: string;
  headline: string;
  context: string;
  idempotencyKey: string;
  // Optional — the trade_alerts row (Core-owned table) this alert fired for. When present, Core's
  // call-variant marks that row 'fired' + stamps fired_at as it places the call.
  alertId?: number;
}

/**
 * Shared auth gate for BOTH externally-hit trade-alert endpoints: the POST fire path AND the GET
 * watch-list feed (`GET /api/vapi/trade-alerts` — Core-built, Security-gated). Constant-time key
 * compare; on failure audit-logs a `bad_key` reject (sentinel user 0) and returns a ready 401. The
 * GET feed leaks Derrick's watch-list if unauthenticated, so it MUST call this first — same rigor as
 * the POST. Returns null when the key is valid (proceed). The key is never logged.
 */
export function guardTradeAlertKey(req: NextRequest): NextResponse | null {
  if (verifyTradeAlertKey(req.headers.get('x-trade-alert-key'))) return null;
  auditLogQueries.logTradeAlert({ userId: 0, outcome: 'rejected', reason: 'bad_key' });
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

/**
 * Validate + normalize the POST body. `context` is pre-written by the trade monitor and may be
 * empty; `reason`, `headline`, and `idempotencyKey` are required. All fields are length-capped so a
 * compromised or buggy upstream can't stuff the call prompt or the dedupe table.
 */
export function parseTradeAlertBody(
  raw: unknown,
): { ok: true; value: TradeAlertBody } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'body must be a JSON object' };
  const o = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const reason = str(o.reason);
  const headline = str(o.headline);
  const context = str(o.context);
  const idempotencyKey = str(o.idempotencyKey);
  if (!reason) return { ok: false, error: 'reason required' };
  if (!headline) return { ok: false, error: 'headline required' };
  if (!idempotencyKey) return { ok: false, error: 'idempotencyKey required' };
  if (reason.length > REASON_MAX) return { ok: false, error: 'reason too long' };
  if (headline.length > HEADLINE_MAX) return { ok: false, error: 'headline too long' };
  if (context.length > CONTEXT_MAX) return { ok: false, error: `context exceeds ${CONTEXT_MAX} chars` };
  if (idempotencyKey.length > 200) return { ok: false, error: 'idempotencyKey too long' };
  // Optional alertId — accepts a number or numeric string; must be a positive integer if present.
  let alertId: number | undefined;
  if (o.alertId !== undefined && o.alertId !== null) {
    const n = typeof o.alertId === 'number'
      ? o.alertId
      : (typeof o.alertId === 'string' && /^\d+$/.test(o.alertId.trim()) ? Number(o.alertId.trim()) : NaN);
    if (!Number.isInteger(n) || n <= 0) return { ok: false, error: 'alertId must be a positive integer' };
    alertId = n;
  }
  return { ok: true, value: { reason, headline, context, idempotencyKey, ...(alertId !== undefined ? { alertId } : {}) } };
}

/**
 * SEAM to Core's C14 call-variant. On a fully-accepted alert the route calls this to place the
 * outbound "Edge calls Derrick with the alert" call. Core (Darren) exports `initiateTradeAlertCall`
 * from lib/vapi.ts; we import it lazily so this trust surface can ship and be tested before that
 * lands. Returns:
 *   'placed'  — the Core call-variant ran,
 *   'pending' — the endpoint is live but Core hasn't wired the call-variant yet (no-op, expected
 *               during the joint C14 handoff window),
 *   'error'   — the call-variant threw.
 * NEVER throws.
 *
 * Handoff contract for Darren: export
 *   `initiateTradeAlertCall(user: User, alert: TradeAlertBody): Promise<unknown>`
 * from lib/vapi.ts (short-call variant, maxDurationSeconds 300, prompt seeded with headline+context).
 */
export async function dispatchTradeAlertCall(
  user: User,
  alert: TradeAlertBody,
): Promise<'placed' | 'pending' | 'error'> {
  try {
    const vapi = (await import('./vapi')) as Record<string, unknown>;
    const fn = vapi['initiateTradeAlertCall'];
    if (typeof fn !== 'function') return 'pending';
    await (fn as (u: User, a: TradeAlertBody) => Promise<unknown>)(user, alert);
    return 'placed';
  } catch (e) {
    console.error('[tradeAlert] dispatch failed:', e instanceof Error ? e.message : e);
    return 'error';
  }
}
