import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { priorityQueries } from '@/lib/db';

// GET /api/priorities/history?range=1mo|3mo|6mo|12mo
// Returns the user's stated priorities grouped by week, newest first — for the browsable
// priority-history view (dashboard ticket 7). Replaces the fixed 4-week trend table, which
// didn't age well as priorities change. Handles changing priorities gracefully because it
// reads the actual per-week rows, not a projection onto the current priority set.
const RANGE_WEEKS: Record<string, number> = {
  '1mo': 5,
  '3mo': 13,
  '6mo': 26,
  '12mo': 52,
};

export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const range = req.nextUrl.searchParams.get('range') ?? '3mo';
  const weeks = RANGE_WEEKS[range] ?? RANGE_WEEKS['3mo'];

  let rows: ReturnType<typeof priorityQueries.getRecentWeeks> = [];
  try {
    rows = priorityQueries.getRecentWeeks(user.id, weeks);
  } catch {
    return NextResponse.json({ range, weeks: [] });
  }

  // Group rows (already ordered week_of DESC, rank ASC) into weeks, preserving order.
  const byWeek = new Map<string, { text: string; rank: number }[]>();
  for (const r of rows) {
    if (!byWeek.has(r.week_of)) byWeek.set(r.week_of, []);
    byWeek.get(r.week_of)!.push({ text: r.text, rank: r.rank });
  }

  const result = [...byWeek.entries()].map(([weekOf, priorities]) => ({ weekOf, priorities }));
  return NextResponse.json({ range, weeks: result });
}
