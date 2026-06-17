import { type NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getEmailSignalSubjects } from '@/lib/gmail';

// Return the thread subjects Edge reviewed during a specific email_signal_fetch.
// Auth-gated + user-scoped: getEmailSignalSubjects enforces user_id = session user.
// Core / Design use this to render the expandable Activity receipt ("See which emails").
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id) || id < 1) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  const subjects = getEmailSignalSubjects(user.id, id);
  if (!subjects) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ subjects });
}
