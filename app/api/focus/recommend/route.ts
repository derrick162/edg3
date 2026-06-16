import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { recommendFocusAreas, type EnergySignal } from '@/lib/focusRecommendation';
import { priorityQueries, userQueries } from '@/lib/db';
import { getCalendarEvents } from '@/lib/calendar';
import { getLatestRecovery } from '@/lib/whoop';
import { getRecentEmailSignal } from '@/lib/gmail';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('focusRecommend', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  // Read timezone from user profile (default UTC)
  const profile = userQueries.findById(user.id);
  const tz = profile?.timezone ?? 'UTC';

  // Date in user's local timezone (YYYY-MM-DD)
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

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

  // Split the pool: first 3 shown, items 4-6 are replacement candidates.
  const { areas, ...rest } = recommendation;
  return NextResponse.json({
    ...rest,
    areas: areas.slice(0, 3),
    candidates: areas.slice(3),
  });
}
