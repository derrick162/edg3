// Focus recommendation engine — Edge TELLS the user what to focus on TODAY.
// Unit = day. Recomputed fresh each morning on the briefing call.
// Each focus area ladders up to a stable overarching priority (anchor).
//
// Spec: specs/focus-recommendation.md

import Anthropic from '@anthropic-ai/sdk';
import type { calendar_v3 } from 'googleapis';
import { factQueries, memoryQueries, dailyFocusQueries, type Priority } from './db';
import { topFacts } from './memorySalience';
import { getPastCalendarEvents } from './calendar';
import type { EmailSignal, EmailSignalItem } from './gmail';
import { formatOpenLoopsForBriefing, type OpenLoop } from './openLoops';
import { enrichEmailSignal, formatEnrichedEmailForPrompt } from './emailIntel';
import { detectCalendarPatterns, formatPatternsAsEnergyProfile } from './calendarPatterns';
import { computeTimeAllocation, formatTimeAllocationForBriefing } from './timeAllocation';

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
  /** Inbox digest from getRecentEmailSignal() — caller fetches, passes in */
  emailSignal?: EmailSignal | null;
  /** Urgent/overdue open loops — fed in by the briefing; surface as focus-area context */
  openLoops?: OpenLoop[];
}

// ── Email signal helpers (pure, exported for testing) ─────────────────────────

const URGENT_SUBJECT_RE = /\b(urgent|action required|overdue|past due|final notice|collector|debt|legal|lawsuit|penalty|delinquent|default|deadline|payment due|response required|demand|credit bureau|collections?|eviction)\b/i;
const URGENT_SENDER_RE  = /\b(cibc|bmo|td\b|rbc|scotiabank|collections?|recovery|creditor|law firm|attorney|counsel|legal|municipal|irs|cra|revenue canada|bailiff)\b/i;

/** Returns true when an email thread is likely time-sensitive / financial / legal. */
export function isUrgentEmail(item: Pick<EmailSignalItem, 'sender' | 'subject' | 'isImportant'>): boolean {
  return item.isImportant || URGENT_SUBJECT_RE.test(item.subject) || URGENT_SENDER_RE.test(item.sender);
}

/**
 * Format an inbox digest for inclusion in the focus-recommendation prompt.
 * When facts are provided, uses the richer enriched format (deadlines, dollars, VIP).
 * Returns '' when scope is missing or no threads available.
 * Exported for unit testing.
 */
