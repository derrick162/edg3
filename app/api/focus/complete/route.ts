import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { auditLogQueries, userQueries } from '@/lib/db';

// POST /api/focus/complete
// Body: { idOrTitle: string }
// Records a focus-area completion as a Momentum signal.
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

  auditLogQueries.record({
    userId: user.id,
    action: 'completeFocusArea',
    argsJson: JSON.stringify({ date, title: idOrTitle.trim() }),
    resultText: `Completed focus area: "${idOrTitle.trim()}" on ${date}`,
    ok: true,
  });

  return NextResponse.json({ ok: true });
}
