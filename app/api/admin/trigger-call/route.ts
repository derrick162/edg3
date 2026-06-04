import { NextRequest, NextResponse } from 'next/server';
import { scheduleBriefingCall } from '@/lib/scheduler';

function checkAdminAuth(req: NextRequest): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD;
  const cookie = req.cookies.get('edg3_admin');
  return !!(adminPassword && cookie && cookie.value === adminPassword);
}

export async function POST(req: NextRequest) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { userId } = await req.json();
    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }

    const briefingId = await scheduleBriefingCall(Number(userId));
    return NextResponse.json({ success: true, briefingId });
  } catch (err) {
    console.error('Admin trigger call error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
