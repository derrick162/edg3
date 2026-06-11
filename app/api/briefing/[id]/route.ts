import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { briefingQueries } from '@/lib/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  // getByIdForUser enforces owner-only access via AND user_id = ? — returns null for any
  // briefing that doesn't belong to the authenticated user, so 404 is the right response.
  const briefing = briefingQueries.getByIdForUser(id, user.id);
  if (!briefing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ briefing });
}
