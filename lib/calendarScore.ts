// Focus/Energy scoring engine — pure, 0 I/O.
// The two headline scores that drive the "scan → score → fix" product loop.
// Shared contract: Design + Security build against ScoreResult / CalendarFit below.

import type { calendar_v3 } from 'googleapis';
import type { Priority } from './db';
import type { AlignmentResult } from './alignment';
import type { EnergySignal } from './energy';

// ─── Public contract ─────────────────────────────────────────────────────────

export interface ScoreResult {
  score: number; // 1-10, rounded
  drivers: string[]; // plain-English reasons for the score
  topFix: { description: string; op?: 'create' | 'move' | 'delete' | 'recolor' } | null;
}

export interface CalendarFit {
  focusScore: ScoreResult;
  energyScore: ScoreResult;
  computedAt: string;
}

// Energy profile V1: parsed from text preference facts.
// V2: structured storage via Security — swap in without changing call sites.
export interface EnergyProfile {
  peakStart: number | null;   // hour 0-23
  peakEnd: number | null;
  troughStart: number | null;
  troughEnd: number | null;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

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

// Duration in hours for a Google Calendar event.
function eventDurationHours(e: calendar_v3.Schema$Event): number {
  if (e.start?.dateTime && e.end?.dateTime) {
    return (new Date(e.end.dateTime).getTime() - new Date(e.start.dateTime).getTime()) / 3600000;
  }
  if (e.start?.date && e.end?.date) {
    const days = (new Date(e.end.date).getTime() - new Date(e.start.date).getTime()) / 86400000;
    return Math.min(days * 8, 8);
  }
  return 0;
}

// Extract the hour-of-day from an RFC3339 dateTime string (reads local time from the string).
// "2026-06-14T09:30:00-04:00" → 9.  "2026-06-14T14:00:00Z" → 14.
function eventStartHour(e: calendar_v3.Schema$Event): number | null {
  const dt = e.start?.dateTime;
  if (!dt) return null;
  const m = dt.match(/T(\d{2}):/);
  return m ? parseInt(m[1], 10) : null;
}

function inWindow(hour: number, start: number | null, end: number | null): boolean {
  if (start === null || end === null) return false;
  return end > start ? (hour >= start && hour < end) : (hour >= start || hour < end);
}

const HIGH_DEMAND_KW = ['deep work', 'focus block', 'focus time', 'writing session', 'coding', 'vibe', 'strategy session', 'build session', 'investor', 'fundrais', 'design sprint'];
const LOW_DEMAND_KW  = ['lunch', 'coffee', 'walk', 'gym', 'breakfast', 'dinner', 'commute', 'break', 'personal', 'yoga', 'meditation', 'meal prep', 'reading'];

function classifyEventDemand(event: calendar_v3.Schema$Event, priorities: Priority[]): 'high' | 'medium' | 'low' {
  const title = (event.summary || '').toLowerCase();
  // Priority energy_cost takes precedence if the title matches a priority keyword.
  for (const p of priorities) {
    if (!p.energy_cost) continue;
    const kw = p.text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (kw.some(k => title.includes(k))) return p.energy_cost;
  }
  if (HIGH_DEMAND_KW.some(k => title.includes(k))) return 'high';
  if (LOW_DEMAND_KW.some(k => title.includes(k))) return 'low';
  return 'medium';
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
      // Inherit am/pm from end token if start is bare
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

// ─── computeFocusScore ───────────────────────────────────────────────────────

/**
 * Score (1-10) how well the calendar reflects the user's stated focus areas.
 * Components: coverage (35%), aligned share (30%), protected blocks (20%), balance (15%).
 * Pure — alignment must be pre-computed by the caller.
 */
export function computeFocusScore(
  events: calendar_v3.Schema$Event[],
  priorities: Priority[],
  alignment: AlignmentResult | null,
): ScoreResult {
  if (!priorities.length) {
    return {
      score: 1,
      drivers: ['No focus areas set — add your top 3 priorities to get a real Focus Score.'],
      topFix: { description: 'Set your 3 areas of focus in the Priorities tab.', op: 'create' },
    };
  }

  const drivers: string[] = [];
  const perPriority = alignment?.perPriority
    ?? priorities.map(p => ({ priority: p.text, hours: 0, blocked: false }));

  // ── 1. Coverage (35%) ─────────────────────────────────────────────────────
  const uncovered = perPriority.filter(p => p.hours === 0);
  const covFraction = (perPriority.length - uncovered.length) / perPriority.length;
  const coverageScore = covFraction >= 1 ? 10 : covFraction <= 0 ? 1 : clamp(1, 10, Math.round(covFraction * 9 + 1));

  if (uncovered.length > 0) {
    drivers.push(
      `${uncovered.map(u => `"${u.priority}"`).join(', ')} ` +
      `${uncovered.length === 1 ? 'has' : 'have'} zero hours this week.`
    );
  } else {
    drivers.push(`All ${perPriority.length} focus areas have scheduled time this week.`);
  }

  // ── 2. Aligned share (30%) ────────────────────────────────────────────────
  const totalFocusHours   = perPriority.reduce((s, p) => s + p.hours, 0);
  const unalignedHours    = alignment?.unalignedHours ?? 0;
  const totalHours        = totalFocusHours + unalignedHours;
  let alignedScore: number;

  if (totalHours < 0.5) {
    alignedScore = 3;
    drivers.push('Calendar is sparse — very few timed events this week.');
  } else {
    const frac = totalFocusHours / totalHours;
    alignedScore = clamp(1, 10, Math.round(frac * 11));
    const pct = Math.round(frac * 100);
    if (frac >= 0.7) {
      drivers.push(`${pct}% of tracked time is on focus areas — strong alignment.`);
    } else if (frac >= 0.4) {
      drivers.push(`${pct}% of tracked time is on focus areas — room to trim unaligned time.`);
    } else {
      drivers.push(`Only ${pct}% of tracked time is on focus areas.`);
      const topU = alignment?.topUnaligned?.[0];
      if (topU) drivers.push(`Biggest time sink: "${topU.title}" at ${topU.hours.toFixed(1)}h.`);
    }
  }

  // ── 3. Protected deep-work blocks (20%) ──────────────────────────────────
  const timedEvents = events.filter(e => !!e.start?.dateTime);
  const hasProtectedBlock = timedEvents.some(e => eventDurationHours(e) >= 1.5);
  const blockScore = hasProtectedBlock ? 8 : 3;

  drivers.push(
    hasProtectedBlock
      ? 'At least one protected block (≥ 90 min) is scheduled for deep work.'
      : 'No protected focus blocks (≥ 90 min) — all slots are short.'
  );

  // ── 4. Balance vs priority ranking (15%) ─────────────────────────────────
  let balanceScore = 9;
  if (perPriority.length >= 2) {
    const hours = perPriority.map(p => p.hours);
    const isOrdered = hours.every((h, i) => i === 0 || hours[i - 1] >= h - 1.0);
    if (!isOrdered) {
      balanceScore = 5;
      const dominant = [...perPriority].sort((a, b) => b.hours - a.hours)[0];
      if (dominant.priority !== perPriority[0].priority) {
        drivers.push(
          `"${dominant.priority}" gets the most time, but "${perPriority[0].priority}" is your top priority.`
        );
      }
    } else {
      drivers.push('Time distribution roughly follows your priority ranking.');
    }
  }

  const raw   = coverageScore * 0.35 + alignedScore * 0.30 + blockScore * 0.20 + balanceScore * 0.15;
  const score = clamp(1, 10, Math.round(raw));

  // ── Top fix ───────────────────────────────────────────────────────────────
  let topFix: ScoreResult['topFix'] = null;

  if (uncovered.length > 0) {
    topFix = {
      description: `Block time for "${uncovered[0].priority}" — it has zero hours scheduled this week.`,
      op: 'create',
    };
  } else if (totalHours >= 0.5 && totalFocusHours / totalHours < 0.4) {
    const topU = alignment?.topUnaligned?.[0];
    topFix = topU
      ? { description: `Cut or reschedule "${topU.title}" (${topU.hours.toFixed(1)}h unaligned) to free time for focus work.`, op: 'move' }
      : { description: 'Trim unaligned commitments to free time for your focus areas.', op: 'delete' };
  } else if (!hasProtectedBlock) {
    const p1 = perPriority[0]?.priority ?? 'your top priority';
    topFix = { description: `Add a 2h focus block for "${p1}" to protect uninterrupted work time.`, op: 'create' };
  } else if (balanceScore < 9 && perPriority.length >= 2) {
    topFix = {
      description: `Shift more time toward "${perPriority[0].priority}" to match your stated priority ranking.`,
      op: 'move',
    };
  }

  return { score, drivers, topFix };
}

// ─── computeEnergyScore ──────────────────────────────────────────────────────

/**
 * Score (1-10) how well today's calendar matches the user's energy.
 * Components: demand↔window match (40%), load vs capacity (35%), recovery protection (25%).
 * Pure — energySignal and energyProfile must be pre-derived by the caller.
 */
export function computeEnergyScore(
  events: calendar_v3.Schema$Event[],
  energySignal: EnergySignal | null,
  energyProfile: EnergyProfile | null,
  priorities: Priority[],
): ScoreResult {
  if (!energySignal) {
    return {
      score: 5,
      drivers: ["No energy signal for today — set it on the dashboard or during your call."],
      topFix: { description: "Set today's energy level (red/yellow/green) to unlock a real Energy Score.", op: 'create' },
    };
  }

  const drivers: string[] = [];
  const timedEvents = events.filter(e => !!e.start?.dateTime && !!e.end?.dateTime);

  // ── 1. Demand↔window match (40%) ─────────────────────────────────────────
  let matchScore: number;
  const hasProfile = energyProfile && (energyProfile.peakStart !== null || energyProfile.troughStart !== null);

  if (!hasProfile) {
    matchScore = 6;
    drivers.push('No peak/trough windows set — tell Edge your energy windows to sharpen this score.');
  } else {
    let matchPoints = 0;
    let counted = 0;
    for (const ev of timedEvents) {
      const h = eventStartHour(ev);
      if (h === null) continue;
      const demand  = classifyEventDemand(ev, priorities);
      const inPeak   = inWindow(h, energyProfile!.peakStart, energyProfile!.peakEnd);
      const inTrough = inWindow(h, energyProfile!.troughStart, energyProfile!.troughEnd);
      if (demand === 'high' && inPeak)    matchPoints += 2;
      else if (demand === 'high' && inTrough) matchPoints -= 2;
      else if (demand === 'low'  && inTrough) matchPoints += 1;
      else if (demand === 'low'  && inPeak)   matchPoints -= 0.5;
      counted++;
    }
    if (counted === 0) {
      matchScore = 6;
      drivers.push('No timed events today to match against your energy windows.');
    } else {
      matchScore = clamp(1, 10, Math.round(5 + (matchPoints / counted) * 2.5));
      if (matchScore >= 8) {
        drivers.push('High-demand work is in your peak window — excellent energy match.');
      } else if (matchScore >= 5) {
        drivers.push('Energy match is moderate — some high-demand work is outside your peak.');
      } else {
        drivers.push('High-demand work is landing in your trough — consider rescheduling it.');
      }
    }
  }

  // ── 2. Load vs capacity (35%) ─────────────────────────────────────────────
  const demandCounts = { high: 0, medium: 0, low: 0 };
  for (const ev of timedEvents) demandCounts[classifyEventDemand(ev, priorities)]++;

  let loadScore: number;
  if (energySignal.level === 'green') {
    loadScore = 9;
    drivers.push(`Green day (${energySignal.source}) — full capacity, load is appropriate.`);
  } else if (energySignal.level === 'yellow') {
    if (demandCounts.high > 2) {
      loadScore = 5;
      drivers.push(`Yellow day with ${demandCounts.high} high-demand events — consider deferring one.`);
    } else {
      loadScore = 8;
      drivers.push(`Yellow day (${energySignal.source}) — moderate load looks manageable.`);
    }
  } else { // red
    if (demandCounts.high > 0) {
      loadScore = 2;
      drivers.push(`Red day with ${demandCounts.high} high-demand event${demandCounts.high > 1 ? 's' : ''} — protect the day.`);
    } else {
      loadScore = 7;
      drivers.push('Red day with mostly light work — good recovery protection.');
    }
  }

  // ── 3. Recovery protection (25%) ─────────────────────────────────────────
  let recoveryScore: number;
  if (energySignal.level === 'green') {
    recoveryScore = 9;
  } else if (energySignal.level === 'yellow') {
    const back2back = (() => {
      const sorted = timedEvents
        .filter(e => classifyEventDemand(e, priorities) !== 'low')
        .sort((a, b) => new Date(a.start!.dateTime!).getTime() - new Date(b.start!.dateTime!).getTime());
      for (let i = 1; i < sorted.length; i++) {
        const gap = new Date(sorted[i].start!.dateTime!).getTime() - new Date(sorted[i - 1].end!.dateTime!).getTime();
        if (gap < 15 * 60 * 1000) return true;
      }
      return false;
    })();
    if (back2back) {
      recoveryScore = 4;
      drivers.push('Yellow day with back-to-back events — add a buffer to protect recovery.');
    } else {
      recoveryScore = 8;
    }
  } else { // red
    const heavyAfternoon = timedEvents.some(e => {
      const h = eventStartHour(e);
      return h !== null && h >= 13 && classifyEventDemand(e, priorities) === 'high';
    });
    if (heavyAfternoon) {
      recoveryScore = 2;
      drivers.push('High-demand work in the afternoon on a red day — move it to protect recovery.');
    } else {
      recoveryScore = 7;
    }
  }

  const raw   = matchScore * 0.40 + loadScore * 0.35 + recoveryScore * 0.25;
  const score = clamp(1, 10, Math.round(raw));

  // ── Top fix ───────────────────────────────────────────────────────────────
  let topFix: ScoreResult['topFix'] = null;

  if (energySignal.level === 'red' && demandCounts.high > 0) {
    const heavy = timedEvents.find(e => classifyEventDemand(e, priorities) === 'high');
    topFix = {
      description: `Move "${heavy?.summary ?? 'high-demand event'}" to your next green day — today is red and it needs full capacity.`,
      op: 'move',
    };
  } else if (matchScore < 5 && hasProfile) {
    topFix = { description: 'Reschedule high-demand work to your peak energy window.', op: 'move' };
  } else if (!hasProfile) {
    topFix = {
      description: 'Tell Edge your peak energy window (e.g. "my peak is 9 to 11") to unlock energy matching.',
      op: 'create',
    };
  }

  return { score, drivers, topFix };
}

// ─── computeCalendarFit ──────────────────────────────────────────────────────

/** Compute both scores and return the combined CalendarFit. */
export function computeCalendarFit(
  events: calendar_v3.Schema$Event[],
  priorities: Priority[],
  alignment: AlignmentResult | null,
  energySignal: EnergySignal | null,
  energyProfile: EnergyProfile | null,
): CalendarFit {
  return {
    focusScore:  computeFocusScore(events, priorities, alignment),
    energyScore: computeEnergyScore(events, energySignal, energyProfile, priorities),
    computedAt:  new Date().toISOString(),
  };
}
