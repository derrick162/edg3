import { NextRequest, NextResponse } from 'next/server';
import { briefingQueries, userQueries, taskQueries, vapiAuthLogQueries, factQueries, priorityQueries, Briefing, getDb } from '@/lib/db';
import { analyzeUserResponse } from '@/lib/briefing';
import { summarizeUserFacingActions } from '@/lib/actionSummary';
import { extractUserResponseFromTranscript, checkVapiSecret } from '@/lib/vapi';
import Anthropic from '@anthropic-ai/sdk';

// Reasons that indicate the user didn't answer — worth retrying
const MISSED_CALL_REASONS = [
  'no-answer', 'busy', 'voicemail', 'failed', 'customer-did-not-answer',
  'pipeline-error', 'twilio-failed-to-connect-call',
];

// Schedule a retry by stamping retry_after in the DB. The minute-cron in lib/scheduler.ts
// detects this and fires the retry call, so server restarts during the 10-minute window
// do NOT drop the retry silently (the flag survives in the DB).
function scheduleRetry(db: ReturnType<typeof getDb>, briefingId: number, userId: number) {
  db.prepare("UPDATE briefings SET retry_after = datetime('now', '+10 minutes') WHERE id = ?").run(briefingId);
  console.log(`[webhook] Retry stamped for briefing ${briefingId} (user ${userId}) — minute-cron fires in ~10 min`);
}

