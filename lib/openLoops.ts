// Open Loops / Commitment Tracking — Core-owned.
//
// Tracks unresolved action threads pulled from email + call transcripts + calendar.
// Three buckets: commitments YOU made · awaiting YOUR response · deadlines.

import { openLoopQueries, factQueries, type OpenLoop, type OpenLoopType, type OpenLoopSource, type OpenLoopStatus } from './db';
import type { EmailSignal } from './gmail';
import type { calendar_v3 } from 'googleapis';
import { enrichEmailSignal, formatEnrichedEmailForPrompt } from './emailIntel';

export type { OpenLoop, OpenLoopType, OpenLoopSource, OpenLoopStatus };

export interface ExtractedOpenLoop {
  description: string;
  type: OpenLoopType;
  source: OpenLoopSource;
  due_date: string | null;
}

// Dedup check — scan open loops for a matching first-80-char prefix
function existsSimilar(userId: number, description: string): boolean {
  const prefix = description.trim().toLowerCase().slice(0, 80);
  return openLoopQueries.list(userId, 'open')
    .some(l => l.description.trim().toLowerCase().slice(0, 80) === prefix);
}

// ─── LLM extraction from text ─────────────────────────────────────────────────

const VALID_TYPES: OpenLoopType[] = ['commitment_made', 'awaiting_you', 'deadline'];

/**
 * One Haiku call: extract up to 8 open commitment loops from a transcript or email digest.
 * Returns [] on any error.
 */
