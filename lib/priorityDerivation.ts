// Proactive Priority Derivation — Core-owned.
//
// Analyzes calendar history + email signal + memory/facts → proposes 2-3
// evidence-backed priorities for this week. One Haiku call synthesizes the
// signals into ranked priorities with honest rationales.
//
// Design: pure signal extraction helpers (testable, no I/O) + one LLM call.
// Always degrades safely: any failure returns null.

import { type calendar_v3 } from 'googleapis';
import { type Fact, type Memory, type Priority, type OpenLoop } from './db';
import { type EmailSignal } from './gmail';

// ── Output types ──────────────────────────────────────────────────────────────

export interface DerivedPriority {
  text: string;
  rationale: string;
  evidenceTags: string[];
}

export interface DerivedPriorityProposal {
  priorities: DerivedPriority[];  // 2–3 ordered by confidence
  summaryLine: string;
  dataSnapshot: {
    calendarEventCount: number;
    calendarDaysSpanned: number;
    emailThreadCount: number;
    factsCount: number;
    openLoopsCount: number;
  };
  generatedAt: string;
}

// ── Pure helpers (exported for testing) ───────────────────────────────────────

export interface CalendarTheme {
  title: string;         // normalized cluster title (first 4 words)
  count: number;         // number of occurrences
  totalHours: number;    // total time spent
}

const THEME_STOP_WORDS = new Set([
  'meeting', 'call', 'sync', 'chat', 'standup', 'catch', 'up', 'with', 'and',
  'the', 'a', 'an', 'of', 'for', 'to', 'in', 'on', 'at', 'by',
  'review', 'check', 'follow', 'intro', 'kickoff', 'discussion', 'session',
  'lunch', 'dinner', 'breakfast', 'coffee', 'gym', 'workout', 'walk',
]);

function eventHours(e: calendar_v3.Schema$Event): number {
  if (e.start?.dateTime && e.end?.dateTime) {
    return (new Date(e.end.dateTime).getTime() - new Date(e.start.dateTime).getTime()) / 3600000;
  }
  if (e.start?.date && e.end?.date) {
    const days = (new Date(e.end.date).getTime() - new Date(e.start.date).getTime()) / 86400000;
    return Math.min(days, 1) * 8; // cap at 8h — multi-day blocks aren't countable work hours
  }
  return 0;
}

/** Normalize a raw event title into a short cluster key (first 4 meaningful words). */
export function normalizeThemeTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(w => w.length >= 3 && !THEME_STOP_WORDS.has(w))
    .slice(0, 4)
    .join(' ');
}

/**
 * Extract the top recurring calendar themes from a set of past events.
 * Returns up to `topN` themes sorted by total hours (most time first).
 * Pure — no I/O.
 */
export function extractCalendarThemes(
  events: calendar_v3.Schema$Event[],
  topN = 15,
): CalendarTheme[] {
  const map = new Map<string, { original: string; count: number; totalHours: number }>();

  for (const e of events) {
    const raw = (e.summary ?? '').trim();
    if (!raw) continue;
    const h = eventHours(e);
    if (h <= 0) continue;

    const key = normalizeThemeTitle(raw);
    if (!key) continue;

    const existing = map.get(key);
    if (existing) {
      existing.count++;
      existing.totalHours += h;
    } else {
      map.set(key, { original: raw, count: 1, totalHours: h });
    }
  }

  return [...map.entries()]
    .map(([, v]) => ({
      title: v.original,
      count: v.count,
      totalHours: Math.round(v.totalHours * 10) / 10,
    }))
    .sort((a, b) => b.totalHours - a.totalHours)
    .slice(0, topN);
}

/** Estimate the date span of the provided events in calendar days. */
export function calendarSpanDays(events: calendar_v3.Schema$Event[]): number {
  const times = events
    .map(e => e.start?.dateTime ?? e.start?.date)
    .filter((d): d is string => !!d)
    .map(d => new Date(d.slice(0, 10) + 'T00:00:00Z').getTime());
  if (times.length < 2) return 0;
  return Math.round((Math.max(...times) - Math.min(...times)) / 86400000);
}

