import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { recommendFocusAreas, type EnergySignal, type FocusArea } from '@/lib/focusRecommendation';
import { priorityQueries, userQueries, dailyFocusQueries, factQueries, memoryQueries, briefingQueries, whoopQueries } from '@/lib/db';
import { getCalendarEvents } from '@/lib/calendar';
import { getLatestRecovery } from '@/lib/whoop';
import { getRecentEmailSignal } from '@/lib/gmail';

/**
 * Build the "Based on:" provenance footer from cheap synchronous DB reads only
 * (no Google fetch, no LLM) — used on the cached fast path so the footer stays
 * populated without paying the slow-path cost.
 */
function buildBasedOnCheap(userId: number): string[] {
  const out: string[] = [];
  try {
    const facts     = factQueries.getAll(userId);
    const memories  = memoryQueries.getRecent(userId, 50);
    const briefings = briefingQueries.getRecent(userId, 30).filter(b => b.status === 'completed');
    const anchors   = priorityQueries.getMostRecent(userId);
    const whoop     = whoopQueries.get(userId);
    if (facts.length > 0)     out.push(`${facts.length} facts from calls`);
    if (memories.length > 0)  out.push(`${memories.length} recent call notes`);
    if (briefings.length > 0) out.push(`${briefings.length} briefing call${briefings.length !== 1 ? 's' : ''}`);
    if (anchors.length > 0)   out.push(`${anchors.length} overarching priorities`);
    if (whoop)                out.push('Whoop recovery');
  } catch {
    /* degrade to whatever we gathered */
  }
  return out;
}

export async function GET(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('focusRecommend', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  // Read timezone from user profile (default UTC)
  const profile = userQueries.findById(user.id);
  const tz = profile?.timezone ?? 'UTC';

  // Date in user's local timezone (YYYY-MM-DD)
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

  const forceRefresh = new URL(req.url).searchParams.get('refresh') === '1';

  // ── Fast path: serve today's already-generated recommendation ────────────────
  // The recommendation is "today's focus" — generated once (morning call or first
  // dashboard load) and stable for the day. Serving the cached row turns a
  // multi-second Sonnet call + 180-day Google fetch into an instant DB read.
  // A confirmed row is served too (the card shows its locked state from this data).
  if (!forceRefresh) {
    const cached = (() => { try { return dailyFocusQueries.getToday(user.id, date); } catch { return null; } })();
    if (cached) {
      let areas: FocusArea[] = [];
      try { areas = JSON.parse(cached.focus_areas); } catch { /* malformed — fall through to recompute */ }
      if (areas.length > 0) {
        return NextResponse.json({
          areas: areas.slice(0, 3),
          candidates: areas.slice(3),
          basedOn: buildBasedOnCheap(user.id),
          generatedAt: cached.generated_at,
          date,
          cached: true,
        });
      }
    }
  }

  // ── Slow path: compute fresh (cache miss or explicit ?refresh=1) ──────────────
  // Gather context in parallel; degrade silently on failure
  const [whoopRec, todayEvents, anchors, emailSignal] = await Promise.all([
    getLatestRecovery(user.id).catch(() => null),
    getCalendarEvents(user.id).catch(() => null),
    Promise.resolve(priorityQueries.getMostRecent(user.id)).catch(() => []),
    getRecentEmailSignal(user.id, { days: 14, max: 20 }).catch(() => null),
  ]);

  const energySignal: EnergySignal | null = whoopRec
    ? {
        tier: whoopRec.recoveryScore >= 67 ? 'green' : whoopRec.recoveryScore >= 34 ? 'yellow' : 'red',
        recoveryScore: whoopRec.recoveryScore,
        source: 'whoop',
      }
    : null;

  const recommendation = await recommendFocusAreas(user.id, {
    energySignal,
    todayEvents: todayEvents ?? undefined,
    anchors: anchors.length > 0 ? anchors : undefined,
    date,
    emailSignal: emailSignal ?? undefined,
  });

  // Cache the result for the rest of the day so subsequent loads are instant.
  // NEVER clobber an existing row (upsert resets confirmed=0): only write when no
  // row exists, or when explicitly refreshing an UNCONFIRMED row.
  if (recommendation.areas.length > 0) {
    try {
      const existing = dailyFocusQueries.getToday(user.id, date);
      if (!existing || (forceRefresh && !existing.confirmed)) {
        dailyFocusQueries.upsert(user.id, date, JSON.stringify(recommendation.areas), recommendation.generatedAt);
      }
    } catch {
      // Non-fatal — recommendation still returns even if caching fails.
    }
  }

  // Split the pool: first 3 shown, items 4-6 are replacement candidates.
  const { areas, ...rest } = recommendation;
  return NextResponse.json({
    ...rest,
    areas: areas.slice(0, 3),
    candidates: areas.slice(3),
  });
}
