import { NextResponse } from 'next/server';
import { format, startOfWeek } from 'date-fns';
import { getSession } from '@/lib/auth';
import { priorityQueries, factQueries, energyLogQueries, effectiveTimezone, energyProfileQueries, calendarScoreQueries } from '@/lib/db';
import { getCalendarEvents, getWeekEvents } from '@/lib/calendar';
import { getLatestRecovery } from '@/lib/whoop';
import { deriveEnergySignal } from '@/lib/energy';
import { computeAlignment } from '@/lib/alignment';
import { computeCalendarFit, parseEnergyProfile } from '@/lib/calendarScore';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userTimezone = effectiveTimezone(user);
  const today  = new Date().toLocaleDateString('en-CA', { timeZone: userTimezone });
  const weekOf = format(startOfWeek(new Date()), 'yyyy-MM-dd');

  const priorities = priorityQueries.getThisWeek(user.id, weekOf);

  const [todayEvents, weekEvents, whoopRecovery] = await Promise.all([
    getCalendarEvents(user.id).catch(() => []),
    getWeekEvents(user.id).catch(() => []),
    getLatestRecovery(user.id).catch(() => null),
  ]);

  const todayEnergyLog = (() => {
    try { return energyLogQueries.getToday(user.id, today); } catch { return undefined; }
  })();
  const energySignal = deriveEnergySignal(todayEnergyLog, whoopRecovery?.recoveryScore ?? null);

  const alignment = await computeAlignment(priorities, weekEvents, userTimezone).catch(() => null);

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

  const fit = computeCalendarFit(todayEvents, priorities, alignment, energySignal, energyProfile);

  // Persist today's scores for trend analysis.
  try {
    calendarScoreQueries.upsert(user.id, today, {
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
