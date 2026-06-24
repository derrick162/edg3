/**
 * R30 T2 — "Call me now" produces an in-app notification (survives navigating away, unlike the
 * old dismissible browser alert). Real in-memory DB so the actual insert + read path is exercised.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

process.env.DB_PATH = ':memory:';

const { getDb, notificationQueries } = await import('./db');
const { createCallInitiatedNotif } = await import('./notifications');

afterAll(() => { delete process.env.DB_PATH; });

function makeUser(): void {
  getDb().prepare("INSERT INTO users (id, email, name, password_hash, onboarding_complete) VALUES (1, 'd@e.com', 'Derrick', 'x', 1)").run();
}

beforeEach(() => {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  for (const t of ['notifications', 'users']) { try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore */ } }
  db.pragma('foreign_keys = ON');
  makeUser();
});

describe('R30 T2 — createCallInitiatedNotif', () => {
  it('creates a call_initiated notification for the user', () => {
    createCallInitiatedNotif(1);
    const notifs = notificationQueries.listRecent(1);
    expect(notifs).toHaveLength(1);
    expect(notifs[0].type).toBe('call_initiated');
    expect(notifs[0].title).toContain('Edge is calling you');
  });

  it('is user-scoped — does not leak to another user', () => {
    createCallInitiatedNotif(1);
    expect(notificationQueries.listRecent(2)).toHaveLength(0);
  });

  it('never throws (fire-and-forget) for an unknown user', () => {
    expect(() => createCallInitiatedNotif(99999)).not.toThrow();
  });
});
