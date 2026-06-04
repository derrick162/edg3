import { NextRequest, NextResponse } from 'next/server';
import { briefingQueries, userQueries, taskQueries, Briefing } from '@/lib/db';
import { analyzeUserResponse } from '@/lib/briefing';
import { extractUserResponseFromTranscript } from '@/lib/vapi';
import { extractAndCreateTimeBlocks, processCalendarEdits } from '@/lib/calendar';
import Anthropic from '@anthropic-ai/sdk';

// Reasons that indicate the user didn't answer — worth retrying
const MISSED_CALL_REASONS = [
  'no-answer', 'busy', 'voicemail', 'failed', 'customer-did-not-answer',
  'pipeline-error', 'twilio-failed-to-connect-call',
];

async function retryCall(briefingId: number, userId: number) {
  try {
    const { userQueries: uq } = await import('@/lib/db');
    const user = uq.findById(userId);
    if (!user) return;
    const phoneNumber = user.phone_number;
    if (!phoneNumber) return;

    console.log(`[webhook] Retrying call for user ${userId} in 10 minutes...`);
    await new Promise(resolve => setTimeout(resolve, 10 * 60 * 1000));

    const { initiateCall } = await import('@/lib/vapi');
    const { memoryQueries: mq } = await import('@/lib/db');
    const db = (await import('@/lib/db')).getDb();
    const briefing = db.prepare('SELECT * FROM briefings WHERE id = ?').get(briefingId) as Briefing | undefined;
    if (!briefing || briefing.status === 'completed') return;

    const recentMemories = mq.getRecent(userId, 1);
    const isFirstCall = recentMemories.filter(m => m.type !== 'profile').length === 0;

    console.log(`[webhook] Firing retry call for user ${userId}...`);
    const call = await initiateCall(phoneNumber, briefing.content, user.name, isFirstCall);
    const callId = call.id;
    if (callId) {
      briefingQueries.update(briefingId, { status: 'calling', vapi_call_id: callId });
      console.log(`[webhook] Retry call initiated: ${callId}`);
    }
  } catch (err) {
    console.error('[webhook] Retry failed:', err);
  }
}

// Vapi webhook handler for call status updates
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const payload = body.message || body;
    const { type, call } = payload;

    if (!call?.id) return NextResponse.json({ received: true });

    // Find the briefing with this call ID
    const db = (await import('@/lib/db')).getDb();
    const briefing = db.prepare('SELECT * FROM briefings WHERE vapi_call_id = ?').get(call.id) as Briefing & { retry_attempted: number };

    if (!briefing) return NextResponse.json({ received: true });

    if ((type === 'call-ended' || type === 'end-of-call-report') && briefing.status !== 'completed') {
      const transcript = call.transcript || payload.transcript || '';
      const endedReason = payload.endedReason || call.endedReason || '';
      const wasMissed = MISSED_CALL_REASONS.some(r => endedReason.toLowerCase().includes(r));

      console.log(`[webhook] Call ended. reason="${endedReason}" missed=${wasMissed} transcript_length=${transcript.length}`);

      if (wasMissed && !briefing.retry_attempted) {
        briefingQueries.update(briefing.id, { status: 'missed' });
        db.prepare('UPDATE briefings SET retry_attempted = 1 WHERE id = ?').run(briefing.id);
        retryCall(briefing.id, briefing.user_id); // fire and forget — waits 10 min then retries
        return NextResponse.json({ received: true });
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

      // Auto-create calendar blocks and tasks from briefing + transcript
      const user = userQueries.findById(briefing.user_id);
      if (user) {
        // Extract calendar blocks from briefing AND transcript conversation
        const combinedContent = briefing.content + (transcript ? '\n\nCONVERSATION TRANSCRIPT:\n' + transcript : '');
        // Process creates AND edits/deletes in parallel
        Promise.all([
          extractAndCreateTimeBlocks(briefing.user_id, combinedContent, user.timezone),
          transcript ? processCalendarEdits(briefing.user_id, transcript, user.timezone) : Promise.resolve([]),
        ]).then(([created, edited]) => {
          const actions = [
            ...created.map((e: any) => ({ type: 'created', title: e.title, start: e.start, end: e.end })),
            ...edited.map((e: any) => ({ type: e.type, title: e.title, start: e.newStart, reason: e.reason })),
          ];
          if (actions.length > 0) {
            db.prepare('UPDATE briefings SET calendar_actions = ? WHERE id = ?')
              .run(JSON.stringify(actions), briefing.id);
            console.log(`[webhook] ${created.length} created, ${edited.length} edited/deleted for briefing ${briefing.id}`);
          }
        }).catch(err => console.error('Calendar processing failed:', err));

        // Extract tasks from briefing content
        const db2 = (await import('@/lib/db')).getDb();
        const tomorrow = new Date(new Date().toLocaleString('en-US', { timeZone: user.timezone }));
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toLocaleDateString('en-CA');
        const existingTasks = db2.prepare(
          "SELECT COUNT(*) as count FROM tasks WHERE user_id = ? AND source = 'edg3' AND date = ?"
        ).get(briefing.user_id, tomorrowStr) as { count: number };

        if (existingTasks.count === 0) {
          extractTasksFromBriefing(briefing.user_id, briefing.content, user.timezone)
            .catch(err => console.error('Task extraction failed:', err));
        }

        // Always extract tasks from transcript conversation (user requests during call)
        if (transcript) {
          extractTasksFromTranscript(briefing.user_id, transcript, user.timezone)
            .catch(err => console.error('Transcript task extraction failed:', err));
        }
      }
    } else if (type === 'call-started' || type === 'assistant.started') {
      briefingQueries.update(briefing.id, { status: 'calling' });
    } else if (type === 'call-failed') {
      console.log(`[webhook] Call failed for briefing ${briefing.id} — scheduling retry`);
      briefingQueries.update(briefing.id, { status: 'missed' });
      if (!briefing.retry_attempted) {
        db.prepare('UPDATE briefings SET retry_attempted = 1 WHERE id = ?').run(briefing.id);
        retryCall(briefing.id, briefing.user_id);
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
      if (text?.trim()) taskQueries.create(userId, text.trim(), today, 'edg3');
    }
  } catch {
    // ignore parse errors
  }
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
      if (text?.trim()) taskQueries.create(userId, text.trim(), today, 'edg3');
    }
  } catch {
    // ignore parse errors
  }
}
