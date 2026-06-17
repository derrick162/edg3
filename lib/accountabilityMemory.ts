// Accountability Memory (M4) — Core-owned.
//
// Closes the outcome loop on past commitments. Takes existing task + open_loop
// records and builds a structured "what was promised, what happened" snapshot.
//
// Pure — zero I/O. Feeds the briefing (did last week's commitments happen?) and
// the dashboard (visual commitment tracking in the Memory tab).

import type { OpenLoop } from './db';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CommitmentOutcome {
  id: number;
  text: string;
  source: 'task' | 'open_loop';
  madeAt: string;        // YYYY-MM-DD when Edge captured the commitment
  dueDate: string | null;
  outcome: 'done' | 'open';
  resolvedAt: string | null; // ISO string when marked done (null if still open)
  daysOpen: number;          // how many days since madeAt (for salience)
}

export interface AccountabilitySnapshot {
  done: CommitmentOutcome[];       // completed commitments in the lookback window
  stillOpen: CommitmentOutcome[]; // still-open commitments past their date or ≥1 day old
  completionRate: number | null;   // 0–1, null when <2 commitments total
  lookbackDays: number;
}

// ── Task shape (minimal — avoids importing the full Task interface) ─────────

interface TaskLike {
  id: number;
  text: string;
  completed: number | boolean;
  completed_at: string | null;
  source: string;
  date: string; // YYYY-MM-DD when the task was logged
}

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Build an accountability snapshot from tasks and open_loops.
 *
 * - tasks: the user's tasks — only source='edg3' entries are treated as
 *   commitments (they come from extractTasksFromTranscript at call end).
 * - openLoops: type='commitment_made' open_loops (from calls + email).
 * - today: YYYY-MM-DD reference date.
 * - lookbackDays: how far back to look (default 7).
 *
 * Returns done vs still-open commitments with metadata for briefing + UI.
 */
export function buildAccountabilitySnapshot(
  tasks: TaskLike[],
  openLoops: OpenLoop[],
  today: string,
  lookbackDays = 7,
): AccountabilitySnapshot {
  const cutoff = offsetDate(today, -lookbackDays);
  const todayMs = new Date(today + 'T12:00:00Z').getTime();

  // ── Tasks: source='edg3', within lookback window ──────────────────────────

  const outcomes: CommitmentOutcome[] = [];

  for (const t of tasks) {
    if (t.source !== 'edg3') continue;
    if (t.date < cutoff) continue;  // too old

    const madeMs = new Date(t.date + 'T12:00:00Z').getTime();
    const daysOpen = Math.max(0, Math.floor((todayMs - madeMs) / 86400000));

    const isDone = t.completed === 1 || t.completed === true;

    outcomes.push({
      id: t.id,
      text: t.text,
      source: 'task',
      madeAt: t.date,
      dueDate: null,
      outcome: isDone ? 'done' : 'open',
      resolvedAt: t.completed_at ?? null,
      daysOpen,
    });
  }

  // ── Open loops: commitment_made type, within lookback window ──────────────

  for (const loop of openLoops) {
    if (loop.type !== 'commitment_made') continue;
    const madeAt = loop.createdAt.slice(0, 10);
    if (madeAt < cutoff) continue;

    const madeMs = new Date(madeAt + 'T12:00:00Z').getTime();
    const daysOpen = Math.max(0, Math.floor((todayMs - madeMs) / 86400000));

    outcomes.push({
      id: loop.id,
      text: loop.description,
      source: 'open_loop',
      madeAt,
      dueDate: loop.dueDate,
      outcome: loop.status === 'done' ? 'done' : 'open',
      resolvedAt: loop.resolvedAt,
      daysOpen,
    });
  }

  // Split + sort
  const done = outcomes
    .filter(o => o.outcome === 'done')
    .sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? ''));

  const stillOpen = outcomes
    .filter(o => o.outcome === 'open' && o.madeAt < today) // exclude today's commitments
    .sort((a, b) => b.daysOpen - a.daysOpen); // oldest first

  const total = done.length + stillOpen.length;
  const completionRate = total >= 2 ? done.length / total : null;

  return { done, stillOpen, completionRate, lookbackDays };
}

// ── Formatting ─────────────────────────────────────────────────────────────────

/**
 * Format an accountability snapshot for the briefing prompt.
 * Honest and specific — names outstanding items and reports the completion rate.
 * Returns empty string when there's nothing to surface (no past commitments).
 */
export function formatAccountabilityForBriefing(snapshot: AccountabilitySnapshot): string {
  const { done, stillOpen, completionRate } = snapshot;
  if (!done.length && !stillOpen.length) return '';

  const lines: string[] = ['ACCOUNTABILITY (commitments Edge captured from your calls):'];

  // Completion rate headline
  if (completionRate !== null) {
    const pct = Math.round(completionRate * 100);
    lines.push(`Rate: ${done.length}/${done.length + stillOpen.length} completed (${pct}%) in the last ${snapshot.lookbackDays} days.`);
  }

  // Outstanding commitments (most important — lead with these)
  if (stillOpen.length > 0) {
    lines.push('Still open:');
    for (const c of stillOpen.slice(0, 3)) {
      const age = c.daysOpen === 1 ? '1 day' : `${c.daysOpen} days`;
      const due = c.dueDate ? ` (due ${c.dueDate})` : '';
      lines.push(`  - "${c.text}"${due} — open ${age}`);
    }
    if (stillOpen.length > 3) lines.push(`  + ${stillOpen.length - 3} more outstanding`);
  }

  // Recent completions (reinforce momentum)
  if (done.length > 0 && done.length <= 3) {
    lines.push('Completed:');
    for (const c of done.slice(0, 2)) {
      lines.push(`  ✓ "${c.text}"`);
    }
  }

  return lines.join('\n');
}

// ── Briefing instruction ───────────────────────────────────────────────────────

/**
 * Generate the briefing instruction for how to use the accountability block.
 */
export function accountabilityBriefingInstruction(snapshot: AccountabilitySnapshot): string {
  if (!snapshot.stillOpen.length && !snapshot.done.length) return '';

  if (snapshot.stillOpen.length > 0) {
    return `Use ACCOUNTABILITY in section 4 (ACTION ITEMS): name the most overdue outstanding commitment and ask directly — "Last time you said you'd [text] — did that happen?" One commitment only. If done, celebrate briefly and move on. If still open, offer to reschedule or drop it ("want to push it to Thursday, or let it go?"). Never shame — curious, not judgmental.`;
  }

  return `Use ACCOUNTABILITY to briefly acknowledge the strong completion rate — one encouraging sentence in the GREETING or closing section. Don't overdo it.`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function offsetDate(date: string, days: number): string {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
