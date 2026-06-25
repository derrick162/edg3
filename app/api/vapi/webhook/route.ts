import { NextRequest, NextResponse } from 'next/server';
import { briefingQueries, userQueries, taskQueries, vapiAuthLogQueries, factQueries, priorityQueries, backgroundJobFailureQueries, failedWebhookQueries, Briefing, getDb, effectiveTimezone, auditLogQueries } from '@/lib/db';
import { checkInboundCallRateLimit } from '@/lib/rateLimit';
import { dayPeriod, greetingYue } from '@/lib/greeting';
import { analyzeUserResponse } from '@/lib/briefing';
import { summarizeUserFacingActions } from '@/lib/actionSummary';
import { extractUserResponseFromTranscript, checkVapiSecret, VOICES, SPEED_MAP, CALENDAR_TOOL_IDS, buildOpenCallSystemPrompt, resolveWebhookUrl, type VoiceSpeedPref } from '@/lib/vapi';
import { currentOpenCallMemoryText, currentPrioritiesText } from '@/lib/callMemory';
import { claimWebhookEvent } from '@/lib/idempotency';
import { withRetry } from '@/lib/retry';
import Anthropic from '@anthropic-ai/sdk';

// Reasons that indicate the user didn't answer — worth retrying
const MISSED_CALL_REASONS = [
  'no-answer', 'busy', 'voicemail', 'failed', 'customer-did-not-answer',
  'pipeline-error', 'twilio-failed-to-connect-call',
];

// Schedule a retry by stamping retry_after in the DB. The minute-cron in lib/scheduler.ts
// detects this and fires the retry call, so server restarts during the 5-minute window
// do NOT drop the retry silently (the flag survives in the DB). DC1-2: retry once at T+5min.
function scheduleRetry(db: ReturnType<typeof getDb>, briefingId: number, userId: number) {
  db.prepare("UPDATE briefings SET retry_after = datetime('now', '+5 minutes') WHERE id = ?").run(briefingId);
  console.log(`[webhook] Retry stamped for briefing ${briefingId} (user ${userId}) — minute-cron fires in ~5 min`);
}

