import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { factQueries } from '@/lib/db';
import { extractAndUpsertFacts } from '@/lib/facts';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

// R36 T1 — "Add context": free-form text the user types into the Memory tab. Runs through the same
// extraction pipeline as a call transcript (→ structured People/Goals/Preferences facts) AND stores
// the raw note as a single `user_note` fact so it shows in the Memory tab as "added manually".
const MAX_NOTE = 2000;

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Reuses the profileUpdate bucket (write + LLM extraction — same shape, avoids a Security-owned
  // rateLimit.ts edit). 10/hour per user.
  const rl = checkRateLimit('profileUpdate', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  let body: { text?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return NextResponse.json({ error: 'Text required' }, { status: 400 });
  if (text.length > MAX_NOTE) {
    return NextResponse.json({ error: `Note must be ${MAX_NOTE} characters or fewer` }, { status: 400 });
  }

  // Structured extraction (same pipeline as call transcripts). Pass the user's name for STT-style
  // name grounding. Returns the count of facts stored. Never throws — degrade to 0.
  let factsExtracted = 0;
  try { factsExtracted = await extractAndUpsertFacts(user.id, text, user.name); } catch { /* raw note still saved below */ }

  // Raw note as a single user_note fact (truncated for display) so it's visible + auditable.
  try { factQueries.upsertFact(user.id, 'user_note', text.slice(0, 500), 'context note', 'high'); } catch { /* non-fatal */ }

  return NextResponse.json({ ok: true, factsExtracted });
}
