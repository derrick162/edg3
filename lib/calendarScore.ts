// Focus/Energy scoring engine.
// MVP: Focus Score = % of working hours on focus areas (0-100).
//       Energy Score = demand-fit vs energy capacity (0-100).
// Future: judgment layer (deferred until multi-user feedback exists — see specs/calendar-scores.md).

import Anthropic from '@anthropic-ai/sdk';
import type { calendar_v3 } from 'googleapis';
import type { Priority } from './db';
import type { AlignmentResult } from './alignment';
import type { EnergySignal } from './energy';
import type { WhoopRecoveryDay, WhoopSleep } from './whoop';

// ─── Public contract ─────────────────────────────────────────────────────────

export interface ScoreResult {
  score: number;           // 0–100
  calibrating?: boolean;   // true = not enough data for a real score; UI shows "calibrating" not a number
  drivers: string[];       // plain-English reasons (no black box)
  topFix: { description: string; op?: 'create' | 'move' | 'delete' | 'recolor' } | null;
  worstMismatchEventId?: string | null;     // event ID of the highest-penalty mismatch (for hero loop)
  worstMismatchEventTitle?: string | null;  // display title of that event
}

export interface CalendarFit {
  edgeScore: number;        // 0–100 — the ONE headline number (blend of focus + energy)
  calibrating: boolean;     // true when energy component has thin data (energy shows "calibrating")
  focusScore: ScoreResult;  // breakdown — does calendar reflect priorities?
  energyScore: ScoreResult; // breakdown — does calendar match energy capacity?
  computedAt: string;
}

// Energy profile (Core's scoring interface — camelCase, nullable).
// DB-stored version is lib/db.ts EnergyProfile (snake_case). API route bridges the two.
export interface EnergyProfile {
  peakStart: number | null;   // hour 0-23
  peakEnd: number | null;
  troughStart: number | null;
  troughEnd: number | null;
}

// ─── Per-event energy tagging ─────────────────────────────────────────────────

export type EventType = 'meeting' | 'meal' | 'workout' | 'deep_work' | 'admin' | 'social' | 'travel' | 'personal' | 'other';
export type EventDemand = 'high' | 'medium' | 'low';

export interface EventEnergyClassification {
  type: EventType;
  demand: EventDemand;
}

