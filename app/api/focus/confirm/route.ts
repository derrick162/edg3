import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { dailyFocusQueries, userQueries, auditLogQueries, type DailyFocusRecord } from '@/lib/db';
import type { FocusArea } from '@/lib/focusRecommendation';

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('focusConfirm', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  const body = await req.json().catch(() => ({}));
  const { areas, date: dateParam } = body as { areas?: unknown; date?: unknown };
  if (!Array.isArray(areas) || areas.length === 0 || areas.length > 3) {
    return NextResponse.json({ error: 'Provide 1–3 focus areas' }, { status: 400 });
  }

  // Validate and normalize each area — accept either string or FocusArea object
  const cleaned: FocusArea[] = [];
  for (const a of areas) {
    if (typeof a === 'string') {
      const title = a.trim().slice(0, 200);
      if (title) cleaned.push({ title, rationale: '', confidence: 'medium' });
    } else if (typeof a === 'object' && a !== null) {
      const obj = a as Record<string, unknown>;
      const title = String(obj.title ?? '').trim().slice(0, 200);
      if (!title) continue;
      const rationale = String(obj.rationale ?? '').trim().slice(0, 500);
      const c = obj.confidence;
      const confidence: 'high' | 'medium' | 'low' = c === 'high' || c === 'low' ? c : 'medium';
      const anchor = typeof obj.anchor === 'string' ? obj.anchor.trim().slice(0, 200) : undefined;
      cleaned.push({ title, rationale, confidence, ...(anchor ? { anchor } : {}) });
    }
  }
  if (cleaned.length === 0) {
    return NextResponse.json({ error: 'No valid focus areas provided' }, { status: 400 });
  }

  // Determine the date — use provided date or derive from user timezone
  let date: string;
  if (typeof dateParam === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    date = dateParam;
  } else {
    const profile = userQueries.findById(user.id);
    const tz = profile?.timezone ?? 'UTC';
    date = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  }

  const generatedAt = new Date().toISOString();
  dailyFocusQueries.upsert(user.id, date, JSON.stringify(cleaned), generatedAt);
  dailyFocusQueries.confirm(user.id, date);

  auditLogQueries.record({
    userId: user.id,
    action: 'confirmFocusAreas',
    argsJson: JSON.stringify({ date, count: cleaned.length }),
    resultText: `Saved ${cleaned.length} focus area${cleaned.length !== 1 ? 's' : ''} for ${date}: ${cleaned.map(a => a.title).join(', ')}`,
    ok: true,
  });

  return NextResponse.json({ ok: true, date, count: cleaned.length });
}
