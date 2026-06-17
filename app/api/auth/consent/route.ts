import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { userQueries, auditLogQueries } from '@/lib/db';
import { checkRateLimit, getClientIP, rateLimitResponse } from '@/lib/rateLimit';

const VALID_CONSENT_VALUES = ['improve', 'privacy'] as const;
type ConsentValue = (typeof VALID_CONSENT_VALUES)[number];

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ip = getClientIP(req);
  const rl = checkRateLimit('consentUpdate', `${user.id}:${ip}`);
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  try {
    const body = await req.json();
    const { consent } = body ?? {};

    if (!VALID_CONSENT_VALUES.includes(consent)) {
      return NextResponse.json(
        { error: 'consent must be "improve" or "privacy"' },
        { status: 400 },
      );
    }

    const prev = user.data_consent ?? null;
    userQueries.updateConsent(user.id, consent as ConsentValue);

    auditLogQueries.record({
      userId: user.id,
      briefingId: null,
      action: 'consent_update',
      argsJson: JSON.stringify({ consent, prev }),
      resultText: `data_consent set to '${consent}'`,
      ok: true,
      snapshotBefore: null,
      snapshotAfter: null,
    });

    return NextResponse.json({ success: true, consent });
  } catch (err) {
    console.error('Consent update error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
