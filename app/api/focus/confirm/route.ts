import { NextRequest, NextResponse } from 'next/server';
import { format, startOfWeek } from 'date-fns';
import { getSession } from '@/lib/auth';
import { priorityQueries } from '@/lib/db';

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { areas } = body as { areas?: unknown };
  if (!Array.isArray(areas) || areas.length === 0 || areas.length > 3) {
    return NextResponse.json({ error: 'Provide 1–3 focus areas' }, { status: 400 });
  }

  const weekOf = format(startOfWeek(new Date()), 'yyyy-MM-dd');

  priorityQueries.deleteThisWeek(user.id, weekOf);
  let rank = 1;
  for (const area of areas) {
    const text = String(area).trim().slice(0, 200);
    if (text) { priorityQueries.create(user.id, text, weekOf, rank); rank++; }
  }

  return NextResponse.json({ ok: true, weekOf, count: rank - 1 });
}
