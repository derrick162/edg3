import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getDb, userQueries, priorityQueries, memoryQueries, factQueries, taskQueries, briefingQueries, energyLogQueries, decryptBriefingRow } from '@/lib/db';
import { decryptField } from '@/lib/crypto';

// Returns a full JSON export of everything EDG3 has stored for the authenticated user.
// Encrypted fields are decrypted in the response. Sensitive internal fields
// (password_hash, OAuth tokens, vapi_call_id) are omitted.
export async function GET(_req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const userId = user.id;

  const profile = userQueries.findById(userId);
  if (!profile) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const briefingRows = (briefingQueries.getRecent(userId, 10000) as ReturnType<typeof briefingQueries.getRecent>)
    .map(b => ({
      scheduledFor: b.scheduled_for,
      status: b.status,
      content: b.content,
      transcript: b.transcript ?? null,
      userResponse: b.user_response ?? null,
      calendarActions: b.calendar_actions ?? null,
      edgePromises: b.edge_promises ?? null,
    }));

  const draftRows = (db.prepare(
    'SELECT recipient, subject, created_at FROM gmail_drafts_log WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId) as Array<{ recipient: string | null; subject: string | null; created_at: number }>).map(r => ({
    recipient: r.recipient ? decryptField(r.recipient) : null,
    subject: r.subject ? decryptField(r.subject) : null,
    createdAt: r.created_at,
  }));

  const energyRows = (db.prepare(
    'SELECT date, level, source, created_at FROM energy_log WHERE user_id = ? ORDER BY date DESC'
  ).all(userId) as Array<{ date: string; level: string; source: string; created_at: string }>);

  const payload = {
    exportedAt: new Date().toISOString(),
    version: '1',
    profile: {
      name: profile.name,
      email: profile.email,
      timezone: profile.timezone ?? null,
      callTime: profile.call_time ?? null,
      phoneNumber: profile.phone_number ?? null,
      profileSummary: profile.profile_summary ?? null,
    },
    priorities: priorityQueries.getMostRecent(userId).map(p => ({
      text: p.text,
      rank: p.rank,
      weekOf: p.week_of,
    })),
    memories: memoryQueries.getRecent(userId, 10000).map(m => ({
      type: m.type,
      content: m.content,
      createdAt: m.created_at,
    })),
    facts: factQueries.getAll(userId).map(f => ({
      category: f.category,
      entity: f.entity ?? null,
      statement: f.statement,
      learnedAt: f.learned_at,
    })),
    tasks: taskQueries.getRecent(userId, 365).map(t => ({
      text: t.text,
      date: t.date,
      source: t.source,
      completed: !!t.completed,
      completedAt: t.completed_at ?? null,
    })),
    briefings: briefingRows,
    emailDraftHistory: draftRows,
    energyLog: energyRows,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="edg3-data-export.json"',
    },
  });
}
