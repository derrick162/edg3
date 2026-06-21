import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { notificationLogQueries } from '@/lib/db';

// GET /api/notifications/history — the user's recent PROACTIVE notifications (the ones Edg3
// pushed: low-recovery, priority-gap), newest first, capped at 10. Read from notification_log.
// Each row is rendered into the {type, title, body} shape the dashboard NotificationHistoryPanel
// expects. (Distinct from /api/notifications, which is the in-app notification feed.)

// Render a stored log row into a human-readable title/body. Kept in sync with the bodies sent by
// lib/proactiveNotifications.ts; payload holds the type-specific datum (recovery score / priority).
function render(type: string, payload: string | null): { title: string; body: string } {
  switch (type) {
    case 'low_recovery':
      return {
        title: 'Recovery Alert',
        body: payload
          ? `Your recovery is ${payload}% today — Edge adjusted your briefing to protect your energy.`
          : 'Your recovery is low today — Edge adjusted your briefing to protect your energy.',
      };
    case 'priority_gap':
      return {
        title: 'Priority Gap',
        body: payload
          ? `"${payload}" hasn't had any time this week. Want Edge to block some?`
          : 'A priority has had no time this week. Want Edge to block some?',
      };
    default:
      return { title: 'Notification', body: payload ?? '' };
  }
}

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = notificationLogQueries.listForUser(user.id, 10);
  const notifications = rows.map(r => {
    const { title, body } = render(r.type, r.payload);
    return { type: r.type, title, body, sentAt: r.sent_at };
  });

  return NextResponse.json({ notifications });
}
