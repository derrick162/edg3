// R23 T1 — rich memory context for open / inbound calls, so Edge has briefing-quality recall on
// every live call (not just 10 preference facts). Lives here (not in scheduler) so the Vapi webhook
// can import it without dragging in scheduler's cron side-effects. Best-effort: each section degrades
// to nothing on failure, never throwing.
import { factQueries, openLoopQueries, briefingQueries } from './db';

const CATEGORY_LABELS: Record<string, string> = {
  goal: 'Goals',
  project: 'Projects',
  person: 'People',
  preference: 'Preferences',
  fact: 'Other',
};
const CATEGORY_ORDER = ['goal', 'project', 'person', 'preference', 'fact'];
const MAX_PER_CATEGORY = 5;

export function currentOpenCallMemoryText(userId: number): string {
  const sections: string[] = [];

  // Section 1 — all fact categories (not just preferences), capped per category.
  try {
    const byCat = new Map<string, string[]>();
    for (const f of factQueries.getAll(userId)) {
      if (!CATEGORY_ORDER.includes(f.category)) continue;
      const arr = byCat.get(f.category) ?? [];
      if (arr.length < MAX_PER_CATEGORY) {
        arr.push(f.entity ? `${f.entity}: ${f.statement}` : f.statement);
        byCat.set(f.category, arr);
      }
    }
    const lines = CATEGORY_ORDER
      .filter(cat => byCat.get(cat)?.length)
      .map(cat => `${CATEGORY_LABELS[cat]}: ${byCat.get(cat)!.join('; ')}`);
    if (lines.length) sections.push(`WHAT EDGE KNOWS ABOUT YOU:\n${lines.join('\n')}`);
  } catch { /* skip section */ }

  // Section 2 — open commitments (things the user said they'd do).
  try {
    const loops = openLoopQueries.list(userId, 'open').slice(0, 5);
    if (loops.length) {
      const bullets = loops.map(l => `• ${l.description}${l.createdAt ? ` (from ${l.createdAt.slice(0, 10)})` : ''}`);
      sections.push(`OPEN COMMITMENTS (things you said you'd do — bring these up naturally if relevant):\n${bullets.join('\n')}`);
    }
  } catch { /* skip section */ }

  // Section 3 — recent call context (last 2 completed calls, for continuity).
  try {
    const recent = briefingQueries.getRecent(userId, 8).filter(b => b.status === 'completed').slice(0, 2);
    const lines: string[] = [];
    for (const b of recent) {
      const note = (b.user_response && b.user_response.trim()) || (b.content ? b.content.slice(0, 150) : '');
      if (note.trim()) lines.push(`${(b.scheduled_for || '').slice(0, 10)}: ${note.trim()}`);
    }
    if (lines.length) sections.push(`RECENT CALL NOTES (last 2 calls — use for continuity, don't repeat back verbatim):\n${lines.join('\n')}`);
  } catch { /* skip section */ }

  return sections.join('\n\n');
}
