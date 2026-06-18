/**
 * T3-4 — Account-deletion cascade tests (real in-memory better-sqlite3, foreign_keys=ON).
 *
 * Two guarantees:
 *  1. DRIFT GUARD: every table in the live schema that has a `user_id` column is listed in
 *     USER_SCOPED_DELETE_ORDER. If someone adds a user-scoped table and forgets the deletion
 *     route, this test fails — which is exactly how the support_messages / fact_history gaps
 *     were found. This is the test that keeps account deletion complete over time.
 *  2. CASCADE CLEAN: deleteUserData removes all of the target user's rows and the users row
 *     under foreign_keys=ON (no FK constraint error), while a bystander user's data survives.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

const ORIGINAL_DB_PATH = process.env.DB_PATH;
process.env.DB_PATH = ':memory:';

const { getDb, deleteUserData, USER_SCOPED_DELETE_ORDER } = await import('./db');

afterAll(() => {
  if (ORIGINAL_DB_PATH === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = ORIGINAL_DB_PATH;
});

// All live tables that carry a user_id column, discovered from the real schema.
function tablesWithUserId(): string[] {
  const db = getDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
  const out: string[] = [];
  for (const { name } of tables) {
    const cols = db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>;
    if (cols.some(c => c.name === 'user_id')) out.push(name);
  }
  return out;
}

function makeUser(id: number, email: string): void {
  getDb().prepare(
    "INSERT INTO users (id, email, name, password_hash, onboarding_complete) VALUES (?, ?, ?, 'x', 1)",
  ).run(id, email, `User${id}`);
}

describe('T3-4 drift guard — deletion list covers every user-scoped table', () => {
  beforeEach(() => { getDb(); });

  it('every table with a user_id column is in USER_SCOPED_DELETE_ORDER', () => {
    const live = tablesWithUserId().filter(t => t !== 'users');
    const covered = new Set(USER_SCOPED_DELETE_ORDER);
    const missing = live.filter(t => !covered.has(t));
    expect(missing, `user-scoped tables missing from USER_SCOPED_DELETE_ORDER: ${missing.join(', ')}`).toEqual([]);
  });

  it('lists no table that lacks a user_id column (no dead entries)', () => {
    const live = new Set(tablesWithUserId());
    const dead = USER_SCOPED_DELETE_ORDER.filter(t => !live.has(t));
    expect(dead, `deletion list has entries with no user_id column: ${dead.join(', ')}`).toEqual([]);
  });
});

describe('T3-4 cascade clean — deleteUserData', () => {
  beforeEach(() => {
    const db = getDb();
    // Fresh state: wipe every user-scoped table + users between tests.
    for (const t of USER_SCOPED_DELETE_ORDER) db.prepare(`DELETE FROM ${t}`).run();
    db.prepare('DELETE FROM users').run();
  });

  it('deletes the target user and all their child rows, leaving the bystander intact', () => {
    const db = getDb();
    makeUser(1, 'target@test.com');
    makeUser(2, 'bystander@test.com');

    // Seed a representative spread of child tables (incl. the just-fixed gaps + FK-ordered ones)
    // for BOTH users, so we prove scoping and FK-safe ordering at once.
    const seed = (uid: number) => {
      db.prepare("INSERT INTO tasks (user_id, text, date, source) VALUES (?, 't', '2026-06-18', 'manual')").run(uid);
      db.prepare("INSERT INTO facts (user_id, category, statement) VALUES (?, 'goal', 's')").run(uid);
      db.prepare("INSERT INTO fact_history (fact_id, user_id, statement, category) VALUES (1, ?, 's', 'goal')").run(uid);
      db.prepare("INSERT INTO support_messages (user_id, type, message) VALUES (?, 'question', 'help')").run(uid);
      db.prepare("INSERT INTO briefings (user_id, content, scheduled_for) VALUES (?, 'c', '2026-06-18T07:00:00')").run(uid);
      db.prepare("INSERT INTO notifications (user_id, type, created_at) VALUES (?, 'call_failed', 0)").run(uid);
      db.prepare("INSERT INTO call_attempts (user_id, scheduled_for, status) VALUES (?, '2026-06-18T07:00:00', 'connected')").run(uid);
      db.prepare("INSERT INTO briefing_context_packs (user_id, pack_date, context_pack) VALUES (?, '2026-06-18', 'ctx')").run(uid);
      db.prepare("INSERT INTO episodes (user_id, source, occurred_at, content_raw) VALUES (?, 'call', '2026-06-18', 'raw')").run(uid);
    };
    seed(1);
    seed(2);

    // Must not throw — proves FK ordering is correct with foreign_keys=ON.
    expect(() => deleteUserData(1)).not.toThrow();

    // Target user fully gone.
    expect(db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = 1').get()).toEqual({ n: 0 });
    for (const t of ['tasks', 'facts', 'fact_history', 'support_messages', 'briefings', 'notifications', 'call_attempts', 'briefing_context_packs', 'episodes']) {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = 1`).get() as { n: number };
      expect(row.n, `${t} should have 0 rows for deleted user`).toBe(0);
    }

    // Bystander untouched.
    expect(db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = 2').get()).toEqual({ n: 1 });
    expect((db.prepare('SELECT COUNT(*) AS n FROM facts WHERE user_id = 2').get() as { n: number }).n).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM support_messages WHERE user_id = 2').get() as { n: number }).n).toBe(1);
  });

  it('is a no-op (no throw) for a user with no data', () => {
    makeUser(3, 'empty@test.com');
    expect(() => deleteUserData(3)).not.toThrow();
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM users WHERE id = 3').get()).toEqual({ n: 0 });
  });
});
