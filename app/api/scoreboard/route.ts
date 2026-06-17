import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { priorityQueries, focusMilestoneQueries, effectiveTimezone } from '@/lib/db';
import { getWeekEvents, getPastCalendarEvents } from '@/lib/calendar';
import { computeWeeklyBreakdown } from '@/lib/timeAllocation';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

const WEEKS_BACK = 4;

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('calendarScores', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  const tz = effectiveTimezone(user);
  const priorities = priorityQueries.getMostRecent(user.id);
  const milestones = focusMilestoneQueries.listForUser(user.id);

  if (priorities.length === 0) {
    return NextResponse.json({
      perPriority: [],
      weeklyTrend: [],
      totalHoursThisWeek: 0,
      weeksBack: WEEKS_BACK,
    });
  }

  // Fetch calendar data in parallel: current week (full schedule) + past events for trend.
  const [weekEvents, pastEvents] = await Promise.all([
    getWeekEvents(user.id).catch(() => []),
    getPastCalendarEvents(user.id, WEEKS_BACK * 7 + 7).catch(() => []),
  ]);

  // This week's hours per priority — keyword-based, full week schedule.
  const weeklyBreakdown = computeWeeklyBreakdown(weekEvents, priorities, 1);
  const thisWeekHours = weeklyBreakdown[0]?.perPriority ?? {};

  // Historical trend — last WEEKS_BACK weeks from past events (oldest→newest).
  const weeklyTrend = computeWeeklyBreakdown(pastEvents, priorities, WEEKS_BACK);

  const perPriority = priorities.map(p => {
    const pMilestones = milestones.filter(m => m.priority_id === p.id);
    const milestoneDone = pMilestones.filter(m => m.done).length;
    const hoursThisWeek = thisWeekHours[p.text] ?? 0;

    // Weekly average over past WEEKS_BACK weeks from trend data.
    const trendTotal = weeklyTrend.reduce((s, w) => s + (w.perPriority[p.text] ?? 0), 0);
    const weeklyAvgHours = weeklyTrend.length > 0
      ? Math.round((trendTotal / weeklyTrend.length) * 10) / 10
      : 0;

    return {
      id: p.id,
      text: p.text,
      rank: p.rank,
      energyCost: p.energy_cost ?? null,
      hoursThisWeek,
      weeklyAvgHours,
      milestoneDone,
      milestoneTotal: pMilestones.length,
      milestones: pMilestones.map(m => ({
        id: m.id,
        title: m.title,
        done: m.done === 1,
        completedAt: m.completed_at ?? null,
      })),
    };
  });

  const totalHoursThisWeek = Math.round(
    perPriority.reduce((s, p) => s + p.hoursThisWeek, 0) * 10
  ) / 10;

  return NextResponse.json({
    perPriority,
    weeklyTrend,
    totalHoursThisWeek,
    weeksBack: WEEKS_BACK,
    timezone: tz,
  });
}
