import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { userQueries } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

const VALID_CONSENT = new Set(['improve', 'privacy']);

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('profileUpdate', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  let body: { data_consent?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { data_consent } = body;
  if (!data_consent || !VALID_CONSENT.has(data_consent)) {
    return NextResponse.json({ error: 'data_consent must be "improve" or "privacy"' }, { status: 400 });
  }

  userQueries.setDataConsent(user.id, data_consent as 'improve' | 'privacy');
  return NextResponse.json({ ok: true });
}