export async function extractOpenLoopsFromText(
  text: string,
  source: OpenLoopSource,
  today: string,
): Promise<ExtractedOpenLoop[]> {
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const sourceLabel = source === 'call' ? 'call transcript' : 'email digest';
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Extract open commitment loops from this ${sourceLabel}.
Return ONLY a JSON array — no preamble, no markdown.
Today is ${today}.

Each item: {"description":"<clear one sentence>","type":"<type>","due_date":"<YYYY-MM-DD or null>"}

Types:
- "commitment_made"  — the user explicitly promised to do something ("I'll send the deck", "I'll call Friday")
- "awaiting_you"    — someone is actively waiting on the user (request sent, reply owed, collector/creditor waiting)
- "deadline"        — explicit upcoming date by which something must happen (bill due, response deadline, filing)

Rules:
- Only UNRESOLVED loops with a clear counterparty or due date — not routine tasks, not vague filler.
- "description" must name the person/company if known and be specific ("Send CIBC proposal by Friday", not "follow up").
- "due_date": extract from explicit mention ("by Friday" = next Friday from today); null if not stated.
- Skip completed items, casual mentions, and anything without a clear obligation.
- Max 8 loops. Return [] if nothing found.

Text (first 2500 chars):
${text.slice(0, 2500)}`,
      }],
    });

    const raw = res.content
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { type: string; text?: string }) => b.text ?? '')
      .join('')
      .trim();

    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];

    const parsed: unknown[] = JSON.parse(match[0]);
    return parsed
      .filter((item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null &&
        typeof (item as Record<string, unknown>).description === 'string' &&
        ((item as Record<string, unknown>).description as string).trim().length > 0 &&
        VALID_TYPES.includes((item as Record<string, unknown>).type as OpenLoopType),
      )
      .slice(0, 8)
      .map(item => ({
        description: (item.description as string).trim(),
        type: item.type as OpenLoopType,
        source,
        due_date: typeof item.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.due_date)
          ? item.due_date
          : null,
      }));
  } catch {
    return [];
  }
}

/**
 * Extract deadline-style open loops from calendar events via keyword matching (no LLM).
 * Only catches events with titles explicitly suggesting a commitment or deadline.
 * Pure — no I/O.
 */
export function extractOpenLoopsFromCalendar(
  events: calendar_v3.Schema$Event[],
): ExtractedOpenLoop[] {
  const DEADLINE_RE = /\b(deadline|due|submit|respond|confirm|send|pay|renew|file|sign|review|deliver)\b/i;
  const loops: ExtractedOpenLoop[] = [];

  for (const event of events) {
    const title = (event.summary || '').trim();
    if (!title || !DEADLINE_RE.test(title)) continue;

    const dateStr = event.start?.date ?? event.start?.dateTime?.slice(0, 10) ?? null;
    loops.push({
      description: `"${title}"${dateStr ? ` due ${dateStr}` : ''}`,
      type: 'deadline',
      source: 'calendar',
      due_date: dateStr,
    });
  }

  return loops.slice(0, 5);
}

// ─── Multi-source upsert ──────────────────────────────────────────────────────

/**
 * Extract open loops from all provided sources and upsert for the given user.
 * Fire-and-forget safe: any error is logged but never propagated.
 * Deduplicates against existing open loops (same description prefix, status=open).
 */
export async function extractAndUpsertOpenLoops(
  userId: number,
  options: {
    transcript?: string;
    emailSignal?: EmailSignal | null;
    calendarEvents?: calendar_v3.Schema$Event[];
    today?: string;
  },
): Promise<void> {
  const today = options.today ?? new Date().toISOString().slice(0, 10);

  try {
    const allExtracted: ExtractedOpenLoop[] = [];

    if (options.transcript && options.transcript.length > 50) {
      const loops = await extractOpenLoopsFromText(options.transcript, 'call', today);
      allExtracted.push(...loops);
    }

    if (options.emailSignal && !options.emailSignal.scopeMissing && options.emailSignal.items.length > 0) {
      // Enrich with deadlines, dollar amounts, and VIP signals before passing to the LLM.
      const facts = (() => { try { return factQueries.getAll(userId); } catch { return []; } })();
      const enriched = enrichEmailSignal(options.emailSignal.items, facts, today);
      const digest = formatEnrichedEmailForPrompt(enriched);
      const loops = await extractOpenLoopsFromText(digest, 'email', today);
      allExtracted.push(...loops);
    }

    if (options.calendarEvents && options.calendarEvents.length > 0) {
      const loops = extractOpenLoopsFromCalendar(options.calendarEvents);
      allExtracted.push(...loops);
    }

    let inserted = 0;
    for (const loop of allExtracted) {
      if (existsSimilar(userId, loop.description)) continue;
      openLoopQueries.insert(userId, loop);
      inserted++;
    }

    if (inserted > 0) {
      console.log(`[openLoops] Inserted ${inserted} open loops for user ${userId}`);
    }
  } catch (err) {
    console.error('[openLoops] extractAndUpsertOpenLoops failed:', err);
  }
}

// ─── Briefing + recommendation injection ─────────────────────────────────────

/**
 * Return open loops that are urgent enough to surface in the briefing and focus recs:
 * - Any loop with a due_date <= today (overdue or due today)
 * - commitment_made + awaiting_you without a due date (they're always relevant)
 */
export function getUrgentOpenLoops(userId: number, today: string): OpenLoop[] {
  return openLoopQueries.list(userId, 'open')
    .filter(loop => {
      if (loop.dueDate) return loop.dueDate <= today;
      return loop.type === 'commitment_made' || loop.type === 'awaiting_you';
    })
    .slice(0, 5);
}

/**
 * Format urgent open loops as a compact block for briefing / focus-rec prompt injection.
 * Returns empty string when there are no urgent loops.
 */
export function formatOpenLoopsForBriefing(loops: OpenLoop[]): string {
  if (!loops.length) return '';

  const lines = loops.map(loop => {
    const tag =
      loop.type === 'commitment_made' ? 'YOU COMMITTED' :
      loop.type === 'awaiting_you'    ? 'AWAITING YOUR RESPONSE' :
      'DEADLINE';
    const due = loop.dueDate ? ` (due ${loop.dueDate})` : '';
    return `- [${tag}]${due} ${loop.description}`;
  });

  return `OPEN LOOPS (unresolved commitments — mention proactively):\n${lines.join('\n')}`;
}
