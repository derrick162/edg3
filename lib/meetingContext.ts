// Meeting Prep Context — Core-owned.
//
// For each upcoming calendar event, surfaces related email threads, stored facts,
// and open loops so Edge can walk in prepared: "Your 2pm with Faiza — here's your
// recent CIBC thread and what I know about her."
//
// Pure keyword matching (no LLM call) — fast and zero extra cost.

import type { calendar_v3 } from 'googleapis';
import type { EmailSignalItem } from './gmail';
import type { Fact, OpenLoop } from './db';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MeetingContext {
  eventSummary: string;
  startTime: string;           // ISO datetime or date
  attendeeNames: string[];     // non-self attendees
  relatedEmails: EmailSignalItem[];   // up to 3, ranked by keyword overlap
  relatedFacts: Array<{ category: string; entity: string; statement: string }>;  // up to 4
  relatedLoops: OpenLoop[];    // up to 2 open loops about this meeting/person
}

// ── Keyword helpers ───────────────────────────────────────────────────────────

const STOP = new Set([
  'with', 'from', 'and', 'the', 'for', 'this', 'that', 'have', 'will', 'your',
  'our', 'are', 'has', 'was', 'about', 'call', 'meeting', 'sync', 'check',
  'catch', 'over', 'week', 'next', 'into', 'follow', 'time', 'chat', 'discuss',
  'team', 'group', 'daily', 'today', 'tomorrow', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday', 'sunday',
]);

export function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !STOP.has(w));
}

/**
 * Extract search tokens for a given event.
 * Returns attendee first-names (≥2 chars) + meaningful words from the event title.
 */
export function eventTokens(event: calendar_v3.Schema$Event): string[] {
  const attendeeNames = (event.attendees ?? [])
    .filter(a => !a.self)
    .flatMap(a => {
      const names: string[] = [];
      if (a.displayName) {
        names.push(...a.displayName.toLowerCase().split(/\s+/).filter(w => w.length >= 2));
      }
      if (a.email) {
        const prefix = a.email.split('@')[0].replace(/[._-]/g, ' ');
        names.push(...prefix.toLowerCase().split(/\s+/).filter(w => w.length >= 2));
      }
      return names;
    });

  const titleWords = extractKeywords(event.summary ?? '');
  return [...new Set([...attendeeNames, ...titleWords])];
}

// ── Core builder ──────────────────────────────────────────────────────────────

/**
 * Build meeting context for a single event.
 * Returns null when there's nothing useful to surface (no token overlap).
 */
export function buildMeetingContext(
  event: calendar_v3.Schema$Event,
  emailItems: EmailSignalItem[],
  facts: Fact[],
  openLoops: OpenLoop[],
): MeetingContext | null {
  const summary = (event.summary ?? '').trim();
  if (!summary) return null;

  const tokens = eventTokens(event);
  if (tokens.length === 0) return null;

  const attendeeNames = (event.attendees ?? [])
    .filter(a => !a.self)
    .map(a => a.displayName ?? a.email?.split('@')[0] ?? '')
    .filter(Boolean);

  // Score emails by token overlap with subject + sender + snippet
  const relatedEmails = emailItems
    .map(item => {
      const haystack = `${item.sender} ${item.subject} ${item.snippet}`.toLowerCase();
      const score = tokens.filter(t => haystack.includes(t)).length;
      return { item, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(x => x.item);

  // Filter facts by entity matching any token
  const relatedFacts = facts
    .filter(f => {
      if (!f.entity) return false;
      const entity = f.entity.toLowerCase();
      return tokens.some(t => entity.includes(t) || t.includes(entity.split(' ')[0]));
    })
    .slice(0, 4)
    .map(f => ({ category: f.category, entity: f.entity!, statement: f.statement }));

  // Filter open loops by description matching any token
  const relatedLoops = openLoops
    .filter(l => {
      const desc = l.description.toLowerCase();
      return tokens.some(t => desc.includes(t));
    })
    .slice(0, 2);

  if (relatedEmails.length === 0 && relatedFacts.length === 0 && relatedLoops.length === 0) {
    return null;
  }

  return {
    eventSummary: summary,
    startTime: event.start?.dateTime ?? event.start?.date ?? '',
    attendeeNames,
    relatedEmails,
    relatedFacts,
    relatedLoops,
  };
}

/**
 * Build contexts for multiple events.
 * Filters to events that start within the next `lookAheadHours` hours (default 8).
 * Returns only events that have something useful to surface.
 */
export function buildMeetingContexts(
  events: calendar_v3.Schema$Event[],
  emailItems: EmailSignalItem[],
  facts: Fact[],
  openLoops: OpenLoop[],
  opts: { lookAheadHours?: number; now?: string; max?: number } = {},
): MeetingContext[] {
  const now = new Date(opts.now ?? new Date().toISOString());
  const lookAheadMs = (opts.lookAheadHours ?? 8) * 3600 * 1000;
  const cutoff = new Date(now.getTime() + lookAheadMs);
  const max = opts.max ?? 3;

  return events
    .filter(e => {
      const startStr = e.start?.dateTime;
      if (!startStr) return false;  // skip all-day events
      const start = new Date(startStr);
      return start >= now && start <= cutoff;
    })
    .sort((a, b) => {
      const aTime = new Date(a.start!.dateTime!).getTime();
      const bTime = new Date(b.start!.dateTime!).getTime();
      return aTime - bTime;
    })
    .slice(0, max * 2)  // check more than we need; filter out empties below
    .map(e => buildMeetingContext(e, emailItems, facts, openLoops))
    .filter((ctx): ctx is MeetingContext => ctx !== null)
    .slice(0, max);
}

// ── Formatting ────────────────────────────────────────────────────────────────

/**
 * Format meeting contexts as a compact block for briefing prompt injection.
 * Returns '' when no contexts.
 */
export function formatMeetingContextsForBriefing(
  contexts: MeetingContext[],
  userTimezone = 'UTC',
): string {
  if (!contexts.length) return '';

  const lines: string[] = ['MEETING PREP (upcoming events with context):'];

  for (const ctx of contexts) {
    const timeLabel = (() => {
      if (!ctx.startTime.includes('T')) return ctx.startTime;
      try {
        return new Intl.DateTimeFormat('en-US', {
          hour: 'numeric', minute: '2-digit', hour12: true, timeZone: userTimezone,
        }).format(new Date(ctx.startTime));
      } catch {
        return ctx.startTime.slice(11, 16);
      }
    })();

    const who = ctx.attendeeNames.length > 0
      ? ` with ${ctx.attendeeNames.slice(0, 2).join(', ')}`
      : '';
    lines.push(`\n"${ctx.eventSummary}"${who} at ${timeLabel}`);

    for (const email of ctx.relatedEmails) {
      lines.push(`  [EMAIL] ${email.sender} — "${email.subject}" (${email.date.slice(0, 10)})`);
    }
    for (const fact of ctx.relatedFacts) {
      lines.push(`  [${fact.category.toUpperCase()}] ${fact.statement}`);
    }
    for (const loop of ctx.relatedLoops) {
      const tag = loop.type === 'commitment_made' ? 'YOU COMMITTED'
        : loop.type === 'awaiting_you' ? 'AWAITING'
        : 'DEADLINE';
      const due = loop.dueDate ? ` (due ${loop.dueDate})` : '';
      lines.push(`  [${tag}]${due} ${loop.description}`);
    }
  }

  return lines.join('\n');
}
