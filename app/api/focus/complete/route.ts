import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { auditLogQueries, userQueries, dailyFocusQueries } from '@/lib/db';
import type { FocusArea } from '@/lib/focusRecommendation';

// POST /api/focus/complete
// Body: { title: string }  (legacy: idOrTitle)
// Marks a locked-in focus area done for today: sets completed:true on the matching item in the
// day's focus_areas JSON (no schema change) and records a Momentum audit signal.
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('focusConfirm', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  const body = await req.json().catch(() => ({}));
  const { title, idOrTitle } = body as { title?: unknown; idOrTitle?: unknown };
  const rawTitle = typeof title === 'string' ? title : idOrTitle; // backward-compat with idOrTitle
  if (typeof rawTitle !== 'string' || !rawTitle.trim()) {
    return NextResponse.json({ error: 'Provide title (string)' }, { status: 400 });
  }
  const cleanTitle = rawTitle.trim();

  const profile = userQueries.findById(user.id);
  const tz = profile?.timezone ?? 'UTC';
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

  // Update the stored focus_areas so the completed state survives reloads.
  let areas: FocusArea[] = [];
  const row = dailyFocusQueries.getToday(user.id, date);
  if (row) {
    try { areas = JSON.parse(row.focus_areas); } catch { areas = []; }
    const target = cleanTitle.toLowerCase();
    let matched = false;
    areas = areas.map(a => {
      if (a.title.trim().toLowerCase() === target) { matched = true; return { ...a, completed: true }; }
      return a;
    });
    if (matched) dailyFocusQueries.updateAreas(user.id, date, areas);
  }

  auditLogQueries.record({
    userId: user.id,
    action: 'completeFocusArea',
    argsJson: JSON.stringify({ date, title: cleanTitle }),
    resultText: `Completed focus area: "${cleanTitle}" on ${date}`,
    ok: true,
  });

  return NextResponse.json({ ok: true, areas });
}
