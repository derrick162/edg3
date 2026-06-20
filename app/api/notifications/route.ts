import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { notificationQueries } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

// In-app notification center (Core). Notifications are created by activity/score/fact
// events. This route reads the stored notifications and lets the dashboard mark them read.
// (The email-outreach reply-pull was removed with the email feature in R12 T7.)

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

  const rl = checkRateLimit('notifications', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  let body: { action?: string; id?: number };
  try { body = await req.json(); } catch { body = {}; }

  switch (body.action) {
    case 'check':
      // No-op since R12 T7 (email-outreach reply tracking removed). Kept so the dashboard's
      // existing "check" action still returns success rather than a 400.
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
