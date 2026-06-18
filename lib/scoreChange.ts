import type { CalendarScore } from './db';

export interface ScoreChangeSummary {
  delta: number;
  direction: 'up' | 'down' | 'flat';
  sinceLabel: string;
  reason: string;
  asOf: string;
}

interface ComponentSnap {
  score: number;
  drivers: string[];
  topFix: { description: string } | null;
}

export interface ScoreComponents {
  focusScore: ComponentSnap;
  energyScore: ComponentSnap;
}

// DB persists only focus_score and energy_score; clarity/momentum deltas
// are not available from prior snapshots and are excluded from dominance logic.
function pickDominantComponent(
  current: ScoreComponents,
  prior: CalendarScore,
): ComponentSnap {
  const focusDelta  = Math.abs(current.focusScore.score  - (prior.focus_score  ?? current.focusScore.score));
  const energyDelta = Math.abs(current.energyScore.score - (prior.energy_score ?? current.energyScore.score));
  return focusDelta >= energyDelta ? current.focusScore : current.energyScore;
}

// Drivers are concrete state fragments ("'fundraising' has zero hours scheduled this week.",
// "Today's focus locked in — Momentum boosted."). Some are positive, some are problems. The
// reason must match the delta's DIRECTION — otherwise we'd say "Up 16 because focus not
// confirmed yet" (a negative driver attached to an upward move). These hints flag problem drivers.
const NEGATIVE_HINTS = [
  'zero hours', 'not connected', 'not granted', 'unavailable', "can't", 'cannot', 'not yet',
  'could use', 'no preference', 'estimated, not measured', 'reconnect', "couldn't", 'not measured',
  'biggest time sink', 'no ', "couldn’t",
];

function isNegativeDriver(d: string): boolean {
  const s = d.toLowerCase();
  return NEGATIVE_HINTS.some(h => s.includes(h));
}

// Strip trailing period + the decorative "✦" so the fragment reads cleanly inside a sentence.
function cleanClause(d: string): string {
  return d.replace(/\s*✦\s*$/, '').replace(/\.+$/, '').trim();
}

function buildReason(component: ComponentSnap, direction: 'up' | 'down' | 'flat'): string {
  if (direction === 'up') {
    // Prefer a positive driver — never explain a rise with a problem statement.
    const positive = component.drivers.find(d => !isNegativeDriver(d));
    return cleanClause(positive ?? component.drivers[0] ?? 'your calendar is better aligned');
  }
  if (direction === 'down') {
    if (component.topFix?.description) return cleanClause(component.topFix.description);
    const negative = component.drivers.find(isNegativeDriver);
    return cleanClause(negative ?? component.drivers[0] ?? 'your calendar could use a tune-up');
  }
  return cleanClause(component.drivers[0] ?? 'no major changes');
}

function buildSinceLabel(prevDate: string, today: string): string {
  const msPerDay = 86_400_000;
  const days = Math.round((new Date(today).getTime() - new Date(prevDate).getTime()) / msPerDay);
  if (days <= 0) return 'recently';
  if (days === 1) return 'since yesterday';
  if (days <= 7) return `since ${days} days ago`;
  const d = new Date(prevDate + 'T12:00:00Z');
  return `since ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
}

export function summarizeScoreChange(
  currentTotal: number,
  currentComponents: ScoreComponents,
  prevSnapshot: CalendarScore | null | undefined,
  today: string,
): ScoreChangeSummary | null {
  if (!prevSnapshot) return null;
  if (prevSnapshot.date === today) return null;
  if (prevSnapshot.edge_score === null || prevSnapshot.edge_score === undefined) return null;

  const delta = currentTotal - prevSnapshot.edge_score;
  const direction: 'up' | 'down' | 'flat' =
    Math.abs(delta) < 2 ? 'flat' : delta > 0 ? 'up' : 'down';

  const dominant = pickDominantComponent(currentComponents, prevSnapshot);
  const reason   = buildReason(dominant, direction);
  const since    = buildSinceLabel(prevSnapshot.date, today);

  return { delta, direction, sinceLabel: since, reason, asOf: prevSnapshot.date };
}
