import { NextRequest, NextResponse } from 'next/server';
import { briefingQueries, memoryQueries, userQueries, taskQueries } from '@/lib/db';
import { analyzeUserResponse } from '@/lib/briefing';
import { extractUserResponseFromTranscript } from '@/lib/vapi';
import { extractAndCreateTimeBlocks } from '@/lib/calendar';
import Anthropic from '@anthropic-ai/sdk';
import { format } from 'date-fns';

// Vapi webhook handler for call status updates
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const payload = body.message || body;
    const { type, call } = payload;

    console.log('Vapi webhook:', type, 'call id:', call?.id);

    if (!call?.id) return NextResponse.json({ received: true });

    // Find the briefing with this call ID
    const db = (await import('@/lib/db')).getDb();
    const briefing = db.prepare('SELECT * FROM briefings WHERE vapi_call_id = ?').get(call.id) as any;

    if (!briefing) return NextResponse.json({ received: true });

    if ((type === 'call-ended' || type === 'end-of-call-report') && briefing.status !== 'completed') {
      const transcript = call.transcript || payload.transcript || '';
      const userResponse = extractUserResponseFromTranscript(transcript);

      briefingQueries.update(briefing.id, {
        status: 'completed',
        transcript,
        user_response: userResponse || undefined,
      });

      // Extract and store insight from user response
      if (userResponse) {
        await analyzeUserResponse(briefing.user_id, userResponse);
      }

      // Auto-create calendar blocks and tasks from briefing recommendations
      const user = userQueries.findById(briefing.user_id);
      if (user) {
        extractAndCreateTimeBlocks(briefing.user_id, briefing.content, user.timezone)
          .catch(err => console.error('Calendar block creation failed:', err));

        // Only extract tasks if none exist for today from EDG3 already
        const db2 = (await import('@/lib/db')).getDb();
        const tomorrow = new Date(new Date().toLocaleString('en-US', { timeZone: user.timezone }));
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toLocaleDateString('en-CA');
        const existingTasks = db2.prepare(
          "SELECT COUNT(*) as count FROM tasks WHERE user_id = ? AND source = 'edg3' AND date = ?"
        ).get(briefing.user_id, tomorrowStr) as any;

        if (existingTasks.count === 0) {
          extractTasksFromBriefing(briefing.user_id, briefing.content, user.timezone)
            .catch(err => console.error('Task extraction failed:', err));
        }
      }
    } else if (type === 'call-started') {
      briefingQueries.update(briefing.id, { status: 'calling' });
    } else if (type === 'call-failed') {
      briefingQueries.update(briefing.id, { status: 'failed' });
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
