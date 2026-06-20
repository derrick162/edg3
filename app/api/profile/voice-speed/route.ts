import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { userQueries } from '@/lib/db';

// R12 T6 — user-selectable speaking-speed presets.
const VALID_SPEEDS = new Set(['slow', 'default', 'fast']);

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { speed?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { speed } = body;
  if (!speed || !VALID_SPEEDS.has(speed)) {
    return NextResponse.json({ error: 'Invalid speed' }, { status: 400 });
  }

  userQueries.setVoiceSpeed(user.id, speed as 'slow' | 'default' | 'fast');
  return NextResponse.json({ ok: true });
}
