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

  // Source the focus areas the Focus Score measures against:
  //   1) today's CONFIRMED daily_focus (what Edge recommended + the user accepted), else
  //   2) the user's MOST-RECENT priorities (any week — not strict this-week, which is often empty).
  let priorities: Priority[] = priorityQueries.getMostRecent(user.id);
  try {
    const df = dailyFocusQueries.getToday(user.id, today);
    if (df && df.confirmed) {
      const areas = JSON.parse(df.focus_areas) as { title?: string }[];
      const titles = Array.isArray(areas)
        ? areas.map(a => (a?.title || '').trim()).filter(Boolean)
        : [];
      if (titles.length) {
        priorities = titles.map((t, i) => ({
          id: -1 - i, user_id: user.id, text: t, week_of: weekOf,
          rank: i + 1, energy_cost: null, created_at: '',
        }));
      }
    }
  } catch {
    // Malformed daily_focus → fall back to most-recent priorities (already set above).
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
