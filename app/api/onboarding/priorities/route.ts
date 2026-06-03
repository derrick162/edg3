import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { priorityQueries } from '@/lib/db';
import { getWeekOf } from '@/lib/briefing';

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { priorities } = await req.json();
  if (!Array.isArray(priorities) || priorities.length === 0) {
    return NextResponse.json({ error: 'Priorities required' }, { status: 400 });
  }

  const weekOf = getWeekOf();
  priorityQueries.deleteThisWeek(user.id, weekOf);

  priorities.slice(0, 3).forEach((text: string, i: number) => {
    if (text?.trim()) {
      priorityQueries.create(user.id, text.trim(), weekOf, i + 1);
    }
  });

  return NextResponse.json({ success: true });
}

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const weekOf = getWeekOf();
  const priorities = priorityQueries.getThisWeek(user.id, weekOf);
  return NextResponse.json({ priorities });
}
