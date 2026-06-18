import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getDb, userQueries, priorityQueries, memoryQueries, factQueries, taskQueries, briefingQueries, energyLogQueries, decryptBriefingRow, energyProfileQueries, openLoopQueries, auditLogQueries, peopleProfileQueries } from '@/lib/db';
import { decryptField } from '@/lib/crypto';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

// Returns a full JSON export of everything EDG3 has stored for the authenticated user.
// Encrypted fields are decrypted in the response. Sensitive internal fields
// (password_hash, OAuth tokens, vapi_call_id) are omitted.
export async function GET(_req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit('accountExport', user.id.toString());
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

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

  const dailyFocusRows = (db.prepare(
    'SELECT date, focus_areas, generated_at, confirmed FROM daily_focus WHERE user_id = ? ORDER BY date ASC'
  ).all(userId) as Array<{ date: string; focus_areas: string; generated_at: string; confirmed: number }>)
    .map(r => ({
      date: r.date,
      focusAreas: (() => { try { return JSON.parse(r.focus_areas); } catch { return []; } })(),
      generatedAt: r.generated_at,
      confirmed: !!r.confirmed,
    }));

  const calendarScoreRows = (db.prepare(
    'SELECT date, focus_score, energy_score, focus_drivers, energy_drivers, created_at FROM calendar_scores WHERE user_id = ? ORDER BY date ASC'
  ).all(userId) as Array<{ date: string; focus_score: number; energy_score: number; focus_drivers: string | null; energy_drivers: string | null; created_at: string }>)
    .map(r => ({
      date: r.date,
      focusScore: r.focus_score,
      energyScore: r.energy_score,
      focusDrivers: r.focus_drivers ? JSON.parse(r.focus_drivers) as string[] : [],
      energyDrivers: r.energy_drivers ? JSON.parse(r.energy_drivers) as string[] : [],
      createdAt: r.created_at,
    }));

  const energyProfile = energyProfileQueries.get(userId);

  const eventEnergyTagRows = (db.prepare(
    'SELECT google_event_id, type, demand, tagged_at FROM event_energy_tags WHERE user_id = ? ORDER BY tagged_at DESC'
  ).all(userId) as Array<{ google_event_id: string; type: string; demand: string; tagged_at: string }>)
    .map(r => ({ eventId: r.google_event_id, type: r.type, demand: r.demand, taggedAt: r.tagged_at }));

  // Activity log — the user-facing action history (same data as the dashboard Activity tab).
  // Exports the human-readable fields only; internal/encrypted state snapshots (snapshot_before/
  // snapshot_after, which can hold encrypted email subjects) are deliberately NOT included.
  const activityLogRows = auditLogQueries.recent(userId, 10000).map(a => ({
    action: a.action,
    args: (() => { try { return JSON.parse(a.args_json); } catch { return a.args_json; } })(),
    result: a.result_text ?? null,
    ok: !!a.ok,
    briefingId: a.briefing_id ?? null,
    createdAt: a.created_at,
  }));

  // Relationship memory — the people Edge has learned about from the user's calendar/calls
  // ("what Edge knows about people in your life"). canonical_name + email are stored plaintext
  // (accepted gap, same tier as users.name) so no decryption is needed.
  const peopleRows = peopleProfileQueries.listForUser(userId).map(p => ({
    name: p.canonical_name,
    email: p.email ?? null,
    interactionCount: p.interaction_count,
    lastInteraction: p.last_interaction ?? null,
    upcomingInteraction: p.upcoming_interaction ?? null,
    updatedAt: p.updated_at,
  }));

  // Open loops — descriptions are decrypted by openLoopQueries.list()
  const openLoopRows = openLoopQueries.list(userId).map(l => ({
    id:          l.id,
    description: l.description,
    type:        l.type,
    source:      l.source,
    dueDate:     l.dueDate,
    status:      l.status,
    createdAt:   l.createdAt,
    resolvedAt:  l.resolvedAt,
  }));

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
      // data_consent is set by the Core onboarding step. Exported so users can verify their setting.
      dataConsent: profile.data_consent ?? null,
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
    dailyFocus: dailyFocusRows,
    calendarScores: calendarScoreRows,
    energyProfile: energyProfile
      ? {
          peakStart: energyProfile.peak_start,
          peakEnd: energyProfile.peak_end,
          troughStart: energyProfile.trough_start,
          troughEnd: energyProfile.trough_end,
          updatedAt: energyProfile.updated_at,
        }
      : null,
    eventEnergyTags: eventEnergyTagRows,
    openLoops: openLoopRows,
    activityLog: activityLogRows,
    people: peopleRows,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="edg3-data-export.json"',
    },
  });
}
