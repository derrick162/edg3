import { NextResponse } from 'next/server';
import { format, startOfWeek } from 'date-fns';
import { getSession } from '@/lib/auth';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { priorityQueries, effectiveTimezone, calendarScoreQueries, dailyFocusQueries, calendarQueries, whoopQueries, factQueries, memoryQueries, briefingQueries, getDb, type Priority } from '@/lib/db';
import { getWeekEvents } from '@/lib/calendar';
import { getRecoveryHistory, getLastSleep } from '@/lib/whoop';
import { computeAlignment } from '@/lib/alignment';
import { computeCalendarFit, type ClarityInputs, type MomentumInputs } from '@/lib/calendarScore';
import { computeCallStreak } from '@/lib/streak';
import { maybeCreateScoreChangeNotif } from '@/lib/notifications';
import { summarizeScoreChange } from '@/lib/scoreChange';

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

  // Clarity + Momentum inputs — synchronous DB reads, no I/O.
  const clarityInputs: ClarityInputs = (() => {
    try {
      const calToken   = calendarQueries.get(user.id);
      const calScope   = calToken?.scope ?? '';
      const whoopToken = whoopQueries.get(user.id);
      const facts      = factQueries.getAll(user.id);
      const memories   = memoryQueries.getRecent(user.id, 50);
      const briefings  = briefingQueries.getRecent(user.id, 30);
      return {
        calendarConnected:  !!calToken,
        gmailReadGranted:   calScope.includes('gmail'),
        whoopConnected:     !!whoopToken,
        factsCount:         facts.length,
        memoriesCount:      memories.length,
        prioritiesCount:    priorities.length,
      };
    } catch {
      return { calendarConnected: false, gmailReadGranted: false, whoopConnected: false, factsCount: 0, memoriesCount: 0, prioritiesCount: 0 };
    }
  })();

  const momentumInputs: MomentumInputs = (() => {
    try {
      const briefings14d = briefingQueries.getRecent(user.id, 30);
      const now = new Date();
      const cut14 = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      const cut7  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);
      const completedAll = briefings14d.filter(b => b.status === 'completed');
      const c14 = completedAll.filter(b => new Date(b.scheduled_for) >= cut14);
      const completedCallDays14d = new Set(c14.map(b => b.scheduled_for.slice(0, 10))).size;
      const completedCallDays7d  = new Set(
        c14.filter(b => new Date(b.scheduled_for) >= cut7).map(b => b.scheduled_for.slice(0, 10))
      ).size;
      const streakDays = computeCallStreak(briefings14d, userTimezone);
      const cut14Str = cut14.toISOString().slice(0, 10);
      const confirmedRow = getDb().prepare(
        "SELECT COUNT(DISTINCT date) AS n FROM daily_focus WHERE user_id = ? AND confirmed = 1 AND date >= ?"
      ).get(user.id, cut14Str) as { n: number };
      return { completedCallDays14d, completedCallDays7d, confirmedFocusDays14d: confirmedRow.n, streakDays, confirmedToday: !!dailyFocus?.confirmed };
    } catch {
      return { completedCallDays14d: 0, completedCallDays7d: 0, confirmedFocusDays14d: 0, streakDays: 0, confirmedToday: !!dailyFocus?.confirmed };
    }
  })();

  const fit = computeCalendarFit(alignment, priorities, recoveryHistory, todaySleep, 45, clarityInputs, momentumInputs);

  // Focus is the ONLY component derived from a live LLM classification (computeAlignment)
  // + a Google Calendar fetch, so it's the only one that can transiently fail. When it
  // does, computeFocusScore returns 0 — which made the headline flicker to a misleading
  // low value on refresh (and, because we persisted it, polluted the trend + showed again).
  // Treat focus as RELIABLE only when alignment succeeded AND we actually had events.
  const focusReliable = alignment !== null && weekEvents.length > 0;

  if (focusReliable) {
    // Persist the good score for trend analysis + fire score-change notification.
    try {
      calendarScoreQueries.upsert(user.id, today, {
        edgeScore:     fit.edgeScore,
        focusScore:    fit.focusScore.score,
        energyScore:   fit.energyScore.score,
        focusDrivers:  fit.focusScore.drivers,
        energyDrivers: fit.energyScore.drivers,
      });
      maybeCreateScoreChangeNotif(user.id, fit.edgeScore, today);
    } catch {
      // Non-fatal — scoring still returns even if persistence fails.
    }
  } else {
    // Degraded compute (LLM/Google hiccup). Do NOT persist a transient 0 — that would
    // flicker the UI and corrupt the trend. Serve the last good score so the number
    // stays stable across refreshes when nothing actually changed.
    // R9 T5 Fix A: explain WHY it couldn't refresh, not just that it couldn't.
    let reason: string;
    if (priorities.length === 0) {
      reason = 'Set your priorities to activate Focus Score.';
    } else if (alignment === null) {
      console.error(`[scores] focus alignment unavailable for user ${user.id} — Google/LLM step failed`);
      reason = 'Calendar alignment unavailable — check your Google Calendar connection.';
    } else {
      reason = 'No calendar events found for this week.';
    }
    try {
      const lastGood = calendarScoreQueries.getLatest(user.id);
      if (lastGood && lastGood.focus_score != null) {
        fit.focusScore.score = lastGood.focus_score;
        fit.focusScore.calibrating = false;
        fit.focusScore.drivers = [`Showing your most recent Focus Score — ${reason}`];
        fit.focusScore.topFix = null;
        if (lastGood.edge_score != null) fit.edgeScore = lastGood.edge_score;
      } else {
        // No history yet — show focus as calibrating with the specific reason.
        fit.focusScore.calibrating = true;
        fit.focusScore.drivers = [reason];
      }
    } catch {
      // Ignore — fall through with computed values.
    }
  }

  // 7-day Edge Score trend (oldest→newest) for the sparkline + trend arrow.
  // Read after the upsert so today's point is included.
  let history: { date: string; score: number }[] = [];
  try {
    const from = new Date(today);
    from.setDate(from.getDate() - 6);
    const fromStr = from.toISOString().slice(0, 10);
    history = calendarScoreQueries.getRange(user.id, fromStr, today)
      .filter(r => r.edge_score !== null && r.edge_score !== undefined)
      .map(r => ({ date: r.date, score: r.edge_score as number }));
  } catch {
    // Non-fatal — trend is additive; scoring still returns without it.
  }

  // Score change summary — diff vs most-recent prior snapshot for transparency.
  let change = null;
  try {
    const prior = calendarScoreQueries.getPrior(user.id, today);
    change = summarizeScoreChange(fit.edgeScore, { focusScore: fit.focusScore, energyScore: fit.energyScore }, prior ?? null, today);
  } catch {
    // Non-fatal — change is additive context only.
  }

  return NextResponse.json({ ...fit, history, ...(change ? { change } : {}) });
}
