import { NextRequest, NextResponse } from 'next/server';
import { briefingQueries, userQueries, memoryQueries } from '@/lib/db';
import Anthropic from '@anthropic-ai/sdk';
import { getCalendarEvents, getWeekEvents } from '@/lib/calendar';

export async function POST(req: NextRequest) {
  try {
    const { briefingId } = await req.json();
    if (!briefingId) return NextResponse.json({ error: 'briefingId required' }, { status: 400 });

    const db = (await import('@/lib/db')).getDb();
    const briefing = db.prepare('SELECT * FROM briefings WHERE id = ?').get(briefingId) as any;
    if (!briefing?.transcript) return NextResponse.json({ skipped: 'no transcript' });

    const user = userQueries.findById(briefing.user_id);
    if (!user) return NextResponse.json({ error: 'user not found' }, { status: 404 });

    const result = await runPromiseVerification(briefing, user);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[verify-promises] Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function runPromiseVerification(briefing: any, user: any) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const transcript = briefing.transcript;

  // Build executed actions from tool_actions (ground truth)
  let executedSummary: string[] = [];
  if (briefing.tool_actions) {
    try {
      const toolActions: Array<{ fn: string; args: any; result: string }> = JSON.parse(briefing.tool_actions);
      executedSummary = toolActions.map(a => `${a.fn}(${JSON.stringify(a.args)}) → ${a.result}`);
      console.log(`[verify-promises] ${toolActions.length} tool actions found`);
    } catch (_e) { /* ignore */ }
  }

  // Step 1: Extract what Edge promised
  const promisesResult = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `Read this call transcript between a user and their AI Chief of Staff called Edge.
Extract every specific promise Edge made — things Edge said it would do, book, add, change, or handle.
Focus on: calendar bookings, event colors, moves, deletes, renames, reminders.
Return ONLY a JSON array of promise strings. If none, return [].
Example: ["Book focus build 1:30-3:30pm Mon-Fri next week", "Make MVP goal event green on June 12"]
Transcript:\n${transcript}`,
    }],
  });

  const promisesText = promisesResult.content[0].type === 'text' ? promisesResult.content[0].text : '[]';
  let promises: string[] = [];
  try { const m = promisesText.match(/\[[\s\S]*\]/); if (m) promises = JSON.parse(m[0]); } catch { return { promises: [], unfulfilled: [] }; }
  if (!promises.length) { console.log('[verify-promises] No promises found'); return { promises: [], unfulfilled: [] }; }

  // Save promises to briefing record so dashboard can show them
  const dbInst = (await import('@/lib/db')).getDb();
  dbInst.prepare('UPDATE briefings SET edge_promises = ? WHERE id = ?').run(JSON.stringify(promises), briefing.id);
  console.log(`[verify-promises] ${promises.length} promises found:`, promises);

  // Step 2: Check calendar state
  const [todayEvts, weekEvts] = await Promise.all([
    getCalendarEvents(user.id).catch(() => []),
    getWeekEvents(user.id).catch(() => []),
  ]);
  const calendarSummary = [...todayEvts, ...weekEvts]
    .map((e: any) => `- ${e.summary} (${e.start?.dateTime?.slice(0, 16) || e.start?.date || 'all day'})`)
    .join('\n') || 'No events';

  // Step 3: Check which were fulfilled — use tool_actions as primary, calendar as fallback
  const executedContext = executedSummary.length
    ? `\n\nACTUALLY EXECUTED (tool calls made during the call):\n${executedSummary.join('\n')}`
    : '';

  const checkResult = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `Edge promised:\n${promises.map((p, i) => `${i + 1}. ${p}`).join('\n')}${executedContext}\n\nCurrent calendar:\n${calendarSummary}\n\nWhich promises were NOT fulfilled? Check tool executions first — if a tool was called for the promise, mark it fulfilled. Only mark unfulfilled if no matching tool call AND not on calendar.\nReturn JSON: [{"promise":"text","reason":"why unfulfilled"}]\nIf all done, return [].`,
    }],
  });

  const checkText = checkResult.content[0].type === 'text' ? checkResult.content[0].text : '[]';
  let unfulfilled: { promise: string; reason: string }[] = [];
  try { const m = checkText.match(/\[[\s\S]*\]/); if (m) unfulfilled = JSON.parse(m[0]); } catch {}

  if (!unfulfilled.length) {
    console.log(`[verify-promises] All ${promises.length} promises verified ✓`);
    return { promises, unfulfilled: [] };
  }

  console.log(`[verify-promises] ${unfulfilled.length} unfulfilled:`, unfulfilled.map(u => u.promise));

  // Flag only — never re-mutate the calendar. The live in-call tools are the single source of
  // truth; re-creating from the transcript here caused duplicate events (and is why a dedup
  // band-aid existed). Surface the gap in memory so the NEXT briefing addresses it directly,
  // and on the dashboard via edge_promises (saved above).
  const missedList = unfulfilled.map(u => `- ${u.promise}`).join('\n');
  memoryQueries.create(user.id, 'calendar_note',
    `[EDGE MISSED] Promised on the last call but not completed:\n${missedList}\nOpen the next briefing by addressing these directly.`
  );

  return { promises, unfulfilled };
}