export interface TaggedEvent {
  event: calendar_v3.Schema$Event;
  tag: EventEnergyClassification;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function parseHour(s: string): number | null {
  s = s.trim().toLowerCase();
  if (s === 'noon') return 12;
  if (s === 'midnight') return 0;
  const m = s.match(/^(\d{1,2})(am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  if (m[2] === 'pm' && h < 12) h += 12;
  if (m[2] === 'am' && h === 12) h = 0;
  return h >= 0 && h <= 23 ? h : null;
}

function eventDurationHours(e: calendar_v3.Schema$Event): number {
  if (e.start?.dateTime && e.end?.dateTime) {
    return (new Date(e.end.dateTime).getTime() - new Date(e.start.dateTime).getTime()) / 3600000;
  }
  return 0;
}

// Extract hour-of-day from an RFC3339 string — reads local time from the string itself.
// "2026-06-14T09:30:00-04:00" → 9.  "2026-06-14T14:00:00Z" → 14.
export function eventStartHour(e: calendar_v3.Schema$Event): number | null {
  const dt = e.start?.dateTime;
  if (!dt) return null;
  const m = dt.match(/T(\d{2}):/);
  return m ? parseInt(m[1], 10) : null;
}

function inWindow(hour: number, start: number | null, end: number | null): boolean {
  if (start === null || end === null) return false;
  return end > start ? (hour >= start && hour < end) : (hour >= start || hour < end);
}

const clamp = (lo: number, hi: number, v: number): number => Math.min(hi, Math.max(lo, v));

// ─── parseEnergyProfile ───────────────────────────────────────────────────────

/**
 * Parse structured energy windows from free-text preference fact statements.
 * Accepts: "my peak is 9 to 11", "9am-11am peak", "trough 2pm to 4pm", "dip at 2pm".
 */
export function parseEnergyProfile(statements: string[]): EnergyProfile {
  const r: EnergyProfile = { peakStart: null, peakEnd: null, troughStart: null, troughEnd: null };

  for (const stmt of statements) {
    const s = stmt.toLowerCase();
    const isPeak   = s.includes('peak') || s.includes('flow state') || s.includes('high energy') || s.includes('high-energy');
    const isTrough = s.includes('trough') || s.includes('dip') || s.includes('low energy') || s.includes('afternoon slump');
    if (!isPeak && !isTrough) continue;

    // Time range: "9 to 11", "9am-11am", "9–11"
    const rangeMatch = s.match(/(\d{1,2}(?:am|pm)?)\s*(?:to|[-–])\s*(\d{1,2}(?:am|pm)?)/);
    if (rangeMatch) {
      let startStr = rangeMatch[1];
      const endStr  = rangeMatch[2];
      if (!startStr.match(/(am|pm)$/)) {
        const endMeridiem = endStr.match(/(am|pm)$/)?.[1];
        if (endMeridiem) startStr += endMeridiem;
      }
      const start = parseHour(startStr);
      const end   = parseHour(endStr);
      if (start !== null && end !== null) {
        if (isPeak   && r.peakStart   === null) { r.peakStart = start;   r.peakEnd = end; }
        if (isTrough && r.troughStart === null) { r.troughStart = start; r.troughEnd = end; }
        continue;
      }
    }

    // Single hour: "peak at 9am", "trough around 2pm"
    const singleMatch = s.match(/(?:at|around)\s+(\d{1,2}(?:am|pm)?)/);
    if (singleMatch) {
      const h = parseHour(singleMatch[1]);
      if (h !== null) {
        if (isPeak   && r.peakStart   === null) { r.peakStart = h;   r.peakEnd   = Math.min(h + 2, 23); }
        if (isTrough && r.troughStart === null) { r.troughStart = h; r.troughEnd = Math.min(h + 1, 23); }
      }
    }
  }

  return r;
}

// ─── LLM-based event energy tagger ───────────────────────────────────────────

const VALID_TYPES: EventType[] = ['meeting', 'meal', 'workout', 'deep_work', 'admin', 'social', 'travel', 'personal', 'other'];
const VALID_DEMANDS: EventDemand[] = ['high', 'medium', 'low'];

/**
 * Classify a batch of calendar events by type and energy demand (async, one LLM call).
 * Degrades to {type:'other', demand:'medium'} per event on any LLM failure.
 * Designed for fast-follow cache swap-in (Security's event_energy_tags table).
 */
export async function classifyEventsEnergy(
  events: calendar_v3.Schema$Event[],
): Promise<TaggedEvent[]> {
  const timedEvents = events.filter(e => !!e.start?.dateTime);
  if (timedEvents.length === 0) return [];

  const eventList = timedEvents.map((e, i) => {
    const desc = (e.description || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    return {
      i,
      title: e.summary ?? 'Untitled',
      ...(desc ? { notes: desc } : {}),
      durationMin: Math.round(eventDurationHours(e) * 60),
      startHour: eventStartHour(e) ?? 0,
    };
  });

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let parsed: { i: number; type: string; demand: string }[] = [];
  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content:
            'Classify each calendar event by type and energy demand. Consider both the title and any "notes" field. Return ONLY a JSON array, no extra text.\n' +
            'type options: meeting meal workout deep_work admin social travel personal other\n' +
            'demand options: high medium low\n\n' +
            `Events:\n${JSON.stringify(eventList)}\n\n` +
            'Response format: [{"i":0,"type":"meeting","demand":"medium"},...]',
        },
      ],
    });
    const text = res.content[0]?.type === 'text' ? res.content[0].text.trim() : '';
    const arr = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? '[]');
    if (Array.isArray(arr)) parsed = arr;
  } catch {
    // Degrade: all events get {type:'other', demand:'medium'}
  }

  const tagMap = new Map<number, EventEnergyClassification>();
  for (const r of parsed) {
    if (typeof r.i !== 'number') continue;
    const type:   EventType   = VALID_TYPES.includes(r.type as EventType)       ? (r.type as EventType)   : 'other';
    const demand: EventDemand = VALID_DEMANDS.includes(r.demand as EventDemand) ? (r.demand as EventDemand) : 'medium';
    tagMap.set(r.i, { type, demand });
  }

  return timedEvents.map((e, i) => ({
    event: e,
    tag:   tagMap.get(i) ?? { type: 'other' as EventType, demand: 'medium' as EventDemand },
  }));
}