// Vapi webhook handler for call status updates
export async function POST(req: NextRequest) {
  try {
    const sec = checkVapiSecret(req.headers.get('x-vapi-secret'));
    if (sec.status !== 'accepted') {
      console.warn(`[webhook] Vapi secret ${sec.status}`);
      vapiAuthLogQueries.record('webhook', sec.status); // persist mismatches for admin monitoring
    }
    if (!sec.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const body = await req.json();
    const payload = body.message || body;
    const { type, call } = payload;

    if (!call?.id) return NextResponse.json({ received: true });

    // Find the briefing with this call ID
    const dbmod = await import('@/lib/db');
    const db = dbmod.getDb();
    const briefingRaw = db.prepare('SELECT * FROM briefings WHERE vapi_call_id = ?').get(call.id) as (Briefing & { retry_attempted: number }) | undefined;

    if (!briefingRaw) return NextResponse.json({ received: true });
    // Decrypt PII columns at rest (transcript / user_response) before any use.
    const briefing = dbmod.decryptBriefingRow(briefingRaw);

    if ((type === 'call-ended' || type === 'end-of-call-report') && briefing.status !== 'completed') {
      // Fetch full transcript from Vapi API — webhook payload often only has partial transcript
      let transcript = call.transcript || payload.transcript || '';
      try {
        const vapiRes = await fetch(`https://api.vapi.ai/call/${call.id}`, {
          headers: { 'Authorization': `Bearer ${process.env.VAPI_API_KEY}` },
        });
        if (vapiRes.ok) {
          const vapiCall = await vapiRes.json();
          const fullTranscript = vapiCall.transcript || vapiCall.artifact?.transcript || '';
          if (fullTranscript.length > transcript.length) {
            transcript = fullTranscript;
            console.log(`[webhook] Fetched full transcript from Vapi API (${transcript.length} chars)`);
          }
        }
      } catch (err) {
        console.error('[webhook] Failed to fetch full transcript from Vapi:', err);
      }

      const endedReason = payload.endedReason || call.endedReason || '';
      const wasMissed = MISSED_CALL_REASONS.some(r => endedReason.toLowerCase().includes(r));

      console.log(`[webhook] Call ended. reason="${endedReason}" missed=${wasMissed} transcript_length=${transcript.length}`);

      if (wasMissed && !briefing.retry_attempted) {
        briefingQueries.update(briefing.id, { status: 'missed' });
        db.prepare('UPDATE briefings SET retry_attempted = 1 WHERE id = ?').run(briefing.id);
        scheduleRetry(db, briefing.id, briefing.user_id);
        return NextResponse.json({ received: true });
      }

      // T4: Canonicalize STT homophones before storing the transcript —
      // fixes e.g. "Derek" → "Derrick" (user's own name) and contacts from facts.
      if (transcript.length > 0) {
        try {
          const userForGrounding = userQueries.findById(briefing.user_id);
          if (userForGrounding?.name) {
            const { groundProperNouns, canonicalNamesFromProfile } = await import('@/lib/grounding');
            const nameTokens = canonicalNamesFromProfile(userForGrounding.name);
            const personFacts = factQueries.getAll(briefing.user_id)
              .filter(f => f.category === 'person' && f.entity?.trim())
              .map(f => f.entity as string);
            const allNames = [...new Set([...nameTokens, ...personFacts])];
            if (allNames.length) transcript = groundProperNouns(transcript, allNames);
          }
        } catch { /* grounding is best-effort — never blocks storage */ }
      }

      const userResponse = extractUserResponseFromTranscript(transcript);
      briefingQueries.update(briefing.id, {
        status: transcript.length > 50 ? 'completed' : 'missed',
        transcript,
        user_response: userResponse || undefined,
      });

      // Extract and store insight from user response
      if (userResponse) {
        await analyzeUserResponse(briefing.user_id, userResponse);
      }

      // POST-CALL PROCESSING — simplified to three things only
      // All calendar changes happen LIVE via tool calling. Nothing here should touch the calendar.
      const user = userQueries.findById(briefing.user_id);
      if (user) {
        // 1. Detect travel timezone
        if (transcript) {
          detectAndSaveTravelTimezone(briefing.user_id, transcript)
            .catch(err => console.error('Travel timezone detection failed:', err));
        }

        // 2. Extract user tasks (not calendar changes)
        const db2 = (await import('@/lib/db')).getDb();
        const tomorrow = new Date(new Date().toLocaleString('en-US', { timeZone: user.timezone }));
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toLocaleDateString('en-CA');
        const existingTasks = db2.prepare(
          "SELECT COUNT(*) as count FROM tasks WHERE user_id = ? AND source = 'edg3' AND date = ?"
        ).get(briefing.user_id, tomorrowStr) as { count: number };
        if (existingTasks.count === 0) {
          extractTasksFromBriefing(briefing.user_id, briefing.content, user.timezone)
            .then(() => briefingQueries.updateLearningStatus(briefing.id, { tasks_ok: true }))
            .catch(err => {
              console.error('Task extraction failed:', err);
              briefingQueries.updateLearningStatus(briefing.id, { tasks_ok: false, tasks_error: String(err).slice(0, 200) });
            });
        }
        if (transcript) {
          extractTasksFromTranscript(briefing.user_id, transcript, user.timezone)
            .catch(err => console.error('Transcript task extraction failed:', err));
          // Compounding memory: extract durable structured facts and deduplicate against
          // existing ones. Fire-and-forget — never blocks the webhook response.
          const briefingId = briefing.id;
          import('@/lib/facts').then(m => m.extractAndUpsertFacts(briefing.user_id, transcript, user.name, briefing.id))
            .then(() => briefingQueries.updateLearningStatus(briefingId, { facts_ok: true }))
            .catch(err => {
              console.error('[webhook] Fact extraction failed:', err);
              briefingQueries.updateLearningStatus(briefingId, { facts_ok: false, facts_error: String(err).slice(0, 200) });
            });
          // Sleep-time consolidation: one Haiku call resolves contradictions between the
          // transcript and stored facts via the bi-temporal retire+insert pipeline.
          import('@/lib/facts').then(m => m.runSleepTimeConsolidation(briefing.user_id, transcript, user.name))
            .then(() => briefingQueries.updateLearningStatus(briefingId, { consolidation_ok: true }))
            .catch(err => {
              console.error('[webhook] Sleep-time consolidation failed:', err);
              briefingQueries.updateLearningStatus(briefingId, { consolidation_ok: false, consolidation_error: String(err).slice(0, 200) });
            });
          // Extract open loops / commitments from the call transcript.
          import('@/lib/openLoops').then(m => m.extractAndUpsertOpenLoops(briefing.user_id, { transcript }))
            .then(() => briefingQueries.updateLearningStatus(briefingId, { loops_ok: true }))
            .catch(err => {
              console.error('[webhook] Open loops extraction failed:', err);
              briefingQueries.updateLearningStatus(briefingId, { loops_ok: false, loops_error: String(err).slice(0, 200) });
            });
          // Episode store: persist the raw (grounded) transcript for episodic recall.
          import('@/lib/episodeStore').then(m => {
            const priorities = (() => { try { return priorityQueries.getMostRecent(briefing.user_id); } catch { return []; } })();
            const taskTexts = (() => { try { return taskQueries.getRecent(briefing.user_id, 1).map(t => t.text); } catch { return []; } })();
            return m.persistCallEpisode(
              briefing.user_id,
              transcript,
              briefing.scheduled_for ?? new Date().toISOString(),
              priorities.map(p => p.text),
              taskTexts,
            );
          })
            .then(() => briefingQueries.updateLearningStatus(briefingId, { episode_ok: true }))
            .catch(err => {
              console.error('[webhook] Episode store failed:', err);
              briefingQueries.updateLearningStatus(briefingId, { episode_ok: false, episode_error: String(err).slice(0, 200) });
            });
        }

        // 3. Verify promises — READ-ONLY. Compares verbal promises vs tool_actions/calendar and
        //    flags any gaps for the next briefing. Never re-mutates the calendar (the live tools
        //    are the single source of truth), so no auto-dedup is needed anymore.
        // Called directly (no self-HTTP) to eliminate the unauthenticated HTTP attack surface.
        import('@/lib/verifyPromises').then(m => m.runPromiseVerification(briefing, user))
          .then(r => console.log('[webhook] Verify promises:', JSON.stringify(r)))
          .catch(err => console.error('Promise verification failed:', err));

        // 4. Save a call summary (discussion + action items) into today's briefing calendar event.
        if (transcript) {
          saveCallSummaryToCalendar(briefing, user)
            .catch(err => console.error('Call summary save failed:', err));
        }
      }
    } else if (type === 'call-started' || type === 'assistant.started') {
      briefingQueries.update(briefing.id, { status: 'calling' });
    } else if (type === 'call-failed') {
      console.log(`[webhook] Call failed for briefing ${briefing.id} — scheduling retry`);
      briefingQueries.update(briefing.id, { status: 'missed' });
      if (!briefing.retry_attempted) {
        db.prepare('UPDATE briefings SET retry_attempted = 1 WHERE id = ?').run(briefing.id);
        scheduleRetry(db, briefing.id, briefing.user_id);
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('Vapi webhook error:', err);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}

async function extractTasksFromBriefing(userId: number, briefingContent: string, timezone: string) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  // Always create tasks for tomorrow — morning briefing is always about the day ahead
  const targetDate = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));
  targetDate.setDate(targetDate.getDate() + 1);
  const today = targetDate.toLocaleDateString('en-CA');

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `Extract the specific action items recommended in this briefing.
Return ONLY a JSON array of short task strings (max 8 words each), nothing else.
Example: ["Go to the gym", "Call lawyer about foreclosure", "Work on Edg3 prototype"]
If no clear action items, return [].

Briefing:
${briefingContent}`,
    }],
  });

  const content = response.content[0];
  if (content.type !== 'text') return;

  try {
    const match = content.text.match(/\[[\s\S]*\]/);
    if (!match) return;
    const tasks: string[] = JSON.parse(match[0]);
    for (const text of tasks.slice(0, 5)) {
      if (text?.trim()) taskQueries.create(userId, text.trim().slice(0, 500), today, 'edg3');
    }
  } catch {
    // ignore parse errors
  }
}

