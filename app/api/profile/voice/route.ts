import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { userQueries } from '@/lib/db';

const VALID_VOICE_PREFS = new Set(['daniel', 'aria']);

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { voice_preference?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { voice_preference } = body;
  if (!voice_preference || !VALID_VOICE_PREFS.has(voice_preference)) {
    return NextResponse.json({ error: 'Invalid voice_preference' }, { status: 400 });
  }

  userQueries.setVoicePreference(user.id, voice_preference as 'daniel' | 'aria');
  return NextResponse.json({ success: true });
}
