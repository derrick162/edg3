import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// On Railway, use the mounted volume at /data. Locally, use ./data
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'edg3.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      profile_summary TEXT,
      call_time TEXT DEFAULT '07:00',
      timezone TEXT DEFAULT 'America/New_York',
      onboarding_complete INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS priorities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      text TEXT NOT NULL,
      week_of TEXT NOT NULL,
      rank INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL CHECK(type IN ('profile','transcript','recommendation','insight','calendar_note')),
      content TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS briefings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      content TEXT NOT NULL,
      vapi_call_id TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','calling','completed','failed','missed')),
      scheduled_for TEXT NOT NULL,
      transcript TEXT,
      user_response TEXT,
      retry_attempted INTEGER DEFAULT 0,
      calendar_actions TEXT,
      edge_promises TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calendar_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expiry TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      text TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      completed_at TEXT,
      source TEXT DEFAULT 'manual' CHECK(source IN ('manual', 'edg3')),
      date TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Indexes for performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_priorities_user_id ON priorities(user_id);
    CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);
    CREATE INDEX IF NOT EXISTS idx_briefings_user_id ON briefings(user_id);
    CREATE INDEX IF NOT EXISTS idx_briefings_vapi_call_id ON briefings(vapi_call_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
  `);

  // Migrations for existing databases
  const migrations = [
    "ALTER TABLE briefings ADD COLUMN retry_attempted INTEGER DEFAULT 0",
    "ALTER TABLE briefings ADD COLUMN calendar_actions TEXT",
    "ALTER TABLE briefings ADD COLUMN edge_promises TEXT",
    "ALTER TABLE users ADD COLUMN phone_number TEXT",
  ];
  for (const migration of migrations) {
    try { db.exec(migration); } catch { /* column already exists */ }
  }
}

// User queries
export const userQueries = {
  create: (email: string, name: string, passwordHash: string) => {
    return getDb().prepare(
      'INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)'
    ).run(email, name, passwordHash);
  },
  findByEmail: (email: string) => {
    return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email) as User | undefined;
  },
  findById: (id: number) => {
    return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
  },
  updateProfile: (id: number, profileSummary: string) => {
    return getDb().prepare('UPDATE users SET profile_summary = ? WHERE id = ?').run(profileSummary, id);
  },
  updateCallTime: (id: number, callTime: string, timezone: string) => {
    return getDb().prepare('UPDATE users SET call_time = ?, timezone = ? WHERE id = ?').run(callTime, timezone, id);
  },
  completeOnboarding: (id: number) => {
    return getDb().prepare('UPDATE users SET onboarding_complete = 1 WHERE id = ?').run(id);
  },
};

// Priority queries
export const priorityQueries = {
  create: (userId: number, text: string, weekOf: string, rank: number) => {
    return getDb().prepare(
      'INSERT INTO priorities (user_id, text, week_of, rank) VALUES (?, ?, ?, ?)'
    ).run(userId, text, weekOf, rank);
  },
  getThisWeek: (userId: number, weekOf: string) => {
    return getDb().prepare(
      'SELECT * FROM priorities WHERE user_id = ? AND week_of = ? ORDER BY rank'
    ).all(userId, weekOf) as Priority[];
  },
  deleteThisWeek: (userId: number, weekOf: string) => {
    return getDb().prepare('DELETE FROM priorities WHERE user_id = ? AND week_of = ?').run(userId, weekOf);
  },
};

// Memory queries
export const memoryQueries = {
  create: (userId: number, type: string, content: string, metadata?: string) => {
    return getDb().prepare(
      'INSERT INTO memories (user_id, type, content, metadata) VALUES (?, ?, ?, ?)'
    ).run(userId, type, content, metadata || null);
  },
  getRecent: (userId: number, limit = 20) => {
    return getDb().prepare(
      'SELECT * FROM memories WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(userId, limit) as Memory[];
  },
  getWeighted: (userId: number, limit = 20) => {
    const db = getDb();
    // Priority: explicit user notes and priority changes always first,
    // then recent insights, then transcripts (deduped to avoid noise)
    const high = db.prepare(
      `SELECT * FROM memories WHERE user_id = ? AND (
        content LIKE '%[USER NOTE]%' OR
        content LIKE '%[PRIORITY CHANGE]%' OR
        content LIKE '%[TRAVEL TIMEZONE]%'
      ) ORDER BY created_at DESC LIMIT 10`
    ).all(userId) as Memory[];

    const insights = db.prepare(
      `SELECT * FROM memories WHERE user_id = ? AND type = 'insight'
       ORDER BY created_at DESC LIMIT 8`
    ).all(userId) as Memory[];

    const recent = db.prepare(
      `SELECT * FROM memories WHERE user_id = ? AND type NOT IN ('profile', 'transcript')
       AND content NOT LIKE '%[USER NOTE]%'
       AND content NOT LIKE '%[PRIORITY CHANGE]%'
       AND content NOT LIKE '%[TRAVEL TIMEZONE]%'
       ORDER BY created_at DESC LIMIT 5`
    ).all(userId) as Memory[];

    // Deduplicate by id and return up to limit
    const seen = new Set<number>();
    const result: Memory[] = [];
    for (const m of [...high, ...insights, ...recent]) {
      if (!seen.has(m.id) && result.length < limit) {
        seen.add(m.id);
        result.push(m);
      }
    }
    return result;
  },
  getByType: (userId: number, type: string, limit = 10) => {
    return getDb().prepare(
      'SELECT * FROM memories WHERE user_id = ? AND type = ? ORDER BY created_at DESC LIMIT ?'
    ).all(userId, type, limit) as Memory[];
  },
  searchContent: (userId: number, keyword: string) => {
    return getDb().prepare(
      "SELECT * FROM memories WHERE user_id = ? AND content LIKE ? ORDER BY created_at DESC LIMIT 10"
    ).all(userId, `%${keyword}%`) as Memory[];
  },
  countTopicMentions: (userId: number, keyword: string, days = 30) => {
    const result = getDb().prepare(
      "SELECT COUNT(*) as count FROM memories WHERE user_id = ? AND content LIKE ? AND created_at >= datetime('now', ?)"
    ).get(userId, `%${keyword}%`, `-${days} days`) as { count: number };
    return result.count;
  },
};

// Briefing queries
export const briefingQueries = {
  create: (userId: number, content: string, scheduledFor: string) => {
    return getDb().prepare(
      'INSERT INTO briefings (user_id, content, scheduled_for) VALUES (?, ?, ?)'
    ).run(userId, content, scheduledFor);
  },
  update: (id: number, data: Partial<Briefing>) => {
    const ALLOWED_FIELDS = new Set(['status', 'transcript', 'user_response', 'vapi_call_id', 'retry_attempted']);
    const entries = Object.entries(data).filter(([k]) => ALLOWED_FIELDS.has(k));
    if (!entries.length) return;
    const fields = entries.map(([k]) => `${k} = ?`).join(', ');
    const values = entries.map(([, v]) => v);
    return getDb().prepare(`UPDATE briefings SET ${fields} WHERE id = ?`).run(...values, id);
  },
  getRecent: (userId: number, limit = 10) => {
    return getDb().prepare(
      'SELECT * FROM briefings WHERE user_id = ? ORDER BY scheduled_for DESC LIMIT ?'
    ).all(userId, limit) as Briefing[];
  },
  getLatest: (userId: number) => {
    return getDb().prepare(
      'SELECT * FROM briefings WHERE user_id = ? ORDER BY scheduled_for DESC LIMIT 1'
    ).get(userId) as Briefing | undefined;
  },
};

// Calendar token queries
export const calendarQueries = {
  upsert: (userId: number, accessToken: string, refreshToken: string, expiry: string) => {
    return getDb().prepare(`
      INSERT INTO calendar_tokens (user_id, access_token, refresh_token, expiry, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expiry = excluded.expiry,
        updated_at = excluded.updated_at
    `).run(userId, accessToken, refreshToken, expiry);
  },
  get: (userId: number) => {
    return getDb().prepare('SELECT * FROM calendar_tokens WHERE user_id = ?').get(userId) as CalendarToken | undefined;
  },
};

// Task queries
export const taskQueries = {
  create: (userId: number, text: string, date: string, source: 'manual' | 'edg3' = 'manual') => {
    const existing = getDb().prepare(
      'SELECT id FROM tasks WHERE user_id = ? AND text = ? AND date = ?'
    ).get(userId, text, date);
    if (existing) return existing;
    return getDb().prepare(
      'INSERT INTO tasks (user_id, text, date, source) VALUES (?, ?, ?, ?)'
    ).run(userId, text, date, source);
  },
  getForDate: (userId: number, date: string) => {
    return getDb().prepare(
      'SELECT * FROM tasks WHERE user_id = ? AND date = ? ORDER BY source DESC, created_at ASC'
    ).all(userId, date) as Task[];
  },
  getRecent: (userId: number, days = 7) => {
    return getDb().prepare(
      "SELECT * FROM tasks WHERE user_id = ? AND date >= date('now', ?) ORDER BY date DESC, created_at ASC"
    ).all(userId, `-${days} days`) as Task[];
  },
  complete: (id: number, userId: number) => {
    return getDb().prepare(
      "UPDATE tasks SET completed = 1, completed_at = datetime('now') WHERE id = ? AND user_id = ?"
    ).run(id, userId);
  },
  uncomplete: (id: number, userId: number) => {
    return getDb().prepare(
      'UPDATE tasks SET completed = 0, completed_at = NULL WHERE id = ? AND user_id = ?'
    ).run(id, userId);
  },
  delete: (id: number, userId: number) => {
    return getDb().prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(id, userId);
  },
  getIncomplete: (userId: number) => {
    return getDb().prepare(
      "SELECT * FROM tasks WHERE user_id = ? AND completed = 0 AND date >= date('now', '-1 days') ORDER BY date ASC"
    ).all(userId) as Task[];
  },
};

// Types
export interface User {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  profile_summary: string | null;
  call_time: string;
  timezone: string;
  onboarding_complete: number;
  phone_number: string | null;
  created_at: string;
}

export interface Priority {
  id: number;
  user_id: number;
  text: string;
  week_of: string;
  rank: number;
  created_at: string;
}

export interface Memory {
  id: number;
  user_id: number;
  type: string;
  content: string;
  metadata: string | null;
  created_at: string;
}

export interface Briefing {
  id: number;
  user_id: number;
  content: string;
  vapi_call_id: string | null;
  status: string;
  scheduled_for: string;
  transcript: string | null;
  user_response: string | null;
  created_at: string;
}

export interface Task {
  id: number;
  user_id: number;
  text: string;
  completed: number;
  completed_at: string | null;
  source: string;
  date: string;
  created_at: string;
}

export interface CalendarToken {
  id: number;
  user_id: number;
  access_token: string;
  refresh_token: string | null;
  expiry: string | null;
  updated_at: string;
}