async function detectAndSaveTravelTimezone(userId: number, transcript: string) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const result = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 100,
    messages: [{
      role: 'user',
      content: `Read this transcript. Respond with ONLY a single token — no explanation, no punctuation:
- "home" if the user mentions being BACK HOME, back in Vancouver, or returning from a trip
- an IANA timezone (e.g. America/Toronto) if they mention being in a different city/location/timezone
- "none" otherwise
Common mappings: Blue Mountain/Toronto/Ontario → America/Toronto, New York/Eastern/EST → America/New_York, London → Europe/London
Transcript: ${transcript.slice(0, 1000)}`,
    }],
  });
  const raw = result.content[0].type === 'text' ? result.content[0].text.trim() : 'none';
  // The model should return one token, but can be verbose — take the first token and validate it.
  // Never persist a non-IANA value; current_timezone is used as a real timezone and would crash calls.
  const token = (raw.split(/\s+/)[0] || '').replace(/['".,]/g, '');
  const { userQueries } = await import('@/lib/db');
  const { isValidTimeZone } = await import('@/lib/time');
  if (token.toLowerCase() === 'home') {
    userQueries.setCurrentTimezone(userId, null);
    console.log(`[webhook] Travel timezone cleared — user is back home`);
  } else if (isValidTimeZone(token)) {
    userQueries.setCurrentTimezone(userId, token);
    console.log(`[webhook] Current timezone set to ${token}`);
  } else {
    console.log(`[webhook] No valid travel timezone detected (got "${raw.slice(0, 40)}") — left unchanged`);
  }
}

async function saveCallSummaryToCalendar(briefing: { id: number; user_id: number; transcript: string | null; tool_actions?: string | null }, user: { name: string; timezone: string }) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let toolSummary = 'None';
  try {
    const ta = JSON.parse(briefing.tool_actions || '[]');
    const labels = summarizeUserFacingActions(ta);
    if (labels.length) toolSummary = labels.map(l => `- ${l}`).join('\n');
  } catch { /* ignore */ }

  // T4: Canonicalize STT homophones before summarization.
  // Sources: user name, person facts, and today's calendar event titles (for event-specific names).
  let transcript = briefing.transcript ?? '';
  try {
    const { groundProperNouns, canonicalNamesFromProfile, extractNamesFromEventTitles } = await import('@/lib/grounding');
    const nameTokens = canonicalNamesFromProfile(user.name);
    const personFacts = factQueries.getAll(briefing.user_id)
      .filter(f => f.category === 'person' && f.entity?.trim())
      .map(f => f.entity as string);
    let eventNames: string[] = [];
    try {
      const { getCalendarEvents } = await import('@/lib/calendar');
      const events = await getCalendarEvents(briefing.user_id);
      eventNames = extractNamesFromEventTitles(events.map(e => e.summary ?? '').filter(Boolean));
    } catch { /* calendar fetch is best-effort */ }
    const allNames = [...new Set([...nameTokens, ...personFacts, ...eventNames])];
    if (allNames.length) transcript = groundProperNouns(transcript, allNames);
  } catch { /* grounding is best-effort */ }

  const firstName = (user.name || 'the user').split(' ')[0];
  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `Summarize this AI Chief of Staff phone call for a calendar note. Plain text only — NO markdown, no preamble. Use exactly these three labeled sections:

Discussed: 2-3 sentences on what was covered.
Edge's action items: short dash bullets of what Edge (the assistant) did or will do — use the executed tool actions below as ground truth. If none, write "None".
Your action items: short dash bullets of what ${firstName} personally agreed to do. If none, write "None".

TRANSCRIPT:
${transcript}

TOOL ACTIONS EDGE EXECUTED:
${toolSummary}`,
    }],
  });
  const summary = res.content[0].type === 'text' ? res.content[0].text.trim() : '';
  if (!summary) return;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.edg3.ai').replace(/\/$/, '');
  const fullSummary = `${summary}\n\n▶ Full transcript: ${appUrl}/dashboard?briefing=${briefing.id}`;
  const { addSummaryToTodaysBriefingEvent } = await import('@/lib/calendar');
  const ok = await addSummaryToTodaysBriefingEvent(briefing.user_id, user.timezone, fullSummary);
  console.log(`[webhook] Call summary ${ok ? 'saved to briefing event' : '(no briefing event found)'} for user ${briefing.user_id}`);
}