export function formatEmailSignalForPrompt(signal: EmailSignal, facts?: { category: string; entity: string | null; statement: string }[]): string {
  if (signal.scopeMissing || signal.items.length === 0) return '';
  if (facts && facts.length > 0) {
    const enriched = enrichEmailSignal(signal.items, facts as Parameters<typeof enrichEmailSignal>[1]);
    return formatEnrichedEmailForPrompt(enriched);
  }
  return signal.items
    .map(item => {
      const tag = isUrgentEmail(item) ? ' [debt/legal signal]' : item.isUnread ? ' [unread]' : '';
      return `  • From: ${item.sender} | Subject: ${item.subject}${tag}\n    Snippet: ${item.snippet.slice(0, 120)}`;
    })
    .join('\n');
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
  const [rawEvents, allFacts, recentMemories, recentDismissed] = await Promise.all([
    getPastCalendarEvents(userId, 180).catch(() => [] as calendar_v3.Schema$Event[]),
    Promise.resolve(factQueries.getAll(userId)).catch(() => []),
    Promise.resolve(memoryQueries.getWeighted(userId, 15)).catch(() => []),
    Promise.resolve(dailyFocusQueries.getRecentDismissed(userId, 7)).catch(() => [] as string[]),
  ]);

  const calendarThemes = aggregateEventThemes(rawEvents);
  const calendarPatterns = detectCalendarPatterns(rawEvents);
  const timeAllocation = computeTimeAllocation(rawEvents, opts.anchors ?? [], { weeksBack: 8 });
  // Rank facts by salience before injecting into the prompt — most relevant first.
  const rankedFacts = topFacts(allFacts, opts.anchors ?? [], date, { max: 15, maxPerCategory: 4 });
  const facts = rankedFacts.map(f => `[${f.category}] ${f.statement}`);
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
  if (opts.emailSignal && !opts.emailSignal.scopeMissing && opts.emailSignal.items.length > 0) {
    const urgentCount = opts.emailSignal.items.filter(isUrgentEmail).length;
    basedOn.push(`email inbox (${opts.emailSignal.items.length} thread${opts.emailSignal.items.length !== 1 ? 's' : ''}${urgentCount > 0 ? `, ${urgentCount} urgent` : ''})`);
  }

  // Degrade on thin data
  const hasSomething = calendarThemes.length >= 3 || facts.length >= 2 || memories.length >= 2;
  if (!hasSomething) {
    return { areas: [], basedOn, generatedAt, date };
  }

  // ── Build Sonnet prompt ───────────────────────────────────────────────────────
  const sections: string[] = [
    `You are Edge, a personal chief-of-staff AI. Today is ${date}.`,
    'Recommend the top 3–6 focus areas for TODAY — not the week, just today. Return AT LEAST 3 and UP TO 6. Sort by importance: the first 3 are shown immediately; items 4-6 are replacement candidates if the user dismisses one.',
    'Each focus area should ladder up to one of the user\'s stable overarching priorities.',
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

  const patternsProfile = formatPatternsAsEnergyProfile(calendarPatterns);
  if (patternsProfile) {
    sections.push(patternsProfile);
    sections.push('');
  }

  const timeAllocationBlock = formatTimeAllocationForBriefing(timeAllocation);
  if (timeAllocationBlock) {
    sections.push(timeAllocationBlock);
    sections.push('Use TIME ALLOCATION to elevate the most under-served anchor — if a stated priority has < 10% of recent calendar time, treat it as the highest-urgency focus area (label it "high" confidence regardless of other signals).');
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

  if (opts.emailSignal) {
    const emailBody = formatEmailSignalForPrompt(opts.emailSignal, allFacts);
    if (emailBody) {
      sections.push('EMAIL INBOX DIGEST (past 14 days — header + snippet only, no body access):');
      sections.push(emailBody);
      sections.push('');
      sections.push('EMAIL JUDGMENT RULES:');
      sections.push('- Elevate a thread ONLY if it directly moves one of the user\'s overarching anchors (runway = active cash/debt/financing; health goal; a named priority).');
      sections.push('- Anchor-relevant signals: active collections contact, outstanding bank/creditor demand, CRA/tax notice, court filing, a named negotiation on an anchor project.');
      sections.push('- NOISE — do NOT elevate: compliance forms, service quotes, SaaS alerts, account notifications, marketing, newsletters, home-service quotes. A [debt/legal signal] tag means the sender/subject pattern matched — use your judgment; do not auto-elevate.');
      sections.push('- If one anchor-relevant thread exists, surface it as its own specific focus area (name the sender/subject in the rationale). Do NOT bundle unrelated emails into one vague bucket.');
      sections.push('- Only claim "runway impact" if the item genuinely affects cash, debt, or financing — not merely because it involves money or a business name.');
      sections.push('- If no email genuinely moves an anchor, ignore the inbox entirely and focus on calendar + goals.');
      sections.push('');
    }
  }

  if (opts.openLoops && opts.openLoops.length > 0) {
    const loopsBlock = formatOpenLoopsForBriefing(opts.openLoops);
    if (loopsBlock) {
      sections.push(loopsBlock);
      sections.push('Open-loop guidance: if a commitment_made or awaiting_you loop is clearly tied to a priority anchor, surface it as its own focus area (e.g. "Send CIBC proposal"). A deadline loop qualifies only when due today or overdue. Do NOT surface open loops not connected to an anchor as standalone focus areas.');
      sections.push('');
    }
  }

  if (recentDismissed.length > 0) {
    sections.push('RECENTLY DISMISSED (user skipped these in the past 7 days — do NOT suggest the same titles again; suggest related but more specific or actionable alternatives if the underlying priority still applies):');
    sections.push(recentDismissed.map(t => `  - "${t}"`).join('\n'));
    sections.push('');
  }

  sections.push(
    'Return ONLY valid JSON — no preamble, no markdown fences:',
    '{"areas":[{"title":"...","rationale":"...","confidence":"high|medium|low","anchor":"exact priority text or standalone"}]}',
    '',
    'Rules:',
    '- title: 2–5 words, action-oriented for TODAY (e.g. "fundraising outreach", "product build", "team hiring") — not generic ("meetings", "work", "email")',
    '- rationale: one honest sentence citing evidence + connection to the anchor priority',
    '- confidence: high = clear signal from 2+ sources; medium = one source or ambiguous; low = thin data',
    '- anchor: ALWAYS include this field. Use the EXACT text of the closest matching priority from the list above. If nothing fits, write "standalone". Never omit.',
    '- Modulate scope by energy: green=ambitious target, yellow=realistic target, red=one meaningful output',
    '- Return 3–6 areas. Never return fewer than 3 unless data is genuinely too thin to support them.',
    '- Sort by importance, highest first. Items 4-6 are backup candidates.',
  );

  const prompt = sections.join('\n');

  // ── LLM call ─────────────────────────────────────────────────────────────────
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = res.content[0]?.type === 'text' ? res.content[0].text.trim() : '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { areas: [], basedOn, generatedAt, date };

    const parsed = JSON.parse(match[0]);
    const rawAreas: unknown[] = Array.isArray(parsed.areas) ? parsed.areas : [];

    const VALID_CONFIDENCE = ['high', 'medium', 'low'] as const;

    const anchorTexts = (opts.anchors ?? []).map(p => p.text);

    const areas: FocusArea[] = rawAreas
      .filter((a): a is { title: string; rationale: string; confidence?: string; anchor?: string } =>
        typeof a === 'object' && a !== null &&
        typeof (a as Record<string, unknown>).title === 'string' &&
        typeof (a as Record<string, unknown>).rationale === 'string'
      )
      .slice(0, 6)
      .map(a => {
        const title    = String(a.title).trim();
        const rationale = String(a.rationale).trim();
        const confidence = VALID_CONFIDENCE.includes(a.confidence as typeof VALID_CONFIDENCE[number])
          ? (a.confidence as 'high' | 'medium' | 'low')
          : 'medium';

        // Always populate anchor: model-returned value wins, then fuzzy match, then 'standalone'.
        let anchor = a.anchor ? String(a.anchor).trim() : '';
        if (!anchor && anchorTexts.length > 0) {
          const combined = (title + ' ' + rationale).toLowerCase();
          const matched = anchorTexts.find(p =>
            p.toLowerCase().split(/\s+/).some(word => word.length >= 4 && combined.includes(word))
          );
          anchor = matched ?? 'standalone';
        } else if (!anchor) {
          anchor = 'standalone';
        }

        return { title, rationale, confidence, anchor };
      })
      .filter(a => a.title.length > 0 && a.rationale.length > 0);

    return { areas, basedOn, generatedAt, date };
  } catch {
    return { areas: [], basedOn, generatedAt, date };
  }
}
