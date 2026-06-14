import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { energyLogQueries, effectiveTimezone } from '@/lib/db';
import { deriveEnergySignal } from '@/lib/energy';
import { getLatestRecovery } from '@/lib/whoop';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tz = effectiveTimezone(user);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const log = energyLogQueries.getToday(user.id, today);

  // Derive from Whoop if no manual entry
  let whoopScore: number | null = null;
  if (!log) {
    try { whoopScore = (await getLatestRecovery(user.id))?.recoveryScore ?? null; } catch { /* degrade */ }
  }
  const signal = deriveEnergySignal(log, whoopScore);
  return NextResponse.json({ signal, date: today });
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { level?: string; source?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const validLevels = ['red', 'yellow', 'green'] as const;
  const { level, source = 'manual' } = body;
  if (!level || !validLevels.includes(level as typeof validLevels[number])) {
    return NextResponse.json({ error: 'level must be red, yellow, or green' }, { status: 400 });
  }
  const validSources = ['manual', 'override'] as const;
  const src = validSources.includes(source as typeof validSources[number])
    ? (source as 'manual' | 'override')
    : 'manual';

  const tz = effectiveTimezone(user);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  energyLogQueries.upsert(user.id, today, level as 'red' | 'yellow' | 'green', src);
  return NextResponse.json({ success: true, level, source: src, date: today });
}
