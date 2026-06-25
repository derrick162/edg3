import cron from 'node-cron';
import { randomBytes } from 'node:crypto';
import { format } from 'date-fns';
import { getDb } from './db';
import { generateDailyBriefing, getWeekOf } from './briefing';
import { initiateCall, buildGratitudeSystemPrompt } from './vapi';
import { getWeatherForecast, getWeatherToday } from './weather';
import { currentOpenCallMemoryText } from './callMemory';
import { getLatestRecovery, getLastSleep, getRecentStrain, getRecoveryHistory, getSleepHistory, getStrainHistory, whoopFreshnessNote, formatWhoopHistoryForCall } from './whoop';
import { briefingQueries, userQueries, priorityQueries, factQueries, energyLogQueries, openLoopQueries, watchedThreadQueries, oauthStateQueries, auditLogQueries, episodeQueries, briefingContextPackQueries, failedWebhookQueries, backgroundJobFailureQueries, healthLogQueries, callAttemptQueries, calendarQueries, notificationQueries, webhookDedupeQueries, toolCallDedupeQueries, schedulerLockQueries, effectiveTimezone, User } from './db';
import { isPrivacyMode } from './consent';
import { greetingEn, greetingYue, dayPeriod } from './greeting';
import { deriveEnergySignal, formatEnergyForCall } from './energy';
import { maybeDailyBackup } from './backup';

/**
 * Structured call failure — carries a user-facing message and a reason code so
 * the API route can tell the dashboard exactly WHY the call didn't go through
 * (daily cap vs broken service vs briefing failure) instead of a generic 500.
 */
export class CallError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly code: 'vapi_daily_limit' | 'vapi_error' | 'briefing_gen_failed' | 'already_called',
  ) {
    super(userMessage);
    this.name = 'CallError';
  }
}

// Returns today's most recent briefing row (status + error_code) for a user, in their
// local timezone. Returns undefined when no briefing exists for today.
export async function getTodayCallStatus(userId: number) {
  const user = userQueries.findById(userId);
  if (!user) return undefined;
  const tz = effectiveTimezone(user);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  return briefingQueries.getTodayForUser(userId, today);
}

// Safe on-demand re-trigger for Core's "I didn't get my call" button. Guards against
// double-calling (completed/calling today) and surfaces CallError details without throwing.
export async function triggerBriefingCallNow(userId: number): Promise<
  | { ok: true; briefingId: number }
  | { ok: false; code: string; message: string }
> {
  try {
    const briefingId = await scheduleBriefingCall(userId);
    return { ok: true, briefingId };
  } catch (err) {
    if (err instanceof CallError) {
      return { ok: false, code: err.code, message: err.userMessage };
    }
    return { ok: false, code: 'unknown', message: 'An unexpected error occurred.' };
  }
}

function classifyVapiError(err: unknown): CallError {
  const msg = String(err instanceof Error ? err.message : err).toLowerCase();
  if (msg.includes('daily-limit') || msg.includes('outbound-daily-limit') || msg.includes('daily limit')) {
    return new CallError(
      'Daily call limit reached on this number — the free-tier cap has been hit. Calls will resume tomorrow, or upgrade to a paid Vapi number.',
      'vapi_daily_limit',
    );
  }
  return new CallError(
    'Could not reach the calling service. Please try again in a moment.',
    'vapi_error',
  );
}

// How long after call_time we'll still fire if the exact-minute tick was missed
// (e.g. server restart during that minute). Capped so a long outage doesn't
// place a morning briefing call in the afternoon.
const CALL_GRACE_MINUTES = 5; // Survive a missed single-minute tick on cold-start. 120 was too wide — it caused catch-up calls on every Railway deploy.

// A 'calling' briefing row older than this means the call was initiated but never
// completed (the end-webhook never arrived / the call didn't connect). Past this age it
// must NOT keep blocking the day's call — otherwise one silently-dropped call permanently
// suppresses every retry (auto + manual) for the rest of the day.
const STALE_CALLING_MS = 15 * 60 * 1000;

// A 'pending' row (claim-first slot) older than this is stale — the server must have
// crashed between createPending() and the Vapi call. Past this age the slot is released
// so the scheduler can retry instead of being permanently stuck.
const STALE_PENDING_MS = 5 * 60 * 1000;

/**
 * The once-a-day guard: is there a briefing for `dayPrefix` (a YYYY-MM-DD local date) that
 * should block placing a NEW morning briefing call right now? Returns the blocking row, or
 * undefined if the slot is free.
 *
 * R19 T4: the `(is_open_call IS NULL OR is_open_call = 0)` filter is critical — a completed
 * *open/gratitude* call (is_open_call = 1) creates a `completed` briefings row for today, but
 * it must NOT count as "the morning briefing already happened", or the gratitude call (which
 * fires earlier once the overnight ElevenLabs quota resets) silently suppresses the briefing.
 * Legacy rows with NULL is_open_call are treated as morning briefings (conservative: still block).
 *
 * Single source of truth for both the `checkAndInitiateCalls` sweep and `scheduleBriefingCall`.
 */
