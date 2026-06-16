import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { recommendFocusAreas, type EnergySignal } from '@/lib/focusRecommendation';
import { priorityQueries, userQueries } from '@/lib/db';
import { getCalendarEvents } from '@/lib/calendar';
import { getLatestRecovery } from '@/lib/whoop';

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
  const [whoopRec, todayEvents, anchors] = await Promise.all([
    getLatestRecovery(user.id).catch(() => null),
    getCalendarEvents(user.id).catch(() => null),
    Promise.resolve(priorityQueries.getMostRecent(user.id)).catch(() => []),
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
  });

  return NextResponse.json(recommendation);
}
