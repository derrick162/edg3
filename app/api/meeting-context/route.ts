import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { factQueries, openLoopQueries } from '@/lib/db';
import { getCalendarEvents } from '@/lib/calendar';
import { getRecentEmailSignal } from '@/lib/gmail';
import { buildMeetingContexts } from '@/lib/meetingContext';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

// GET /api/meeting-context?date=YYYY-MM-DD
// Returns meeting prep context for today's upcoming events.
// Used by Design to render the pre-meeting briefing panel.
export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('meetingContext', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
  const lookAheadHours = Math.min(24, parseInt(searchParams.get('hours') ?? '8', 10));

  try {
    const [calendarEvents, emailSignal] = await Promise.all([
      getCalendarEvents(user.id).catch(() => []),
      getRecentEmailSignal(user.id, { days: 14, max: 20 }).catch(() => null),
    ]);

    const facts = (() => { try { return factQueries.getAll(user.id); } catch { return []; } })();
    const openLoops = (() => { try { return openLoopQueries.list(user.id, 'open'); } catch { return []; } })();

    const contexts = buildMeetingContexts(
      calendarEvents,
      emailSignal?.items ?? [],
      facts,
      openLoops,
      { lookAheadHours, now: new Date().toISOString() },
    );

    return NextResponse.json({ date, contexts, total: contexts.length });
  } catch (err) {
    console.error('[meeting-context] GET failed:', err);
    return NextResponse.json({ error: 'Failed to build meeting context' }, { status: 500 });
  }
}