export function findTodaysBlockingBriefing(
  db: ReturnType<typeof getDb>,
  userId: number,
  dayPrefix: string,
  callingCutoff: string,
  pendingCutoff: string,
): { status: string; error_code: string | null } | undefined {
  return db.prepare(
    `SELECT status, error_code FROM briefings WHERE user_id = ? AND scheduled_for LIKE ? AND (is_open_call IS NULL OR is_open_call = 0) AND (
      status = 'completed'
      OR (status = 'calling' AND scheduled_for >= ?)
      OR (status = 'pending' AND scheduled_for >= ?)
      OR (status = 'failed' AND error_code = 'vapi_daily_limit')
    ) ORDER BY scheduled_for DESC LIMIT 1`,
  ).get(userId, `${dayPrefix}%`, callingCutoff, pendingCutoff) as { status: string; error_code: string | null } | undefined;
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// The user's current top priorities as prompt text — this week's, falling back to the most
// recent set so Edge always knows them on a call (especially open calls, which have no briefing).
function currentPrioritiesText(userId: number): string {
  const prios = priorityQueries.getThisWeek(userId, getWeekOf());
  const eff = prios.length ? prios : priorityQueries.getMostRecent(userId);
  return eff.length ? eff.map((p, i) => `${i + 1}. ${p.text}`).join('\n') : '';
}

// R25 T1 — currentPreferencesText removed: both briefing and open calls now use the richer
// currentOpenCallMemoryText (from ./callMemory), which already includes preference facts.

// Today's Whoop snapshot as a compact string for the live-call system prompt, so recovery/sleep/
// strain are available on ANY call (briefing OR open), not just the briefing. '' if unavailable.
async function currentWhoopText(userId: number): Promise<string> {
  try {
    // Today's snapshot + last-7-days history, all in parallel (history fetches are cached).
    const [rec, slp, str, recHist, slpHist, strHist] = await Promise.all([
      getLatestRecovery(userId).catch(() => null),
      getLastSleep(userId).catch(() => null),
      getRecentStrain(userId).catch(() => null),
      getRecoveryHistory(userId, 7).catch(() => []),
      getSleepHistory(userId, 7).catch(() => []),
      getStrainHistory(userId, 7).catch(() => []),
    ]);
    const parts: string[] = [];
    if (rec) parts.push(`recovery ${rec.recoveryScore}%`);
    if (slp) { const h = Math.floor(slp.durationMs / 3600000); const m = Math.round((slp.durationMs % 3600000) / 60000); const dur = m === 0 ? `${h} hours` : `${h} hours ${m} minutes`; parts.push(`sleep ${dur} (sleep score ${slp.performancePct}%)`); }
    if (str) parts.push(`strain ${str.strain}`);
    if (!parts.length) return '';
    // Freshness: flag when recovery/sleep aren't today's so Edge says so instead of
    // presenting a stale reading as current.
    const user = userQueries.findById(userId);
    const tz = user ? effectiveTimezone(user) : 'America/Vancouver';
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    const note = whoopFreshnessNote(rec?.date, slp?.date, today);
    // Last-7-days history so Edge can answer "how's my recovery/sleep been this week".
    const history = formatWhoopHistoryForCall(recHist, slpHist, strHist);
    let out = parts.join(' · ');
    if (note) out += ` — ${note}`;
    if (history) out += ` · ${history}`;
    return out;
  } catch { return ''; }
}

// Today's energy signal as a compact string for the live-call system prompt.
async function currentEnergyText(userId: number): Promise<string> {
  try {
    const user = userQueries.findById(userId);
    if (!user) return '';
    const tz = effectiveTimezone(user);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    const log = energyLogQueries.getToday(userId, today);
    // Whoop recovery needed for auto-derive only when no log entry exists
    const whoopScore = log ? null : await import('./whoop').then(m => m.getLatestRecovery(userId).catch(() => null)).then(r => r?.recoveryScore ?? null);
    const signal = deriveEnergySignal(log, whoopScore);
    const firstName = user.name.split(' ')[0];
    return formatEnergyForCall(signal, firstName);
  } catch { return ''; }
}

// ── Nightly context-pack pre-warmer (11pm in each user's LOCAL timezone) ─────
// Assembles tomorrow's briefing context for each active user so morning calls read a
// pre-warmed pack rather than running live queries. Runs HOURLY; each user is built once,
// when their local clock reads 23:xx — so the pack is freshest (~8h before the 7am call)
// and "tomorrow" is computed correctly across timezones (vs a single fixed UTC hour, which
// skews freshness from ~3pm to ~10am-next-day depending on the user's offset).
// Idempotent: if tomorrow's pack already exists it's skipped, so re-runs cost nothing.
// Activates automatically once Core exports buildBriefingContextPack from lib/briefing.ts.
export async function runNightlyContextPacks(now: Date = new Date()): Promise<void> {
  const BriefingLib = await import('./briefing');
  const buildContextPack = (BriefingLib as Record<string, unknown>)['buildBriefingContextPack'] as
    ((userId: number) => Promise<string>) | undefined;

  if (typeof buildContextPack !== 'function') {
    console.log('[scheduler] buildBriefingContextPack not yet exported from lib/briefing — skipping nightly context pack prep');
    return;
  }

  const db = getDb();
  const users = db.prepare(`
    SELECT * FROM users
    WHERE onboarding_complete = 1
    AND phone_number IS NOT NULL
    AND call_time IS NOT NULL
  `).all() as User[];

  let built = 0;
  let empty = 0;
  for (const user of users) {
    try {
      const tz = effectiveTimezone(user);
      // Only build at ~11pm in the USER'S local timezone (same local-time pattern as the
      // call scheduler). The hourly cron catches each user once, during their 23:00 hour.
      const localHour = new Date(now.toLocaleString('en-US', { timeZone: tz })).getHours();
      if (localHour !== 23) continue;

      // "Tomorrow" in the user's local timezone — the date the pack will prime.
      const tomorrowLocal = new Date(now.getTime() + 24 * 60 * 60 * 1000)
        .toLocaleDateString('en-CA', { timeZone: tz });

      // Idempotency + cost guard: tomorrow's pack already built (e.g. an earlier tick or a
      // restart) → skip the LLM call entirely.
      if (briefingContextPackQueries.get(user.id, tomorrowLocal)) continue;

      const startedAt = Date.now();
      const contextPack = await buildContextPack(user.id);
      const durationMs = Date.now() - startedAt;
      const packSize = typeof contextPack === 'string' ? contextPack.trim().length : 0;

      // M2-4 — verify the pack is non-empty. An empty pack must NOT be cached: the
      // morning call falls back to live assembly, which is correct, so caching '' would
      // poison that fallback. Surface it as a job failure so the 6am digest flags it.
      if (packSize === 0) {
        empty++;
        console.warn(`[scheduler] Context pack EMPTY user=${user.id} date=${tomorrowLocal} — not caching; morning call will assemble live`);
        backgroundJobFailureQueries.record('nightly_context_packs', user.id, 'empty pack (not cached)');
        continue;
      }

      briefingContextPackQueries.upsert(user.id, tomorrowLocal, contextPack);
      built++;

      // M2-4 observability: size + duration are operational metrics (not pack content).
      // Respect Privacy Mode — userId only, never the name, and suppress metrics.
      if (!isPrivacyMode(user)) {
        console.log(`[scheduler] Context pack ready user=${user.id} date=${tomorrowLocal} size=${packSize} durationMs=${durationMs}`);
      } else {
        console.log(`[scheduler] Context pack ready user=${user.id} date=${tomorrowLocal} (privacy mode — metrics suppressed)`);
      }
    } catch (err) {
      console.error(`[scheduler] Context pack failed for user ${user.id}:`, err);
      backgroundJobFailureQueries.record('nightly_context_packs', user.id, String(err));
    }
  }

  // Prune packs older than 7 days (runs alongside the pack build to stay clean).
  try { briefingContextPackQueries.prune(); } catch (e) { console.error('[scheduler] context pack prune failed:', e); }
  console.log(`[scheduler] Nightly context packs: ${built}/${users.length} built${empty ? `, ${empty} empty (skipped)` : ''}`);
}

// ── Nightly Edg3 Score computation (R19 T5) ──────────────────────────────────
// The score sparkline shows gaps on days the user never loads the dashboard (the score
// is computed lazily on page load). This job computes + persists the score for every
// active user nightly so the trend is continuous regardless of page loads.
//
// Dynamic import + runtime function-check so this stays a safe no-op until Core exports
// computeAndSaveScore from lib/scores.ts (same activation pattern as runNightlyContextPacks).
export async function runNightlyScores(): Promise<void> {
  const ScoresLib = await import('./scores');
  const computeAndSaveScore = (ScoresLib as Record<string, unknown>)['computeAndSaveScore'] as
    ((userId: number) => Promise<void>) | undefined;

  if (typeof computeAndSaveScore !== 'function') {
    console.log('[scheduler] computeAndSaveScore not yet exported from lib/scores — skipping nightly score computation');
    return;
  }

  const users = getDb().prepare('SELECT id FROM users WHERE onboarding_complete = 1').all() as Array<{ id: number }>;
  let done = 0;
  for (const { id } of users) {
    try { await computeAndSaveScore(id); done++; }
    catch (e) {
      console.error(`[scheduler] nightly score failed for user ${id}:`, e);
      backgroundJobFailureQueries.record('nightly_scores', id, String(e));
    }
  }
  console.log(`[scheduler] Nightly scores: ${done}/${users.length} computed`);
}

// ── Weekly confidence decay job (4am UTC every Sunday) ───────────────────────
// Decays confidence_score on active facts by category tier. Facts that decay below
// 0.3 surface to Core's reconfirmation trigger during the next morning briefing.
const VOLATILE_CATEGORIES = ['priorities', 'projects', 'current_focus'];
const STABLE_CATEGORIES   = ['personality', 'working_style', 'relationships'];
const VOLATILE_DECAY = 0.1;
const STABLE_DECAY   = 0.02;

export function decayFactConfidenceScores(): void {
  try {
    factQueries.decayByCategories(VOLATILE_CATEGORIES, VOLATILE_DECAY);
    factQueries.decayByCategories(STABLE_CATEGORIES, STABLE_DECAY);
    console.log('[scheduler] Weekly confidence decay applied');
  } catch (e) {
    console.error('[scheduler] Confidence decay failed:', e);
    backgroundJobFailureQueries.record('decay_fact_confidence', null, String(e));
  }
}

// ── 6am health digest (T1-3 / PILLAR-TRUST) ─────────────────────────────────
// Runs before the 7am call. Checks for: failed calls (last 24h), webhook DLQ,
// background job failures, and calendar auth issues. Writes to health_log and emits
// a single summary line — "HEALTH: OK" or "HEALTH: DEGRADED (reason1; reason2)".
export async function runHealthDigest(): Promise<void> {
  const issues: string[] = [];

  try {
    const failedCalls = callAttemptQueries.failedCount(24);
    if (failedCalls > 0) issues.push(`${failedCalls} call(s) failed in last 24h`);
  } catch (e) { issues.push(`call-attempts check error: ${e}`); }

  try {
    const webhookFails = failedWebhookQueries.recentCount(24);
    if (webhookFails > 0) issues.push(`${webhookFails} webhook(s) in DLQ`);
  } catch (e) { issues.push(`webhook-dlq check error: ${e}`); }

  try {
    const jobFails = backgroundJobFailureQueries.recentCount(24);
    if (jobFails > 0) issues.push(`${jobFails} background job failure(s)`);
  } catch (e) { issues.push(`job-failures check error: ${e}`); }

  try {
    const db = getDb();
    const row = db.prepare(
      `SELECT COUNT(*) as count FROM briefings WHERE status = 'completed' AND created_at > datetime('now', '-24 hours') AND (transcript IS NULL OR length(transcript) < 50)`
    ).get() as { count: number };
    if (row.count > 0) issues.push(`${row.count} completed call(s) have no transcript`);
  } catch (e) { issues.push(`transcript-health check error: ${e}`); }

  // T0-1 — durability: in prod, off-box replication must be active or a volume
  // loss is unrecoverable. Surface daily (not just at boot) so it can't be missed.
  try {
    if (process.env.NODE_ENV === 'production') {
      const hasOffBox = Boolean(process.env.LITESTREAM_S3_BUCKET) || Boolean(process.env.BACKUP_S3_BUCKET);
      if (!hasOffBox) issues.push('NO off-box DB replication configured (data-loss risk)');
    }
  } catch (e) { issues.push(`durability check error: ${e}`); }

  // T0-2 — encryption key presence: in prod, a missing DATA_ENCRYPTION_KEY means
  // PII is written as plaintext (or writes fail in strict mode). Surface daily.
  try {
    if (process.env.NODE_ENV === 'production') {
      const { encryptionEnabled } = await import('./crypto');
      if (!encryptionEnabled()) issues.push('DATA_ENCRYPTION_KEY unset in prod (PII at-rest not encrypted)');
    }
  } catch (e) { issues.push(`encryption check error: ${e}`); }

  try {
    // Proactively validate calendar tokens for all active users before the 7am call.
    const { checkCalendarTokenHealth } = await import('./google-auth');
    const db = getDb();
    const activeUsers = db.prepare(
      `SELECT u.id FROM users u INNER JOIN calendar_tokens ct ON ct.user_id = u.id WHERE u.onboarding_complete = 1`
    ).all() as Array<{ id: number }>;
    let tokenFails = 0;
    for (const u of activeUsers) {
      const result = await checkCalendarTokenHealth(u.id).catch(() => ({ ok: false, needsReconnect: false }));
      if (!result.ok) tokenFails++;
    }
    if (tokenFails > 0) issues.push(`${tokenFails} user(s) have calendar auth issues`);
  } catch (e) { issues.push(`calendar-auth check error: ${e}`); }

  const status = issues.length === 0 ? 'ok' : 'degraded';
  const summary = issues.length === 0
    ? 'All systems nominal'
    : issues.join('; ');

  healthLogQueries.write(status, summary);
  healthLogQueries.prune();
  callAttemptQueries.prune();

  if (status === 'ok') {
    console.log('[health] HEALTH: OK — All systems nominal');
  } else {
    console.error(`[health] HEALTH: DEGRADED — ${summary}`);
  }
}

let schedulerRunning = false;

// T0-4 — unique per-process id so the scheduler lock can identify this instance.
// PID + random suffix distinguishes replicas (and restarts) sharing one DB.
const INSTANCE_ID = `${process.pid}-${randomBytes(4).toString('hex')}`;
const DISPATCH_LOCK = 'dispatch';
// TTL < the 60s tick so a crashed holder's lock self-expires before the next tick.
const DISPATCH_LOCK_TTL_SECONDS = 55;

export function startScheduler() {
  if (schedulerRunning) return;
  schedulerRunning = true;

  // Check every minute if any users need a call. T0-4: claim a single-instance lock
  // first so a second Railway replica (or an overlapping slow tick) can't double-dial.
  cron.schedule('* * * * *', async () => {
    if (!schedulerLockQueries.acquire(DISPATCH_LOCK, INSTANCE_ID, DISPATCH_LOCK_TTL_SECONDS)) {
      // A refused acquire always means a DIFFERENT holder owns it (our own holder would
      // refresh successfully) — i.e. a second instance/replica, or a still-running slow
      // tick. Log a warning naming the holder so a real double-instance is visible, not silent.
      const held = schedulerLockQueries.currentHolder(DISPATCH_LOCK);
      console.warn(
        `[scheduler] dispatch lock already held${held ? ` by ${held.holder} (expires ${held.expires_at})` : ''} — ` +
        `instance ${INSTANCE_ID} skipping this tick (prevents double-dial)`,
      );
      return;
    }
    try {
      await checkAndInitiateCalls(new Date());
    } finally {
      schedulerLockQueries.release(DISPATCH_LOCK, INSTANCE_ID);
    }
  });

  // Nightly at 3am UTC: retention prune for PII rows + daily DB snapshot (covers no-call days).
  cron.schedule('0 3 * * *', () => {
    try { openLoopQueries.prune(); } catch (e) { console.error('[scheduler] openLoopQueries.prune failed:', e); }
    try { watchedThreadQueries.prune(); } catch (e) { console.error('[scheduler] watchedThreadQueries.prune failed:', e); }
    try { oauthStateQueries.prune(); } catch (e) { console.error('[scheduler] oauthStateQueries.prune failed:', e); }
    try { auditLogQueries.pruneEmailSubjects(); } catch (e) { console.error('[scheduler] pruneEmailSubjects failed:', e); }
    try { episodeQueries.pruneAll(); } catch (e) { console.error('[scheduler] episodeQueries.pruneAll failed:', e); }
    try { failedWebhookQueries.prune(); } catch (e) { console.error('[scheduler] failedWebhookQueries.prune failed:', e); }
    try { backgroundJobFailureQueries.prune(); } catch (e) { console.error('[scheduler] backgroundJobFailureQueries.prune failed:', e); }
    try { webhookDedupeQueries.prune(); } catch (e) { console.error('[scheduler] webhookDedupeQueries.prune failed:', e); }
    try { toolCallDedupeQueries.prune(); } catch (e) { console.error('[scheduler] toolCallDedupeQueries.prune failed:', e); }
    maybeDailyBackup().catch(e => console.error('[scheduler] maybeDailyBackup failed:', e));
    // Health check: log warnings if any failures accumulated in the last 24h.
    try {
      const webhookFails = failedWebhookQueries.recentCount(24);
      const jobFails = backgroundJobFailureQueries.recentCount(24);
      if (webhookFails > 0) console.error(`[health] WARN: ${webhookFails} webhook(s) in dead-letter queue in last 24h — check Railway logs`);
      if (jobFails > 0) console.error(`[health] WARN: ${jobFails} background job failure(s) in last 24h — check Railway logs`);
    } catch (e) { console.error('[scheduler] daily health check failed:', e); }
  });

  // Daily at 6am UTC: health digest — runs before the 7am call so failures surface first.
  // Writes one row to health_log (status OK vs DEGRADED) + emits a single summary log line
  // that Railway can alert on. Check: failed calls, job failures, webhook DLQ, calendar auth.
  cron.schedule('0 6 * * *', async () => {
    try {
      await runHealthDigest();
    } catch (e) { console.error('[scheduler] health digest cron failed:', e); }
  });

  // Hourly: pre-warm tomorrow's briefing context for users whose LOCAL time is 11pm.
  // runNightlyContextPacks filters by local hour + skips already-built packs, so this is
  // cheap on the 23 non-matching hours. Activates once Core exports buildBriefingContextPack.
  cron.schedule('0 * * * *', () => {
    runNightlyContextPacks().catch(e => console.error('[scheduler] runNightlyContextPacks failed:', e));
  });

  // Daily at 11pm UTC: compute + persist the Edg3 Score for every active user so the
  // sparkline trend stays continuous even on days they don't open the dashboard (R19 T5).
  cron.schedule('0 23 * * *', () => {
    runNightlyScores().catch(e => console.error('[scheduler] runNightlyScores failed:', e));
  });

  // Weekly at 4am UTC every Sunday: decay confidence scores on active facts.
  cron.schedule('0 4 * * 0', () => {
    decayFactConfidenceScores();
  });

  // R14 T2 — proactive push notifications. Every 30 min so we can hit local 7:30 (low-recovery)
  // and local 9:00 (priority gap). The sweep filters by each user's LOCAL time + gates, so it's
  // cheap on non-matching ticks (no fetches unless a user is at a trigger time).
  // Dynamic import (same pattern as './briefing' above) keeps its heavy deps — calendar /
  // alignment / whoop / push — out of the scheduler's module-load graph.
  // R20 T2 — */10 (was */30): the proactive jobs self-throttle, so a higher check frequency
  // only makes the gratitude auto-call fire promptly when the morning Whoop score lands —
  // it does not change how often the throttled push jobs actually fire.
  cron.schedule('*/10 * * * *', () => {
    import('./proactiveNotifications')
      .then(async m => {
        await m.runProactiveNotifications();
        await m.runGratitudeAutoCall().catch(e => console.error('[scheduler] runGratitudeAutoCall failed:', e));
      })
      .catch(e => console.error('[scheduler] runProactiveNotifications failed:', e));
  });

  console.log('EDG3 scheduler started');
}

// Exported for testing (injectable `now` makes time-based logic deterministic in tests).
export async function checkAndInitiateCalls(now: Date = new Date()) {
  const db = getDb();
  const today = format(now, 'yyyy-MM-dd');

  // Get all onboarded users with a phone number and call time
  const users = db.prepare(`
    SELECT * FROM users
    WHERE onboarding_complete = 1
    AND phone_number IS NOT NULL
    AND call_time IS NOT NULL
  `).all() as User[];

  for (const user of users) {
    try {
      const timezone = user.timezone || 'America/Vancouver';

      // Get current time in the user's timezone
      const userLocalTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
      const userHH = String(userLocalTime.getHours()).padStart(2, '0');
      const userMM = String(userLocalTime.getMinutes()).padStart(2, '0');
      const userCurrentTime = `${userHH}:${userMM}`;
      const userToday = userLocalTime.toLocaleDateString('en-CA'); // YYYY-MM-DD

      // Catch-up window: fire any time >= call_time and within CALL_GRACE_MINUTES.
      // The exact-minute tick can be missed when the server restarts during that minute;
      // the grace window fires a few minutes late instead of silently skipping the call.
      const userMinutes = timeToMinutes(userCurrentTime);
      const callMinutes = timeToMinutes(user.call_time);
      if (userMinutes < callMinutes || userMinutes >= callMinutes + CALL_GRACE_MINUTES) continue;

      // Check if already called today (in user's local date). A 'completed' call always
      // blocks; a 'calling' row blocks only if recent (stale >15 min = call dropped, retryable);
      // a 'pending' row blocks only if recent (stale >5 min = server crashed mid-gen, retryable);
      // a 'failed' daily-limit row blocks for the rest of the day (no point retrying).
      const callingCutoff = new Date(now.getTime() - STALE_CALLING_MS).toISOString();
      const pendingCutoff = new Date(now.getTime() - STALE_PENDING_MS).toISOString();
      const alreadyCalled = findTodaysBlockingBriefing(db, user.id, userToday, callingCutoff, pendingCutoff);

      if (alreadyCalled) continue;

      const deltaMins = userMinutes - callMinutes;
      console.log(
        `[scheduler] Calling user ${user.id} (${user.name}) — scheduled ${user.call_time} ${timezone}` +
        (deltaMins > 0 ? `, ${deltaMins}min late (cold-start/missed-tick catch-up)` : ' (on time)'),
      );
      const scheduledFor = `${userToday}T${user.call_time}:00`;
      await scheduleBriefingCall(user.id);
      callAttemptQueries.record(user.id, scheduledFor, 'connected');
    } catch (err) {
      console.error(`[scheduler] Failed to call user ${user.id} (${user.name}):`, err);
      const userToday2 = new Date(now.toLocaleString('en-US', { timeZone: user.timezone || 'America/Vancouver' })).toLocaleDateString('en-CA');
      callAttemptQueries.record(user.id, `${userToday2}T${user.call_time}:00`, 'failed', String(err).slice(0, 500));
    }
  }

  // DB-flagged retries: missed calls whose retry_after timestamp has now passed.
  // This is the durable retry path — survives server restarts unlike the old in-memory setTimeout.
  const pendingRetries = db.prepare(`
    SELECT id, user_id FROM briefings
    WHERE status = 'missed'
    AND retry_attempted = 1
    AND retry_after IS NOT NULL
    AND retry_after <= datetime('now')
  `).all() as Array<{ id: number; user_id: number }>;

  for (const row of pendingRetries) {
    try {
      // Clear retry_after first so we don't double-fire on the next tick.
      db.prepare('UPDATE briefings SET retry_after = NULL WHERE id = ?').run(row.id);
      console.log(`[scheduler] Firing DB-flagged retry for briefing ${row.id} (user ${row.user_id})`);
      await scheduleBriefingCall(row.user_id, { force: true });
    } catch (err) {
      console.error(`[scheduler] DB-flagged retry failed for briefing ${row.id} (user ${row.user_id}):`, err);
      // Write to dead-letter queue — all retries exhausted for this briefing.
      failedWebhookQueries.record(row.user_id, null, row.id, String(err));
    }
  }
}

// T4-2 — Lightweight Vapi API health probe. Makes a GET to the phone-number list endpoint
// (cheapest authenticated call). Returns true if reachable (2xx), false otherwise.
// Used before initiating calls so a service outage fails fast with a user notification.
async function pingVapiHealth(): Promise<boolean> {
  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) return true; // no key = dev/test mode, skip check
  try {
    const res = await fetch('https://api.vapi.ai/phone-number', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000), // 8-second timeout
    });
    return res.ok || res.status === 404; // 404 = no numbers, but API is reachable
  } catch {
    return false;
  }
}

