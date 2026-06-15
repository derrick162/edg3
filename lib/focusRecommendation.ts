// Focus recommendation engine — Edge TELLS the user what to focus on TODAY.
// Unit = day. Recomputed fresh each morning on the briefing call.
// Each focus area ladders up to a stable overarching priority (anchor).
//
// Spec: specs/focus-recommendation.md

import Anthropic from '@anthropic-ai/sdk';
import type { calendar_v3 } from 'googleapis';
import { factQueries, memoryQueries, type Priority } from './db';
import { getPastCalendarEvents } from './calendar';

// ── Public contract ───────────────────────────────────────────────────────────

export interface FocusArea {
  title: string;         // 2–5 words, action-oriented
  rationale: string;     // one honest sentence citing evidence
  confidence: 'high' | 'medium' | 'low';
  anchor?: string;       // which stable overarching priority this serves
}

export interface FocusRecommendation {
  areas: FocusArea[];    // 0–3 focus areas for TODAY
  basedOn: string[];     // human-readable source descriptions (shown on dashboard)
  generatedAt: string;   // ISO timestamp
  date: string;          // YYYY-MM-DD the recommendation is for (user's local date)
}

export type EnergyTier = 'green' | 'yellow' | 'red';

export interface EnergySignal {
  tier: EnergyTier;
  recoveryScore?: number;   // 0–100 from Whoop
  source: 'whoop' | 'default';
}

