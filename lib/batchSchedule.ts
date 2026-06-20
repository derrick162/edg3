// R13 T1 — pure helpers for batchReschedule (move/clear a window of events in one go).
// The I/O handler in tool-call/route.ts does calendar fetches + writable/organizer
// filtering; these pure pieces handle window-membership + the spoken preview so they
// can be unit-tested without googleapis.

export interface BatchEventLike {
  summary?: string | null;
  status?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
}

/**
 * True when an event is a live, TIMED event whose start falls in [startMs, endMs).
 * All-day events (date, no dateTime) and cancelled events are excluded — a batch
 * reschedule only ever touches real timed blocks. Unbounded window → ±Infinity.
 */
export function isTimedEventInWindow(ev: BatchEventLike, startMs: number, endMs: number): boolean {
  if (ev.status === 'cancelled') return false;
  const dt = ev.start?.dateTime;
  if (!dt) return false; // all-day or malformed
  const t = new Date(dt).getTime();
  if (isNaN(t)) return false;
  return t >= startMs && t < endMs;
}

/**
 * Spoken-friendly preview of the events a batch op will touch, e.g.
 * "Gym at 2:00 PM, Focus block at 3:00 PM, Call at 4:00 PM".
 * Strips the ⚡ marker Edge prefixes onto events it created.
 */
export function formatBatchPreview(events: BatchEventLike[], timeZone: string): string {
  return events
    .map(ev => {
      const name = (ev.summary ?? 'Untitled').replace(/^⚡\s*/, '').trim() || 'Untitled';
      const dt = ev.start?.dateTime;
      const t = dt
        ? new Date(dt).toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' })
        : 'all day';
      return `${name} at ${t}`;
    })
    .join(', ');
}
