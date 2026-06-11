import cron from 'node-cron';
import { format } from 'date-fns';
import { getDb } from './db';
import { generateDailyBriefing, getWeekOf } from './briefing';
import { initiateCall } from './vapi';
import { briefingQueries, userQueries, priorityQueries, effectiveTimezone, User } from './db';

// How long after call_time we'll still fire if the exact-minute tick was missed
// (e.g. server restart during that minute). Capped so a long outage doesn't
// place a morning briefing call in the afternoon.
const CALL_GRACE_MINUTES = 120;

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

let schedulerRunning = false;

export function startScheduler() {
  if (schedulerRunning) return;
  schedulerRunning = true;

  // Check every minute if any users need a call
  cron.schedule('* * * * *', async () => {
    await checkAndInitiateCalls(new Date());
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

      // Check if already called today (in user's local date)
      const alreadyCalled = db.prepare(`
        SELECT 1 FROM briefings
        WHERE user_id = ?
        AND scheduled_for LIKE ?
        AND status IN ('calling', 'completed')
      `).get(user.id, `${userToday}%`);

      if (alreadyCalled) continue;

      console.log(`[scheduler] Calling user ${user.id} (${user.name}) at ${userCurrentTime} ${timezone}`);
      await scheduleBriefingCall(user.id);
    } catch (err) {
      console.error(`[scheduler] Failed to call user ${user.id} (${user.name}):`, err);
    }
  }
}

export async function scheduleBriefingCall(userId: number) {
  const user = userQueries.findById(userId);
  if (!user) throw new Error('User not found');

  const now = new Date();
  const scheduledFor = now.toISOString();

  console.log(`[scheduler] Generating briefing for ${user.name}...`);
  const briefingContent = await generateDailyBriefing(userId);

  // Create briefing record
  const result = briefingQueries.create(userId, briefingContent, scheduledFor) as { lastInsertRowid: number };
  const briefingId = result.lastInsertRowid;

  const phoneNumber = user.phone_number;
  if (phoneNumber && process.env.VAPI_API_KEY) {
    briefingQueries.update(briefingId, { status: 'calling' });

    const { memoryQueries } = await import('./db');
    const recentMemories = memoryQueries.getRecent(userId, 1);
    const isFirstCall = recentMemories.filter(m => m.type !== 'profile').length === 0;

    console.log(`[scheduler] Initiating Vapi call for ${user.name} (isFirstCall=${isFirstCall})...`);
    const call = await initiateCall(phoneNumber, briefingContent, user.name, isFirstCall, effectiveTimezone(user), false, currentPrioritiesText(userId));
    console.log(`[scheduler] Vapi call initiated for ${user.name}: ${call.id}`);

    const callId = call.id;
    if (callId) briefingQueries.update(briefingId, { vapi_call_id: callId });
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

    console.log(`[scheduler] Initiating OPEN call for ${user.name}...`);
    const call = await initiateCall(phoneNumber, opener, user.name, isFirstCall, timezone, true, currentPrioritiesText(userId));
    console.log(`[scheduler] Vapi open call initiated for ${user.name}: ${call.id}`);

    if (call.id) briefingQueries.update(briefingId, { vapi_call_id: call.id });
  } else {
    console.log(`[scheduler] Skipping open call for ${user.name} — no phone or Vapi key`);
  }

  return briefingId;
}
