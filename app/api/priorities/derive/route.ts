import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { userQueries, effectiveTimezone, factQueries, openLoopQueries, priorityQueries } from '@/lib/db';
import { getPastCalendarEvents } from '@/lib/calendar';
import { getRecentEmailSignal } from '@/lib/gmail';
import { derivePriorities } from '@/lib/priorityDerivation';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('priorityDerive', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  const profile = userQueries.findById(user.id);
  const userTz = profile ? effectiveTimezone(profile) : 'UTC';

  // Gather signals in parallel — each failure degrades silently.
  const [pastEvents, emailSignal] = await Promise.all([
    getPastCalendarEvents(user.id, 90).catch(() => []),
    getRecentEmailSignal(user.id, { days: 14, max: 30 }).catch(() => null),
  ]);

  const facts         = factQueries.getAll(user.id);
  const openLoops     = openLoopQueries.list(user.id);
  const currentPriorities = priorityQueries.getMostRecent(user.id);

  // We don't use timezone in derivation itself but include it for future use.
  void userTz;

  const proposal = await derivePriorities({
    pastEvents,
    emailSignal,
    facts,
    openLoops,
    memories: [], // memories are lower-signal for derivation; facts + calendar carry more weight
    currentPriorities,
  });

  if (!proposal) {
    return NextResponse.json({
      proposal: null,
      reason: 'Not enough data yet — connect your calendar and let Edge learn your patterns.',
    });
  }

  return NextResponse.json({ proposal });
}
