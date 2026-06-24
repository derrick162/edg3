import { format } from 'date-fns';

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
  const date = format(new Date(f.learned_at), 'MMM d');
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
