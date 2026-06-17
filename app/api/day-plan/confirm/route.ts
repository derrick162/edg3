import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { userQueries, priorityQueries, calendarScoreQueries, effectiveTimezone, calendarQueries, auditLogQueries, calendarPlanQueries } from '@/lib/db';
import { getOAuthClient, getCalendarEvents, getWeekEvents } from '@/lib/calendar';
import { getRecoveryHistory, getLastSleep } from '@/lib/whoop';
import { computeCalendarFit } from '@/lib/calendarScore';
import { computeAlignment } from '@/lib/alignment';
import { buildCalendarPlan } from '@/lib/calendarPlan';
import { consumeDeleteToken } from '@/lib/idempotency';
import { recordUndo, type UndoOp } from '@/lib/undo';
import { wallTimeToUtc, timedEventDateMove } from '@/lib/time';
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

  const fit = computeCalendarFit(alignment, priorities, recoveryHistory, todaySleep);
  const plan = buildCalendarPlan(todayEvents, fit, priorities, today, userTz);

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
        }
      } catch (err) {
        console.error('[day-plan/confirm] move failed:', err);
      }
    }
  }

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
    const newFit = computeCalendarFit(newAlignment, priorities, recoveryHistory, todaySleep);
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

  return NextResponse.json({ ok: true, newScore: newEdgeScore, count: doneDescs.length });
}
