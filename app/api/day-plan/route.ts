import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { userQueries, priorityQueries, energyLogQueries, energyProfileQueries, factQueries, effectiveTimezone } from '@/lib/db';
import { getCalendarEvents, getWeekEvents } from '@/lib/calendar';
import { getLatestRecovery } from '@/lib/whoop';
import { deriveEnergySignal } from '@/lib/energy';
import { classifyEventsEnergy, computeCalendarFit, parseEnergyProfile } from '@/lib/calendarScore';
import { computeAlignment } from '@/lib/alignment';
import { buildCalendarPlan } from '@/lib/calendarPlan';
import { issueDeleteToken } from '@/lib/idempotency';

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

  const profile = userQueries.findById(user.id);
  const userTz = profile ? effectiveTimezone(profile) : 'UTC';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: userTz }).format(new Date());

  const priorities = priorityQueries.getMostRecent(user.id);

  const [todayEvents, weekEvents, whoopRec] = await Promise.all([
    getCalendarEvents(user.id).catch(() => []),
    getWeekEvents(user.id).catch(() => []),
    getLatestRecovery(user.id).catch(() => null),
  ]);

  const todayEnergyLog = (() => { try { return energyLogQueries.getToday(user.id, today); } catch { return undefined; } })();
  const energySignal = deriveEnergySignal(todayEnergyLog, whoopRec?.recoveryScore ?? null);

  const [alignment, tagged] = await Promise.all([
    computeAlignment(priorities, weekEvents, userTz).catch(() => null),
    classifyEventsEnergy(todayEvents).catch(() => []),
  ]);

  const dbProfile = (() => { try { return energyProfileQueries.get(user.id); } catch { return undefined; } })();
  const energyProfile = dbProfile
    ? { peakStart: dbProfile.peak_start, peakEnd: dbProfile.peak_end, troughStart: dbProfile.trough_start, troughEnd: dbProfile.trough_end }
    : (() => {
        try {
          const stmts = factQueries.getAll(user.id).filter(f => f.category === 'preference').map(f => f.statement);
          return parseEnergyProfile(stmts);
        } catch { return null; }
      })();

  const fit = computeCalendarFit(tagged, alignment, priorities, energySignal, energyProfile);
  const plan = buildCalendarPlan(todayEvents, fit, priorities, today, userTz);

  if (plan.actions.length === 0) {
    return NextResponse.json(null);
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
      reason: 'High-demand work clashes with your energy level today',
    };
  });

  const scoreAfter = Math.min(100, fit.edgeScore + plan.actions.length * 12);
  const planId = issueDeleteToken(user.id);

  return NextResponse.json({
    changes,
    scoreBefore: fit.edgeScore,
    scoreAfter,
    summary: plan.summary,
    planId,
  });
}
