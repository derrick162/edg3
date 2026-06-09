import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { calendarQueries, undoQueries } from '@/lib/db';
import { getOAuthClient } from '@/lib/calendar';
import { executeUndo, parseUndoOps } from '@/lib/undo';
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

// Peek at the most recent reversible action (for the dashboard button label/state).
export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const last = undoQueries.getLatest(user.id);
  return NextResponse.json({ available: !!last, label: last?.label ?? null });
}

// Reverse the most recent action.
export async function POST() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const last = undoQueries.getLatest(user.id);
  if (!last) return NextResponse.json({ success: false, error: 'Nothing to undo' }, { status: 400 });
  const cal = await getCal(user.id);
  if (!cal) return NextResponse.json({ success: false, error: 'No calendar connected' }, { status: 400 });
  const ok = await executeUndo(cal, parseUndoOps(last.payload));
  undoQueries.markUndone(last.id);
  return NextResponse.json({ success: ok, label: last.label });
}
