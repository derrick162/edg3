// R25 T7 Part B — decide whether to fire the Edge Score "rise" celebration on dashboard load.
//
// The animation used to fire only after an explicit confirm-focus action. When the score rises
// naturally (e.g. the calendar improved overnight, or a nightly cron re-scored), the user got no
// visual acknowledgment. This pure helper centralizes the trigger rule so it's unit-testable
// (the dashboard has no React-render test infra) and shared between load + confirm paths.

export const LAST_SEEN_SCORE_KEY = 'edg3_last_seen_score';

// Minimum rise (in points) over the prior stored score before we celebrate — avoids firing on
// noise (a 1–2 pt wiggle isn't worth an animation).
export const SCORE_RISE_THRESHOLD = 3;

export interface ScoreCelebrationInput {
  edgeScore: number | null | undefined;
  priorScore: number | null | undefined;
  // The highest score we've already celebrated for this user on this device (localStorage).
  lastSeen: number;
}

/**
 * Returns true when the current edge score is a genuine rise worth celebrating:
 *  - we have a current score and a prior score to compare against,
 *  - the rise is at least SCORE_RISE_THRESHOLD points, and
 *  - the current score is strictly above the last score we already celebrated (so re-renders /
 *    refreshes within the same day don't replay the animation).
 */
export function shouldCelebrateScoreRise({ edgeScore, priorScore, lastSeen }: ScoreCelebrationInput): boolean {
  if (edgeScore == null || priorScore == null) return false;
  const delta = edgeScore - priorScore;
  return delta >= SCORE_RISE_THRESHOLD && edgeScore > lastSeen;
}
