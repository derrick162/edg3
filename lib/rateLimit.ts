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
import { rateLimitQueries, inboundCallQueries } from './db';

// ── Inbound call rate limit (R18) ───────────────────────────────────────────────
// Phone-keyed (not user/IP): cap inbound calls to the Twilio number at 5 per rolling 24h
// per phone number, so a single caller can't rack up Vapi/LLM cost or abuse the line.
const INBOUND_CALL_LIMIT = 5;
const INBOUND_CALL_WINDOW_MS = 24 * 60 * 60 * 1000;

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
  factEdit:          { limit: 20, windowMs: 60 * 60 * 1000 },  // 20 / hour per user (fact corrections)
  emailReceipt:      { limit: 60, windowMs: 60 * 60 * 1000 },  // 60 / hour per user (Activity receipt reads)
  briefingGenerate:  { limit: 5,  windowMs: 60 * 60 * 1000 },  // 5  / hour per user (LLM briefing gen)
  briefingIntro:     { limit: 3,  windowMs: 60 * 60 * 1000 },  // 3  / hour per user (Vapi intro call)
  calendarBook:      { limit: 20, windowMs: 60 * 60 * 1000 },  // 20 / hour per user (web calendar create)
  energyToday:       { limit: 30, windowMs: 60 * 60 * 1000 },  // 30 / hour per user (energy log write)
  meetingContext:    { limit: 30, windowMs: 60 * 60 * 1000 },  // 30 / hour per user (Google + facts read)
  notifications:     { limit: 30, windowMs: 60 * 60 * 1000 },  // 30 / hour per user (check/markRead)
  tasksWrite:        { limit: 60, windowMs: 60 * 60 * 1000 },  // 60 / hour per user (create / complete)
  undoPost:          { limit: 20, windowMs: 60 * 60 * 1000 },  // 20 / hour per user (calendar mutations)
  priorityDerive:    { limit: 5,  windowMs: 60 * 60 * 1000 },  // 5  / hour per user (LLM synthesis)
  priorityAccept:    { limit: 20, windowMs: 60 * 60 * 1000 },  // 20 / hour per user (accept proposed priorities)
  suggestPriorities:    { limit: 5,  windowMs: 60 * 60 * 1000 },  // 5  / hour per user (LLM onboarding suggestion)
  accountDelete:        { limit: 3,  windowMs: 60 * 60 * 1000 },  // 3  / hour per user (destructive cascade)
  accountExport:        { limit: 5,  windowMs: 60 * 60 * 1000 },  // 5  / hour per user (full PII decrypt + download)
  onboardingPriorities: { limit: 10, windowMs: 60 * 60 * 1000 },  // 10 / hour per user (writes priorities + memory + facts)
  prioritiesKeep:       { limit: 20, windowMs: 60 * 60 * 1000 },  // 20 / hour per user (refresh priorities week_of)
  onboardingProfile:    { limit: 5,  windowMs: 60 * 60 * 1000 },  // 5  / hour per user (profile write + LLM prompt input)
  onboardingCallTime:   { limit: 10, windowMs: 60 * 60 * 1000 },  // 10 / hour per user (triggers Google Calendar API)
  profileUpdate:        { limit: 10, windowMs: 60 * 60 * 1000 },  // 10 / hour per user (profile write + LLM prompt input)
  consentUpdate:        { limit: 10, windowMs: 60 * 60 * 1000 },  // 10 / hour per user (privacy setting change)
  calendarDisconnect:   { limit: 5,  windowMs: 60 * 60 * 1000 },  // 5  / hour per user (OAuth revocation)
  whoopDisconnect:      { limit: 5,  windowMs: 60 * 60 * 1000 },  // 5  / hour per user (OAuth revocation)
  gmailDisconnect:      { limit: 5,  windowMs: 60 * 60 * 1000 },  // 5  / hour per user (Gmail account OAuth revocation)
  gmailConnect:         { limit: 10, windowMs: 60 * 60 * 1000 },  // 10 / hour per user (Gmail account OAuth initiate)
  gmailIngest:          { limit: 6,  windowMs: 60 * 60 * 1000 },  // 6  / hour per user (Gmail contact ingest — many external API reads)
  calendarReminder:     { limit: 10, windowMs: 60 * 60 * 1000 },  // 10 / hour per user (recurring calendar event set/remove)
  profileTimezone:      { limit: 20, windowMs: 60 * 60 * 1000 },  // 20 / hour per user (travel timezone override)
  priorityEnergy:       { limit: 30, windowMs: 60 * 60 * 1000 },  // 30 / hour per user (priority energy-cost tag)
  milestoneWrite:       { limit: 60, windowMs: 60 * 60 * 1000 },  // 60 / hour per user (milestone create/complete/delete)
  vapiToolCall:         { limit: 60, windowMs: 60 * 1000 },        // 60 / MIN per user (R11 T2 — runaway Vapi tool-loop guard: cost + calendar-spam protection)
  pushSubscribe:        { limit: 30, windowMs: 60 * 60 * 1000 },   // 30 / hour per user (R14 — push subscribe/unsubscribe)
  callFeedback:         { limit: 30, windowMs: 60 * 60 * 1000 },   // 30 / hour per user (R17 T2 — post-call 1–5 star rating)
  gratitudeMode:        { limit: 30, windowMs: 60 * 60 * 1000 },   // 30 / hour per user (R20 — gratitude-mode toggle)
  languageSetting:      { limit: 30, windowMs: 60 * 60 * 1000 },   // 30 / hour per user (R22 — call-language toggle)
  // S8 — anti-flood ceiling on the Vapi webhook, keyed per source IP. Vapi is a single upstream, so
  // this is effectively a DoS backstop, NOT a tight limit — set well above realistic multi-user
  // volume (~4–6 events/call) and fail-open so a legit call-ended event is never dropped. The real
  // retry defense is the idempotency layer (claimWebhookEvent); this only sheds a pathological flood.
  vapiWebhook:          { limit: 1000, windowMs: 60 * 1000 },      // 1000 / MIN per source IP
  // S8 — per-user post-call fact-extraction ceiling (Haiku cost). Normal load is ~1/call and calls
  // are already rate-limited; this is a cost backstop against a pathological extraction loop.
  factExtraction:       { limit: 10, windowMs: 60 * 60 * 1000 },   // 10 / hour per user
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

/**
 * R18 — inbound call rate limit. Caps a phone number at 5 inbound calls / rolling 24h.
 *  - On breach: returns `{ allowed: false, reason: 'rate_limit' }` and records nothing.
 *  - On pass:   records the attempt (so it counts toward the window) and returns `{ allowed: true }`.
 * `userId` is stored with the recorded attempt when the caller maps to a known account (else null).
 * Synchronous (better-sqlite3) — safe to `await` from the webhook either way. Fails OPEN on a DB
 * fault so a transient error never blocks a legitimate inbound call.
 */
export function checkInboundCallRateLimit(
  phoneNumber: string,
  userId: number | null = null,
): { allowed: boolean; reason?: string } {
  try {
    const count = inboundCallQueries.countSince(phoneNumber, Date.now() - INBOUND_CALL_WINDOW_MS);
    if (count >= INBOUND_CALL_LIMIT) return { allowed: false, reason: 'rate_limit' };
    inboundCallQueries.record(phoneNumber, userId, Date.now());
    return { allowed: true };
  } catch (err) {
    console.error('[rateLimit] inbound-call check DB fault — failing open for', phoneNumber, err);
    return { allowed: true };
  }
}