/** Build the compact LLM prompt from all signals. */
export function buildDerivePrompt(opts: {
  themes: CalendarTheme[];
  facts: Fact[];
  openLoops: OpenLoop[];
  emailThreads: EmailSignal['items'];
  currentPriorities: Priority[];
  calendarDaysSpanned: number;
}): string {
  const { themes, facts, openLoops, emailThreads, currentPriorities, calendarDaysSpanned } = opts;

  const sanitize = (s: string, max = 120) =>
    s.replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

  const parts: string[] = [];

  if (currentPriorities.length) {
    parts.push(`CURRENT STATED PRIORITIES:\n${currentPriorities.map((p, i) => `${i + 1}. ${sanitize(p.text)}`).join('\n')}`);
  }

  if (themes.length) {
    const windowDesc = calendarDaysSpanned >= 7
      ? `past ${Math.round(calendarDaysSpanned / 7)} weeks`
      : `past ${calendarDaysSpanned} days`;
    const themeLines = themes
      .slice(0, 12)
      .map(t => `- "${sanitize(t.title, 60)}" — ${t.count}× (${t.totalHours}h total)`)
      .join('\n');
    parts.push(`CALENDAR THEMES (${windowDesc}):\n${themeLines}`);
  }

  const goalFacts = facts.filter(f => f.category === 'goal' || f.category === 'project');
  const prefFacts = facts.filter(f => f.category === 'preference');
  if (goalFacts.length) {
    parts.push(`STATED GOALS & PROJECTS:\n${goalFacts.slice(0, 10).map(f => `- ${sanitize(f.statement)}`).join('\n')}`);
  }
  if (prefFacts.length) {
    parts.push(`PREFERENCES:\n${prefFacts.slice(0, 5).map(f => `- ${sanitize(f.statement)}`).join('\n')}`);
  }

  const openByType = openLoops.filter(l => l.status === 'open').slice(0, 10);
  if (openByType.length) {
    parts.push(`OPEN COMMITMENTS (${openByType.length}):\n${openByType.map(l => `- [${l.type}] ${sanitize(l.description)}`).join('\n')}`);
  }

  if (emailThreads.length) {
    parts.push(`RECENT EMAIL THREADS (${emailThreads.length}):\n${emailThreads.slice(0, 10).map(t => `- "${sanitize(t.subject, 80)}" from ${sanitize(t.sender, 40)}`).join('\n')}`);
  }

  const signalBlock = parts.join('\n\n');

  return `You are analyzing the work patterns of a high-performing professional to identify their most important priorities for this week. Be evidence-based and specific — cite what you actually see in the data, not generic advice.

${signalBlock}

Based on these signals, identify 2–3 priorities that are BOTH important AND actionable this week. For each priority:
- text: A clear, specific, actionable priority (under 60 chars). Start with a verb. Reference the actual goal/project.
- rationale: 1–2 sentences explaining WHY this is a priority NOW, citing specific signals from the data above.
- evidenceTags: 2–3 compact tags (e.g. "8 meetings this month", "2 open commitments", "stated goal").

Respond ONLY with a JSON object — no preamble, no markdown fences, no commentary:
{
  "priorities": [
    { "text": "...", "rationale": "...", "evidenceTags": ["...", "..."] }
  ],
  "summaryLine": "Based on [X weeks of data + Y email threads + Z facts]..."
}`;
}

// ── Main derivation function ──────────────────────────────────────────────────

/**
 * Derive 2–3 evidence-backed priorities from the user's signals.
 * Pure inputs → one Haiku call → structured output.
 * Returns null on any failure so callers always degrade gracefully.
 */
export async function derivePriorities(opts: {
  pastEvents: calendar_v3.Schema$Event[];
  emailSignal: EmailSignal | null;
  facts: Fact[];
  openLoops: OpenLoop[];
  memories: Memory[];
  currentPriorities: Priority[];
}): Promise<DerivedPriorityProposal | null> {
  try {
    const { pastEvents, emailSignal, facts, openLoops, currentPriorities } = opts;

    // Need at least some signal to derive from
    const hasCalendar = pastEvents.length > 0;
    const hasFacts = facts.filter(f => f.category === 'goal' || f.category === 'project').length > 0;
    if (!hasCalendar && !hasFacts && !emailSignal?.items.length) return null;

    const themes = extractCalendarThemes(pastEvents, 15);
    const spanDays = calendarSpanDays(pastEvents);
    const emailItems = emailSignal?.items ?? [];

    const prompt = buildDerivePrompt({
      themes,
      facts,
      openLoops,
      emailThreads: emailItems,
      currentPriorities,
      calendarDaysSpanned: spanDays,
    });

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = res.content
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { type: string; text?: string }) => b.text ?? '')
      .join('')
      .trim();

    // Extract JSON object from response
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const parsed: {
      priorities?: { text?: string; rationale?: string; evidenceTags?: string[] }[];
      summaryLine?: string;
    } = JSON.parse(match[0]);

    if (!Array.isArray(parsed.priorities) || parsed.priorities.length === 0) return null;

    const priorities: DerivedPriority[] = parsed.priorities
      .slice(0, 3)
      .filter(p => p.text?.trim())
      .map(p => ({
        text: (p.text ?? '').trim().slice(0, 120),
        rationale: (p.rationale ?? '').trim().slice(0, 300),
        evidenceTags: Array.isArray(p.evidenceTags)
          ? p.evidenceTags.slice(0, 4).map(t => String(t).slice(0, 60))
          : [],
      }));

    if (!priorities.length) return null;

    return {
      priorities,
      summaryLine: (parsed.summaryLine ?? '').trim().slice(0, 200),
      dataSnapshot: {
        calendarEventCount: pastEvents.length,
        calendarDaysSpanned: spanDays,
        emailThreadCount: emailItems.length,
        factsCount: facts.length,
        openLoopsCount: openLoops.filter(l => l.status === 'open').length,
      },
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
