// Notification producers for the in-app notification center.
// All functions are fire-and-forget safe (swallow errors, never throw).
// De-duplication: each type is capped at one per UTC calendar day via existsToday.

import { notificationQueries, calendarScoreQueries } from './db';

export function maybeCreateScoreChangeNotif(userId: number, todayScore: number, todayDate: string): void {
  try {
    if (notificationQueries.existsToday(userId, 'score_change')) return;
    // Use noon-UTC anchor to safely compute yesterday's YYYY-MM-DD without DST concerns.
    const yesterdayMs = new Date(todayDate + 'T12:00:00Z').getTime() - 86400000;
    const yesterday = new Date(yesterdayMs).toISOString().slice(0, 10);
    const rows = calendarScoreQueries.getRange(userId, yesterday, yesterday);
    if (!rows.length) return;
    const prevScore = rows[0].edge_score as number | null;
    if (prevScore === null || prevScore === undefined) return;
    const delta = todayScore - prevScore;
    if (Math.abs(delta) < 3) return;
    const arrow = delta > 0 ? '▲' : '▼';
    const sign = delta > 0 ? `+${delta}` : `${delta}`;
    notificationQueries.create(
      userId,
      'score_change',
      `Edge Score ${arrow} ${todayScore}`,
      `Your Edge Score moved from ${prevScore} to ${todayScore} (${sign} pts).`,
    );
  } catch {
    // Non-fatal
  }
}

export function maybeCreateFactLearnedNotif(userId: number, count: number): void {
  try {
    if (count <= 0) return;
    if (notificationQueries.existsToday(userId, 'fact_learned')) return;
    notificationQueries.create(
      userId,
      'fact_learned',
      `Edge learned ${count} new thing${count !== 1 ? 's' : ''}`,
      `${count} new preference${count !== 1 ? 's' : ''} noted from today's call.`,
    );
  } catch {
    // Non-fatal
  }
}

const MUTATION_TOOL_LABELS: Record<string, string> = {
  createEvent: 'added',
  moveEvent: 'moved',
  deleteEvent: 'removed',
  editEvent: 'updated',
  cleanupEvents: 'cleaned up',
  cleanupDuplicates: 'removed duplicates from',
};

export function maybeCreateActivityNotif(userId: number, toolName: string, eventTitle: string): void {
  try {
    const label = MUTATION_TOOL_LABELS[toolName];
    if (!label) return;
    if (notificationQueries.existsToday(userId, 'activity')) return;
    const display = eventTitle ? `"${eventTitle}"` : 'your calendar';
    notificationQueries.create(
      userId,
      'activity',
      `Edge ${label} ${display}`,
      `Edge made a calendar change during today's call.`,
    );
  } catch {
    // Non-fatal
  }
}
