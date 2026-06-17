import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import {
  userQueries, priorityQueries, effectiveTimezone,
  calendarQueries, whoopQueries, factQueries, memoryQueries,
  briefingQueries, dailyFocusQueries, getDb,
} from '@/lib/db';
import { getCalendarEvents, getWeekEvents } from '@/lib/calendar';
import { getRecoveryHistory, getLastSleep } from '@/lib/whoop';
import { computeCalendarFit, type ClarityInputs, type MomentumInputs } from '@/lib/calendarScore';
import { computeAlignment } from '@/lib/alignment';
import { buildCalendarPlan, buildDiagnoses, patchAlignmentForPlan } from '@/lib/calendarPlan';
import { issueDeleteToken } from '@/lib/idempotency';
import { computeCallStreak } from '@/lib/streak';

interface PlanChange {
  op: 'create' | 'move' | 'delete' | 'recolor';
  title: string;
  detail: string;
  reason: string;
}

function fmtWall(dt: string): string {
  const timePart = dt.split('T')[1] ?? '';
  const [hStr, mStr] = timePart.split(':');
  const h = parseInt(hStr ?? '0', 10);
  const m = parseInt(mStr ?? '0', 10);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12} ${period}` : `${h12}:${mStr} ${period}`;
}

function fmtDate(dateStr: string): string {
  const parts = dateStr.split('-');
  const m = parseInt(parts[1] ?? '1', 10);
  const d = parseInt(parts[2] ?? '1', 10);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}`;
}

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('dayPlan', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

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

  // H2: compute 4-component inputs so scoreBefore matches the dashboard headline exactly.
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

  // H1: pass alignment + recovery so buildCalendarPlan can draw on all diagnosis signals.
  const fit = computeCalendarFit(alignment, priorities, recoveryHistory, todaySleep, 45, clarityInputs, momentumInputs);
  const plan = buildCalendarPlan(todayEvents, fit, priorities, today, userTz, alignment, recoveryHistory);
  const diagnoses = buildDiagnoses(alignment, weekEvents, recoveryHistory, userTz);

  // Always issue a token (well-aligned state also renders the card).
  const planId = issueDeleteToken(user.id);

  // H3: always return something so the card renders.
  if (plan.actions.length === 0) {
    return NextResponse.json({
      changes: [],
      scoreBefore: fit.edgeScore,
      scoreAfter:  fit.edgeScore,
      summary:     "Your day's well-aligned — nothing to reshape right now.",
      planId,
      diagnoses,
      wellAligned: true,
    });
  }

  const changes: PlanChange[] = plan.actions.map(action => {
    if (action.type === 'create') {
      const detail = action.startDateTime && action.endDateTime
        ? `${fmtWall(action.startDateTime)} – ${fmtWall(action.endDateTime)}`
        : 'Today';
      return {
        op: 'create' as const,
        title: action.title ?? 'Focus block',
        detail,
        reason: action.addresses === 'focus'
          ? 'No focused time blocked for this priority this week'
          : 'Align to your peak energy window',
      };
    }
    const detail = action.newDate ? `Today → ${fmtDate(action.newDate)}` : 'Move to tomorrow';
    return {
      op: 'move' as const,
      title: action.eventTitle ?? 'Event',
      detail,
      reason: action.addresses === 'energy'
        ? 'Recovery is low — protect your energy today'
        : 'Not aligned to your priorities this week',
    };
  });

  // H2: real score projection — patch alignment with plan deltas and recompute.
  const patchedAlignment = alignment ? patchAlignmentForPlan(alignment, plan.actions) : null;
  const afterFit = computeCalendarFit(patchedAlignment, priorities, recoveryHistory, todaySleep, 45, clarityInputs, momentumInputs);
  const scoreAfter = afterFit.edgeScore;

  return NextResponse.json({
    changes,
    scoreBefore: fit.edgeScore,
    scoreAfter,
    summary: plan.summary,
    planId,
    diagnoses,
    wellAligned: false,
  });
}