// Vapi webhook handler for call status updates
export async function POST(req: NextRequest) {
  // T1-1: set once we enter the critical call-ended processing path. If anything in that
  // path throws (after the inline retries below), the outer catch dead-letters it so a
  // silent "call happened but nothing was learned" failure becomes visible in the 6am digest.
  let dlq: { userId: number; callId: string; briefingId: number } | null = null;
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

    // R23 T2 — inbound call: Vapi fires `assistant-request` when someone dials our number.
    // We respond synchronously with a personalized Edge assistant config (no call.id / briefing
    // exists yet, so this MUST run before the by-call-id lookup below).
    if (type === 'assistant-request') {
      const callerNumber = payload.call?.customer?.number as string | undefined;
      if (!callerNumber) {
        return NextResponse.json({ error: 'No caller number provided.' });
      }

      // R18 — anti-abuse: cap a phone at 5 inbound calls / rolling 24h. Checked BEFORE the user
      // lookup so abuse from unregistered numbers is throttled too. Fails open on a DB fault.
      const inboundRl = checkInboundCallRateLimit(callerNumber);
      if (!inboundRl.allowed) {
        auditLogQueries.logInboundCallAttempt({ phoneNumber: callerNumber, userId: null, outcome: 'rate_limited', vapiCallId: call?.id });
        return NextResponse.json({
          assistant: {
            firstMessage: "You've made several calls recently. Please wait a bit before trying again.",
            endCallMessage: 'Take care.',
            maxDurationSeconds: 8,
            model: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', systemPrompt: 'You are Edge. Say the firstMessage and immediately end the call.' },
            voice: VOICES.daniel,
            endCallPhrases: ['goodbye'],
          },
        });
      }

      const callerUser = userQueries.findByPhoneNumber(callerNumber);
      if (!callerUser) {
        // Unknown caller — polite 15-second decline.
        auditLogQueries.logInboundCallAttempt({ phoneNumber: callerNumber, userId: null, outcome: 'unknown_caller', vapiCallId: call?.id });
        return NextResponse.json({
          assistant: {
            firstMessage: "Hi there! This number isn't registered with Edg3. Visit edg3.ai to get started.",
            endCallMessage: 'Take care.',
            maxDurationSeconds: 15,
            model: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', systemPrompt: 'You are Edge. This caller is not registered. Say the firstMessage and end the call immediately.' },
            voice: VOICES.daniel,
          },
        });
      }

      const userId = callerUser.id;
      auditLogQueries.logInboundCallAttempt({ phoneNumber: callerNumber, userId, outcome: 'allowed', vapiCallId: call?.id });
      const timezone = effectiveTimezone(callerUser);
      const firstName = callerUser.name.split(' ')[0];
      const hour = parseInt(new Date().toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }));
      const greet = dayPeriod(hour);
      const opener = `Hey, it's Edge — ${firstName}, good ${greet}. How can I help?`;

      // Track the inbound call in history (call-started later links the Vapi call.id).
      const result = briefingQueries.create(userId, `[Inbound call] ${opener}`, new Date().toISOString()) as { lastInsertRowid: number };
      const briefingId = result.lastInsertRowid;
      try { briefingQueries.markOpenCall(briefingId); } catch { /* non-fatal */ }
      try { briefingQueries.markInbound(briefingId); } catch { /* non-fatal */ }
      briefingQueries.update(briefingId, { status: 'calling' });

      const language = callerUser.language || 'en';
      const isCantonese = language === 'yue';
      const voicePref = callerUser.voice_preference === 'aria' ? 'aria' : 'daniel';
      const voiceSpeedPref: VoiceSpeedPref = (callerUser.voice_speed === 'slow' || callerUser.voice_speed === 'fast') ? callerUser.voice_speed : 'default';
      const voiceConfig = { ...VOICES[voicePref], speed: SPEED_MAP[voiceSpeedPref] };
      const effectiveVoice = isCantonese ? { provider: 'azure', voiceId: 'zh-HK-WanLungNeural' } : voiceConfig;
      const cantoneseTranscriber = isCantonese ? { provider: 'openai', model: 'gpt-4o-transcribe' } : undefined;

      // R40 T1 — current wall-clock time so an evening inbound call isn't framed as morning.
      const currentTime = new Date().toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true });
      const systemPrompt = buildOpenCallSystemPrompt({
        firstName, userName: callerUser.name, timezone,
        prioritiesText: currentPrioritiesText(userId),
        memoryText: currentOpenCallMemoryText(userId),
        language,
        currentTime,
        isEvening: hour >= 17,
      });
      const ambientBase = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
      const assistantConfig = {
        firstMessage: isCantonese ? `${greetingYue(hour)}，${firstName}！我係 Edge——有咩想傾？` : opener,
        voice: effectiveVoice,
        ...(cantoneseTranscriber ? { transcriber: cantoneseTranscriber } : {}),
        backgroundSound: ambientBase ? `${ambientBase}/audio/ambient-1.mp3` : 'office',
        model: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', systemPrompt, toolIds: CALENDAR_TOOL_IDS },
        endCallPhrases: isCantonese ? ['再見', '拜拜', '多謝', 'goodbye'] : ['have a focused day', 'have a great day', 'goodbye'],
        silenceTimeoutSeconds: 40,
        maxDurationSeconds: 1800,
        messagePlan: {
          idleMessages: ['Still here — take your time.', "No rush, I'm still on the line."],
          idleTimeoutSeconds: 10,
          idleMessageMaxSpokenCount: 2,
        },
      };

      if (process.env.VAPI_ASSISTANT_ID) {
        return NextResponse.json({ assistantId: process.env.VAPI_ASSISTANT_ID, assistantOverrides: assistantConfig });
      }
      return NextResponse.json({ assistant: { name: 'EDG3', server: { url: resolveWebhookUrl() }, ...assistantConfig } });
    }

    if (!call?.id) return NextResponse.json({ received: true });

    // Find the briefing with this call ID
    const dbmod = await import('@/lib/db');
    const db = dbmod.getDb();
    const briefingRaw = db.prepare('SELECT * FROM briefings WHERE vapi_call_id = ?').get(call.id) as (Briefing & { retry_attempted: number }) | undefined;

    // R23 T2 — inbound calls: the briefing was created at assistant-request without a call.id, so the
    // lookup above misses it. On call-started, link this Vapi call.id to the caller's most recent
    // unlinked inbound 'calling' briefing so the call-ended pipeline finds it normally afterward.
    if (!briefingRaw && (type === 'call-started' || type === 'assistant.started')) {
      const callerNum = call?.customer?.number as string | undefined;
      const inboundUser = callerNum ? userQueries.findByPhoneNumber(callerNum) : undefined;
      if (inboundUser) {
        const pending = db.prepare(
          "SELECT * FROM briefings WHERE user_id = ? AND is_inbound = 1 AND vapi_call_id IS NULL AND status = 'calling' ORDER BY id DESC LIMIT 1",
        ).get(inboundUser.id) as Briefing | undefined;
        if (pending) {
          briefingQueries.update(pending.id, { vapi_call_id: call.id });
          console.log(`[webhook] Linked inbound call ${call.id} to briefing ${pending.id} (user ${inboundUser.id})`);
        }
      }
      return NextResponse.json({ received: true });
    }

    if (!briefingRaw) return NextResponse.json({ received: true });
    // Decrypt PII columns at rest (transcript / user_response) before any use.
    const briefing = dbmod.decryptBriefingRow(briefingRaw);

    // T4-4: Atomic idempotency gate — eliminates the TOCTOU race in the status-flag check.
    // SQLite INSERT OR IGNORE is serialized within the DB; the second concurrent webhook
    // for the same (callId, type) gets changes=0 and returns immediately.
    if ((type === 'call-ended' || type === 'end-of-call-report') && !claimWebhookEvent(call.id, type)) {
      console.log(`[webhook] Duplicate ${type} for call ${call.id} — skipped`);
      return NextResponse.json({ received: true });
    }

    if ((type === 'call-ended' || type === 'end-of-call-report') && briefing.status !== 'completed') {
      // Entering critical processing — arm the dead-letter context (see outer catch).
      dlq = { userId: briefing.user_id, callId: call.id, briefingId: briefing.id };

      // Fetch full transcript from Vapi API — webhook payload often only has partial transcript.
      // T1-1: retry the fetch (3 attempts, exponential backoff) so a transient Vapi 5xx /
      // network blip doesn't drop us to the partial transcript. Non-fatal on final failure.
      let transcript = call.transcript || payload.transcript || '';
      try {
        const fullTranscript = await withRetry(async () => {
          const vapiRes = await fetch(`https://api.vapi.ai/call/${call.id}`, {
            headers: { 'Authorization': `Bearer ${process.env.VAPI_API_KEY}` },
          });
          if (!vapiRes.ok) throw new Error(`Vapi call fetch HTTP ${vapiRes.status}`);
          const vapiCall = await vapiRes.json();
          return (vapiCall.transcript || vapiCall.artifact?.transcript || '') as string;
        }, { attempts: 3, label: 'transcript fetch' });
        if (fullTranscript.length > transcript.length) {
          transcript = fullTranscript;
          console.log(`[webhook] Fetched full transcript from Vapi API (${transcript.length} chars)`);
        }
      } catch (err) {
        console.error('[webhook] Failed to fetch full transcript after retries:', err);
      }

      const endedReason = payload.endedReason || call.endedReason || '';
      const wasMissed = MISSED_CALL_REASONS.some(r => endedReason.toLowerCase().includes(r));

      console.log(`[webhook] Call ended. reason="${endedReason}" missed=${wasMissed} transcript_length=${transcript.length}`);

      // Quota errors won't self-heal with a retry — skip retry and mark missed.
      // (e.g. 'pipeline-error-eleven-labs-quota-exceeded' matches MISSED_CALL_REASONS
      //  via 'pipeline-error', but retrying just burns more failed calls until the
      //  quota is topped up — 14 consecutive failures on 2026-06-22.)
      const isQuotaError = endedReason.toLowerCase().includes('quota');

      if (wasMissed && !briefing.retry_attempted && !isQuotaError) {
        briefingQueries.update(briefing.id, { status: 'missed' });
        db.prepare('UPDATE briefings SET retry_attempted = 1 WHERE id = ?').run(briefing.id);
        scheduleRetry(db, briefing.id, briefing.user_id);
        return NextResponse.json({ received: true });
      }
      // Quota error or already retried — just mark missed, no retry.
      if (wasMissed) {
        briefingQueries.update(briefing.id, { status: 'missed' });
        if (isQuotaError) console.warn(`[webhook] Quota error — call ${call.id} marked missed, no retry scheduled`);
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
          // DC0-2: measure call-end → memory-landed latency. Facts must be extracted well
          // within 30 min of call end; this tracks the actual post-call processing time so a
          // slow pipeline is visible (logged + stored on learning_status; warns past 2 min).
          const briefingId = briefing.id;
          const postCallStart = Date.now();

          const taskP = extractTasksFromTranscript(briefing.user_id, transcript, user.timezone)
            .catch(err => console.error('Transcript task extraction failed:', err));
          // Compounding memory: extract durable structured facts and deduplicate against
          // existing ones. Fire-and-forget — never blocks the webhook response.
          const t0 = Date.now();
          const factsP = import('@/lib/facts').then(m => m.extractAndUpsertFacts(briefing.user_id, transcript, user.name, briefing.id))
            .then((factsExtracted) => {
              const extractionMs = Date.now() - t0;
              const flagged = factsExtracted === 0;
              briefingQueries.updateLearningStatus(briefingId, { facts_ok: true, facts_extracted: factsExtracted, extraction_ms: extractionMs, ...(flagged ? { flagged_for_review: true } : {}) });
              if (flagged) console.warn(`[DC0-1] briefing ${briefingId}: 0 facts extracted — flagged for sleep-time review`);
            })
            .catch(err => {
              console.error('[webhook] Fact extraction failed:', err);
              briefingQueries.updateLearningStatus(briefingId, { facts_ok: false, facts_error: String(err).slice(0, 200) });
              try { backgroundJobFailureQueries.record('fact_extraction', briefing.user_id, String(err).slice(0, 200)); } catch {}
            });
          // Sleep-time consolidation: one Haiku call resolves contradictions between the
          // transcript and stored facts via the bi-temporal retire+insert pipeline.
          const consolidationP = import('@/lib/facts').then(m => m.runSleepTimeConsolidation(briefing.user_id, transcript, user.name))
            .then(() => briefingQueries.updateLearningStatus(briefingId, { consolidation_ok: true }))
            .catch(err => {
              console.error('[webhook] Sleep-time consolidation failed:', err);
              briefingQueries.updateLearningStatus(briefingId, { consolidation_ok: false, consolidation_error: String(err).slice(0, 200) });
              try { backgroundJobFailureQueries.record('sleep_consolidation', briefing.user_id, String(err).slice(0, 200)); } catch {}
            });
          // R37 (M4-4) — update per-person social mental models for anyone mentioned this call.
          // Fire-and-forget, fully self-guarding (never throws) — runs alongside the other learners.
          const peopleModelsP = import('@/lib/peopleModels').then(m => m.updatePeopleModels(briefing.user_id, transcript, user.name))
            .catch(err => { console.error('[webhook] People-model update failed:', err); });
          // Extract open loops / commitments from the call transcript.
          const loopsP = import('@/lib/openLoops').then(m => m.extractAndUpsertOpenLoops(briefing.user_id, { transcript }))
            .then(() => briefingQueries.updateLearningStatus(briefingId, { loops_ok: true }))
            .catch(err => {
              console.error('[webhook] Open loops extraction failed:', err);
              briefingQueries.updateLearningStatus(briefingId, { loops_ok: false, loops_error: String(err).slice(0, 200) });
              try { backgroundJobFailureQueries.record('open_loops_extraction', briefing.user_id, String(err).slice(0, 200)); } catch {}
            });
          // Episode store: persist the raw (grounded) transcript for episodic recall.
          const episodeP = import('@/lib/episodeStore').then(m => {
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
              try { backgroundJobFailureQueries.record('episode_store', briefing.user_id, String(err).slice(0, 200)); } catch {}
            });

          // DC0-2: once all memory jobs settle, record total latency. A line the Security
          // health digest (T1-3) can scrape; warns when it exceeds the 2-minute target.
          Promise.allSettled([taskP, factsP, consolidationP, loopsP, episodeP, peopleModelsP]).then(() => {
            const postCallMs = Date.now() - postCallStart;
            briefingQueries.updateLearningStatus(briefingId, { post_call_ms: postCallMs });
            if (postCallMs > 120_000) {
              console.warn(`[DC0-2] HEALTH: post-call memory pipeline took ${postCallMs}ms for briefing ${briefingId} (target ≤120000ms)`);
            } else {
              console.log(`[DC0-2] post-call memory pipeline ${postCallMs}ms for briefing ${briefingId}`);
            }
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
    // T1-1: if we failed while processing a completed call, dead-letter it so the lost
    // learning is visible (failedWebhookQueries.recentCount feeds the 6am health digest +
    // 3am warning) rather than vanishing silently. Best-effort — never mask the original error.
    if (dlq) {
      try {
        failedWebhookQueries.record(dlq.userId, dlq.callId, dlq.briefingId, String(err).slice(0, 2000));
        console.error(`[webhook] T1-1: dead-lettered call ${dlq.callId} (user ${dlq.userId}) after processing failure`);
      } catch (dlqErr) {
        console.error('[webhook] T1-1: failed to write dead-letter record:', dlqErr);
      }
    }
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
  const nowLocal = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));
  const todayStr = nowLocal.toLocaleDateString('en-CA');
  // Default due date: tomorrow (tasks committed to on the call are expected by next morning)
  const tomorrowDate = new Date(nowLocal);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowStr = tomorrowDate.toLocaleDateString('en-CA');
  // Compute this week's dates for relative resolution ("by Friday" → actual date)
  const dayMs = 86_400_000;
  const dayOfWeek = nowLocal.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7 || 7;
  const fridayStr = new Date(nowLocal.getTime() + daysUntilFriday * dayMs).toLocaleDateString('en-CA');

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Read this call transcript between a user and their AI Chief of Staff.
Extract NEW tasks or action items that the USER personally needs to do — things they committed to or agreed to take action on themselves.

IMPORTANT rules:
- Only include tasks for the USER to complete themselves
- Do NOT include instructions the user gave to the AI (e.g. "delete that event", "move my meeting") — those are Edge requests, not user tasks
- Do NOT include calendar management requests — Edge handles those separately
- Only include real personal actions: calls to make, things to build, errands, decisions, people to contact

Today is ${todayStr}. This Friday is ${fridayStr}.
For each task, include the due date in YYYY-MM-DD format. Rules:
- Explicit date ("by Friday", "this week", "tomorrow"): resolve to the actual date using today = ${todayStr}
- No explicit date mentioned: use ${tomorrowStr} (default — next morning)
- "This week" = ${fridayStr}; "next week" = 7 days from today

Return ONLY a JSON array — no preamble, no markdown.
Each item: {"text":"<short task, max 8 words>","dueDate":"YYYY-MM-DD"}
If no user tasks were committed to, return [].

Transcript:
${transcript}`,
    }],
  });

  const content = response.content[0];
  if (content.type !== 'text') return;

  try {
    const match = content.text.match(/\[[\s\S]*\]/);
    if (!match) return;
    const tasks: Array<{ text?: string; dueDate?: string } | string> = JSON.parse(match[0]);
    for (const item of tasks.slice(0, 5)) {
      const text = typeof item === 'string' ? item : item?.text;
      const rawDate = typeof item === 'object' && item?.dueDate ? item.dueDate : tomorrowStr;
      // Validate date format; fall back to tomorrow if malformed
      const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : tomorrowStr;
      if (text?.trim()) taskQueries.create(userId, text.trim().slice(0, 500), dueDate, 'edg3');
    }
  } catch {
    // ignore parse errors
  }
}
