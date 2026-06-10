import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { notificationQueries } from '@/lib/db';
import { checkOutreachReplies } from '@/lib/replies';

// In-app notification center (Core). Notifications are created by reply-detection
// (lib/replies.ts) at briefing time and on an explicit "check". This route reads the
// stored notifications and lets the dashboard mark them read.

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({
    notifications: notificationQueries.listRecent(user.id, 30),
    unread: notificationQueries.unreadCount(user.id),
  });
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { action?: string; id?: number };
  try { body = await req.json(); } catch { body = {}; }

  switch (body.action) {
    case 'check':
      // Pull fresh outreach replies → creates notifications. Degrades safely to nothing
      // if Gmail read access isn't granted yet or there are no watched threads.
      await checkOutreachReplies(user.id).catch(() => []);
      break;
    case 'markRead':
      if (typeof body.id === 'number') notificationQueries.markRead(body.id, user.id);
      break;
    case 'markAllRead':
      notificationQueries.markAllRead(user.id);
      break;
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    notifications: notificationQueries.listRecent(user.id, 30),
    unread: notificationQueries.unreadCount(user.id),
  });
}
