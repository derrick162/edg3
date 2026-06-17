/**
 * IP-based rate limiting for EDG3 auth + admin endpoints (#8).
 *
 * Uses a fixed-window counter backed by SQLite (consistent with the existing
 * architecture, no Redis dependency). The window resets after `windowMs`; requests
 * beyond the limit receive a 429 with a Retry-After header.
 *
 * Limits (chosen to accommodate real users while blocking abuse):
 *   login          — 10 per 15 min per IP    (brute-force protection)
 *   signup         — 5  per 60 min per IP    (spam/scraper prevention)
 *   trigger-call   — 3  per  5 min per IP    (admin endpoint; costly Vapi call)
 *   dayPlan        — 10 per 60 min per user  (LLM plan generation)
 *   dayPlanConfirm — 5  per 60 min per user  (calendar mutations + LLM)
 *   focusRecommend — 20 per 60 min per user  (LLM recommendation)
 *   focusConfirm   — 30 per 60 min per user  (DB write)
 *   calendarScores — 20 per 60 min per user  (LLM scoring)
 *   factEdit       — 20 per 60 min per user  (fact corrections/deletions)
 *   emailReceipt   — 60 per 60 min per user  (Activity receipt reads)
 *
 * The NextRequest helper extracts the real client IP from Railway's proxy headers.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { rateLimitQueries } from './db';

// ── Limits ────────────────────────────────────────────────────────────────────

export const LIMITS = {
  login:          { limit: 10, windowMs: 15 * 60 * 1000 },  // 10 / 15 min
  signup:         { limit: 5,  windowMs: 60 * 60 * 1000 },  // 5 / hour
  triggerCall:    { limit: 3,  windowMs:  5 * 60 * 1000 },  // 3 / 5 min
  adminApi:       { limit: 60, windowMs: 60 * 1000 },        // 60 / min (CoS agent)
  dayPlan:        { limit: 10, windowMs: 60 * 60 * 1000 },  // 10 / hour per user
  dayPlanConfirm: { limit: 5,  windowMs: 60 * 60 * 1000 },  // 5  / hour per user
  focusRecommend: { limit: 20, windowMs: 60 * 60 * 1000 },  // 20 / hour per user
  focusConfirm:   { limit: 30, windowMs: 60 * 60 * 1000 },  // 30 / hour per user
  calendarScores: { limit: 20, windowMs: 60 * 60 * 1000 },  // 20 / hour per user
  learned:        { limit: 30, windowMs: 60 * 60 * 1000 },  // 30 / hour per user
  openLoops:      { limit: 60, windowMs: 60 * 60 * 1000 },  // 60 / hour per user (resolve/dismiss)
  openCall:       { limit: 5,  windowMs:  5 * 60 * 1000 },  // 5  / 5 min per user (Vapi call cost)
  briefingCall:   { limit: 3,  windowMs: 10 * 60 * 1000 },  // 3  / 10 min per user (manual call + retry)
  support:        { limit: 10, windowMs: 60 * 60 * 1000 },  // 10 / hour per user
  waitlist:       { limit: 5,  windowMs: 60 * 60 * 1000 },  // 5  / hour per IP (public signup, anti-spam)
  factEdit:       { limit: 20, windowMs: 60 * 60 * 1000 },  // 20 / hour per user (fact corrections)
  emailReceipt:   { limit: 60, windowMs: 60 * 60 * 1000 },  // 60 / hour per user (Activity receipt reads)
} as const;

export type RateLimitKey = keyof typeof LIMITS;

// ── IP extraction ─────────────────────────────────────────────────────────────

/**
 * Extract the real client IP from Railway's proxy headers.
 *
 * X-Forwarded-For is client-controlled for all but the rightmost entry.
 * Railway's load balancer appends the IP it observed, so the rightmost hop
 * is the one the proxy saw — clients cannot spoof it by sending a fake XFF.
 * Taking the leftmost (old behaviour) let attackers get a fresh rate-limit
 * bucket per request by rotating the XFF header.
 *
 * Falls back to x-real-ip then 'unknown' (local dev without a proxy).
 */
export function getClientIP(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const hops = xff.split(',').map(s => s.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1]; // rightmost = Railway-observed
  }
  return req.headers.get('x-real-ip') || 'unknown';
}

// ── Core check ────────────────────────────────────────────────────────────────

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;  // epoch ms
}

/**
 * Check + increment the rate-limit counter for a given type + IP.
 * Fails open (returns allowed: true) on any DB fault so a transient error
 * never locks out a legitimate user.
 */
export function checkRateLimit(type: RateLimitKey, ip: string): RateLimitResult {
  try {
    const { limit, windowMs } = LIMITS[type];
    const key = `${type}:${ip}`;
    const result = rateLimitQueries.check(key, limit, windowMs, Date.now());
    return { allowed: result.allowed, remaining: result.remaining, resetAt: result.resetAt };
  } catch (err) {
    // Fail open — never block a real user because of a transient DB fault.
    // Log loudly: a persistent fault here silently erases brute-force protection.
    console.error('[rateLimit] DB fault — failing open for', type, 'from', ip, err);
    return { allowed: true, remaining: 1, resetAt: Date.now() + 60_000 };
  }
}

// ── NextResponse helper ───────────────────────────────────────────────────────

/**
 * Build a 429 Too Many Requests response with standard rate-limit headers.
 * The Retry-After header tells the client how many seconds to wait.
 */
export function rateLimitResponse(resetAt: number): NextResponse {
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  return NextResponse.json(
    { error: 'Too many requests — please slow down and try again shortly.' },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSeconds),
        'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
      },
    }
  );
}
