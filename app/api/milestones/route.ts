import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { focusMilestoneQueries } from '@/lib/db';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const milestones = focusMilestoneQueries.listForUser(user.id);
  return NextResponse.json({ milestones });
}
