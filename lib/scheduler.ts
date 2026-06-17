import cron from 'node-cron';
import { format } from 'date-fns';
import { getDb } from './db';
import { generateDailyBriefing, getWeekOf } from './briefing';
import { initiateCall } from './vapi';
import { getLatestRecovery, getLastSleep, getRecentStrain, getRecoveryHistory, getSleepHistory, getStrainHistory, whoopFreshnessNote, formatWhoopHistoryForCall } from './whoop';
import { briefingQueries, userQueries, priorityQueries, factQueries, energyLogQueries, openLoopQueries, watchedThreadQueries, oauthStateQueries, auditLogQueries, effectiveTimezone, User } from './db';
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
const CALL_GRACE_MINUTES = 120;

// A 'calling' briefing row older than this means the call was initiated but never
// completed (the end-webhook never arrived / the call didn't connect). Past this age it
// must NOT keep blocking the day's call — otherwise one silently-dropped call permanently
// suppresses every retry (auto + manual) for the rest of the day.
const STALE_CALLING_MS = 15 * 60 * 1000;

// A 'pending' row (claim-first slot) older than this is stale — the server must have
// crashed between createPending() and the Vapi call. Past this age the slot is released
// so the scheduler can retry instead of being permanently stuck.
const STALE_PENDING_MS = 5 * 60 * 1000;

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

// Up to 10 most-recent stored preference facts as bullet lines for the KNOWN PREFERENCES
// section of the live-call system prompt. Returns '' when none are stored.
function currentPreferencesText(userId: number): string {
  const prefs = factQueries.getByCategory(userId, 'preference');
  if (!prefs.length) return '';
  return prefs.slice(0, 10).map(p => `- ${p.statement}`).join('\n');
}

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

let schedulerRunning = false;

export function startScheduler() {
  if (schedulerRunning) return;
  schedulerRunning = true;

  // Check every minute if any users need a call
  cron.schedule('* * * * *', async () => {
    await checkAndInitiateCalls(new Date());
  });

  // Nightly at 3am UTC: retention prune for PII rows + daily DB snapshot (covers no-call days).
  cron.schedule('0 3 * * *', () => {
    try { openLoopQueries.prune(); } catch (e) { console.error('[scheduler] openLoopQueries.prune failed:', e); }
    try { watchedThreadQueries.prune(); } catch (e) { console.error('[scheduler] watchedThreadQueries.prune failed:', e); }
    try { oauthStateQueries.prune(); } catch (e) { console.error('[scheduler] oauthStateQueries.prune failed:', e); }
    try { auditLogQueries.pruneEmailSubjects(); } catch (e) { console.error('[scheduler] pruneEmailSubjects failed:', e); }
    maybeDailyBackup().catch(e => console.error('[scheduler] maybeDailyBackup failed:', e));
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
      const alreadyCalled = db.prepare(`
        SELECT 1 FROM briefings
        WHERE user_id = ?
        AND scheduled_for LIKE ?
        AND (
          status = 'completed'
          OR (status = 'calling' AND scheduled_for >= ?)
          OR (status = 'pending' AND scheduled_for >= ?)
          OR (status = 'failed' AND error_code = 'vapi_daily_limit')
        )
      `).get(user.id, `${userToday}%`, callingCutoff, pendingCutoff);

      if (alreadyCalled) continue;

      console.log(`[scheduler] Calling user ${user.id} (${user.name}) at ${userCurrentTime} ${timezone}`);
      await scheduleBriefingCall(user.id);
    } catch (err) {
      console.error(`[scheduler] Failed to call user ${user.id} (${user.name}):`, err);
    }
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
    const existing = getDb().prepare(
      `SELECT status, error_code FROM briefings WHERE user_id = ? AND scheduled_for LIKE ? AND (
        status = 'completed'
        OR (status = 'calling' AND scheduled_for >= ?)
        OR (status = 'pending' AND scheduled_for >= ?)
        OR (status = 'failed' AND error_code = 'vapi_daily_limit')
      ) ORDER BY scheduled_for DESC LIMIT 1`
    ).get(userId, `${today}%`, callingCutoff, pendingCutoff) as { status: string; error_code: string | null } | undefined;
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

    const { memoryQueries } = await import('./db');
    const recentMemories = memoryQueries.getRecent(userId, 1);
    const isFirstCall = recentMemories.filter(m => m.type !== 'profile').length === 0;

    // Guard Vapi call — classify the error (daily cap vs service failure) for the dashboard.
    try {
      console.log(`[scheduler] Initiating Vapi call for ${user.name} (isFirstCall=${isFirstCall})...`);
      const call = await initiateCall(phoneNumber, briefingContent, user.name, isFirstCall, effectiveTimezone(user), false, currentPrioritiesText(userId), currentPreferencesText(userId), await currentWhoopText(userId), user.call_time || '', await currentEnergyText(userId));
      console.log(`[scheduler] Vapi call initiated for ${user.name}: ${call.id}`);
      if (call.id) briefingQueries.update(briefingId, { vapi_call_id: call.id });
    } catch (err) {
      console.error(`[scheduler] Vapi call failed for user ${userId}:`, err);
      const callErr = classifyVapiError(err);
      briefingQueries.update(briefingId, { status: 'failed', error_code: callErr.code });
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
  const greet = hour >= 18 ? 'Good evening' : hour >= 12 ? 'Good afternoon' : 'Good morning';
  const firstName = user.name.split(' ')[0];
  const opener = `${greet}, ${firstName}. It's Edge — I'm all yours. What's on your mind?`;

  const result = briefingQueries.create(userId, `[Open call] ${opener}`, scheduledFor) as { lastInsertRowid: number };
  const briefingId = result.lastInsertRowid;

  const phoneNumber = user.phone_number;
  if (phoneNumber && process.env.VAPI_API_KEY) {
    briefingQueries.update(briefingId, { status: 'calling' });

    const { memoryQueries } = await import('./db');
    const recentMemories = memoryQueries.getRecent(userId, 1);
    const isFirstCall = recentMemories.filter(m => m.type !== 'profile').length === 0;

    try {
      console.log(`[scheduler] Initiating OPEN call for ${user.name}...`);
      const call = await initiateCall(phoneNumber, opener, user.name, isFirstCall, timezone, true, currentPrioritiesText(userId), currentPreferencesText(userId), await currentWhoopText(userId), user.call_time || '', await currentEnergyText(userId));
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
