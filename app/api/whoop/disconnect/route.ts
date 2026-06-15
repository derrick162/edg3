import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { revokeWhoopAccess } from '@/lib/whoop';

export async function POST() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await revokeWhoopAccess(user.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Whoop disconnect error:', err);
    return NextResponse.json({ error: 'Failed to disconnect Whoop' }, { status: 500 });
  }
}
