import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { priorityQueries } from '@/lib/db';
import { getWeekOf } from '@/lib/briefing';

// POST /api/priorities/keep
// Refreshes the week_of of the user's most-recent priorities to the current week,
// dismissing the "still your priorities?" stale-priority banner without changing text.
export async function POST() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const latest = priorityQueries.getMostRecent(user.id);
  if (!latest.length) return NextResponse.json({ success: true }); // nothing to refresh

  const weekOf = getWeekOf();
  // Clear any existing current-week entries, then re-insert with updated week_of.
  priorityQueries.deleteThisWeek(user.id, weekOf);
  latest.forEach((p, i) => priorityQueries.create(user.id, p.text, weekOf, i + 1));

  return NextResponse.json({ success: true });
}