export interface RecommendOpts {
  energySignal?: EnergySignal | null;
  todayEvents?: calendar_v3.Schema$Event[];
  anchors?: Priority[];
  /** YYYY-MM-DD representing today in the user's local timezone */
  date?: string;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function eventDurationHours(e: calendar_v3.Schema$Event): number {
  if (e.start?.dateTime && e.end?.dateTime) {
    return (new Date(e.end.dateTime).getTime() - new Date(e.start.dateTime).getTime()) / 3600000;
  }
  return 0;
}

export interface CalendarTheme {
  title: string;
  totalHours: number;
  occurrences: number;
}

/**
 * Aggregate raw events into title-grouped themes sorted by total hours.
 * Pure — no I/O. Exported for unit testing.
 */
export function aggregateEventThemes(
  events: calendar_v3.Schema$Event[],
  topN = 25,
): CalendarTheme[] {
  const map = new Map<string, { title: string; hours: number; count: number }>();
  for (const e of events) {
    const title = (e.summary || '').trim();
    if (title.length < 3) continue;
    const hours = eventDurationHours(e);
    if (hours <= 0) continue;
    const key = title.toLowerCase();
    const curr = map.get(key);
    if (curr) {
      curr.hours += hours;
      curr.count += 1;
    } else {
      map.set(key, { title, hours, count: 1 });
    }
  }
  return [...map.values()]
    .map(({ title, hours, count }) => ({
      title,
      totalHours: Math.round(hours * 10) / 10,
      occurrences: count,
    }))
    .sort((a, b) => b.totalHours - a.totalHours)
    .slice(0, topN);
}

function describeEnergyTier(tier: EnergyTier): string {
  if (tier === 'green') return 'High energy today (recovery ≥67%). Full capacity — schedule demanding deep work.';
  if (tier === 'yellow') return 'Moderate energy today (recovery 34–66%). Normal capacity — balance focus with admin.';
  return 'Low energy today (recovery ≤33%). Protect capacity — favour low-demand tasks and one meaningful output.';
}

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Recommend today's top focus areas, anchored to stable overarching priorities.
 * Factors energy signal (Whoop recovery) + today's calendar load.
 * Degrades gracefully: returns { areas: [] } on thin data or any failure.
 */
export async function recommendFocusAreas(
  userId: number,
  opts: RecommendOpts = {},
): Promise<FocusRecommendation> {
  const generatedAt = new Date().toISOString();
  const date = opts.date ?? new Date().toISOString().slice(0, 10);

  // ── Assemble sources in parallel ─────────────────────────────────────────────
  const [rawEvents, allFacts, recentMemories] = await Promise.all([
    getPastCalendarEvents(userId, 180).catch(() => [] as calendar_v3.Schema$Event[]),
    Promise.resolve(factQueries.getAll(userId)).catch(() => []),
    Promise.resolve(memoryQueries.getWeighted(userId, 15)).catch(() => []),
  ]);

  const calendarThemes = aggregateEventThemes(rawEvents);
  const facts = allFacts.map(f => `[${f.category}] ${f.statement}`);
  const memories = recentMemories.map(m => m.content).filter(Boolean).slice(0, 10) as string[];

  const basedOn: string[] = [];
  if (calendarThemes.length > 0) {
    basedOn.push(`${calendarThemes.length} calendar event types across ~180 days (${rawEvents.length} events)`);
  }
  if (facts.length > 0) basedOn.push(`${facts.length} facts from calls (goals, projects, preferences)`);
  if (memories.length > 0) basedOn.push(`${memories.length} recent call notes`);
  if (opts.energySignal) basedOn.push(`Whoop recovery: ${opts.energySignal.tier} (${opts.energySignal.recoveryScore ?? '?'}%)`);
  if (opts.todayEvents && opts.todayEvents.length > 0) basedOn.push(`today's calendar (${opts.todayEvents.length} events)`);
  if (opts.anchors && opts.anchors.length > 0) basedOn.push(`${opts.anchors.length} overarching priorities`);

  // Degrade on thin data
  const hasSomething = calendarThemes.length >= 3 || facts.length >= 2 || memories.length >= 2;
  if (!hasSomething) {
    return { areas: [], basedOn, generatedAt, date };
  }

  // ── Build Sonnet prompt ───────────────────────────────────────────────────────
  const sections: string[] = [
    `You are Edge, a personal chief-of-staff AI. Today is ${date}.`,
    'Recommend the top 1–3 focus areas for TODAY — not the week, just today. Each focus area should ladder up to one of the user\'s stable overarching priorities.',
    '',
  ];

  // Energy context
  if (opts.energySignal) {
    sections.push(`ENERGY TODAY: ${describeEnergyTier(opts.energySignal.tier)}`);
    sections.push('');
  }

  // Stable anchors
  if (opts.anchors && opts.anchors.length > 0) {
    sections.push('OVERARCHING PRIORITIES (stable anchors — each focus area must ladder to one of these):');
    sections.push(opts.anchors.map(p => `  ${p.rank}. "${p.text}"`).join('\n'));
    sections.push('');
  }

  // Today's calendar
  if (opts.todayEvents && opts.todayEvents.length > 0) {
    const todayThemes = aggregateEventThemes(opts.todayEvents, 10);
    sections.push('TODAY\'S CALENDAR LOAD:');
    sections.push(todayThemes.map(t => `  • "${t.title}" — ${t.totalHours}h`).join('\n'));
    sections.push('');
  }

  if (calendarThemes.length > 0) {
    sections.push('HISTORICAL CALENDAR — where time actually went (past ~180 days, sorted by total hours):');
    sections.push(calendarThemes.map(t => `  • "${t.title}" — ${t.totalHours}h total, ${t.occurrences}×`).join('\n'));
    sections.push('');
  }

  if (facts.length > 0) {
    sections.push('WHAT EDGE KNOWS ABOUT THIS PERSON:');
    sections.push(facts.map(f => `  ${f}`).join('\n'));
    sections.push('');
  }

  if (memories.length > 0) {
    sections.push('RECENT CALL NOTES:');
    sections.push(memories.map(m => `  ${m}`).join('\n'));
    sections.push('');
  }

  sections.push(
    'Return ONLY valid JSON — no preamble, no markdown fences:',
    '{"areas":[{"title":"...","rationale":"...","confidence":"high|medium|low","anchor":"matching overarching priority text or omit if none"}]}',
    '',
    'Rules:',
    '- title: 2–5 words, action-oriented for TODAY (e.g. "fundraising outreach", "product build", "team hiring") — not generic ("meetings", "work", "email")',
    '- rationale: one honest sentence citing evidence + connection to the anchor priority',
    '- confidence: high = clear signal from 2+ sources; medium = one source or ambiguous; low = thin data',
    '- anchor: the exact text of the overarching priority this serves (omit if anchors list is empty)',
    '- Modulate scope by energy: green=ambitious target, yellow=realistic target, red=one meaningful output',
    '- Return fewer than 3 if fewer than 3 clear priorities emerge — never invent',
    '- Sort by importance, highest first',
  );

  const prompt = sections.join('\n');

  // ── LLM call ─────────────────────────────────────────────────────────────────
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = res.content[0]?.type === 'text' ? res.content[0].text.trim() : '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { areas: [], basedOn, generatedAt, date };

    const parsed = JSON.parse(match[0]);
    const rawAreas: unknown[] = Array.isArray(parsed.areas) ? parsed.areas : [];

    const VALID_CONFIDENCE = ['high', 'medium', 'low'] as const;

    const areas: FocusArea[] = rawAreas
      .filter((a): a is { title: string; rationale: string; confidence?: string; anchor?: string } =>
        typeof a === 'object' && a !== null &&
        typeof (a as Record<string, unknown>).title === 'string' &&
        typeof (a as Record<string, unknown>).rationale === 'string'
      )
      .slice(0, 3)
      .map(a => ({
        title: String(a.title).trim(),
        rationale: String(a.rationale).trim(),
        confidence: VALID_CONFIDENCE.includes(a.confidence as typeof VALID_CONFIDENCE[number])
          ? (a.confidence as 'high' | 'medium' | 'low')
          : 'medium',
        ...(a.anchor ? { anchor: String(a.anchor).trim() } : {}),
      }))
      .filter(a => a.title.length > 0 && a.rationale.length > 0);

    return { areas, basedOn, generatedAt, date };
  } catch {
    return { areas: [], basedOn, generatedAt, date };
  }
}
