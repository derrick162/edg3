// Focus/Energy scoring engine.
// MVP: Focus Score = % of working hours on focus areas (0-100).
//       Energy Score = demand-fit vs energy capacity (0-100).
// Future: judgment layer (deferred until multi-user feedback exists — see specs/calendar-scores.md).

import Anthropic from '@anthropic-ai/sdk';
import type { calendar_v3 } from 'googleapis';
import type { Priority } from './db';
import type { AlignmentResult } from './alignment';
import type { EnergySignal } from './energy';

// ─── Public contract ─────────────────────────────────────────────────────────

export interface ScoreResult {
  score: number;       // 0–100
  drivers: string[];   // plain-English reasons (no black box)
  topFix: { description: string; op?: 'create' | 'move' | 'delete' | 'recolor' } | null;
}

export interface CalendarFit {
  focusScore: ScoreResult;
  energyScore: ScoreResult;
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
 * Energy Score = % of weighted demand appropriately matched to capacity (0–100).
 * Weights: high=2, medium=1, low=0.5. Mismatches: high-demand on red day, or high-demand in trough.
 * Pure — no I/O.
 */
export function computeEnergyScore(
  taggedEvents: TaggedEvent[],
  energySignal: EnergySignal | null,
  energyProfile: EnergyProfile | null,
): ScoreResult {
  if (!energySignal) {
    return {
      score: 50,
      drivers: ["No energy signal for today — set it on the dashboard or during your call."],
      topFix: { description: "Set today's energy level (red/yellow/green) to unlock a real Energy Score.", op: 'create' },
    };
  }

  if (taggedEvents.length === 0) {
    return {
      score: energySignal.level === 'red' ? 100 : 70,
      drivers: energySignal.level === 'red'
        ? ['Light/empty schedule on a red day — excellent recovery protection.']
        : ['No timed events to score today.'],
      topFix: null,
    };
  }

  const hasProfile = !!(energyProfile && (energyProfile.peakStart !== null || energyProfile.troughStart !== null));
  const WEIGHTS: Record<EventDemand, number> = { high: 2, medium: 1, low: 0.5 };

  let totalWeight = 0;
  let penaltyWeight = 0;
  let worstMismatch: { event: calendar_v3.Schema$Event; reason: string } | null = null;
  let lightOnRed = 0;

  for (const { event: ev, tag } of taggedEvents) {
    const w = WEIGHTS[tag.demand];
    totalWeight += w;

    if (tag.demand === 'low' && energySignal.level === 'red') lightOnRed++;

    let isMismatch = false;
    let reason = '';

    if (tag.demand === 'high') {
      if (energySignal.level === 'red') {
        isMismatch = true;
        reason = 'High-demand work on a red-recovery day';
      } else if (hasProfile) {
        const h = eventStartHour(ev);
        if (h !== null && inWindow(h, energyProfile!.troughStart, energyProfile!.troughEnd)) {
          isMismatch = true;
          reason = 'High-demand work in your trough window';
        }
      }
    }

    if (isMismatch) {
      penaltyWeight += w;
      if (!worstMismatch) worstMismatch = { event: ev, reason };
    }
  }

  const score = totalWeight === 0 ? 70 : clamp(0, 100, Math.round((1 - penaltyWeight / totalWeight) * 100));

  const drivers: string[] = [];

  if (energySignal.level === 'red') {
    const highCount = taggedEvents.filter(t => t.tag.demand === 'high').length;
    if (highCount > 0) {
      drivers.push(`Red day with ${highCount} high-demand event${highCount > 1 ? 's' : ''} — protect recovery.`);
    } else if (lightOnRed > 0) {
      drivers.push("Light schedule protects today's recovery — well matched.");
    }
  } else if (energySignal.level === 'yellow') {
    const highCount = taggedEvents.filter(t => t.tag.demand === 'high').length;
    if (highCount > 2) {
      drivers.push(`Yellow day with ${highCount} high-demand events — consider deferring one.`);
    } else if (highCount > 0 && hasProfile) {
      const highInPeak = taggedEvents.filter(t => {
        if (t.tag.demand !== 'high') return false;
        const h = eventStartHour(t.event);
        return h !== null && inWindow(h, energyProfile!.peakStart, energyProfile!.peakEnd);
      }).length;
      drivers.push(
        highInPeak === highCount
          ? 'High-demand work lands in your peak window — good timing for a yellow day.'
          : 'Yellow day: move high-demand work into your peak window for better fit.'
      );
    } else {
      drivers.push(`Yellow day (${energySignal.source}) — load looks manageable.`);
    }
  } else {
    // green
    if (hasProfile) {
      const highTotal = taggedEvents.filter(t => t.tag.demand === 'high').length;
      if (highTotal === 0) {
        drivers.push('Green day — no high-demand blocks scheduled.');
      } else {
        const highInPeak = taggedEvents.filter(t => {
          if (t.tag.demand !== 'high') return false;
          const h = eventStartHour(t.event);
          return h !== null && inWindow(h, energyProfile!.peakStart, energyProfile!.peakEnd);
        }).length;
        drivers.push(
          highInPeak === highTotal
            ? 'High-demand work is in your peak window — excellent energy match.'
            : 'Green day but some high-demand work is outside your peak window.'
        );
      }
    } else {
      drivers.push(`Green day (${energySignal.source}) — full capacity.`);
    }
  }

  if (worstMismatch) {
    drivers.push(`${worstMismatch.reason}: "${worstMismatch.event.summary ?? 'event'}"`);
  }

  if (!hasProfile && energySignal.level !== 'red') {
    drivers.push('Tell Edge your peak/trough windows to sharpen this score.');
  }

  let topFix: ScoreResult['topFix'] = null;
  if (worstMismatch) {
    const title = worstMismatch.event.summary ?? 'high-demand event';
    topFix = energySignal.level === 'red'
      ? { description: `Move "${title}" to your next green day — today is red and it needs full capacity.`, op: 'move' }
      : { description: `Reschedule "${title}" to your peak energy window — it's landing in your trough.`, op: 'move' };
  } else if (!hasProfile) {
    topFix = {
      description: 'Tell Edge your peak energy window (e.g. "my peak is 9 to 11") to unlock energy matching.',
      op: 'create',
    };
  }

  return { score, drivers, topFix };
}

// ─── computeCalendarFit ───────────────────────────────────────────────────────

/** Compute both scores and return the combined CalendarFit. Pure. */
export function computeCalendarFit(
  taggedEvents: TaggedEvent[],
  alignment: AlignmentResult | null,
  priorities: Priority[],
  energySignal: EnergySignal | null,
  energyProfile: EnergyProfile | null,
  totalWorkingHours = 45,
): CalendarFit {
  return {
    focusScore:  computeFocusScore(alignment, priorities, totalWorkingHours),
    energyScore: computeEnergyScore(taggedEvents, energySignal, energyProfile),
    computedAt:  new Date().toISOString(),
  };
}
