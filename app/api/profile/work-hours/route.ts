import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { userQueries } from '@/lib/db';
import { parseWorkSchedule, validateWorkSchedule, type WorkSchedule } from '@/lib/workHours';

// R33 — read/update the user's work hours so Edge never suggests booking work blocks outside them.

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const schedule = parseWorkSchedule(userQueries.getWorkSchedule(user.id));
  return NextResponse.json({ schedule });
}

export async function PATCH(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Partial<WorkSchedule>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const candidate = { start: body.start, end: body.end, days: body.days };
  if (!validateWorkSchedule(candidate)) {
    return NextResponse.json(
      { error: 'Invalid work hours — start 0–23, end 1–24 with end after start, and at least one weekday (1–7).' },
      { status: 400 },
    );
  }

  // Normalize days: unique + sorted before persisting.
  const normalized: WorkSchedule = {
    start: candidate.start,
    end: candidate.end,
    days: [...new Set(candidate.days)].sort((a, b) => a - b),
  };
  userQueries.setWorkSchedule(user.id, JSON.stringify(normalized));
  return NextResponse.json({ ok: true, schedule: normalized });
}
