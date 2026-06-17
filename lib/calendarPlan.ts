// Pure calendar plan builder — no I/O.
// Composes 1–2 concrete create/move actions to improve today's Edge Score.
// The plan is deterministic: same inputs → same plan, so step-1 (preview) and
// step-2 (execute) in the applyCalendarPlan confirmToken flow produce identical actions.

import type { calendar_v3 } from 'googleapis';
import type { CalendarFit } from './calendarScore';
import type { AlignmentResult } from './alignment';
import { detectHygieneFlags } from './alignment';
import type { Priority } from './db';
import type { WhoopRecoveryDay } from './whoop';

// ─── Public types ─────────────────────────────────────────────────────────────

export type PlanActionType = 'create' | 'move';

export interface PlanAction {
  type: PlanActionType;
  /** Spoken to the user before confirmation. */
  description: string;
  /** Which score dimension this action addresses. */
  addresses: 'focus' | 'energy';
  /** Optional specific reason shown in the DayPlanCard; overrides the generic reason. */
  reason?: string;
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

// ─── findHeaviestDeferrableEvent ─────────────────────────────────────────────

const ROUTINE_PLAN = new Set([
  'breakfast','lunch','dinner','coffee','gym','workout','morning walk','evening walk',
  'meal prep','sleep','commute','transit','shower',
]);

function isRoutinePlanTitle(title: string): boolean {
  const t = title.toLowerCase().trim();
  return [...ROUTINE_PLAN].some(r => t.includes(r));
}

/**
 * Return the longest timed non-routine event in today's list.
 * Candidate for the "move to tomorrow on low recovery" action.
 */
export function findHeaviestDeferrableEvent(
  events: calendar_v3.Schema$Event[],
): calendar_v3.Schema$Event | null {
  return (
    events
      .filter(e => e.start?.dateTime && e.end?.dateTime && !isRoutinePlanTitle(e.summary ?? ''))
      .sort((a, b) => {
        const durA = new Date(a.end!.dateTime!).getTime() - new Date(a.start!.dateTime!).getTime();
        const durB = new Date(b.end!.dateTime!).getTime() - new Date(b.start!.dateTime!).getTime();
        return durB - durA;
      })[0] ?? null
  );
}

// ─── findNextMeetingNeedingPrep ───────────────────────────────────────────────

const EDGE_BLOCK_RE = /^(⚡|Focus\s*[—\-–]|Buffer|Commitments\s*[—\-–]|Meeting Prep\s*[—\-–])/i;

/**
 * Find the next timed event that looks like an important meeting (not routine,
 * not an Edge-created block) and has a free 15-min window immediately before it.
 * Returns the prep slot datetimes, or null when nothing qualifies.
 *
 * @param nowIso — injectable ISO timestamp for "now" (for deterministic tests)
 */
export function findNextMeetingNeedingPrep(
  events: calendar_v3.Schema$Event[],
  date: string,
  tz: string,
  nowIso: string,
): { meetingTitle: string; prepStartDateTime: string; prepEndDateTime: string } | null {
  const PREP_H = 15 / 60;
  const nowHM = localHourMinute(nowIso, tz);
  if (!nowHM) return null;
  const nowH = nowHM.hour + nowHM.minute / 60;

  const timed = events
    .filter(e => e.start?.dateTime && e.end?.dateTime)
    .map(e => {
      const s  = localHourMinute(e.start!.dateTime!, tz);
      const en = localHourMinute(e.end!.dateTime!, tz);
      if (!s || !en) return null;
      return {
        title:   (e.summary ?? '').trim(),
        startH:  s.hour + s.minute / 60,
        endH:    en.hour + en.minute / 60,
        startMs: new Date(e.start!.dateTime!).getTime(),
      };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null && b.title.length > 0)
    .sort((a, b) => a.startMs - b.startMs);

  for (const ev of timed) {
    if (ev.startH <= nowH + PREP_H) continue;        // too soon for prep
    if (isRoutinePlanTitle(ev.title)) continue;       // skip gym, lunch, etc.
    if (EDGE_BLOCK_RE.test(ev.title)) continue;       // skip ⚡ blocks

    const prepStart = ev.startH - PREP_H;
    const prepEnd   = ev.startH;

    const blocked = timed.some(
      o => o !== ev && o.startH < prepEnd && o.endH > prepStart,
    );
    if (!blocked) {
      const slot = makeSlot(date, prepStart, prepEnd);
      return {
        meetingTitle:      ev.title,
        prepStartDateTime: slot.startDateTime,
        prepEndDateTime:   slot.endDateTime,
      };
    }
  }
  return null;
}

// ─── findFirstTightGap ───────────────────────────────────────────────────────

/**
 * Find the first pair of consecutive timed events today with a gap < 15 minutes.
 * Returns the gap as a wall-clock slot (startDateTime / endDateTime in user tz).
 * Used to propose a buffer create action between back-to-back meetings.
 * Pure — no I/O.
 */
export function findFirstTightGap(
  events: calendar_v3.Schema$Event[],
  date: string,
  tz: string,
): { beforeTitle: string; afterTitle: string; startDateTime: string; endDateTime: string } | null {
  const timed = events
    .filter(e => e.start?.dateTime && e.end?.dateTime)
    .map(e => {
      const s  = localHourMinute(e.start!.dateTime!, tz);
      const en = localHourMinute(e.end!.dateTime!, tz);
      if (!s || !en) return null;
      return {
        title:   (e.summary ?? 'Meeting').trim(),
        startH:  s.hour + s.minute / 60,
        endH:    en.hour + en.minute / 60,
        startMs: new Date(e.start!.dateTime!).getTime(),
      };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null)
    .sort((a, b) => a.startMs - b.startMs);

  const GAP_MIN_H  = 1 / 60;     // at least 1 min gap (skip exactly-overlapping events)
  const TIGHT_H    = 15 / 60;    // < 15 min = back-to-back

  for (let i = 1; i < timed.length; i++) {
    const gapH = timed[i].startH - timed[i - 1].endH;
    if (gapH >= GAP_MIN_H && gapH < TIGHT_H) {
      return {
        beforeTitle:   timed[i - 1].title,
        afterTitle:    timed[i].title,
        ...makeSlot(date, timed[i - 1].endH, timed[i].startH),
      };
    }
  }
  return null;
}

// ─── patchAlignmentForPlan ────────────────────────────────────────────────────

/**
 * Apply plan deltas to alignment for real score projection (H2).
 * - create: adds block duration to the matching priority's hours
 * - move: removes the event from topUnaligned and reduces unalignedHours
 * Pure — returns a new AlignmentResult; does not mutate input.
 */
export function patchAlignmentForPlan(
  alignment: AlignmentResult,
  actions: PlanAction[],
): AlignmentResult {
  const patched: AlignmentResult = {
    perPriority: alignment.perPriority.map(p => ({ ...p })),
    unalignedHours: alignment.unalignedHours,
    routineHours: alignment.routineHours,
    topUnaligned: [...alignment.topUnaligned],
  };

  const norm = (s: string) => s.toLowerCase().trim();

  for (const action of actions) {
    if (action.type === 'create' && action.startDateTime && action.endDateTime && action.title) {
      const durationH =
        (new Date(action.endDateTime).getTime() - new Date(action.startDateTime).getTime()) / 3600000;
      const priorityName = norm(action.title.replace(/^Focus\s*[—\-–]\s*/i, ''));
      const p = patched.perPriority.find(
        pp =>
          norm(pp.priority).includes(priorityName) ||
          priorityName.includes(norm(pp.priority)),
      );
      if (p) {
        p.hours = Math.round((p.hours + durationH) * 10) / 10;
        p.blocked = true;
      }
    } else if (action.type === 'move' && action.eventTitle) {
      const idx = patched.topUnaligned.findIndex(u => norm(u.title) === norm(action.eventTitle!));
      if (idx >= 0) {
        const hrs = patched.topUnaligned[idx].hours;
        patched.topUnaligned.splice(idx, 1);
        patched.unalignedHours = Math.max(0, Math.round((patched.unalignedHours - hrs) * 10) / 10);
      }
    }
  }

  return patched;
}

// ─── buildCalendarPlan ────────────────────────────────────────────────────────

/**
 * Compose 1–3 deterministic actions to improve today's day.
 *
 * Action sources (in priority order, cap 3):
 *   1. Focus block — focusScore.topFix says create, OR hygiene flag, OR open loops due today
 *   2. Recovery move — latest recovery ≤33% → move heaviest deferrable event to tomorrow
 *   3. Alignment gap move — biggest unaligned sink today → move to tomorrow
 *   4. Meeting prep — 15-min prep block before next important meeting with a free window
 *   5. Buffer — first back-to-back pair with a tight gap → create a breathing-room event
 *
 * Pure — no I/O. Deterministic given the same inputs.
 * @param nowIso — injectable ISO timestamp for "now" (for deterministic tests)
 */
export function buildCalendarPlan(
  todayEvents: calendar_v3.Schema$Event[],
  fit: CalendarFit,
  priorities: Priority[],
  date: string,
  tz: string,
  alignment?: AlignmentResult | null,
  recoveryHistory?: WhoopRecoveryDay[],
  openLoopsDueToday?: string[],
  nowIso?: string,
): CalendarPlan {
  const actions: PlanAction[] = [];

  // ── 1. Focus block ─────────────────────────────────────────────────────────
  // Path A: score engine says "create a block for a zero-hour priority"
  if (fit.focusScore.topFix?.op === 'create') {
    const slot = findFreeSlot(todayEvents, date, 1.5, tz);
    if (slot) {
      const match = fit.focusScore.topFix.description.match(/"([^"]+)"/);
      const priorityName = match?.[1] ?? priorities[0]?.text ?? 'your top priority';
      const startDecimalH =
        parseInt(slot.startDateTime.slice(11, 13), 10) +
        parseInt(slot.startDateTime.slice(14, 16), 10) / 60;
      actions.push({
        type: 'create',
        description: `Block 90 minutes for "${priorityName}" at ${formatWallHour(startDecimalH)}`,
        addresses: 'focus',
        reason: `No time blocked for "${priorityName}" this week`,
        title: `Focus — ${priorityName}`,
        startDateTime: slot.startDateTime,
        endDateTime:   slot.endDateTime,
      });
    }
  }
  // Path B: hygiene flag (back-to-back OR no deep-work) and priorities exist → create a slot
  else if (priorities.length > 0) {
    const hygieneFlag = detectHygieneFlags(todayEvents, tz);
    if (hygieneFlag) {
      const slot = findFreeSlot(todayEvents, date, 1.5, tz);
      if (slot) {
        const priorityName = priorities[0].text;
        const startDecimalH =
          parseInt(slot.startDateTime.slice(11, 13), 10) +
          parseInt(slot.startDateTime.slice(14, 16), 10) / 60;
        actions.push({
          type: 'create',
          description: `Block 90 minutes for "${priorityName}" at ${formatWallHour(startDecimalH)} — protect deep-work time`,
          addresses: 'focus',
          reason: 'Schedule is packed — protect deep-work time',
          title: `Focus — ${priorityName}`,
          startDateTime: slot.startDateTime,
          endDateTime:   slot.endDateTime,
        });
      }
    }
    // Path C: open loops due today and no focus block yet → create a 60-min slot to clear them
    else if (openLoopsDueToday && openLoopsDueToday.length > 0 && actions.length === 0) {
      const slot = findFreeSlot(todayEvents, date, 1, tz);
      if (slot) {
        const count = openLoopsDueToday.length;
        const startDecimalH =
          parseInt(slot.startDateTime.slice(11, 13), 10) +
          parseInt(slot.startDateTime.slice(14, 16), 10) / 60;
        actions.push({
          type: 'create',
          description: `Block 60 minutes at ${formatWallHour(startDecimalH)} to clear ${count} open commitment${count !== 1 ? 's' : ''} due today`,
          addresses: 'focus',
          reason: `${count} commitment${count !== 1 ? 's' : ''} due today with no time blocked`,
          title: 'Commitments — clear open loops',
          startDateTime: slot.startDateTime,
          endDateTime:   slot.endDateTime,
        });
      }
    }
  }

  // ── 2. Recovery move ───────────────────────────────────────────────────────
  // Replaces the dead worstMismatchEventId path (computeEnergyScore never sets that field).
  if (actions.length < 3 && recoveryHistory && recoveryHistory.length > 0) {
    const latestRec = [...recoveryHistory].sort((a, b) => b.date.localeCompare(a.date))[0];
    if (latestRec && latestRec.recoveryScore <= 33) {
      const heaviest = findHeaviestDeferrableEvent(todayEvents);
      if (heaviest && heaviest.id) {
        actions.push({
          type: 'move',
          description: `Move "${heaviest.summary ?? 'event'}" to tomorrow — recovery is ${latestRec.recoveryScore}%, protect your energy today`,
          addresses: 'energy',
          reason: `Recovery ${latestRec.recoveryScore}% — protect your energy`,
          eventId:    heaviest.id,
          eventTitle: heaviest.summary ?? undefined,
          newDate:    nextDateString(date),
        });
      }
    }
  }

  // ── 3. Alignment gap move ──────────────────────────────────────────────────
  if (actions.length < 3 && alignment && alignment.topUnaligned.length > 0) {
    const topSink = alignment.topUnaligned[0];
    if (topSink.hours >= 1) {
      const norm = (s: string) => s.toLowerCase().trim();
      const alreadyTargeted = new Set(actions.filter(a => a.type === 'move').map(a => a.eventId));
      const match = todayEvents.find(
        e =>
          e.start?.dateTime &&
          e.id &&
          !alreadyTargeted.has(e.id) &&
          norm(e.summary ?? '') === norm(topSink.title),
      );
      if (match && match.id) {
        actions.push({
          type: 'move',
          description: `Move "${match.summary}" to tomorrow — ${topSink.hours}h that isn't aligned to your priorities`,
          addresses: 'focus',
          reason: `${topSink.hours}h on "${topSink.title}" isn't aligned to your priorities`,
          eventId:    match.id,
          eventTitle: match.summary ?? undefined,
          newDate:    nextDateString(date),
        });
      }
    }
  }

  // ── 4. Meeting prep ────────────────────────────────────────────────────────
  // Only fires when nowIso is explicitly provided (so tests that don't want
  // prep don't accidentally trigger it by defaulting to wall clock).
  if (actions.length < 3 && nowIso) {
    const prep = findNextMeetingNeedingPrep(todayEvents, date, tz, nowIso);
    if (prep) {
      const prepStartH =
        parseInt(prep.prepStartDateTime.slice(11, 13), 10) +
        parseInt(prep.prepStartDateTime.slice(14, 16), 10) / 60;
      actions.push({
        type: 'create',
        description: `Add 15-min prep before "${prep.meetingTitle}" at ${formatWallHour(prepStartH)}`,
        addresses: 'focus',
        reason: `No prep time blocked before "${prep.meetingTitle}"`,
        title: `Meeting Prep — ${prep.meetingTitle}`,
        startDateTime: prep.prepStartDateTime,
        endDateTime:   prep.prepEndDateTime,
      });
    }
  }

  // ── 5. Buffer between back-to-back meetings ────────────────────────────────
  // Only when there's room and a tight gap exists today.
  if (actions.length < 3) {
    const gap = findFirstTightGap(todayEvents, date, tz);
    if (gap) {
      const gapStartH =
        parseInt(gap.startDateTime.slice(11, 13), 10) +
        parseInt(gap.startDateTime.slice(14, 16), 10) / 60;
      const gapMins = Math.round(
        (parseInt(gap.endDateTime.slice(11, 13), 10) * 60 + parseInt(gap.endDateTime.slice(14, 16), 10)) -
        (parseInt(gap.startDateTime.slice(11, 13), 10) * 60 + parseInt(gap.startDateTime.slice(14, 16), 10))
      );
      actions.push({
        type: 'create',
        description: `Protect the ${gapMins}-min gap at ${formatWallHour(gapStartH)} between "${gap.beforeTitle}" and "${gap.afterTitle}"`,
        addresses: 'focus',
        reason: 'Back-to-back meetings with no breathing room',
        title: 'Buffer',
        startDateTime: gap.startDateTime,
        endDateTime:   gap.endDateTime,
      });
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
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

// ─── buildDiagnoses ───────────────────────────────────────────────────────────

/**
 * Derive 1–3 concrete problem sentences from already-computed data.
 * Used by /api/day-plan to explain WHY a plan is needed before showing changes.
 * Pure — no I/O.
 */
export function buildDiagnoses(
  alignment: AlignmentResult | null,
  weekEvents: calendar_v3.Schema$Event[],
  recoveryHistory: WhoopRecoveryDay[],
  tz: string,
): string[] {
  const out: string[] = [];

  // 1. Zero-hour priority (first in rank order = most important)
  const zeroP = alignment?.perPriority.find(p => p.hours === 0);
  if (zeroP) {
    out.push(`No time blocked for "${zeroP.priority}" this week`);
  }

  // 2. Calendar hygiene flag (back-to-back meetings or no focus blocks)
  if (out.length < 3) {
    const flag = detectHygieneFlags(weekEvents, tz);
    if (flag) out.push(flag);
  }

  // 3. Low recovery (Whoop red tier ≤33%)
  if (out.length < 3 && recoveryHistory.length > 0) {
    const latest = [...recoveryHistory].sort((a, b) => b.date.localeCompare(a.date))[0];
    if (latest && latest.recoveryScore <= 33) {
      out.push(`Recovery is at ${latest.recoveryScore}% today — protect your energy`);
    }
  }

  // 4. Recurring pattern — non-recurring event title appears ≥3 times this week
  if (out.length < 3) {
    const counts = new Map<string, number>();
    for (const e of weekEvents) {
      if (!e.start?.dateTime) continue;       // skip all-day
      if (e.recurringEventId) continue;        // skip existing recurring instances
      const t = (e.summary ?? '').toLowerCase().trim();
      if (!t || isRoutinePlanTitle(t)) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 3) {
      const display = top[0].replace(/^\w/, c => c.toUpperCase());
      out.push(`"${display}" has come up ${top[1]} times this week — consider making it recurring`);
    }
  }

  return out;
}
