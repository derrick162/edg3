import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { calendarQueries, undoQueries } from '@/lib/db';
import { getOAuthClient } from '@/lib/calendar';
import { executeUndo, parseUndoOps } from '@/lib/undo';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { google, calendar_v3 } from 'googleapis';

async function getCal(userId: number): Promise<calendar_v3.Calendar | null> {
  const tokenRow = calendarQueries.get(userId);
  if (!tokenRow) return null;
  const o = getOAuthClient();
  o.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token || undefined,
    expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined,
  });
  return google.calendar({ version: 'v3', auth: o });
}

// GET /api/undo         → { available, label } — sidebar button state
// GET /api/undo?list=1  → { actions: [...] }  — Activity feed
export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (req.nextUrl.searchParams.get('list') === '1') {
    const actions = undoQueries.listRecent(user.id);
    return NextResponse.json({ actions });
  }

  const last = undoQueries.getLatest(user.id);
  return NextResponse.json({ available: !!last, label: last?.label ?? null });
}

// POST /api/undo           (no body) → undo the most recent action
// POST /api/undo  { id: N }          → undo a specific action by id
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('undoPost', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  let id: number | undefined;
  try {
    const body = await req.json();
    if (typeof body?.id === 'number') id = body.id;
  } catch { /* no body — undo latest */ }

  const entry = id !== undefined
    ? undoQueries.getById(user.id, id)
    : undoQueries.getLatest(user.id);

  if (!entry) return NextResponse.json({ success: false, error: 'Nothing to undo' }, { status: 400 });

  const cal = await getCal(user.id);
  if (!cal) return NextResponse.json({ success: false, error: 'No calendar connected' }, { status: 400 });

  const ok = await executeUndo(cal, parseUndoOps(entry.payload));
  undoQueries.markUndone(entry.id);
  return NextResponse.json({ success: ok, label: entry.label });
}
