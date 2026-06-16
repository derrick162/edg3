// Open Loops / Commitment Tracking — Core-owned.
//
// Tracks unresolved action threads pulled from email + call transcripts + calendar.
// Three buckets: commitments YOU made · awaiting YOUR response · deadlines.

import { openLoopQueries, type OpenLoop as DbOpenLoop } from './db';
import type { EmailSignal } from './gmail';
import type { calendar_v3 } from 'googleapis';

// ─── Types ────────────────────────────────────────────────────────────────────

export type OpenLoopType   = 'commitment_made' | 'awaiting_you' | 'deadline';
export type OpenLoopSource = 'email' | 'call' | 'calendar';
export type OpenLoopStatus = 'open' | 'done' | 'dismissed';

// Snake-case interface retained for backwards compat with the route + UI component.
export interface OpenLoop {
  id: number;
  user_id: number;
  description: string;
  type: OpenLoopType;
  source: OpenLoopSource;
  due_date: string | null;
  status: OpenLoopStatus;
  created_at: string;
  resolved_at: string | null;
}

export interface ExtractedOpenLoop {
  description: string;
  type: OpenLoopType;
  source: OpenLoopSource;
  due_date: string | null;
}

// ─── Adapter ─────────────────────────────────────────────────────────────────
// Converts the camelCase DbOpenLoop (from lib/db.ts) to the snake_case OpenLoop
// interface expected by the route and UI component.

function toSnake(l: DbOpenLoop): OpenLoop {
  return {
    id:          l.id,
    user_id:     l.userId,
    description: l.description,
    type:        l.type as OpenLoopType,
    source:      l.source as OpenLoopSource,
    due_date:    l.dueDate,
    status:      l.status as OpenLoopStatus,
    created_at:  l.createdAt,
    resolved_at: l.resolvedAt,
  };
}

// openLoopStubQueries: thin wrapper over the encrypted openLoopQueries from lib/db.ts.
// Preserves the snake_case interface so the route, UI component, and tests remain unchanged.
export const openLoopStubQueries = {
  insert(userId: number, loop: ExtractedOpenLoop): void {
    openLoopQueries.insert(userId, {
      description: loop.description,
      type:        loop.type,
      source:      loop.source,
      due_date:    loop.due_date,
    });
  },

  getOpen(userId: number): OpenLoop[] {
    return openLoopQueries.list(userId, 'open').map(toSnake);
  },

  getAll(userId: number, _limit = 50): OpenLoop[] {
    return openLoopQueries.list(userId).map(toSnake);
  },

  resolve(userId: number, id: number): boolean {
    return openLoopQueries.resolve(userId, id);
  },

  dismiss(userId: number, id: number): boolean {
    return openLoopQueries.dismiss(userId, id);
  },

  existsSimilar(userId: number, description: string): boolean {
    return openLoopQueries.existsSimilar(userId, description);
  },
};

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
      const digest = options.emailSignal.items
        .map(item => `From: ${item.sender} | Subject: ${item.subject}\nSnippet: ${item.snippet.slice(0, 150)}`)
        .join('\n\n');
      const loops = await extractOpenLoopsFromText(digest, 'email', today);
      allExtracted.push(...loops);
    }

    if (options.calendarEvents && options.calendarEvents.length > 0) {
      const loops = extractOpenLoopsFromCalendar(options.calendarEvents);
      allExtracted.push(...loops);
    }

    let inserted = 0;
    for (const loop of allExtracted) {
      if (openLoopStubQueries.existsSimilar(userId, loop.description)) continue;
      openLoopStubQueries.insert(userId, loop);
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
  const open = openLoopStubQueries.getOpen(userId);
  return open
    .filter(loop => {
      if (loop.due_date) return loop.due_date <= today;
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
    const due = loop.due_date ? ` (due ${loop.due_date})` : '';
    return `- [${tag}]${due} ${loop.description}`;
  });

  return `OPEN LOOPS (unresolved commitments — mention proactively):\n${lines.join('\n')}`;
}