// ─── computeFocusScore ───────────────────────────────────────────────────────

/**
 * Focus Score = focusAlignedHours / totalWorkingHours * 100 (0–100).
 * Pure — no I/O. Degrades to 0 when alignment is null.
 */
export function computeFocusScore(
  alignment: AlignmentResult | null,
  priorities: Priority[],
  totalWorkingHours = 45,
): ScoreResult {
  if (!priorities.length) {
    return {
      score: 0,
      drivers: ['No focus areas set — add your top 3 priorities to get a real Focus Score.'],
      topFix: { description: 'Set your 3 areas of focus in the Priorities tab.', op: 'create' },
    };
  }

  const perPriority = alignment?.perPriority
    ?? priorities.map(p => ({ priority: p.text, hours: 0, blocked: false }));

  const focusAlignedHours = perPriority.reduce((s, p) => s + p.hours, 0);
  const score = Math.min(100, Math.round((focusAlignedHours / Math.max(totalWorkingHours, 0.01)) * 100));

  const drivers: string[] = [];
  for (const p of perPriority) {
    if (p.hours === 0) {
      drivers.push(`"${p.priority}" has zero hours scheduled this week.`);
    } else {
      drivers.push(`"${p.priority}" — ${p.hours.toFixed(1)}h this week.`);
    }
  }

  const unalignedHours = alignment?.unalignedHours ?? 0;
  if (unalignedHours > focusAlignedHours && alignment?.topUnaligned?.[0]) {
    drivers.push(`Biggest time sink: "${alignment.topUnaligned[0].title}" at ${alignment.topUnaligned[0].hours.toFixed(1)}h.`);
  }

  const uncovered = perPriority.filter(p => p.hours === 0);
  let topFix: ScoreResult['topFix'] = null;

  if (uncovered.length > 0) {
    topFix = {
      description: `Block time for "${uncovered[0].priority}" — it has zero hours scheduled this week.`,
      op: 'create',
    };
  } else if (score < 40) {
    const topU = alignment?.topUnaligned?.[0];
    topFix = topU
      ? { description: `Cut or reschedule "${topU.title}" (${topU.hours.toFixed(1)}h unaligned) to free time for focus work.`, op: 'move' }
      : { description: "Block more time for your focus areas — you're below 40%.", op: 'create' };
  } else if (score < 70) {
    const lowestP = [...perPriority].sort((a, b) => a.hours - b.hours)[0];
    topFix = {
      description: `Add more time for "${lowestP.priority}" to push your focus score higher.`,
      op: 'create',
    };
  }

  return { score, drivers, topFix };
}

// ─── computeEnergyScore ───────────────────────────────────────────────────────

/**
 * Energy Score = weighted average of Whoop sleep performance + recovery (0–100).
 * Weight: sleep 60% / recovery 40% over trailing 7 days.
 * Calibrating when no Whoop data at all. Pure — no I/O.
 */
