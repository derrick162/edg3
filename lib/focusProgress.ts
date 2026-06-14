// Focus Scoreboard — pure progress aggregation. No I/O.
// Combines priority list, alignment hours, and milestone state into a per-area scorecard.

import type { Priority, FocusMilestone } from './db';
import type { AlignmentResult } from './alignment';

export interface FocusProgress {
  priorityId: number;
  title: string;
  hoursThisWeek: number;
  milestonesDone: number;
  milestonesTotal: number;
  isComplete: boolean; // all milestones done AND at least one exists
  neglected: boolean;  // < 0.5h this week (truly zero calendar time)
}

// Threshold below which we consider a focus area "neglected" this week.
const NEGLECT_THRESHOLD_HOURS = 0.5;

/**
 * Build per-area progress from priorities, alignment result, and milestones.
 * Returns one FocusProgress per priority, sorted by rank (as given).
 * Safe with any combination of nulls — always returns a complete array.
 */
export function buildFocusProgress(
  priorities: Priority[],
  alignment: AlignmentResult | null,
  milestones: FocusMilestone[],
): FocusProgress[] {
  return priorities.map(p => {
    // Match hours from alignment by priority text (alignment uses the text string as key).
    const alignRow = alignment?.perPriority.find(
      ap => ap.priority.trim().toLowerCase() === p.text.trim().toLowerCase()
    );
    const hoursThisWeek = alignRow?.hours ?? 0;

    const pMilestones = milestones.filter(m => m.priority_id === p.id);
    const milestonesDone = pMilestones.filter(m => m.done === 1).length;
    const milestonesTotal = pMilestones.length;

    return {
      priorityId: p.id,
      title: p.text,
      hoursThisWeek,
      milestonesDone,
      milestonesTotal,
      isComplete: milestonesTotal > 0 && milestonesDone === milestonesTotal,
      neglected: hoursThisWeek < NEGLECT_THRESHOLD_HOURS,
    };
  });
}

/**
 * Format the FOCUS SCOREBOARD block for the morning briefing prompt.
 * Returns '' when there are no priorities (degrade silently).
 */
export function formatFocusScoreboardForBriefing(
  progress: FocusProgress[],
  recentlyCompletedMilestones: FocusMilestone[],
): string {
  if (!progress.length) return '';

  const lines: string[] = ['FOCUS SCOREBOARD (use this to open section 3 — one momentum line per area, no jargon):'];

  for (const p of progress) {
    const hourStr = p.hoursThisWeek === 0 ? 'zero hours' : `${p.hoursThisWeek.toFixed(1)} h`;
    const msStr = p.milestonesTotal > 0 ? ` | milestones: ${p.milestonesDone}/${p.milestonesTotal}` : '';
    const tag = p.isComplete ? ' ✓ DONE' : p.neglected ? ' ⚠ NEGLECTED' : '';
    lines.push(`  - ${p.title}: ${hourStr} this week${msStr}${tag}`);
  }

  if (recentlyCompletedMilestones.length > 0) {
    lines.push('');
    lines.push('CELEBRATE THESE MILESTONE WINS (weave a warm, specific acknowledgment into section 1 or the greeting):');
    for (const m of recentlyCompletedMilestones) {
      lines.push(`  - "${m.title}"`);
    }
  }

  // Neglected areas — proactively offer to block time.
  const neglected = progress.filter(p => p.neglected && !p.isComplete);
  if (neglected.length > 0) {
    lines.push('');
    lines.push(
      `NEGLECTED FOCUS AREA${neglected.length > 1 ? 'S' : ''} (zero calendar time this week — ` +
      `surface ONE of these in section 3 with a specific free-slot offer; do NOT mention all of them): ` +
      neglected.map(p => `"${p.title}"`).join(', ')
    );
  }

  return lines.join('\n');
}