export async function scheduleBriefingCall(userId: number, opts: { force?: boolean } = {}) {
  const user = userQueries.findById(userId);
  if (!user) throw new Error('User not found');

  const tz = effectiveTimezone(user);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  if (opts.force) {
    // Explicit user request ("Call me now" / report-missed-call): bypass the once-a-day
    // guard — the user is telling us they want a call now (e.g. an earlier call was wrongly
    // marked completed after hitting voicemail). Still block a genuine double-click: refuse
    // only if a call actually started in the last 3 minutes.
    const recentCutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const inFlight = getDb().prepare(
      `SELECT 1 FROM briefings WHERE user_id = ? AND status = 'calling' AND scheduled_for >= ?`
    ).get(userId, recentCutoff);
    if (inFlight) throw new CallError('A call is already dialing — give it a moment.', 'already_called');
  } else {
    // Auto-scheduler / non-forced: a COMPLETED call always blocks; a 'calling' row blocks
    // only if recent (stale >15 min = dropped call, retryable); a 'pending' row blocks only
    // if recent (stale >5 min = server crashed mid-gen, retryable); a failed daily-limit row
    // blocks for the rest of the day — no point retrying and burning more LLM calls.
    const callingCutoff = new Date(Date.now() - STALE_CALLING_MS).toISOString();
    const pendingCutoff = new Date(Date.now() - STALE_PENDING_MS).toISOString();
    const existing = findTodaysBlockingBriefing(getDb(), userId, today, callingCutoff, pendingCutoff);
    if (existing) {
      if (existing.status === 'failed' && existing.error_code === 'vapi_daily_limit') {
        throw new CallError(
          'Daily call limit reached on this number — the free-tier cap has been hit. Calls will resume tomorrow, or upgrade to a paid Vapi number.',
          'vapi_daily_limit',
        );
      }
      const msg = existing.status === 'completed'
        ? "You already had a call today — use the open call to chat with Edge now."
        : existing.status === 'calling'
        ? "A call is already in progress. Check back in a moment."
        : "A briefing is being prepared — please wait a moment.";
      throw new CallError(msg, 'already_called');
    }
  }

  const now = new Date();
  const scheduledFor = now.toISOString();

  // Claim the call slot NOW — before the slow briefing generation — so a second cron tick
  // (which starts ~60s later) sees this 'pending' row and bails instead of generating a
  // duplicate call. If generation fails, we mark it 'failed'; if the server crashes mid-gen,
  // the row becomes stale after STALE_PENDING_MS and the slot is released for retry.
  const result = briefingQueries.createPending(userId, scheduledFor) as { lastInsertRowid: number };
  const briefingId = result.lastInsertRowid;

  // Guard briefing generation — a gen failure must not surface as an unhandled 500.
  let briefingContent: string;
  try {
    console.log(`[scheduler] Generating briefing for ${user.name}...`);
    briefingContent = await generateDailyBriefing(userId);
  } catch (err) {
    console.error(`[scheduler] Briefing generation failed for user ${userId}:`, err);
    briefingQueries.update(briefingId, { status: 'failed', error_code: 'briefing_gen_failed' });
    throw new CallError(
      'Briefing generation failed — please try again shortly.',
      'briefing_gen_failed',
    );
  }

  // Write the generated content into the already-claimed row.
  briefingQueries.updateContent(briefingId, briefingContent);

  const phoneNumber = user.phone_number;
  if (phoneNumber && process.env.VAPI_API_KEY) {
    briefingQueries.update(briefingId, { status: 'calling' });

    // R19 T1 — first-call detection keys off completed calls, not memories: memory extraction
    // can fail silently, but a completed briefing is the true "we've spoken before" signal.
    const isFirstCall = briefingQueries.countCompleted(userId) === 0;

    // T4-2 — Pre-call Vapi health check: ping Vapi API before generating the briefing
    // call so a service outage fails fast with a user notification instead of wasting
    // a full LLM gen call that can never be delivered.
    // Non-blocking: a ping failure (network hiccup, transient timeout) must not suppress
    // a call that might succeed — the real error will surface from initiateCall instead.
    const vapiHealthy = await pingVapiHealth();
    if (!vapiHealthy) {
      console.warn(`[scheduler] Vapi health ping failed for user ${userId} — proceeding anyway (ping ≠ transport)`);
    }

    // Guard Vapi call — classify the error (daily cap vs service failure) for the dashboard.
    try {
      console.log(`[scheduler] Initiating Vapi call for ${user.name} (isFirstCall=${isFirstCall})...`);
      // R25 T1 — briefing calls get the same rich live memory block as open calls (all facts +
      // open loops + recent call notes), so Edge knows people who aren't on today's calendar.
      const call = await initiateCall(phoneNumber, briefingContent, user.name, isFirstCall, effectiveTimezone(user), false, currentPrioritiesText(userId), currentOpenCallMemoryText(userId), await currentWhoopText(userId), user.call_time || '', await currentEnergyText(userId), user.voice_preference === 'aria' ? 'aria' : 'daniel', (user.voice_speed === 'slow' || user.voice_speed === 'fast' ? user.voice_speed : 'default'), null, user.language || 'en', userQueries.getWorkSchedule(userId) ?? '');
      console.log(`[scheduler] Vapi call initiated for ${user.name}: ${call.id}`);
      if (call.id) briefingQueries.update(briefingId, { vapi_call_id: call.id });
    } catch (err) {
      console.error(`[scheduler] Vapi call failed for user ${userId}:`, err);
      const callErr = classifyVapiError(err);
      briefingQueries.update(briefingId, { status: 'failed', error_code: callErr.code });
      // Write a notification so the user sees the failure in the dashboard.
      try {
        notificationQueries.create(
          userId,
          'call_failed',
          "Edge couldn't place your call this morning",
          callErr.userMessage,
        );
      } catch { /* best effort */ }
      throw callErr;
    }
  } else {
    console.log(`[scheduler] Skipping call for ${user.name} — no phone or Vapi key`);
  }

  return briefingId;
}

