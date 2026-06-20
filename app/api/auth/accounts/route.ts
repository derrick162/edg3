import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { calendarQueries, gmailTokenQueries } from '@/lib/db';

// GET /api/auth/accounts — Google account linking status for the dashboard UI.
//   - calendar: the primary account (calendar + gmail.readonly scopes)
//   - gmail:    a vestigial dedicated-Gmail row (R12 T2 removed the link/draft flow; existing
//               rows remain readable, but there's no longer a way to connect a new one)
// `email` is null for calendar (we don't store the calendar account's email today).
export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const cal = calendarQueries.get(user.id);
  const gmail = gmailTokenQueries.get(user.id);

  return NextResponse.json({
    calendar: {
      connected: !!cal,
      email: null,
    },
    gmail: {
      connected: !!gmail,
      email: gmail?.email ?? null,
    },
  });
}
