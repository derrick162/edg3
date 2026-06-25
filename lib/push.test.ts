/**
 * R14 T1 — sendPushToUser (lib/push.ts). web-push + db mocked; env toggled per case.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  subs: [] as Array<{ endpoint: string; p256dh: string; auth: string }>,
  userIds: [] as number[],
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(async () => ({})),
  del: vi.fn(),
}));

vi.mock('web-push', () => ({ default: { setVapidDetails: h.setVapidDetails, sendNotification: h.sendNotification } }));
vi.mock('./db', () => ({
  pushSubscriptionQueries: {
    getAll: (_id: number) => h.subs,
    delete: (id: number, ep: string) => h.del(id, ep),
    allUserIds: () => h.userIds,
  },
}));

const { sendPushToUser, sendPushToAllSubscribers } = await import('./push');

const ORIG = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY };
beforeEach(() => {
  vi.clearAllMocks();
  h.subs = [];
  h.userIds = [];
  process.env.VAPID_PUBLIC_KEY = 'test-pub';
  process.env.VAPID_PRIVATE_KEY = 'test-priv';
});
afterEach(() => {
  if (ORIG.pub === undefined) delete process.env.VAPID_PUBLIC_KEY; else process.env.VAPID_PUBLIC_KEY = ORIG.pub;
  if (ORIG.priv === undefined) delete process.env.VAPID_PRIVATE_KEY; else process.env.VAPID_PRIVATE_KEY = ORIG.priv;
});

describe('sendPushToUser', () => {
  it('no-op when the user has no subscriptions', async () => {
    h.subs = [];
    await sendPushToUser(1, { title: 'T', body: 'B' });
    expect(h.sendNotification).not.toHaveBeenCalled();
  });

  it('sends to every subscription with the JSON payload', async () => {
    h.subs = [
      { endpoint: 'e1', p256dh: 'k1', auth: 'a1' },
      { endpoint: 'e2', p256dh: 'k2', auth: 'a2' },
    ];
    await sendPushToUser(1, { title: 'Recovery Alert', body: 'low today' });
    expect(h.sendNotification).toHaveBeenCalledTimes(2);
    expect(h.sendNotification).toHaveBeenCalledWith(
      { endpoint: 'e1', keys: { p256dh: 'k1', auth: 'a1' } },
      JSON.stringify({ title: 'Recovery Alert', body: 'low today' }),
    );
  });

  it('deletes a subscription that returns 410 Gone', async () => {
    h.subs = [{ endpoint: 'dead', p256dh: 'k', auth: 'a' }];
    h.sendNotification.mockRejectedValueOnce(Object.assign(new Error('Gone'), { statusCode: 410 }));
    await sendPushToUser(7, { title: 'T', body: 'B' });
    expect(h.del).toHaveBeenCalledWith(7, 'dead');
  });

  it('also cleans up a 404 endpoint', async () => {
    h.subs = [{ endpoint: 'missing', p256dh: 'k', auth: 'a' }];
    h.sendNotification.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { statusCode: 404 }));
    await sendPushToUser(7, { title: 'T', body: 'B' });
    expect(h.del).toHaveBeenCalledWith(7, 'missing');
  });

  it('logs but does NOT delete on other errors, and never throws', async () => {
    h.subs = [{ endpoint: 'e', p256dh: 'k', auth: 'a' }];
    h.sendNotification.mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 500 }));
    await expect(sendPushToUser(1, { title: 'T', body: 'B' })).resolves.toBeUndefined();
    expect(h.del).not.toHaveBeenCalled();
  });

  it('degrades silently (no send) when VAPID keys are not configured', async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    h.subs = [{ endpoint: 'e', p256dh: 'k', auth: 'a' }];
    await sendPushToUser(1, { title: 'T', body: 'B' });
    expect(h.sendNotification).not.toHaveBeenCalled();
  });
});

describe('sendPushToAllSubscribers (S2 — health broadcast)', () => {
  it('fans out to every subscribed user (the simulated-failure alert path)', async () => {
    h.userIds = [1, 2];
    h.subs = [{ endpoint: 'e', p256dh: 'k', auth: 'a' }]; // each user resolves one device
    await sendPushToAllSubscribers({ title: 'Edg3 health: DEGRADED', body: '2 webhook(s) in DLQ' });
    // one send per user (each getAll returns the single mocked sub)
    expect(h.sendNotification).toHaveBeenCalledTimes(2);
    expect(h.sendNotification).toHaveBeenCalledWith(
      { endpoint: 'e', keys: { p256dh: 'k', auth: 'a' } },
      JSON.stringify({ title: 'Edg3 health: DEGRADED', body: '2 webhook(s) in DLQ' }),
    );
  });

  it('no-op when nobody is subscribed', async () => {
    h.userIds = [];
    await sendPushToAllSubscribers({ title: 'T', body: 'B' });
    expect(h.sendNotification).not.toHaveBeenCalled();
  });

  it('never throws even if a send rejects', async () => {
    h.userIds = [1];
    h.subs = [{ endpoint: 'e', p256dh: 'k', auth: 'a' }];
    h.sendNotification.mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 500 }));
    await expect(sendPushToAllSubscribers({ title: 'T', body: 'B' })).resolves.toBeUndefined();
  });
});
