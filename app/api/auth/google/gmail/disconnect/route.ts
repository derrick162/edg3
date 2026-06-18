import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { disconnectGmailAccount } from '@/lib/google-auth';
import { auditLogQueries } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

// POST /api/auth/google/gmail/disconnect — unlink ONLY the dedicated Gmail account.
// The primary (calendar) account is a separate row and is left intact, so email drafting
// falls back to the calendar grant afterward (if it carries gmail.compose).
export async function POST() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('gmailDisconnect', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  disconnectGmailAccount(user.id);
  try { auditLogQueries.record({ userId: user.id, action: 'gmailAccountDisconnect', argsJson: '{}', ok: true }); } catch { /* non-critical */ }

  return NextResponse.json({ ok: true });
}
