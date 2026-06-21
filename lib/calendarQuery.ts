// R15 — pure helpers for the read-query calendar tools (searchEvents, checkConflict,
// getNextEvents). The I/O handlers fetch from Google; these dedup/sort/format/overlap-check
// so they're unit-testable without googleapis.

export interface CalEventLike {
  id?: string | null;
  summary?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
}

const startKey = (e: CalEventLike) => e.start?.dateTime ?? e.start?.date ?? '';

/** Dedup by event id (fallback: start key), then sort ascending by start. */
export function dedupeSortEvents<T extends CalEventLike>(events: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const e of events) {
    const key = e.id ?? startKey(e);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(e);
  }
  return out.sort((a, b) => startKey(a).localeCompare(startKey(b)));
}

function fmtDate(iso: string, tz: string): string {
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return d.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' });
}

/** Spoken form of one event. `withDate` includes the date (for search/cross-day lists). */
export function formatEventForSpeech(ev: CalEventLike, tz: string, opts: { withDate?: boolean } = {}): string {
  const name = (ev.summary ?? 'Untitled').replace(/^⚡\s*/, '').trim() || 'Untitled';
  const dt = ev.start?.dateTime;
  if (!dt) {
    const d = ev.start?.date;
    return opts.withDate && d ? `${name} (all day ${fmtDate(d, tz)})` : `${name} (all day)`;
  }
  const time = new Date(dt).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  return opts.withDate ? `${name} on ${fmtDate(dt, tz)} at ${time}` : `${name} at ${time}`;
}

/** Timed events overlapping [startMs, endMs). All-day events are not point-in-time conflicts. */
export function findOverlappingEvents<T extends CalEventLike>(events: T[], startMs: number, endMs: number): T[] {
  return events.filter(e => {
    const s = e.start?.dateTime, en = e.end?.dateTime;
    if (!s || !en) return false;
    const sMs = Date.parse(s), enMs = Date.parse(en);
    if (isNaN(sMs) || isNaN(enMs)) return false;
    return sMs < endMs && enMs > startMs;
  });
}
