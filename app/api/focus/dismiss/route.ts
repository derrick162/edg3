import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { dailyFocusQueries, userQueries, auditLogQueries } from '@/lib/db';

// POST /api/focus/dismiss
// Body: { idOrTitle: string }
// Records a dismissed focus area for the learning signal (down-weights in future recs).
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('focusConfirm', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  const body = await req.json().catch(() => ({}));
  const { idOrTitle } = body as { idOrTitle?: unknown };

  if (typeof idOrTitle !== 'string' || !idOrTitle.trim()) {
    return NextResponse.json({ error: 'Provide idOrTitle (string)' }, { status: 400 });
  }

  const profile = userQueries.findById(user.id);
  const tz = profile?.timezone ?? 'UTC';
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

  dailyFocusQueries.addDismissed(user.id, date, idOrTitle.trim());
  try { auditLogQueries.record({ userId: user.id, action: 'dismissFocus', argsJson: JSON.stringify({ idOrTitle: idOrTitle.trim(), date }), ok: true }); } catch { /* non-critical */ }

  return NextResponse.json({ ok: true });
}