async function extractTasksFromTranscript(userId: number, transcript: string, timezone: string) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const targetDate = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));
  targetDate.setDate(targetDate.getDate() + 1);
  const today = targetDate.toLocaleDateString('en-CA');

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `Read this call transcript between a user and their AI Chief of Staff.
Extract NEW tasks or action items that the USER personally needs to do — things they committed to or agreed to take action on themselves.

IMPORTANT rules:
- Only include tasks for the USER to complete themselves
- Do NOT include instructions the user gave to the AI (e.g. "delete that event", "move my meeting", "add hot tub time") — those are requests to Edge, not user tasks
- Do NOT include calendar management requests — Edge handles those separately
- Only include real personal actions: calls to make, things to build, workouts, errands, decisions to make, people to contact

Return ONLY a JSON array of short task strings (max 8 words each). If no user tasks were committed to, return [].

Transcript:
${transcript}`,
    }],
  });

  const content = response.content[0];
  if (content.type !== 'text') return;

  try {
    const match = content.text.match(/\[[\s\S]*\]/);
    if (!match) return;
    const tasks: string[] = JSON.parse(match[0]);
    for (const text of tasks.slice(0, 5)) {
      if (text?.trim()) taskQueries.create(userId, text.trim().slice(0, 500), today, 'edg3');
    }
  } catch {
    // ignore parse errors
  }
}
