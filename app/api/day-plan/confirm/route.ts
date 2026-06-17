import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { userQueries, priorityQueries, calendarScoreQueries, effectiveTimezone, calendarQueries, auditLogQueries, calendarPlanQueries, openLoopQueries, whoopQueries, factQueries, memoryQueries, briefingQueries, dailyFocusQueries, getDb } from '@/lib/db';
import { getOAuthClient, getCalendarEvents, getWeekEvents } from '@/lib/calendar';
import { getRecoveryHistory, getLastSleep } from '@/lib/whoop';
import { computeCalendarFit, type ClarityInputs, type MomentumInputs } from '@/lib/calendarScore';
import { computeAlignment } from '@/lib/alignment';
import { buildCalendarPlan, type PlanAction } from '@/lib/calendarPlan';
import { consumeDeleteToken } from '@/lib/idempotency';
import { recordUndo, type UndoOp } from '@/lib/undo';
import { wallTimeToUtc, timedEventDateMove } from '@/lib/time';
import { computeCallStreak } from '@/lib/streak';
import { google } from 'googleapis';

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('dayPlanConfirm', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  const body = await req.json().catch(() => ({}));
  const { planId } = body as { planId?: string };

  if (!planId || !consumeDeleteToken(user.id, planId)) {
    return NextResponse.json({ error: 'Invalid or expired plan ID' }, { status: 400 });
  }

  const profile = userQueries.findById(user.id);
  const userTz = profile ? effectiveTimezone(profile) : 'UTC';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: userTz }).format(new Date());

  const priorities = priorityQueries.getMostRecent(user.id);

  const [todayEvents, weekEvents, recoveryHistory, todaySleep] = await Promise.all([
    getCalendarEvents(user.id).catch(() => []),
    getWeekEvents(user.id).catch(() => []),
    getRecoveryHistory(user.id, 7).catch(() => []),
    getLastSleep(user.id).catch(() => null),
  ]);

  const alignment = await computeAlignment(priorities, weekEvents, userTz).catch(() => null);

  const openLoopsDueToday = (() => {
    try {
      return openLoopQueries.list(user.id, 'open')
        .filter(l => l.dueDate === today)
        .map(l => l.description);
    } catch { return []; }
  })();

  // Compute the same 4-component inputs as /api/day-plan so scoreBefore matches the dashboard.
  const clarityInputs: ClarityInputs = (() => {
    try {
      const calToken  = calendarQueries.get(user.id);
      const calScope  = calToken?.scope ?? '';
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
        briefingCallsCount: briefings.filter(b => b.status === 'completed').length,
        prioritiesCount:    priorities.length,
      };
    } catch {
      return { calendarConnected: true, gmailReadGranted: false, whoopConnected: false, factsCount: 0, memoriesCount: 0, briefingCallsCount: 0, prioritiesCount: priorities.length };
    }
  })();

  const momentumInputs: MomentumInputs = (() => {
    try {
      const briefings14d = briefingQueries.getRecent(user.id, 30);
      const now  = new Date();
      const cut14 = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      const cut7  = new Date(now.getTime() -  7 * 24 * 60 * 60 * 1000);
      const completedAll = briefings14d.filter(b => b.status === 'completed');
      const c14 = completedAll.filter(b => new Date(b.scheduled_for) >= cut14);
      const completedCallDays14d = new Set(c14.map(b => b.scheduled_for.slice(0, 10))).size;
      const completedCallDays7d  = new Set(
        c14.filter(b => new Date(b.scheduled_for) >= cut7).map(b => b.scheduled_for.slice(0, 10))
      ).size;
      const streakDays = computeCallStreak(briefings14d, userTz);
      const cut14Str = cut14.toISOString().slice(0, 10);
      const confirmedRow = getDb().prepare(
        'SELECT COUNT(DISTINCT date) AS n FROM daily_focus WHERE user_id = ? AND confirmed = 1 AND date >= ?'
      ).get(user.id, cut14Str) as { n: number };
      const dailyFocus = (() => { try { return dailyFocusQueries.getToday(user.id, today); } catch { return null; } })();
      return { completedCallDays14d, completedCallDays7d, confirmedFocusDays14d: confirmedRow.n, streakDays, confirmedToday: !!dailyFocus?.confirmed };
    } catch {
      return { completedCallDays14d: 0, completedCallDays7d: 0, confirmedFocusDays14d: 0, streakDays: 0, confirmedToday: false };
    }
  })();

  const fit = computeCalendarFit(alignment, priorities, recoveryHistory, todaySleep, 45, clarityInputs, momentumInputs);
  const scoreBefore = fit.edgeScore;
  const plan = buildCalendarPlan(todayEvents, fit, priorities, today, userTz, alignment, recoveryHistory, openLoopsDueToday, new Date().toISOString());

  // Build calendar client
  const tokenRow = calendarQueries.get(user.id);
  if (!tokenRow) return NextResponse.json({ error: 'Calendar not connected' }, { status: 400 });
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token ?? undefined,
    expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined,
  });
  const cal = google.calendar({ version: 'v3', auth: oauth2Client });

  const undoOps: UndoOp[] = [];
  const doneDescs: string[] = [];
  const doneActions: PlanAction[] = [];

  for (const action of plan.actions) {
    if (action.type === 'create' && action.title && action.startDateTime && action.endDateTime) {
      try {
        const startUtc = wallTimeToUtc(action.startDateTime, userTz);
        const endUtc   = wallTimeToUtc(action.endDateTime,   userTz);
        const res = await cal.events.insert({
          calendarId: 'primary',
          requestBody: {
            summary: `⚡ ${action.title}`,
            start: { dateTime: startUtc.toISOString(), timeZone: userTz },
            end:   { dateTime: endUtc.toISOString(),   timeZone: userTz },
            colorId: '9',
          },
        });
        if (res.data.id) {
          undoOps.push({ type: 'delete', calId: 'primary', eventId: res.data.id });
          doneDescs.push(action.description);
          doneActions.push(action);
        }
      } catch (err) {
        console.error('[day-plan/confirm] create failed:', err);
      }
    } else if (action.type === 'move' && action.eventId && action.newDate) {
      try {
        const evRes = await cal.events.get({ calendarId: 'primary', eventId: action.eventId });
        const moveEv = evRes.data;
        if (moveEv?.start?.dateTime) {
          const eventTz = moveEv.start.timeZone ?? userTz;
          const patch = timedEventDateMove(moveEv.start.dateTime, moveEv.end?.dateTime ?? '', action.newDate, eventTz);
          await cal.events.patch({
            calendarId: 'primary',
            eventId: action.eventId,
            requestBody: { start: patch.start, end: patch.end },
          });
          undoOps.push({ type: 'patch', calId: 'primary', eventId: action.eventId, requestBody: {
            start: { dateTime: moveEv.start.dateTime, timeZone: moveEv.start.timeZone ?? userTz },
            end: moveEv.end?.dateTime
              ? { dateTime: moveEv.end.dateTime, timeZone: moveEv.end.timeZone ?? userTz }
              : undefined,
          } });
          doneDescs.push(action.description);
          doneActions.push(action);
        }
      } catch (err) {
        console.error('[day-plan/confirm] move failed:', err);
      }
    }
  }

  // Build 1–3 plain-English change-lines from successfully applied actions for the
  // DayPlanCard "Day reshaped" toast. Prefer action.reason (already short + honest);
  // fall back to a truncated description so the toast is never empty.
  const changeLines = doneActions.slice(0, 3).map(a =>
    a.reason ?? a.description.slice(0, 80)
  );

  if (undoOps.length) {
    // Pass planId so undoPlan() can locate and revert the whole batch by planId.
    recordUndo(user.id, `day plan — ${doneDescs.length} action${doneDescs.length !== 1 ? 's' : ''}`, undoOps, planId);
  }

  // Record the execution so undoPlan() can markReverted and Core can idempotency-check.
  calendarPlanQueries.markApplied(user.id, planId, doneDescs.length);

  auditLogQueries.record({
    userId: user.id,
    action: 'applyDayPlan',
    argsJson: JSON.stringify({ planId, actionCount: plan.actions.length }),
    resultText: doneDescs.length > 0
      ? `Applied ${doneDescs.length} calendar change${doneDescs.length !== 1 ? 's' : ''}: ${doneDescs.slice(0, 3).join('; ')}${doneDescs.length > 3 ? ' …' : ''}`
      : 'No actions could be executed',
    ok: doneDescs.length > 0,
  });

  if (doneDescs.length === 0) {
    return NextResponse.json({ ok: false, error: 'No actions could be executed' }, { status: 422 });
  }

  // Re-score and persist
  let newEdgeScore: number | null = null;
  try {
    const [newTodayEvts, newWeekEvts] = await Promise.all([
      getCalendarEvents(user.id).catch(() => todayEvents),
      getWeekEvents(user.id).catch(() => weekEvents),
    ]);
    const newAlignment = await computeAlignment(priorities, newWeekEvts, userTz).catch(() => alignment);
    const newFit = computeCalendarFit(newAlignment, priorities, recoveryHistory, todaySleep, 45, clarityInputs, momentumInputs);
    newEdgeScore = newFit.edgeScore;
    try {
      calendarScoreQueries.upsert(user.id, today, {
        edgeScore:     newFit.edgeScore,
        focusScore:    newFit.focusScore.score,
        energyScore:   newFit.energyScore.score,
        focusDrivers:  newFit.focusScore.drivers,
        energyDrivers: newFit.energyScore.drivers,
      });
    } catch { /* non-fatal */ }
  } catch { /* non-fatal */ }

  return NextResponse.json({ ok: true, newScore: newEdgeScore, scoreBefore, changeLines, count: doneDescs.length });
}