// Open call: an on-demand, no-briefing conversation. We still create a briefing record so the
// webhook, transcript, memory extraction, and live calendar tools can tie back to the call.
export async function scheduleOpenCall(userId: number) {
  const user = userQueries.findById(userId);
  if (!user) throw new Error('User not found');

  // Guard against double-tap: refuse if a call started in the last 3 minutes.
  // Without this, a user double-clicking "Open Call" spawns two concurrent Vapi calls.
  const recentCutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  const inFlight = getDb().prepare(
    `SELECT 1 FROM briefings WHERE user_id = ? AND status = 'calling' AND scheduled_for >= ?`
  ).get(userId, recentCutoff);
  if (inFlight) throw new CallError('A call is already in progress — give it a moment.', 'already_called');

  const timezone = effectiveTimezone(user);
  const scheduledFor = new Date().toISOString();

  const hour = parseInt(new Date().toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }));
  const greet = greetingEn(hour);
  const greetYue = greetingYue(hour);
  const period = dayPeriod(hour); // 'morning' | 'afternoon' | 'evening' — keeps the gratitude opener time-accurate
  const firstName = user.name.split(' ')[0];
  const isCantonese = (user.language || 'en') === 'yue';

  // R20 — gratitude mode: the open call becomes a warm 3-minute gratitude check-in.
  const isGratitude = user.gratitude_mode === 1;
  let opener = isCantonese
    ? `${greetYue}，${firstName}！我係 Edge——有咩想傾？`
    : `${greet}, ${firstName}. It's Edge — I'm all yours. What's on your mind?`;
  let gratitudePrompt: string | null = null;
  if (isGratitude) {
    // Build TTS-safe date: "Monday June 22" — no commas (cause Azure pauses), no year (garbles).
    const _d = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));
    const _days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const _months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const dateStr = `${_days[_d.getDay()]} ${_months[_d.getMonth()]} ${_d.getDate()}`;
    // Today-only — no forecast/tomorrow. Returns null on failure so weather is silently omitted.
    const weatherStr = await getWeatherToday().catch(() => null);
    // R21 — optional themed daily quote at the top of the gratitude call. Degrade safely.
    const { quoteEnabled, quoteTheme } = (() => {
      try { return userQueries.getGratitudeQuote(userId); }
      catch { return { quoteEnabled: false, quoteTheme: 'resilience' }; }
    })();
    // R25 T2 — celebrate a strong recovery/sleep score at the top of the gratitude call.
    const rec = await getLatestRecovery(userId).catch(() => null);
    const recoveryScore = rec?.recoveryScore ?? null;
    // R27 + R19 hotfix — pass time-aware greeting AND rich memory so Edge knows people mid-gratitude
    const gratGreeting = isCantonese ? greetYue : greet;
    gratitudePrompt = buildGratitudeSystemPrompt(firstName, dateStr, weatherStr, quoteEnabled, quoteTheme, user.language || 'en', recoveryScore, gratGreeting, period, currentOpenCallMemoryText(userId));
    const weatherPhrase = weatherStr ? ` ${weatherStr}.` : '';
    opener = isCantonese
      ? `${greetYue} ${firstName}！今日係 ${dateStr}。${weatherPhrase}你今日點呀？`
      : `${greet} ${firstName}! Today is ${dateStr}.${weatherPhrase} How are you doing this ${period}?`;
  }

  const result = briefingQueries.create(userId, `[Open call] ${opener}`, scheduledFor) as { lastInsertRowid: number };
  const briefingId = result.lastInsertRowid;
  // R12 T4 (Core, cross-lane additive): flag as an open call so Momentum scores it
  // distinctly from scheduled morning briefings.
  try { briefingQueries.markOpenCall(briefingId); } catch { /* non-fatal — defaults to 0 */ }

  const phoneNumber = user.phone_number;
  if (phoneNumber && process.env.VAPI_API_KEY) {
    briefingQueries.update(briefingId, { status: 'calling' });

    // R19 T1 — first-call detection keys off completed calls, not memories: memory extraction
    // can fail silently, but a completed briefing is the true "we've spoken before" signal.
    const isFirstCall = briefingQueries.countCompleted(userId) === 0;

    try {
      console.log(isGratitude ? `[scheduler] Gratitude call for ${user.name}` : `[scheduler] Initiating OPEN call for ${user.name}...`);
      // R23 T1 — open calls get briefing-quality memory (all fact categories + open loops + recent
      // call notes), not just 10 preference facts. Passed as preferencesText (rendered under MEMORY).
      const call = await initiateCall(phoneNumber, opener, user.name, isFirstCall, timezone, true, currentPrioritiesText(userId), currentOpenCallMemoryText(userId), await currentWhoopText(userId), user.call_time || '', await currentEnergyText(userId), user.voice_preference === 'aria' ? 'aria' : 'daniel', (user.voice_speed === 'slow' || user.voice_speed === 'fast' ? user.voice_speed : 'default'), gratitudePrompt, user.language || 'en', userQueries.getWorkSchedule(userId) ?? '');
      console.log(`[scheduler] Vapi open call initiated for ${user.name}: ${call.id}`);
      if (call.id) briefingQueries.update(briefingId, { vapi_call_id: call.id });
    } catch (err) {
      console.error(`[scheduler] Vapi open call failed for user ${userId}:`, err);
      const callErr = classifyVapiError(err);
      briefingQueries.update(briefingId, { status: 'failed', error_code: callErr.code });
      throw callErr;
    }
  } else {
    console.log(`[scheduler] Skipping open call for ${user.name} — no phone or Vapi key`);
  }

  return briefingId;
}
