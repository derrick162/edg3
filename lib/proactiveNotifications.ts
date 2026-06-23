// R14 T2 / R17 T1 — proactive push notification jobs + the scheduler sweep that drives them.
// Each job SELF-THROTTLES (low-recovery 20h cooldown, priority-gap 7d) and self-gates, so the
// sweep can safely call them on every 30-min tick. Best-effort throughout: external fetches are
// wrapped, and a per-user failure never aborts the sweep.
import { User, priorityQueries, notificationLogQueries, effectiveTimezone, getDb, backgroundJobFailureQueries, gratitudeQueries } from './db';
import { sendPushToUser } from './push';
import { getLatestRecovery } from './whoop';
import { computeAlignment } from './alignment';
import { getWeekEvents } from './calendar';
import { todayInTz, nowParts } from './time';

const LOW_RECOVERY_THRESHOLD = 40; // recovery ≤ 40% is "red" — worth a heads-up

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

/** Job B — priority gap alert. Returns true if a push was sent. `now` drives the weekday gate. */
export async function maybePriorityGapAlert(user: User, now: Date = new Date()): Promise<boolean> {
  // Tue–Thu only (Mon is low-signal, Fri too late) — gate on the user's LOCAL weekday. This is a
  // self-gate inside the job (the sweep just calls it every tick), preserving the R14 timing intent.
  const localDay = new Date(now.toLocaleString('en-US', { timeZone: effectiveTimezone(user) })).getDay(); // 0=Sun…6=Sat
  if (localDay < 2 || localDay > 4) return false;
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
  // R17 T1 — eligibility: only sweep users who (a) have ≥1 push subscription AND (b) have
  // completed ≥1 briefing. This avoids running the jobs (and their Whoop/calendar/LLM fetches)
  // for users who can't receive a push or have never used the product. The jobs self-throttle,
  // so calling both every 30-min tick is safe.
  const users = getDb().prepare(`
    SELECT DISTINCT u.* FROM users u
    JOIN push_subscriptions ps ON ps.user_id = u.id
    WHERE EXISTS (SELECT 1 FROM briefings b WHERE b.user_id = u.id AND b.status = 'completed')
  `).all() as User[];

  for (const user of users) {
    // Per-JOB try/catch so a low-recovery failure can't skip the priority-gap job, and one
    // user's failure never aborts the sweep.
    try { await maybeLowRecoveryAlert(user); }
    catch (err) { backgroundJobFailureQueries.record('proactive_notifications', user.id, `low_recovery: ${err}`); }
    try { await maybePriorityGapAlert(user, now); }
    catch (err) { backgroundJobFailureQueries.record('proactive_notifications', user.id, `priority_gap: ${err}`); }
  }
}

/**
 * R20 T2 — auto-trigger the gratitude call when today's Whoop recovery score lands.
 * For each gratitude-mode user: fire scheduleOpenCall (which branches to the gratitude prompt)
 * once today's recovery is in, no gratitude entry exists yet today, and it's 5–11am local.
 * Self-gated + best-effort: a per-user failure never aborts the sweep. Injectable `now` for tests.
 */
export async function runGratitudeAutoCall(now: Date = new Date()): Promise<void> {
  const users = getDb().prepare('SELECT * FROM users WHERE gratitude_mode = 1').all() as User[];
  if (!users.length) return;
  // Dynamic import avoids a static cycle (scheduler imports this module).
  const { scheduleOpenCall } = await import('./scheduler');
  for (const user of users) {
    try {
      const tz = effectiveTimezone(user);
      const today = todayInTz(tz, now);
      const rec = await getLatestRecovery(user.id).catch(() => null);
      if (!rec || rec.date !== today) continue;                 // score not in yet
      if (gratitudeQueries.getByDate(user.id, today)) continue;  // already checked in today
      const localHour = nowParts(tz, now).hour;
      if (localHour < 5 || localHour >= 11) continue;            // morning window only
      await scheduleOpenCall(user.id);
    } catch (err) {
      backgroundJobFailureQueries.record('gratitude_auto_call', user.id, String(err));
    }
  }
}
