import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { userQueries, factQueries, memoryQueries, taskQueries, callFeedbackQueries, notificationLogQueries, whoopQueries, pushSubscriptionQueries } from '@/lib/db';

// GET /api/user/export — R16 T2. A user's-own GDPR data export (auth-gated, session cookie).
// Returns a single JSON object as a file download. Secrets are never included: no password
// hash, no OAuth/Whoop/push tokens — Whoop + push are reported as connected-boolean / count only.
// (For the comprehensive export incl. episodes/fact_history/etc., see /api/account/export.)

const MEMORY_CONTENT_CAP = 10_000; // truncate long transcripts so the export stays manageable

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = user.id;

  // better-sqlite3 is synchronous, so these "parallel" reads just run in sequence; kept flat.
  const p = userQueries.findById(userId);
  const profile = p
    ? {
        id: p.id,
        name: p.name,
        email: p.email,
        timezone: p.timezone ?? null,
        callTime: p.call_time ?? null,
        phoneNumber: p.phone_number ?? null,
        profileSummary: p.profile_summary ?? null,
        dataConsent: p.data_consent ?? null,
        createdAt: p.created_at ?? null,
        // password_hash is deliberately NOT included.
      }
    : null;

  const facts = factQueries.getAll(userId).map(f => ({
    category: f.category, entity: f.entity ?? null, statement: f.statement, learnedAt: f.learned_at,
  }));

  const memories = memoryQueries.getRecent(userId, 10000).map(m => {
    const content = m.content ?? '';
    return {
      type: m.type,
      content: content.length > MEMORY_CONTENT_CAP ? content.slice(0, MEMORY_CONTENT_CAP) + '…[truncated]' : content,
      createdAt: m.created_at,
    };
  });

  const tasks = taskQueries.getRecent(userId, 365).map(t => ({
    text: t.text, date: t.date, source: t.source, completed: !!t.completed, completedAt: t.completed_at ?? null,
  }));

  const callFeedback = callFeedbackQueries.recent(userId, 1000).map(c => ({
    briefingId: c.briefing_id ?? null, rating: c.rating, note: c.note ?? null, createdAt: c.created_at,
  }));

  const notificationLog = notificationLogQueries.listForUser(userId, 1000).map(n => ({
    type: n.type, payload: n.payload, sentAt: n.sent_at,
  }));

  const whoopConnected = !!whoopQueries.get(userId);              // boolean only — never the token
  const pushSubscriptionsCount = pushSubscriptionQueries.getAll(userId).length; // count only

  const payload = {
    exportedAt: new Date().toISOString(),
    profile,
    facts,
    memories,
    tasks,
    callFeedback,
    notificationLog,
    whoopConnected,
    pushSubscriptionsCount,
    // NOTE: the spec also listed `outreach_tracking`, but that feature/table was removed in R12
    // (email drafting/reply-tracking deleted). There is no such data to export.
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="edg3-user-export.json"',
    },
  });
}
