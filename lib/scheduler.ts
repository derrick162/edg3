import cron from 'node-cron';
import { format } from 'date-fns';
import { getDb } from './db';
import { generateDailyBriefing } from './briefing';
import { initiateCall } from './vapi';
import { briefingQueries, userQueries } from './db';

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
  const currentTime = format(now, 'HH:mm');
  const today = format(now, 'yyyy-MM-dd');

  // Find users whose call time matches now and haven't been called today
  const usersToCall = db.prepare(`
    SELECT u.* FROM users u
    WHERE u.call_time = ?
    AND u.onboarding_complete = 1
    AND NOT EXISTS (
      SELECT 1 FROM briefings b
      WHERE b.user_id = u.id
      AND b.scheduled_for LIKE ?
      AND b.status IN ('calling', 'completed')
    )
  `).all(currentTime, `${today}%`) as any[];

  for (const user of usersToCall) {
    try {
      await scheduleBriefingCall(user.id);
    } catch (err) {
      console.error(`Failed to initiate call for user ${user.id}:`, err);
    }
  }
}

export async function scheduleBriefingCall(userId: number) {
  const user = userQueries.findById(userId);
  if (!user) throw new Error('User not found');

  const now = new Date();
  const scheduledFor = now.toISOString();

  // Generate briefing content
  const briefingContent = await generateDailyBriefing(userId);

  // Create briefing record
  const result = briefingQueries.create(userId, briefingContent, scheduledFor);
  const briefingId = (result as any).lastInsertRowid as number;

  // Only initiate call if phone number and Vapi are configured
  const phoneNumber = (user as any).phone_number;
  if (phoneNumber && process.env.VAPI_API_KEY) {
    briefingQueries.update(briefingId, { status: 'calling' });

    const call = await initiateCall(phoneNumber, briefingContent, user.name);
    console.log('Vapi call response:', JSON.stringify(call));
    const callId = call.id || (call as any).callId || (call as any).call?.id;
    if (callId) briefingQueries.update(briefingId, { vapi_call_id: callId });
  }

  return briefingId;
}
