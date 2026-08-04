import { NextRequest, NextResponse } from 'next/server';
import { userQueries, auditLogQueries } from '@/lib/db';
import { checkRateLimit } from '@/lib/rateLimit';
import { claimTradeAlert } from '@/lib/idempotency';
import {
  guardTradeAlertKey,
  isWithinMarketHours,
  parseTradeAlertBody,
  dispatchTradeAlertCall,
} from '@/lib/tradeAlert';

// POST /api/vapi/trade-alert — Derrick's trade-monitor service posts market alerts; on accept, Edge
// places an outbound call to Derrick with the alert (Core's C14 call-variant, via the dispatch seam).
//
// This is a MACHINE-to-machine endpoint (no user session) — authenticated by the shared
// TRADE_ALERT_KEY secret, exactly like the Vapi webhook's x-vapi-secret. It is deliberately NOT part
// of the getSession() surface; the OWASP "every route needs a session" rule excludes secret-authed
// service endpoints (webhook, tool-call, this).
//
// Trust surface (S10) — a leaked key is a robocall vector, so gate hard, in this order:
//   1. constant-time key compare        (401)   — minimal work for an unauthenticated caller
//   2. body validation                  (400)
//   3. resolve target user              (200 queued:false if none)
//   4. per-user kill switch             (200 queued:false)
//   5. market-hours window              (200 queued:false)
//   6. idempotency dedupe               (200 queued:false)  — BEFORE the cap so retries never burn budget
//   7. ≤3/day hard cap                  (429)                — the backstop; consumed only on real accepts
//   8. dispatch the call + audit accept (200 queued:true)
// Every branch is audit-logged (accept or reject + reason).
export async function POST(req: NextRequest) {
  // 1) Authenticate (shared gate — same constant-time compare + bad_key audit as the GET feed).
  const authFail = guardTradeAlertKey(req);
  if (authFail) return authFail;

  // 2) Validate the payload.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = null;
  }
  const parsed = parseTradeAlertBody(raw);
  if (!parsed.ok) {
    auditLogQueries.logTradeAlert({ userId: 0, outcome: 'rejected', reason: `bad_body:${parsed.error}` });
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const alert = parsed.value;

  // 3) Resolve the target user (single-owner service; TRADE_ALERT_USER_ID overrides).
  const user = userQueries.getTradeAlertTarget();
  if (!user) {
    auditLogQueries.logTradeAlert({ userId: 0, outcome: 'rejected', reason: 'no_target_user', idempotencyKey: alert.idempotencyKey });
    return NextResponse.json({ queued: false, reason: 'no_target_user' });
  }

  // 4) Per-user kill switch.
  if (!userQueries.getTradeAlertsEnabled(user.id)) {
    auditLogQueries.logTradeAlert({ userId: user.id, outcome: 'rejected', reason: 'alerts_disabled', idempotencyKey: alert.idempotencyKey });
    return NextResponse.json({ queued: false, reason: 'alerts_disabled' });
  }

  // 5) Market-hours window (09:30–16:00 ET, Mon–Fri).
  if (!isWithinMarketHours(new Date())) {
    auditLogQueries.logTradeAlert({ userId: user.id, outcome: 'rejected', reason: 'outside_market_hours', idempotencyKey: alert.idempotencyKey });
    return NextResponse.json({ queued: false, reason: 'outside_market_hours' });
  }

  // 6) Idempotency — BEFORE the cap so an upstream retry of the same alert short-circuits here and
  //    never consumes a daily-cap token.
  if (!claimTradeAlert(alert.idempotencyKey)) {
    auditLogQueries.logTradeAlert({ userId: user.id, outcome: 'rejected', reason: 'duplicate', idempotencyKey: alert.idempotencyKey });
    return NextResponse.json({ queued: false, reason: 'duplicate' });
  }

  // 7) Daily cap — the hard backstop. Only genuine accepts (authed, enabled, in-hours, non-dup)
  //    reach here and consume a token.
  const rl = checkRateLimit('tradeAlert', String(user.id));
  if (!rl.allowed) {
    auditLogQueries.logTradeAlert({ userId: user.id, outcome: 'rejected', reason: 'daily_cap', idempotencyKey: alert.idempotencyKey });
    return NextResponse.json({ queued: false, reason: 'daily_cap' }, { status: 429 });
  }

  // 8) All gates passed — hand off to the Core call-variant and record the outcome.
  const dispatch = await dispatchTradeAlertCall(user, alert);
  if (dispatch === 'error') {
    auditLogQueries.logTradeAlert({ userId: user.id, outcome: 'rejected', reason: 'dispatch_failed', idempotencyKey: alert.idempotencyKey });
    return NextResponse.json({ queued: false, reason: 'dispatch_failed' });
  }
  auditLogQueries.logTradeAlert({ userId: user.id, outcome: 'accepted', reason: dispatch, idempotencyKey: alert.idempotencyKey });
  return NextResponse.json({ queued: true });
}
