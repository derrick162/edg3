import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { dailyFocusQueries, userQueries, auditLogQueries, priorityQueries } from '@/lib/db';
import { recommendFocusAreas, type EnergySignal, type FocusArea } from '@/lib/focusRecommendation';
import { getCalendarEvents } from '@/lib/calendar';
import { getLatestRecovery } from '@/lib/whoop';
import { getRecentEmailSignal } from '@/lib/gmail';

// POST /api/focus/dismiss
// Body: { title: string }  (legacy: idOrTitle)
// Removes a locked-in focus area, records it as dismissed (down-weights future recs), then tries to
// generate a fresh replacement so the user always sees a full list. Returns the updated focus_areas.
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

  // Record the dismissal FIRST so recommendFocusAreas (which reads dismissed_titles from DB)
  // won't re-suggest the item we're removing.
  dailyFocusQueries.addDismissed(user.id, date, cleanTitle);
  try { auditLogQueries.record({ userId: user.id, action: 'dismissFocus', argsJson: JSON.stringify({ title: cleanTitle, date }), ok: true }); } catch { /* non-critical */ }

  // Load + trim the day's focus areas (remove the dismissed item by title).
  let areas: FocusArea[] = [];
  const row = dailyFocusQueries.getToday(user.id, date);
  if (row) { try { areas = JSON.parse(row.focus_areas); } catch { areas = []; } }
  const target = cleanTitle.toLowerCase();
  areas = areas.filter(a => a.title.trim().toLowerCase() !== target);
  if (row) dailyFocusQueries.updateAreas(user.id, date, areas);

  // Try to generate a replacement (LLM call, 3–5s — fine for a manual tap). Degrades to no-op.
  try {
    const [whoopRec, todayEvents, anchors, emailSignal] = await Promise.all([
      getLatestRecovery(user.id).catch(() => null),
      getCalendarEvents(user.id).catch(() => null),
      Promise.resolve(priorityQueries.getMostRecent(user.id)).catch(() => []),
      getRecentEmailSignal(user.id, { days: 14, max: 20 }).catch(() => null),
    ]);
    const energySignal: EnergySignal | null = whoopRec
      ? { tier: whoopRec.recoveryScore >= 67 ? 'green' : whoopRec.recoveryScore >= 34 ? 'yellow' : 'red', recoveryScore: whoopRec.recoveryScore, source: 'whoop' }
      : null;

    const rec = await recommendFocusAreas(user.id, {
      energySignal,
      todayEvents: todayEvents ?? undefined,
      anchors: anchors.length > 0 ? anchors : undefined,
      date,
      emailSignal: emailSignal ?? undefined,
    });

    const have = new Set(areas.map(a => a.title.trim().toLowerCase()));
    const replacement = rec.areas.find(a => a.title.trim() && !have.has(a.title.trim().toLowerCase()));
    if (replacement) {
      areas = [...areas, { ...replacement, completed: false }];
      if (row) dailyFocusQueries.updateAreas(user.id, date, areas);
    }
  } catch {
    // Replacement generation failed — return the trimmed list (may be 2 items). Non-fatal.
  }

  return NextResponse.json({ ok: true, areas });
}
