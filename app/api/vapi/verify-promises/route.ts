import { NextRequest, NextResponse } from 'next/server';
import { userQueries, getDb, decryptBriefingRow } from '@/lib/db';
import { checkVapiSecret } from '@/lib/vapi';
import { runPromiseVerification } from '@/lib/verifyPromises';

export { runPromiseVerification };

export async function POST(req: NextRequest) {
  // Only callable by Vapi (same shared secret as webhook) — blocks unauthenticated callers.
  const sec = checkVapiSecret(req.headers.get('x-vapi-secret'));
  if (!sec.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const { briefingId } = await req.json();
    if (!briefingId) return NextResponse.json({ error: 'briefingId required' }, { status: 400 });

    const briefingRaw = getDb().prepare('SELECT * FROM briefings WHERE id = ?').get(briefingId) as any;
    if (!briefingRaw?.transcript) return NextResponse.json({ skipped: 'no transcript' });
    const briefing = decryptBriefingRow(briefingRaw);

    const user = userQueries.findById(briefing.user_id);
    if (!user) return NextResponse.json({ error: 'user not found' }, { status: 404 });

    const result = await runPromiseVerification(briefing, user);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[verify-promises] Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
