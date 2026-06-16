import { NextResponse } from 'next/server';
import { format, startOfWeek } from 'date-fns';
import { getSession } from '@/lib/auth';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { priorityQueries, effectiveTimezone, calendarScoreQueries, dailyFocusQueries, calendarQueries, whoopQueries, factQueries, memoryQueries, briefingQueries, type Priority } from '@/lib/db';
import { getWeekEvents } from '@/lib/calendar';
import { getRecoveryHistory, getLastSleep } from '@/lib/whoop';
import { computeAlignment } from '@/lib/alignment';
import { computeCalendarFit, type IntelligenceInputs } from '@/lib/calendarScore';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('calendarScores', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  const userTimezone = effectiveTimezone(user);
  const today  = new Date().toLocaleDateString('en-CA', { timeZone: userTimezone });
  const weekOf = format(startOfWeek(new Date()), 'yyyy-MM-dd');

  // Prefer confirmed daily_focus (from FocusRecommendationCard) → fall back to most-recent
  // priorities (any week, not strict this-week). This closes the loop: confirming a
  // focus recommendation now drives the Focus Score immediately.
  let priorities: Priority[];
  const dailyFocus = (() => { try { return dailyFocusQueries.getToday(user.id, today); } catch { return null; } })();
  if (dailyFocus?.confirmed) {
    try {
      const areas: { title: string }[] = JSON.parse(dailyFocus.focus_areas);
      const synth = areas.filter(a => a.title).map((a, i) => ({
        id: -(i + 1),
        user_id: user.id,
        text: a.title,
        week_of: weekOf,
        rank: i + 1,
        energy_cost: null as null,
        created_at: today,
      }));
      priorities = synth.length > 0 ? synth : priorityQueries.getMostRecent(user.id);
    } catch {
      priorities = priorityQueries.getMostRecent(user.id);
    }
  } else {
    priorities = priorityQueries.getMostRecent(user.id);
  }

  const [weekEvents, recoveryHistory, todaySleep] = await Promise.all([
    getWeekEvents(user.id).catch(() => []),
    getRecoveryHistory(user.id, 7).catch(() => []),
    getLastSleep(user.id).catch(() => null),
  ]);

  const alignment = await computeAlignment(priorities, weekEvents, userTimezone).catch(() => null);

  // Intelligence Score inputs — synchronous DB reads, no I/O.
  const intelligenceInputs: IntelligenceInputs = (() => {
    try {
      const calToken    = calendarQueries.get(user.id);
      const calScope    = calToken?.scope ?? '';
      const whoopToken  = whoopQueries.get(user.id);
      const facts       = factQueries.getAll(user.id);
      const memories    = memoryQueries.getRecent(user.id, 50);
      const briefings   = briefingQueries.getRecent(user.id, 30);
      return {
        calendarConnected: !!calToken,
        gmailReadGranted:  calScope.includes('gmail'),
        whoopConnected:    !!whoopToken,
        factsCount:        facts.length,
        memoriesCount:     memories.length,
        briefingCallsCount: briefings.filter(b => b.status === 'completed').length,
        prioritiesCount:   priorities.length,
      };
    } catch {
      return { calendarConnected: false, gmailReadGranted: false, whoopConnected: false, factsCount: 0, memoriesCount: 0, briefingCallsCount: 0, prioritiesCount: 0 };
    }
  })();

  const fit = computeCalendarFit(alignment, priorities, recoveryHistory, todaySleep, 45, intelligenceInputs);

  // Persist today's scores for trend analysis.
  try {
    calendarScoreQueries.upsert(user.id, today, {
      edgeScore:     fit.edgeScore,
      focusScore:    fit.focusScore.score,
      energyScore:   fit.energyScore.score,
      focusDrivers:  fit.focusScore.drivers,
      energyDrivers: fit.energyScore.drivers,
    });
  } catch {
    // Non-fatal — scoring still returns even if persistence fails.
  }

  return NextResponse.json(fit);
}
