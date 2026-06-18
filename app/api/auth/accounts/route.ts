import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { calendarQueries, gmailTokenQueries } from '@/lib/db';
import { hasGmailScope } from '@/lib/google-auth';

// GET /api/auth/accounts — multi-account Google linking status for the dashboard UI (Darren).
// Returns both Google accounts a user can connect:
//   - calendar: the primary account (calendar + gmail scopes)
//   - gmail:    an optional second account dedicated to Gmail drafting
// `email` is null for calendar (we don't store the calendar account's email today — the
// row predates multi-account; Darren can show "Connected" without it). The Gmail account
// stores its email at link time, so it's returned here.
export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const cal = calendarQueries.get(user.id);
  const gmail = gmailTokenQueries.get(user.id);

  return NextResponse.json({
    calendar: {
      connected: !!cal,
      email: null,
      // Whether the primary account also carries Gmail compose (existing single-account
      // users draft email via this grant until they link a dedicated Gmail account).
      hasGmailScope: hasGmailScope(cal?.scope),
    },
    gmail: {
      connected: !!gmail,
      email: gmail?.email ?? null,
    },
  });
}
