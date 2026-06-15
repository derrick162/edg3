// Pure calendar plan builder — no I/O.
// Composes 1–2 concrete create/move actions to improve today's Edge Score.
// The plan is deterministic: same inputs → same plan, so step-1 (preview) and
// step-2 (execute) in the applyCalendarPlan confirmToken flow produce identical actions.

import type { calendar_v3 } from 'googleapis';
import type { CalendarFit } from './calendarScore';
import type { Priority } from './db';

// ─── Public types ─────────────────────────────────────────────────────────────

export type PlanActionType = 'create' | 'move';

export interface PlanAction {
  type: PlanActionType;
  /** Spoken to the user before confirmation. */
  description: string;
  /** Which score dimension this action addresses. */
  addresses: 'focus' | 'energy';
  // create:
  title?: string;         // event title (handler prepends ⚡)
  startDateTime?: string; // wall-clock in user tz: "2026-06-15T09:00:00"
  endDateTime?: string;
  // move:
  eventId?: string;
  eventTitle?: string;
  newDate?: string;       // YYYY-MM-DD — same wall-clock time, next day
}

export interface CalendarPlan {
  actions: PlanAction[];
  /** Edge reads this summary and asks for one confirmation before executing. */
  summary: string;
  generatedAt: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function localHourMinute(isoDateTime: string, tz: string): { hour: number; minute: number } | null {
  try {
    const d = new Date(isoDateTime);
    if (isNaN(d.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d);
    const h  = parts.find(p => p.type === 'hour')?.value;
    const mn = parts.find(p => p.type === 'minute')?.value;
    return h && mn ? { hour: parseInt(h, 10), minute: parseInt(mn, 10) } : null;
  } catch {
    return null;
  }
}

function padTwo(n: number): string {
  return String(Math.floor(n)).padStart(2, '0');
}

function makeSlot(date: string, startH: number, endH: number): { startDateTime: string; endDateTime: string } {
  const sH = Math.floor(startH);
  const sM = Math.round((startH - sH) * 60);
  const eH = Math.floor(endH);
  const eM = Math.round((endH - eH) * 60);
  return {
    startDateTime: `${date}T${padTwo(sH)}:${padTwo(sM)}:00`,
    endDateTime:   `${date}T${padTwo(eH)}:${padTwo(eM)}:00`,
  };
}

function nextDateString(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function formatWallHour(decimalHour: number): string {
  const h24 = Math.floor(decimalHour);
  const m   = Math.round((decimalHour - h24) * 60);
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${padTwo(m)} ${ampm}`;
}

// ─── findFreeSlot ─────────────────────────────────────────────────────────────

/**
 * Scan today's timed events and return the first contiguous free slot of at
 * least `durationHours` within working hours.
 *
 * Events are converted to decimal wall-clock hours in the user's timezone.
 * Returns start/end as wall-clock datetimes ("YYYY-MM-DDTHH:MM:00"), no offset.
 * Returns null when no slot is available.
 */
export function findFreeSlot(
  events: calendar_v3.Schema$Event[],
  date: string,
  durationHours: number,
  tz: string,
  workStartHour = 9,
  workEndHour   = 18,
): { startDateTime: string; endDateTime: string } | null {
  // Convert timed events to {start, end} decimal hours in the user's timezone.
  const blocks: { start: number; end: number }[] = events
    .filter(e => e.start?.dateTime && e.end?.dateTime)
    .map(e => {
      const s  = localHourMinute(e.start!.dateTime!, tz);
      const en = localHourMinute(e.end!.dateTime!,   tz);
      if (!s || !en) return null;
      return { start: s.hour + s.minute / 60, end: en.hour + en.minute / 60 };
    })
    .filter((b): b is { start: number; end: number } => b !== null)
    .sort((a, b) => a.start - b.start);

  let cursor = workStartHour;

  for (const block of blocks) {
    if (block.end <= cursor) continue;   // event already past cursor
    if (block.start >= workEndHour) break; // event after work window
    if (block.start - cursor >= durationHours) {
      return makeSlot(date, cursor, cursor + durationHours);
    }
    cursor = Math.max(cursor, block.end);
  }

  if (workEndHour - cursor >= durationHours) {
    return makeSlot(date, cursor, cursor + durationHours);
  }

  return null;
}

// ─── buildCalendarPlan ────────────────────────────────────────────────────────

/**
 * Compose a 1–2 action plan to address today's Focus + Energy gaps.
 *
 * Focus action  — if focusScore.topFix.op === 'create': find the first free
 *                 90-minute slot and plan to create a focus block.
 * Energy action — if energyScore.topFix.op === 'move' and worstMismatchEventId
 *                 is set: plan to move that event to tomorrow (same wall time).
 *
 * Pure — no I/O. Deterministic given the same inputs.
 */
export function buildCalendarPlan(
  todayEvents: calendar_v3.Schema$Event[],
  fit: CalendarFit,
  priorities: Priority[],
  date: string,
  tz: string,
): CalendarPlan {
  const actions: PlanAction[] = [];

  // ── Focus: create a 90-minute focus block ──────────────────────────────────
  if (fit.focusScore.topFix?.op === 'create') {
    const slot = findFreeSlot(todayEvents, date, 1.5, tz);
    if (slot) {
      // Extract priority name from topFix description: 'Block time for "Fundraising" — ...'
      const match = fit.focusScore.topFix.description.match(/"([^"]+)"/);
      const priorityName = match?.[1] ?? priorities[0]?.text ?? 'your top priority';
      const startDecimalH =
        parseInt(slot.startDateTime.slice(11, 13), 10) +
        parseInt(slot.startDateTime.slice(14, 16), 10) / 60;

      actions.push({
        type: 'create',
        description: `Block 90 minutes for "${priorityName}" at ${formatWallHour(startDecimalH)}`,
        addresses: 'focus',
        title: `Focus — ${priorityName}`,
        startDateTime: slot.startDateTime,
        endDateTime:   slot.endDateTime,
      });
    }
  }

  // ── Energy: move worst mismatch event to tomorrow ──────────────────────────
  if (
    fit.energyScore.topFix?.op === 'move' &&
    fit.energyScore.worstMismatchEventId
  ) {
    const eventTitle = fit.energyScore.worstMismatchEventTitle ?? 'high-demand event';
    actions.push({
      type: 'move',
      description: `Move "${eventTitle}" to tomorrow — too draining for today`,
      addresses: 'energy',
      eventId:    fit.energyScore.worstMismatchEventId,
      eventTitle: fit.energyScore.worstMismatchEventTitle ?? undefined,
      newDate:    nextDateString(date),
    });
  }

  // ── Build spoken summary ────────────────────────────────────────────────────
  let summary: string;
  if (actions.length === 0) {
    summary = `Your Edge Score is ${fit.edgeScore} — calendar looks good. Nothing to reshape right now.`;
  } else if (actions.length === 1) {
    summary = `Here's the one move I'd make: ${actions[0].description}. Want me to do that now?`;
  } else {
    const list = actions.map((a, i) => `${i + 1}. ${a.description}`).join('; ');
    summary = `Here are ${actions.length} moves to sharpen your day (Edge Score: ${fit.edgeScore}): ${list}. Should I make them happen?`;
  }

  return { actions, summary, generatedAt: new Date().toISOString() };
}
