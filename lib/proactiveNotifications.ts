// R14 T2 — proactive push notification jobs. Driven by the scheduler's 30-min cron;
// each job fires at a specific LOCAL hour for the user. Best-effort: every job degrades
// gracefully (push send + external fetches are wrapped) and a per-user failure never
// aborts the sweep.
import { User, userQueries, priorityQueries, notificationLogQueries, effectiveTimezone, getDb, backgroundJobFailureQueries } from './db';
import { sendPushToUser } from './push';
import { getLatestRecovery } from './whoop';
import { computeAlignment } from './alignment';
import { getWeekEvents } from './calendar';

const LOW_RECOVERY_THRESHOLD = 40; // recovery ≤ 40% is "red" — worth a heads-up
void userQueries; // (kept for symmetry with other scheduler helpers; users are loaded via getDb below)

// Gate: only notify users who've actually used the product (≥1 completed briefing call) —
// don't push to churned / never-onboarded accounts.
function hasCompletedCall(userId: number): boolean {
  const row = getDb().prepare(
    "SELECT 1 FROM briefings WHERE user_id = ? AND status = 'completed' LIMIT 1"
  ).get(userId) as unknown;
  return !!row;
}

/** Job A — low recovery alert. Returns true if a push was sent. */
export async function maybeLowRecoveryAlert(user: User): Promise<boolean> {
  const rec = await getLatestRecovery(user.id).catch(() => null);
  if (!rec || rec.recoveryScore > LOW_RECOVERY_THRESHOLD) return false; // not connected / no data / fine
  if (!hasCompletedCall(user.id)) return false;                         // churned → don't push
  if (notificationLogQueries.hasRecentEntry(user.id, 'low_recovery', 20)) return false; // already today
  await sendPushToUser(user.id, {
    title: 'Recovery Alert',
    body: `Your recovery is ${rec.recoveryScore}% today — Edge adjusted your briefing to protect your energy.`,
  });
  notificationLogQueries.record(user.id, 'low_recovery', String(rec.recoveryScore));
  return true;
}

/** Job B — priority gap alert. Returns true if a push was sent. */
export async function maybePriorityGapAlert(user: User): Promise<boolean> {
  // Once per week per user. This cheap gate runs BEFORE the calendar + LLM calls so we don't
  // pay for alignment more than once a week per user.
  if (notificationLogQueries.hasRecentEntry(user.id, 'priority_gap', 24 * 7)) return false;

  const priorities = priorityQueries.getMostRecent(user.id);
  if (!priorities.length) return false;

  const weekEvents = await getWeekEvents(user.id).catch(() => []);
  const alignment = await computeAlignment(priorities, weekEvents, effectiveTimezone(user)).catch(() => null);
  if (!alignment) return false;

  const gap = alignment.perPriority.find(p => p.hours === 0);
  if (!gap) return false;

  await sendPushToUser(user.id, {
    title: 'Priority Gap',
    body: `"${gap.priority}" hasn't had any time this week. Want Edge to block some?`,
  });
  notificationLogQueries.record(user.id, 'priority_gap', gap.priority);
  return true;
}

/**
 * Sweep all active users and fire the proactive jobs that match each user's LOCAL time.
 * Wired to a 30-min cron — Job A at local 7:30, Job B at local 9:00 (Tue–Thu).
 * Injectable `now` for deterministic tests.
 */
export async function runProactiveNotifications(now: Date = new Date()): Promise<void> {
  const users = getDb().prepare(
    `SELECT * FROM users WHERE onboarding_complete = 1 AND phone_number IS NOT NULL AND call_time IS NOT NULL`
  ).all() as User[];

  for (const user of users) {
    try {
      const tz = effectiveTimezone(user);
      const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
      const hour = local.getHours();
      const minute = local.getMinutes();
      const day = local.getDay(); // 0=Sun … 6=Sat

      // Job A — low recovery at 7:30 local.
      if (hour === 7 && minute === 30) await maybeLowRecoveryAlert(user);
      // Job B — priority gap at 9:00 local, Tue–Thu only (Mon low-signal, Fri too late).
      if (hour === 9 && minute === 0 && day >= 2 && day <= 4) await maybePriorityGapAlert(user);
    } catch (err) {
      backgroundJobFailureQueries.record('proactive_notifications', user.id, String(err));
    }
  }
}
