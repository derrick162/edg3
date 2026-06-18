import { calendar_v3 } from 'googleapis';
import { undoQueries, calendarPlanQueries, factQueries, factHistoryQueries, priorityQueries } from '@/lib/db';
import { deleteDraft } from './gmail';

// A reversible operation. Each mutation Edge performs records the inverse op(s)
// so the most recent action can be rolled back from a call ("undo that") or the dashboard.
//
// `deleteDraft` is the inverse of Security's createDraft (lib/gmail.ts). It carries its
// own userId so executeUndo can resolve the user's Gmail client without a signature
// change — the Gmail draft API is per-user and not the shared calendar client.
//
// `retireFact`/`rollbackFact` are the inverses of fact writes (rememberPreference).
// They carry userId so executeUndo can find the right user's facts without a signature change.
export type UndoOp =
  | { type: 'delete'; calId: string; eventId: string }
  | { type: 'deleteMany'; calId: string; eventIds: string[] }
  | { type: 'patch'; calId: string; eventId: string; requestBody: calendar_v3.Schema$Event }
  | { type: 'recreate'; calId: string; event: calendar_v3.Schema$Event }
  | { type: 'deleteDraft'; userId: number; draftId: string }
  | { type: 'retireFact'; userId: number; factId: number }
  | { type: 'rollbackFact'; userId: number; historyId: number }
  | { type: 'restorePriorities'; userId: number; weekOf: string; priorities: Array<{ text: string; rank: number }> };

// Record the inverse of a single mutation. Pass planId when the mutation is part
// of an applyCalendarPlan batch — all ops sharing a planId can be undone together
// via undoPlan(). Without planId, the entry is standalone (individual "undo that").
export function recordUndo(userId: number, label: string, ops: UndoOp[], planId?: string) {
  if (!ops.length) return;
  try {
    if (planId) {
      undoQueries.recordForPlan(userId, label, { ops }, planId);
    } else {
      undoQueries.record(userId, label, { ops });
    }
  } catch { /* non-critical */ }
}

export async function executeUndo(cal: calendar_v3.Calendar, ops: UndoOp[]): Promise<boolean> {
  let any = false;
  for (const op of ops) {
    try {
      if (op.type === 'delete') { await cal.events.delete({ calendarId: op.calId, eventId: op.eventId }); any = true; }
      else if (op.type === 'deleteMany') { await Promise.all(op.eventIds.map(id => cal.events.delete({ calendarId: op.calId, eventId: id }).catch(() => undefined))); any = true; }
      else if (op.type === 'patch') { await cal.events.patch({ calendarId: op.calId, eventId: op.eventId, requestBody: op.requestBody }); any = true; }
      else if (op.type === 'recreate') { await cal.events.insert({ calendarId: op.calId, requestBody: op.event }); any = true; }
      else if (op.type === 'deleteDraft') { await deleteDraft(op.userId, op.draftId); any = true; }
      else if (op.type === 'retireFact') { factQueries.retire(op.userId, op.factId); any = true; }
      else if (op.type === 'rollbackFact') { factHistoryQueries.rollbackFact(op.userId, op.historyId); any = true; }
      else if (op.type === 'restorePriorities') {
        priorityQueries.deleteThisWeek(op.userId, op.weekOf);
        op.priorities.forEach(p => priorityQueries.create(op.userId, p.text, op.weekOf, p.rank));
        any = true;
      }
    } catch { /* skip individual failures */ }
  }
  return any;
}

// Undo all mutations recorded under a planId (hero loop "undo my whole day").
// Executes ops in reverse insertion order (most recent mutation reverted first).
// Marks the plan as reverted in calendar_plan_executions; no-op if plan not found.
export async function undoPlan(
  userId: number,
  planId: string,
  cal: calendar_v3.Calendar,
): Promise<{ reverted: number }> {
  const entries = undoQueries.getByPlanId(userId, planId);
  if (!entries.length) return { reverted: 0 };

  // getByPlanId orders by id DESC — most recent mutation first — correct undo order.
  let reverted = 0;
  for (const entry of entries) {
    const ops = parseUndoOps(entry.payload);
    const ok = await executeUndo(cal, ops);
    if (ok) reverted++;
  }

  undoQueries.markPlanUndone(userId, planId);
  calendarPlanQueries.markReverted(userId, planId);
  return { reverted };
}

// Strip read-only fields so a deleted event can be re-inserted on undo.
export function cleanForRecreate(e: calendar_v3.Schema$Event): calendar_v3.Schema$Event {
  return { summary: e.summary, start: e.start, end: e.end, colorId: e.colorId ?? undefined, description: e.description ?? undefined, location: e.location ?? undefined, recurrence: e.recurrence ?? undefined };
}

// Parse a stored undo_log payload into ops.
export function parseUndoOps(payload: string): UndoOp[] {
  try { return (JSON.parse(payload) as { ops: UndoOp[] }).ops ?? []; } catch { return []; }
}
