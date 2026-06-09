import { calendar_v3 } from 'googleapis';
import { undoQueries } from '@/lib/db';
import { deleteDraft } from './gmail';

// A reversible operation. Each mutation Edge performs records the inverse op(s)
// so the most recent action can be rolled back from a call ("undo that") or the dashboard.
//
// `deleteDraft` is the inverse of Security's createDraft (lib/gmail.ts). It carries its
// own userId so executeUndo can resolve the user's Gmail client without a signature
// change — the Gmail draft API is per-user and not the shared calendar client.
export type UndoOp =
  | { type: 'delete'; calId: string; eventId: string }
  | { type: 'deleteMany'; calId: string; eventIds: string[] }
  | { type: 'patch'; calId: string; eventId: string; requestBody: calendar_v3.Schema$Event }
  | { type: 'recreate'; calId: string; event: calendar_v3.Schema$Event }
  | { type: 'deleteDraft'; userId: number; draftId: string };

export function recordUndo(userId: number, label: string, ops: UndoOp[]) {
  if (!ops.length) return;
  try { undoQueries.record(userId, label, { ops }); } catch { /* non-critical */ }
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
    } catch { /* skip individual failures */ }
  }
  return any;
}

// Strip read-only fields so a deleted event can be re-inserted on undo.
export function cleanForRecreate(e: calendar_v3.Schema$Event): calendar_v3.Schema$Event {
  return { summary: e.summary, start: e.start, end: e.end, colorId: e.colorId ?? undefined, description: e.description ?? undefined, location: e.location ?? undefined, recurrence: e.recurrence ?? undefined };
}

// Parse a stored undo_log payload into ops.
export function parseUndoOps(payload: string): UndoOp[] {
  try { return (JSON.parse(payload) as { ops: UndoOp[] }).ops ?? []; } catch { return []; }
}
