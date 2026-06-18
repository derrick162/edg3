import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { userQueries, memoryQueries, auditLogQueries } from '@/lib/db';
import { isValidTimeZone } from '@/lib/time';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

const VALID_VOICE_PREFS = new Set(['daniel', 'aria']);

const MAX_PROFILE_SUMMARY = 2000;

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const fullUser = userQueries.findById(user.id);
  return NextResponse.json({
    profile_summary: fullUser?.profile_summary || '',
    call_time: fullUser?.call_time || '07:00',
    timezone: fullUser?.timezone || 'America/Vancouver',
    current_timezone: isValidTimeZone(fullUser?.current_timezone) ? fullUser!.current_timezone : null,
    data_consent: fullUser?.data_consent ?? 'privacy',
    voice_preference: fullUser?.voice_preference ?? 'daniel',
  });
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('profileUpdate', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  let body: { profile_summary?: string; voice_preference?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // voice_preference — optional standalone update (profile_summary not required)
  if (body.voice_preference !== undefined) {
    if (!VALID_VOICE_PREFS.has(body.voice_preference)) {
      return NextResponse.json({ error: 'Invalid voice_preference' }, { status: 400 });
    }
    userQueries.setVoicePreference(user.id, body.voice_preference as 'daniel' | 'aria');
    if (!body.profile_summary) return NextResponse.json({ success: true });
  }

  const { profile_summary } = body;
  const summary = profile_summary?.trim().slice(0, MAX_PROFILE_SUMMARY);
  if (!summary) return NextResponse.json({ error: 'Profile required' }, { status: 400 });

  userQueries.updateProfile(user.id, summary);
  memoryQueries.create(user.id, 'profile', `Profile updated: ${summary}`);
  try { auditLogQueries.record({ userId: user.id, action: 'updateProfile', argsJson: JSON.stringify({ summary: summary.slice(0, 100) }), ok: true }); } catch { /* non-critical */ }

  return NextResponse.json({ success: true });
}
