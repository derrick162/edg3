import { NextResponse } from 'next/server';
import { format, startOfWeek } from 'date-fns';
import { getSession } from '@/lib/auth';
import { priorityQueries, factQueries, energyLogQueries, effectiveTimezone, energyProfileQueries, calendarScoreQueries, dailyFocusQueries, type Priority } from '@/lib/db';
import { getCalendarEvents, getWeekEvents } from '@/lib/calendar';
import { getLatestRecovery } from '@/lib/whoop';
import { deriveEnergySignal } from '@/lib/energy';
import { computeAlignment } from '@/lib/alignment';
import { computeCalendarFit, parseEnergyProfile, classifyEventsEnergy } from '@/lib/calendarScore';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

  const [todayEvents, weekEvents, whoopRecovery] = await Promise.all([
    getCalendarEvents(user.id).catch(() => []),
    getWeekEvents(user.id).catch(() => []),
    getLatestRecovery(user.id).catch(() => null),
  ]);

  const todayEnergyLog = (() => {
    try { return energyLogQueries.getToday(user.id, today); } catch { return undefined; }
  })();
  const energySignal = deriveEnergySignal(todayEnergyLog, whoopRecovery?.recoveryScore ?? null);

  const [alignment, taggedEvents] = await Promise.all([
    computeAlignment(priorities, weekEvents, userTimezone).catch(() => null),
    classifyEventsEnergy(todayEvents).catch(() => []),
  ]);

  // Structured energy profile from DB; fall back to parsing from preference facts.
  const dbProfile = (() => { try { return energyProfileQueries.get(user.id); } catch { return undefined; } })();
  const energyProfile = dbProfile
    ? {
        peakStart:   dbProfile.peak_start,
        peakEnd:     dbProfile.peak_end,
        troughStart: dbProfile.trough_start,
        troughEnd:   dbProfile.trough_end,
      }
    : (() => {
        try {
          const stmts = factQueries.getAll(user.id).filter(f => f.category === 'preference').map(f => f.statement);
          return parseEnergyProfile(stmts);
        } catch { return null; }
      })();

  const fit = computeCalendarFit(taggedEvents, alignment, priorities, energySignal, energyProfile);

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
