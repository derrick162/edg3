import { format } from 'date-fns';

// R41 T0 — SQLite `datetime('now')` returns "YYYY-MM-DD HH:MM:SS" in UTC with NO timezone marker.
// `new Date()` parses that as LOCAL time, so a fact saved at 10 PM EDT (= 02:00 UTC next day) showed
// the wrong date. Normalize to a real UTC instant; date-fns `format` then renders it in the browser's
// local timezone (correct for the user). Idempotent for strings that already carry a tz marker.
export function parseDbTimestamp(s: string): Date {
  if (!s) return new Date(NaN);
  const t = s.trim();
  const hasTz = /([zZ])$|[+-]\d{2}:?\d{2}$/.test(t);
  return new Date(hasTz ? t.replace(' ', 'T') : `${t.replace(' ', 'T')}Z`);
}

// R25 T5 — provenance label for a stored fact in the Memory tab. Pure + exported so the
// open-call vs morning-call labeling is unit-testable (the dashboard imports this).
export interface FactSourceInput {
  learned_at: string;
  source?: string | null;
  source_briefing_id?: number | null;
  // 1 = open/gratitude call, 0 = morning briefing, null/undefined = no call source.
  source_is_open_call?: number | null;
}

export function factSourceLabel(f: FactSourceInput): { text: string; href: string | null } {
  const date = format(parseDbTimestamp(f.learned_at), 'MMM d');
  if (f.source === 'email') {
    return { text: `learned ${date} · from your inbox`, href: null };
  }
  if (f.source === 'priority-sync') {
    return { text: `learned ${date} · from your priorities`, href: null };
  }
  if (f.source_briefing_id) {
    // Open/gratitude calls also carry a source_briefing_id; label them correctly.
    const label = f.source_is_open_call ? 'from your open call' : 'from your morning call';
    return { text: `learned ${date} · ${label}`, href: `/dashboard?briefing=${f.source_briefing_id}` };
  }
  return { text: `learned ${date}`, href: null };
}
