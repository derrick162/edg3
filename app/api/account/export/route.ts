import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getDb, userQueries, priorityQueries, memoryQueries, factQueries, taskQueries, briefingQueries, energyLogQueries, decryptBriefingRow, energyProfileQueries, openLoopQueries, auditLogQueries, peopleProfileQueries, peopleModelQueries, undoQueries } from '@/lib/db';
import { decryptField, safeDecryptField } from '@/lib/crypto';
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

  // Social mental models (M4-4) — what Edge has learned about the people in the user's life.
  // listForUser decrypts goals/communication_style/relationship_state/last_interaction.
  const peopleModelRows = peopleModelQueries.listForUser(userId).map(m => ({
    personName: m.person_name,
    goals: m.goals ?? null,
    communicationStyle: m.communication_style ?? null,
    relationshipState: m.relationship_state ?? null,
    lastInteraction: m.last_interaction ?? null,
    healthScore: m.health_score,
    updatedAt: m.updated_at,
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

  // R10 T1 — four previously-deferred tables, now included (GDPR completeness, Kevin-authorized).
  // All use safeDecryptField so one undecryptable row degrades to '' rather than 500-ing the export.

  // Episodes — ground-truth records of each call/calendar/email event. content_raw is encrypted;
  // surfaced as a readable contentSummary (never the raw ciphertext). topics/commitments are JSON.
  const episodeRows = (db.prepare(
    'SELECT source, occurred_at, content_raw, topics, commitments FROM episodes WHERE user_id = ? ORDER BY occurred_at DESC LIMIT 10000'
  ).all(userId) as Array<{ source: string; occurred_at: string; content_raw: string; topics: string; commitments: string }>)
    .map(e => ({
      source: e.source,
      occurredAt: e.occurred_at,
      contentSummary: safeDecryptField(e.content_raw, 'episodes.content_raw'),
      topics: (() => { try { return JSON.parse(e.topics) as string[]; } catch { return []; } })(),
      commitments: (() => { try { return JSON.parse(e.commitments) as string[]; } catch { return []; } })(),
    }));

  // Fact history — the versioned memory audit trail (every retired/superseded fact). fact_history
  // carries its own user_id, so no join to facts is needed. statement is encrypted at rest.
  const factHistoryRows = (db.prepare(
    'SELECT fact_id, statement, entity, category, retired_at, reason FROM fact_history WHERE user_id = ? ORDER BY retired_at DESC LIMIT 10000'
  ).all(userId) as Array<{ fact_id: number; statement: string; entity: string | null; category: string; retired_at: string; reason: string | null }>)
    .map(h => ({
      factId: h.fact_id,
      statement: safeDecryptField(h.statement, 'fact_history.statement'),
      entity: h.entity ?? null,
      category: h.category,
      retiredAt: h.retired_at,
      reason: h.reason ?? null,
    }));

  // Focus milestones — sub-goals under each priority. title is encrypted; completed_at is the
  // done timestamp (column is completed_at, surfaced as doneAt).
  const focusMilestoneRows = (db.prepare(
    'SELECT title, done, completed_at, priority_id FROM focus_milestones WHERE user_id = ? ORDER BY priority_id, sort_order, id'
  ).all(userId) as Array<{ title: string; done: number; completed_at: string | null; priority_id: number }>)
    .map(m => ({
      title: safeDecryptField(m.title, 'focus_milestones.title'),
      done: !!m.done,
      doneAt: m.completed_at ?? null,
      priorityId: m.priority_id,
    }));

  // Support messages — the user's own feedback/question/issue submissions. message is encrypted.
  // (supportMessageQueries.list() is admin-scoped; this is a dedicated user-scoped read.)
  const supportMessageRows = (db.prepare(
    'SELECT type, message, created_at FROM support_messages WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId) as Array<{ type: string; message: string; created_at: string }>)
    .map(s => ({
      type: s.type,
      message: safeDecryptField(s.message, 'support_messages.message'),
      createdAt: s.created_at,
    }));

  // T3-3: undo history — the human-readable label of every action the user could undo, with
  // whether it was undone. The internal `payload` (restore state) is deliberately NOT exported.
  const undoHistoryRows = undoQueries.listRecent(userId, 10000).map(u => ({
    action: u.label,
    undone: !!u.undone,
    at: u.created_at,
  }));

  const payload = {
    exportedAt: new Date().toISOString(),
    version: '4',
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
    // T3-3: include RETIRED facts (the bi-temporal history) with status + confidence metadata,
    // so the export is the user's complete memory record, not just what's currently active.
    facts: factQueries.getAll(userId, { includeRetired: true }).map(f => ({
      category: f.category,
      entity: f.entity ?? null,
      statement: f.statement,
      learnedAt: f.learned_at,
      status: f.valid_until == null ? 'active' : 'retired',
      retiredAt: f.valid_until ?? null,
      confidence: f.confidence,
      confidenceScore: f.confidence_score ?? null,
      lastConfirmedAt: f.last_confirmed_at ?? null,
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
    peopleModels: peopleModelRows,
    episodes: episodeRows,
    factHistory: factHistoryRows,
    focusMilestones: focusMilestoneRows,
    supportMessages: supportMessageRows,
    undoHistory: undoHistoryRows,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="edg3-data-export.json"',
    },
  });
}
