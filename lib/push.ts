// R14 — Web Push (VAPID) sender. Best-effort: never throws to the caller, degrades silently
// when VAPID keys aren't configured (local dev / pre-Railway-setup), and self-heals by deleting
// subscriptions the browser has expired (410 Gone / 404 Not Found).
import webpush from 'web-push';
import { pushSubscriptionQueries } from './db';

const DEFAULT_SUBJECT = 'mailto:derrick@deltaedg3.com';

// Configure VAPID from env. Returns false (→ no-op send) when keys aren't set. Re-evaluated per
// call so a key set after boot is picked up, and so tests can toggle env between cases.
function configureVapid(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || DEFAULT_SUBJECT, publicKey, privateKey);
    return true;
  } catch (e) {
    console.error('[push] VAPID configuration failed:', (e as Error).message);
    return false;
  }
}

/**
 * Send a push notification to every device the user has subscribed. Best-effort:
 *  - no-op when VAPID keys are unset or the user has no subscriptions
 *  - expired endpoints (410/404) are deleted from the DB
 *  - any other per-endpoint error is logged, never thrown (push must not block the caller)
 */
export async function sendPushToUser(
  userId: number,
  notification: { title: string; body: string },
): Promise<void> {
  if (!configureVapid()) return; // VAPID not configured → silent no-op

  const subs = pushSubscriptionQueries.getAll(userId);
  if (!subs.length) return;

  const payload = JSON.stringify(notification);
  await Promise.allSettled(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 410 || code === 404) {
          // Subscription is dead (user cleared site data / unsubscribed in the browser) — clean up.
          pushSubscriptionQueries.delete(userId, s.endpoint);
        } else {
          console.error(`[push] sendNotification failed for user ${userId} (status ${code ?? '?'}):`, (err as Error).message);
        }
      }
    }),
  );
}
