// R25 T4 — server-callable Edg3 Score computation + persistence, extracted so a nightly cron
// (Security) can fill trend gaps on days the user never opens the dashboard. Mirrors the
// compute+persist path of GET /api/scores; the route keeps its own (richer) response assembly.
// Background-job contract: NEVER throws — degrades silently on any failure.
import { format, startOfWeek } from 'date-fns';
import {
  userQueries, priorityQueries, effectiveTimezone, calendarScoreQueries, dailyFocusQueries,
  calendarQueries, whoopQueries, factQueries, memoryQueries, briefingQueries, getDb, type Priority,
} from './db';
import { getWeekEvents } from './calendar';
import { getRecoveryHistory, getLastSleep } from './whoop';
import { computeAlignment } from './alignment';
import { computeCalendarFit, type ClarityInputs, type MomentumInputs } from './calendarScore';
import { computeCallStreak } from './streak';
import { maybeCreateScoreChangeNotif } from './notifications';

/**
 * Compute today's Edg3 Score for a user and persist it (upsert into calendar_scores) when the
 * Focus component is reliable. No-op on degraded compute (LLM/Google hiccup) so we never write a
 * transient 0 that would corrupt the trend. Best-effort: swallows all errors.
 */
export async function computeAndSaveScore(userId: number): Promise<void> {
  try {
    const user = userQueries.findById(userId);
    if (!user) return;

    const userTimezone = effectiveTimezone(user);
    const today  = new Date().toLocaleDateString('en-CA', { timeZone: userTimezone });
    const weekOf = format(startOfWeek(new Date()), 'yyyy-MM-dd');

    // Prefer confirmed daily_focus → fall back to most-recent priorities (same as the route).
    const dailyFocus = (() => { try { return dailyFocusQueries.getToday(userId, today); } catch { return null; } })();
    let priorities: Priority[];
    if (dailyFocus?.confirmed) {
      try {
        const areas: { title: string }[] = JSON.parse(dailyFocus.focus_areas);
        const synth = areas.filter(a => a.title).map((a, i) => ({
          id: -(i + 1), user_id: userId, text: a.title, week_of: weekOf, rank: i + 1,
          energy_cost: null as null, created_at: today,
        }));
        priorities = synth.length > 0 ? synth : priorityQueries.getMostRecent(userId);
      } catch {
        priorities = priorityQueries.getMostRecent(userId);
      }
    } else {
      priorities = priorityQueries.getMostRecent(userId);
    }

    const [weekEvents, recoveryHistory, todaySleep] = await Promise.all([
      getWeekEvents(userId).catch(() => []),
      getRecoveryHistory(userId, 7).catch(() => []),
      getLastSleep(userId).catch(() => null),
    ]);

    const alignment = await computeAlignment(priorities, weekEvents, userTimezone).catch(() => null);

    const clarityInputs: ClarityInputs = (() => {
      try {
        const calToken   = calendarQueries.get(userId);
        const whoopToken = whoopQueries.get(userId);
        return {
          calendarConnected: !!calToken,
          gmailReadGranted:  (calToken?.scope ?? '').includes('gmail'),
          whoopConnected:    !!whoopToken,
          factsCount:        factQueries.getAll(userId).length,
          memoriesCount:     memoryQueries.getRecent(userId, 50).length,
          prioritiesCount:   priorities.length,
        };
      } catch {
        return { calendarConnected: false, gmailReadGranted: false, whoopConnected: false, factsCount: 0, memoriesCount: 0, prioritiesCount: 0 };
      }
    })();

    const momentumInputs: MomentumInputs = (() => {
      try {
        const briefings14d = briefingQueries.getRecent(userId, 30);
        const now = new Date();
        const cut14 = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
        const cut7  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);
        const completedAll = briefings14d.filter(b => b.status === 'completed');
        const c14 = completedAll.filter(b => new Date(b.scheduled_for) >= cut14);
        const localDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: userTimezone });
        const morningC14 = c14.filter(b => !b.is_open_call);
        const morningCallDays14d = new Set(morningC14.map(b => localDay(b.scheduled_for))).size;
        const morningCallDays7d  = new Set(morningC14.filter(b => new Date(b.scheduled_for) >= cut7).map(b => localDay(b.scheduled_for))).size;
        const openCallCount14d = c14.filter(b => !!b.is_open_call).length;
        const streakDays = computeCallStreak(briefings14d, userTimezone);
        const confirmedRow = getDb().prepare(
          "SELECT COUNT(DISTINCT date) AS n FROM daily_focus WHERE user_id = ? AND confirmed = 1 AND date >= ?"
        ).get(userId, cut14.toISOString().slice(0, 10)) as { n: number };
        return { morningCallDays14d, morningCallDays7d, openCallCount14d, confirmedFocusDays14d: confirmedRow.n, streakDays, confirmedToday: !!dailyFocus?.confirmed };
      } catch {
        return { morningCallDays14d: 0, morningCallDays7d: 0, openCallCount14d: 0, confirmedFocusDays14d: 0, streakDays: 0, confirmedToday: !!dailyFocus?.confirmed };
      }
    })();

    const fit = computeCalendarFit(alignment, priorities, recoveryHistory, todaySleep, 45, clarityInputs, momentumInputs);

    // Only persist when Focus is reliable (alignment succeeded AND events existed) — never write a
    // transient degraded 0 that would corrupt the trend.
    const focusReliable = alignment !== null && weekEvents.length > 0;
    if (!focusReliable) return;

    calendarScoreQueries.upsert(userId, today, {
      edgeScore:     fit.edgeScore,
      focusScore:    fit.focusScore.score,
      energyScore:   fit.energyScore.score,
      focusDrivers:  fit.focusScore.drivers,
      energyDrivers: fit.energyScore.drivers,
    });
    try { maybeCreateScoreChangeNotif(userId, fit.edgeScore, today); } catch { /* non-fatal */ }
  } catch {
    // Background job — never throw.
  }
}