export function computeEnergyScore(
  recoveryHistory: WhoopRecoveryDay[],
  todaySleep: WhoopSleep | null,
): ScoreResult {
  const recent7d = recoveryHistory.slice(-7);
  const hasRecovery = recent7d.length > 0;
  const hasSleep = todaySleep !== null;

  if (!hasRecovery && !hasSleep) {
    return {
      score: 50,
      calibrating: true,
      drivers: ['Connect Whoop to unlock a real Energy Score based on your sleep and recovery data.'],
      topFix: { description: 'Connect your Whoop to score your energy from real health data.', op: 'create' },
    };
  }

  const avgRecovery = hasRecovery
    ? Math.round(recent7d.reduce((s, d) => s + d.recoveryScore, 0) / recent7d.length)
    : null;
  const sleepScore = hasSleep ? todaySleep!.performancePct : null;

  let score: number;
  if (hasSleep && hasRecovery) {
    score = clamp(0, 100, Math.round(sleepScore! * 0.6 + avgRecovery! * 0.4));
  } else if (hasSleep) {
    score = clamp(0, 100, sleepScore!);
  } else {
    score = clamp(0, 100, avgRecovery!);
  }

  const drivers: string[] = [];
  if (sleepScore !== null) {
    const tier = sleepScore >= 75 ? 'excellent' : sleepScore >= 50 ? 'good' : 'low';
    drivers.push(`Last night's sleep score: ${sleepScore}% (${tier}).`);
  } else {
    drivers.push('Sleep score unavailable — connect Whoop to see it here.');
  }
  if (avgRecovery !== null) {
    const tier = avgRecovery >= 67 ? 'strong' : avgRecovery >= 34 ? 'moderate' : 'low';
    drivers.push(`7-day recovery average: ${avgRecovery}% (${tier}).`);
  }

  let topFix: ScoreResult['topFix'] = null;
  if (score < 40) {
    topFix = { description: 'Your energy is low — protect your sleep and keep today lighter.', op: 'move' };
  } else if (score < 70 && sleepScore !== null && sleepScore < 60) {
    topFix = { description: 'Improving sleep quality will raise your energy score the most.', op: 'move' };
  } else if (score < 70 && avgRecovery !== null && avgRecovery < 50) {
    topFix = { description: 'Recovery is trending low — consider reducing strain this week.', op: 'move' };
  }

  return { score, drivers, topFix };
}

// ─── computeCalendarFit ───────────────────────────────────────────────────────

/** Compute both scores and return the combined CalendarFit with a single Edge Score. Pure. */
export function computeCalendarFit(
  alignment: AlignmentResult | null,
  priorities: Priority[],
  recoveryHistory: WhoopRecoveryDay[],
  todaySleep: WhoopSleep | null,
  totalWorkingHours = 45,
): CalendarFit {
  const focusScore  = computeFocusScore(alignment, priorities, totalWorkingHours);
  const energyScore = computeEnergyScore(recoveryHistory, todaySleep);

  // Calibrating = no Whoop data. Edge Score falls back to focus-only when calibrating.
  const calibrating = energyScore.calibrating === true;
  const edgeScore   = calibrating
    ? focusScore.score
    : Math.round((focusScore.score + energyScore.score) / 2);

  return { edgeScore, calibrating, focusScore, energyScore, computedAt: new Date().toISOString() };
}

// ─── Energy color-coding ─────────────────────────────────────────────────────

// Maps event demand + daily energy level to a Google Calendar colorId.
// Visual logic: low demand = always sage (calm); medium = banana unless red day;
// high demand = blueberry on green days (aligned), tangerine on yellow (caution),
// tomato on red (warning — consider deferring), peacock when signal unknown.
function demandToColorId(demand: EventDemand, level: 'green' | 'yellow' | 'red' | null): string {
  if (demand === 'low') return '2';   // sage
  if (demand === 'medium') return level === 'red' ? '6' : '5'; // tangerine or banana
  // high demand:
  if (level === 'green')  return '9';  // blueberry — full capacity, go
  if (level === 'yellow') return '6';  // tangerine — proceed with care
  if (level === 'red')    return '11'; // tomato — warning, flag for deferral
  return '8'; // peacock — no signal, neutral blue
}

export interface EnergyColorAssignment {
  eventId: string;
  colorId: string;
}

/** Pure: maps a list of tagged events to Google Calendar colorId assignments. */
export function colorByEnergy(
  tags: { eventId: string; demand: EventDemand }[],
  signal: EnergySignal | null,
): EnergyColorAssignment[] {
  const level = signal?.level ?? null;
  return tags.map(({ eventId, demand }) => ({
    eventId,
    colorId: demandToColorId(demand, level),
  }));
}
