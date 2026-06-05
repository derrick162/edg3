import cron from 'node-cron';
import { format } from 'date-fns';
import { getDb } from './db';
import { generateDailyBriefing } from './briefing';
import { initiateCall } from './vapi';
import { briefingQueries, userQueries, User } from './db';

let schedulerRunning = false;

export function startScheduler() {
  if (schedulerRunning) return;
  schedulerRunning = true;

  // Check every minute if any users need a call
  cron.schedule('* * * * *', async () => {
    await checkAndInitiateCalls();
  });

  console.log('EDG3 scheduler started');
}

async function checkAndInitiateCalls() {
  const db = getDb();
  const now = new Date();
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

      if (userCurrentTime !== user.call_time) continue;

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

  // Pre-call calendar check — silently fix duplicates before briefing
  try {
    const { deduplicateCalendarEvents } = await import('./calendar');
    const removed = await deduplicateCalendarEvents(userId, user.timezone);
    if (removed.length) console.log(`[scheduler] Pre-call dedup removed ${removed.length} events for ${user.name}`);
  } catch (err) {
    console.error(`[scheduler] Pre-call dedup failed:`, err);
  }

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
    const call = await initiateCall(phoneNumber, briefingContent, user.name, isFirstCall, user.timezone || 'America/Vancouver');
    console.log(`[scheduler] Vapi call initiated for ${user.name}: ${call.id}`);

    const callId = call.id;
    if (callId) briefingQueries.update(briefingId, { vapi_call_id: callId });
  } else {
    console.log(`[scheduler] Skipping call for ${user.name} — no phone or Vapi key`);
  }

  return briefingId;
}
