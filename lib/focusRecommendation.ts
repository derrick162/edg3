// Focus recommendation engine — Edge TELLS the user what to focus on.
// Analyzes past calendar behavior + call memory and proposes top 3 focus areas for the week.
// Pluggable: Whoop and email sources fold in via assembleSources without touching the core contract.
//
// Spec: specs/focus-recommendation.md

import Anthropic from '@anthropic-ai/sdk';
import type { calendar_v3 } from 'googleapis';
import { factQueries, memoryQueries } from './db';
import { getPastCalendarEvents } from './calendar';

// ── Public contract ───────────────────────────────────────────────────────────

export interface FocusArea {
  title: string;        // 2–5 words, action-oriented
  rationale: string;    // one honest sentence citing evidence
  confidence: 'high' | 'medium' | 'low';
}

export interface FocusRecommendation {
  areas: FocusArea[];       // 0–3 proposed focus areas for the week
  basedOn: string[];        // human-readable source descriptions (shown on dashboard)
  generatedAt: string;      // ISO timestamp
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

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Recommend the user's top focus areas for the week based on calendar history + call memory.
 * One Sonnet call synthesizes all sources → FocusRecommendation.
 * Degrades gracefully: returns { areas: [] } on thin data or any failure.
 */
export async function recommendFocusAreas(userId: number): Promise<FocusRecommendation> {
  const generatedAt = new Date().toISOString();

  // ── Assemble sources in parallel ─────────────────────────────────────────────
  // Pluggable: add Whoop/email sources here when ready; they show up in basedOn automatically.
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

  // Degrade on thin data — not enough signal to make a confident recommendation
  const hasSomething = calendarThemes.length >= 3 || facts.length >= 2 || memories.length >= 2;
  if (!hasSomething) {
    return { areas: [], basedOn, generatedAt };
  }

  // ── Build Sonnet prompt ───────────────────────────────────────────────────────
  const sections: string[] = [
    'You are Edge, a personal chief-of-staff AI. Analyze the data below and recommend the top 1–3 focus areas for this person this week — the highest-leverage things most worth their time.',
    '',
  ];

  if (calendarThemes.length > 0) {
    sections.push('CALENDAR — time actually spent (past ~180 days, sorted by total hours):');
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
    '{"areas":[{"title":"...","rationale":"...","confidence":"high|medium|low"}]}',
    '',
    'Rules:',
    '- title: 2–5 words, action-oriented (e.g. "fundraising outreach", "product build", "team hiring") — not generic ("meetings", "work", "email")',
    '- rationale: one honest sentence citing evidence from the data (e.g. "You\'ve logged 18h on product work in the last month and your stated goal is launching by September.")',
    '- confidence: high = clear signal from 2+ sources; medium = one source or ambiguous; low = thin data',
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
    if (!match) return { areas: [], basedOn, generatedAt };

    const parsed = JSON.parse(match[0]);
    const rawAreas: unknown[] = Array.isArray(parsed.areas) ? parsed.areas : [];

    const VALID_CONFIDENCE = ['high', 'medium', 'low'] as const;

    const areas: FocusArea[] = rawAreas
      .filter((a): a is { title: string; rationale: string; confidence?: string } =>
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
      }))
      .filter(a => a.title.length > 0 && a.rationale.length > 0);

    return { areas, basedOn, generatedAt };
  } catch {
    return { areas: [], basedOn, generatedAt };
  }
}
