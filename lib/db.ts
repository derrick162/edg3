import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { isValidTimeZone } from './time';
import { encryptField, encryptNullable, decryptField, decryptNullable } from './crypto';

// On Railway, use the mounted volume at /data. Locally, use ./data
export const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'edg3.db');

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
      energy_cost TEXT CHECK(energy_cost IN ('high', 'medium', 'low')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Daily energy signal: one row per user per day; source determines confidence.
    -- 'override' wins over 'whoop' (subjective felt-energy beats recovery score).
    CREATE TABLE IF NOT EXISTS energy_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      date       TEXT NOT NULL,
      level      TEXT NOT NULL CHECK(level IN ('red', 'yellow', 'green')),
      source     TEXT NOT NULL CHECK(source IN ('whoop', 'manual', 'override')),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, date)
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
      tool_actions TEXT,
      error_code TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calendar_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expiry TEXT,
      scope TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Append-only audit of Gmail drafts created on a user's behalf (draft-only;
    -- we never send). Recipient + subject are encrypted at rest (PII). Doubles as
    -- the source for the per-user anti-spam rate limit (count rows in a window).
    CREATE TABLE IF NOT EXISTS gmail_drafts_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      recipient TEXT,
      subject TEXT,
      draft_id TEXT,
      created_at INTEGER NOT NULL
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

    CREATE TABLE IF NOT EXISTS undo_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      label TEXT NOT NULL,
      payload TEXT NOT NULL,
      undone INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Outreach threads Edge drafted, watched for replies (email-reply tracking).
    -- Only threads Edge itself started are ever recorded here; recipient/context are PII
    -- (encrypted at rest, same field cipher as tokens/transcripts/#4).
    CREATE TABLE IF NOT EXISTS watched_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      thread_id TEXT NOT NULL,
      recipient TEXT,
      context TEXT,
      event_title TEXT,
      event_date TEXT,
      last_seen_message_id TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','handled','dismissed')),
      created_at INTEGER NOT NULL
    );

    -- In-app notification center. title/body can contain reply content → PII (encrypted at rest).
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL DEFAULT 'reply',
      title TEXT,
      body TEXT,
      read INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    -- IP-based rate limiting (#8). Fixed-window counters keyed by "{type}:{identifier}".
    -- Rows are self-expiring (expires_at checked on each access) and pruned opportunistically.
    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 1,
      window_start INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    -- Short-TTL dedupe keys for event-creation idempotency (#3). Rows expire after 5 min.
    -- The composite PRIMARY KEY enables an atomic INSERT OR IGNORE + changes-check pattern
    -- (no separate SELECT → no TOCTOU race even under concurrent calls).
    CREATE TABLE IF NOT EXISTS event_dedupe_keys (
      user_id INTEGER NOT NULL,
      dedupe_key TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, dedupe_key)
    );

    -- Vapi webhook/tool-call auth events (#2 telemetry). Only mismatches are recorded —
    -- accepted calls are not logged (high-volume). Used to verify Vapi sends the right
    -- secret during the 24h fail-open window before VAPI_SECRET_ENFORCE is flipped on.
    -- Capped at 1000 rows; pruned on each insert to stay lean.
    CREATE TABLE IF NOT EXISTS vapi_auth_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- One-time server-issued tokens for hard delete-confirmation (#9). The model must
    -- present a token it received from the server — it cannot mint one itself — closing
    -- the self-confirmation hole. Rows are purged opportunistically on each issue() call.
    CREATE TABLE IF NOT EXISTS delete_confirm_tokens (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    );

    -- Day-1 preview briefing — generated once on first dashboard load after onboarding.
    -- UNIQUE on user_id ensures a single preview per user; INSERT OR IGNORE handles races.
    CREATE TABLE IF NOT EXISTS preview_briefings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Append-only action audit log (#7). Records every calendar mutation (both
    -- voice and web paths). No row-cap — unlike briefings.tool_actions (50-row
    -- mutable JSON blob). snapshot_before/after hold JSON calendar state; populated
    -- where available, null otherwise (future: handlers capture pre/post state).
    -- This table is the data source for Core's "Recent Activity" dashboard feed.
    CREATE TABLE IF NOT EXISTS audit_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL,
      briefing_id     INTEGER,           -- null = web-initiated action
      action          TEXT    NOT NULL,  -- fn name: createEvent, moveEvent, deleteEvent…
      args_json       TEXT    NOT NULL,  -- JSON args passed to the tool/route
      result_text     TEXT,              -- human-readable outcome returned to caller
      ok              INTEGER NOT NULL DEFAULT 1, -- 1=success, 0=failure/rejection
      snapshot_before TEXT,              -- JSON calendar state before change (nullable)
      snapshot_after  TEXT,              -- JSON calendar state after change (nullable)
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Structured, durable facts extracted from call transcripts (compounding memory).
    -- Deduplicated by (category, entity) so facts evolve instead of accumulating noise.
    CREATE TABLE IF NOT EXISTS facts (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id            INTEGER NOT NULL REFERENCES users(id),
      category           TEXT NOT NULL CHECK(category IN ('person','project','goal','preference','fact')),
      statement          TEXT NOT NULL,
      entity             TEXT,
      learned_at         TEXT NOT NULL DEFAULT (datetime('now')),
      confidence         TEXT NOT NULL DEFAULT 'high' CHECK(confidence IN ('high','low')),
      source_briefing_id INTEGER REFERENCES briefings(id)
    );

    -- Whoop OAuth tokens (health data PII — encrypted at rest).
    -- expires_at is epoch ms for easy Date.now() comparison.
    CREATE TABLE IF NOT EXISTS whoop_tokens (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER UNIQUE NOT NULL REFERENCES users(id),
      access_token  TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at    INTEGER NOT NULL,
      scope         TEXT,
      updated_at    TEXT DEFAULT (datetime('now'))
    );

    -- Daily energy state for a user — one row per user per day (UNIQUE enforces the
    -- upsert contract). Source tracks whether the level was auto-derived from Whoop,
    -- manually entered, or overridden by the user (override wins over whoop).
    CREATE TABLE IF NOT EXISTS energy_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      date       TEXT NOT NULL,
      level      TEXT NOT NULL CHECK(level IN ('red', 'yellow', 'green')),
      source     TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('whoop', 'manual', 'override')),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, date)
    );

    -- Sub-goals that hang off a focus area (priorities row). Powers the Focus Scoreboard:
    -- Core reads these for progress display; user checks them off as they complete work.
    -- completed_at captures when done so briefings can celebrate recent wins.
    CREATE TABLE IF NOT EXISTS focus_milestones (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id),
      priority_id  INTEGER NOT NULL REFERENCES priorities(id),
      title        TEXT NOT NULL,
      done         INTEGER NOT NULL DEFAULT 0,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    -- Daily Focus + Energy scores. One row per user per day (UNIQUE enforces upsert).
    -- Recomputed before every morning call; drivers stored as JSON arrays so Core and
    -- Design can render explanations without re-running the scoring logic.
    CREATE TABLE IF NOT EXISTS calendar_scores (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES users(id),
      date            TEXT NOT NULL,
      focus_score     INTEGER NOT NULL,
      energy_score    INTEGER NOT NULL,
      focus_drivers   TEXT,
      energy_drivers  TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, date)
    );

    -- Structured energy profile: the user's stated peak/trough windows (hour 0–23).
    -- One row per user (upserted). Peak = high-energy window; trough = low-energy dip.
    -- Core derives this from free-text preference facts as v1 and swaps to this once live.
    CREATE TABLE IF NOT EXISTS energy_profile (
      user_id     INTEGER PRIMARY KEY REFERENCES users(id),
      peak_start  INTEGER NOT NULL,
      peak_end    INTEGER NOT NULL,
      trough_start INTEGER NOT NULL,
      trough_end  INTEGER NOT NULL,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- LLM-derived energy classification cache for Google Calendar events.
    -- Keyed by (user_id, google_event_id). title_hash detects title changes so
    -- a renamed event is re-tagged automatically on next score computation.
    -- demand: high | med | low. type: free-text category (e.g. 'deep-work', 'admin').
    CREATE TABLE IF NOT EXISTS event_energy_tags (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES users(id),
      google_event_id TEXT NOT NULL,
      type            TEXT NOT NULL,
      demand          TEXT NOT NULL CHECK(demand IN ('high', 'med', 'low')),
      title_hash      TEXT NOT NULL,
      tagged_at       TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, google_event_id)
    );

    -- Daily focus areas recommended by Edge each morning.
    -- Day-scoped: recomputed fresh each morning, anchored to stable overarching priorities.
    -- focus_areas: JSON array of {title, rationale, confidence, anchor?}.
    CREATE TABLE IF NOT EXISTS daily_focus (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date         TEXT NOT NULL,
      focus_areas  TEXT NOT NULL DEFAULT '[]',
      generated_at TEXT NOT NULL DEFAULT (datetime('now')),
      confirmed    INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, date)
    );

    -- Idempotency registry for calendar plan executions (hero loop).
    -- One row per (user, plan) — INSERT OR IGNORE makes apply idempotent.
    -- plan_id is a UUID generated by Core before the apply call; Core checks
    -- this table first to guard against double-submit on retry/re-render.
    CREATE TABLE IF NOT EXISTS calendar_plan_executions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL REFERENCES users(id),
      plan_id        TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'applied' CHECK(status IN ('applied', 'reverted')),
      mutation_count INTEGER NOT NULL DEFAULT 0,
      applied_at     TEXT NOT NULL DEFAULT (datetime('now')),
      reverted_at    TEXT,
      UNIQUE(user_id, plan_id)
    );

    -- Open loops / commitment tracking. description is email-derived PII → encrypted at rest.
    -- Retention: resolved/dismissed rows pruned after 30 days via openLoopQueries.prune().
    CREATE TABLE IF NOT EXISTS open_loops (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      description TEXT NOT NULL,
      type        TEXT NOT NULL CHECK(type IN ('commitment_made','awaiting_you','deadline')),
      source      TEXT NOT NULL CHECK(source IN ('email','call','calendar')),
      due_date    TEXT,
      status      TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done','dismissed')),
      created_at  TEXT DEFAULT (datetime('now')),
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS support_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      type       TEXT NOT NULL CHECK(type IN ('feedback','question','issue')),
      message    TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','seen','resolved')),
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
    CREATE INDEX IF NOT EXISTS idx_gmail_drafts_user ON gmail_drafts_log(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_watched_threads_user ON watched_threads(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_facts_user ON facts(user_id, category);
    CREATE INDEX IF NOT EXISTS idx_whoop_tokens_user ON whoop_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_energy_log_user_date ON energy_log(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_focus_milestones_user ON focus_milestones(user_id, priority_id);
    CREATE INDEX IF NOT EXISTS idx_calendar_scores_user_date ON calendar_scores(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_event_energy_tags_user ON event_energy_tags(user_id, google_event_id);
    CREATE INDEX IF NOT EXISTS idx_daily_focus_user_date ON daily_focus(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_calendar_plan_executions_user ON calendar_plan_executions(user_id, plan_id);
    CREATE INDEX IF NOT EXISTS idx_open_loops_user ON open_loops(user_id, status, created_at DESC);
  `);

  // Migrations for existing databases
  const migrations = [
    "ALTER TABLE briefings ADD COLUMN retry_attempted INTEGER DEFAULT 0",
    "ALTER TABLE briefings ADD COLUMN calendar_actions TEXT",
    "ALTER TABLE briefings ADD COLUMN edge_promises TEXT",
    "ALTER TABLE briefings ADD COLUMN tool_actions TEXT",
    "ALTER TABLE briefings ADD COLUMN error_code TEXT",
    "ALTER TABLE users ADD COLUMN phone_number TEXT",
    "ALTER TABLE users ADD COLUMN current_timezone TEXT",
    "ALTER TABLE calendar_tokens ADD COLUMN scope TEXT",
    "ALTER TABLE facts ADD COLUMN confidence TEXT NOT NULL DEFAULT 'high'",
    "ALTER TABLE facts ADD COLUMN source_briefing_id INTEGER REFERENCES briefings(id)",
    "ALTER TABLE priorities ADD COLUMN energy_cost TEXT CHECK(energy_cost IN ('high', 'medium', 'low'))",
    "ALTER TABLE calendar_scores ADD COLUMN edge_score INTEGER",
    "ALTER TABLE undo_log ADD COLUMN plan_id TEXT",
    "ALTER TABLE facts ADD COLUMN source TEXT",
    "ALTER TABLE open_loops ADD COLUMN snooze_until TEXT",
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
  setCurrentTimezone: (id: number, currentTimezone: string | null) => {
    return getDb().prepare('UPDATE users SET current_timezone = ? WHERE id = ?').run(currentTimezone, id);
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
  // The user's most recently set priorities (any week) — used as a carry-over fallback
  // when a target week has none, so "same as my current priorities" works.
  getMostRecent: (userId: number) => {
    return getDb().prepare(
      'SELECT * FROM priorities WHERE user_id = ? AND week_of = (SELECT MAX(week_of) FROM priorities WHERE user_id = ?) ORDER BY rank'
    ).all(userId, userId) as Priority[];
  },
  deleteThisWeek: (userId: number, weekOf: string) => {
    return getDb().prepare('DELETE FROM priorities WHERE user_id = ? AND week_of = ?').run(userId, weekOf);
  },
  setEnergyCost: (userId: number, id: number, energyCost: 'high' | 'medium' | 'low' | null) => {
    return getDb().prepare('UPDATE priorities SET energy_cost = ? WHERE id = ? AND user_id = ?').run(energyCost, id, userId);
  },
};

// Energy log queries — one row per user per day (UNIQUE constraint); source 'override' wins over 'whoop'.
export const energyLogQueries = {
  upsert: (userId: number, date: string, level: 'red' | 'yellow' | 'green', source: 'whoop' | 'manual' | 'override'): void => {
    getDb().prepare(`
      INSERT INTO energy_log (user_id, date, level, source)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, date) DO UPDATE SET
        level = excluded.level,
        source = excluded.source,
        created_at = datetime('now')
    `).run(userId, date, level, source);
  },
  getToday: (userId: number, date: string): EnergyLog | undefined => {
    return getDb().prepare('SELECT * FROM energy_log WHERE user_id = ? AND date = ?').get(userId, date) as EnergyLog | undefined;
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
    const wdb = getDb();
    // Priority: explicit user notes and priority changes always first,
    // then recent insights, then transcripts (deduped to avoid noise)
    const high = wdb.prepare(
      `SELECT * FROM memories WHERE user_id = ? AND (
        content LIKE '%[USER NOTE]%' OR
        content LIKE '%[PRIORITY CHANGE]%' OR
        content LIKE '%[TRAVEL TIMEZONE]%'
      ) ORDER BY created_at DESC LIMIT 10`
    ).all(userId) as Memory[];

    const insights = wdb.prepare(
      `SELECT * FROM memories WHERE user_id = ? AND type = 'insight'
       ORDER BY created_at DESC LIMIT 8`
    ).all(userId) as Memory[];

    const recent = wdb.prepare(
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
  // Claim the call slot BEFORE generating the briefing so a second cron tick (60s later)
  // sees the row and bails instead of generating a second call. Content is filled in by
  // updateContent() after generation succeeds; on failure the row is marked 'failed'.
  createPending: (userId: number, scheduledFor: string) => {
    return getDb().prepare(
      "INSERT INTO briefings (user_id, content, scheduled_for, status) VALUES (?, '[generating]', ?, 'pending')"
    ).run(userId, scheduledFor);
  },
  updateContent: (id: number, content: string) => {
    getDb().prepare('UPDATE briefings SET content = ? WHERE id = ?').run(content, id);
  },
  update: (id: number, data: Partial<Briefing>) => {
    const ALLOWED_FIELDS = new Set(['status', 'transcript', 'user_response', 'vapi_call_id', 'retry_attempted', 'error_code']);
    const entries = Object.entries(data).filter(([k]) => ALLOWED_FIELDS.has(k));
    if (!entries.length) return;
    const fields = entries.map(([k]) => `${k} = ?`).join(', ');
    // Encrypt PII columns (call transcript + the captured user response) at rest.
    const values = entries.map(([k, v]) => (ENCRYPTED_BRIEFING_FIELDS.has(k) && typeof v === 'string') ? encryptField(v) : v);
    return getDb().prepare(`UPDATE briefings SET ${fields} WHERE id = ?`).run(...values, id);
  },
  getRecent: (userId: number, limit = 10) => {
    return (getDb().prepare(
      'SELECT * FROM briefings WHERE user_id = ? ORDER BY scheduled_for DESC LIMIT ?'
    ).all(userId, limit) as Briefing[]).map(decryptBriefingRow);
  },
  getLatest: (userId: number) => {
    const row = getDb().prepare(
      'SELECT * FROM briefings WHERE user_id = ? ORDER BY scheduled_for DESC LIMIT 1'
    ).get(userId) as Briefing | undefined;
    return row ? decryptBriefingRow(row) : undefined;
  },
  // Strictly owner-gated: the AND user_id = ? ensures a user can never read another's transcript.
  getByIdForUser: (id: number, userId: number) => {
    const row = getDb().prepare(
      'SELECT * FROM briefings WHERE id = ? AND user_id = ?'
    ).get(id, userId) as Briefing | undefined;
    return row ? decryptBriefingRow(row) : undefined;
  },
  // Most recent briefing for a given UTC-date prefix (YYYY-MM-DD). Used by the
  // call-status endpoint and the idempotency guard to check today's call state.
  getTodayForUser: (userId: number, datePrefix: string) => {
    return getDb().prepare(
      `SELECT id, status, error_code, scheduled_for FROM briefings WHERE user_id = ? AND scheduled_for LIKE ? ORDER BY scheduled_for DESC LIMIT 1`
    ).get(userId, `${datePrefix}%`) as Pick<Briefing, 'id' | 'status' | 'scheduled_for'> & { error_code: string | null } | undefined;
  },
};

// PII columns on `briefings` that are encrypted at rest.
const ENCRYPTED_BRIEFING_FIELDS = new Set(['transcript', 'user_response']);

// Decrypt the encrypted columns of a briefing row in place (legacy plaintext passes through).
export function decryptBriefingRow<T extends { transcript?: string | null; user_response?: string | null }>(row: T): T {
  if (row.transcript != null) row.transcript = decryptField(row.transcript);
  if (row.user_response != null) row.user_response = decryptField(row.user_response);
  return row;
}

// Calendar token queries
export const calendarQueries = {
  // `scope` is the space-delimited set of scopes Google reported as granted. It is
  // optional so token-*refresh* callers (which don't change the grant) can omit it —
  // COALESCE then preserves the previously stored scope rather than nulling it.
  upsert: (userId: number, accessToken: string, refreshToken: string, expiry: string, scope?: string | null) => {
    return getDb().prepare(`
      INSERT INTO calendar_tokens (user_id, access_token, refresh_token, expiry, scope, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expiry = excluded.expiry,
        scope = COALESCE(excluded.scope, calendar_tokens.scope),
        updated_at = excluded.updated_at
    `).run(userId, encryptField(accessToken), encryptNullable(refreshToken) ?? '', expiry, scope ?? null);
  },
  get: (userId: number) => {
    const row = getDb().prepare('SELECT * FROM calendar_tokens WHERE user_id = ?').get(userId) as CalendarToken | undefined;
    if (!row) return undefined;
    // Decrypt transparently — legacy plaintext rows pass through unchanged.
    row.access_token = decryptField(row.access_token);
    row.refresh_token = decryptNullable(row.refresh_token);
    return row;
  },
  delete: (userId: number) => {
    return getDb().prepare('DELETE FROM calendar_tokens WHERE user_id = ?').run(userId);
  },
};

// Gmail draft audit + rate-limit queries. recipient/subject are PII → encrypted at
// rest with the same field cipher as tokens/transcripts (#4).
export const gmailQueries = {
  logDraft: (userId: number, recipient: string, subject: string, draftId: string) => {
    return getDb().prepare(
      'INSERT INTO gmail_drafts_log (user_id, recipient, subject, draft_id, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, encryptNullable(recipient), encryptNullable(subject), draftId, Date.now());
  },
  // How many drafts this user created since `sinceMs` (epoch ms) — drives the rate limit.
  countSince: (userId: number, sinceMs: number): number => {
    const row = getDb().prepare(
      'SELECT COUNT(*) AS n FROM gmail_drafts_log WHERE user_id = ? AND created_at >= ?'
    ).get(userId, sinceMs) as { n: number };
    return row.n;
  },
  // Recent drafts for admin/audit display (recipient/subject decrypted).
  recent: (userId: number, limit = 50) => {
    const rows = getDb().prepare(
      'SELECT id, user_id, recipient, subject, draft_id, created_at FROM gmail_drafts_log WHERE user_id = ? ORDER BY id DESC LIMIT ?'
    ).all(userId, limit) as GmailDraftLog[];
    return rows.map((r) => ({ ...r, recipient: decryptNullable(r.recipient), subject: decryptNullable(r.subject) }));
  },
};

// Email-reply tracking: outreach threads Edge drafted, watched for replies.
// recipient/context are PII → encrypted at rest (same field cipher as drafts/tokens).
export interface WatchedThread {
  id: number;
  user_id: number;
  thread_id: string;
  recipient: string | null;
  context: string | null;
  event_title: string | null;
  event_date: string | null;
  last_seen_message_id: string | null;
  status: 'open' | 'handled' | 'dismissed';
  created_at: number;
}
export const watchedThreadQueries = {
  // Start watching a thread Edge drafted. No-op if this user already watches the thread.
  register: (userId: number, threadId: string, recipient: string, context: string, eventTitle?: string, eventDate?: string) => {
    const exists = getDb().prepare('SELECT id FROM watched_threads WHERE user_id = ? AND thread_id = ?').get(userId, threadId);
    if (exists) return;
    getDb().prepare(
      'INSERT INTO watched_threads (user_id, thread_id, recipient, context, event_title, event_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(userId, threadId, encryptNullable(recipient), encryptNullable(context), eventTitle ?? null, eventDate ?? null, 'open', Date.now());
  },
  // Open threads to poll for replies (recipient/context decrypted for use).
  listOpen: (userId: number): WatchedThread[] => {
    const rows = getDb().prepare(
      "SELECT * FROM watched_threads WHERE user_id = ? AND status = 'open' ORDER BY created_at DESC"
    ).all(userId) as WatchedThread[];
    return rows.map((r) => ({ ...r, recipient: decryptNullable(r.recipient), context: decryptNullable(r.context) }));
  },
  // Record the newest message id we've already processed for a thread.
  markSeen: (id: number, messageId: string) => {
    getDb().prepare('UPDATE watched_threads SET last_seen_message_id = ? WHERE id = ?').run(messageId, id);
  },
  setStatus: (id: number, status: 'open' | 'handled' | 'dismissed') => {
    getDb().prepare('UPDATE watched_threads SET status = ? WHERE id = ?').run(status, id);
  },
  // Retention minimization: remove non-open threads older than 30 days (email PII).
  prune: (): void => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    getDb().prepare("DELETE FROM watched_threads WHERE status != 'open' AND created_at < ?").run(cutoff);
  },
};

// In-app notification center. title/body are PII (reply content) → encrypted at rest.
export interface Notification {
  id: number;
  user_id: number;
  type: string;
  title: string | null;
  body: string | null;
  read: number;
  created_at: number;
}
export const notificationQueries = {
  create: (userId: number, type: string, title: string, body: string) => {
    getDb().prepare(
      'INSERT INTO notifications (user_id, type, title, body, read, created_at) VALUES (?, ?, ?, ?, 0, ?)'
    ).run(userId, type, encryptNullable(title), encryptNullable(body), Date.now());
  },
  listRecent: (userId: number, limit = 30): Notification[] => {
    const rows = getDb().prepare(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?'
    ).all(userId, limit) as Notification[];
    return rows.map((r) => ({ ...r, title: decryptNullable(r.title), body: decryptNullable(r.body) }));
  },
  unreadCount: (userId: number): number => {
    const row = getDb().prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0').get(userId) as { n: number };
    return row.n;
  },
  markRead: (id: number, userId: number) => {
    getDb().prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(id, userId);
  },
  markAllRead: (userId: number) => {
    getDb().prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(userId);
  },
};

// Event-creation idempotency dedupe (#3). Keyed by (user_id, normalized-title+start-minute).
// claim() is called once per creation attempt; returns true on first call (proceed), false
// on a duplicate within the TTL window (skip the insert — the event was already created).
export const eventDedupeQueries = {
  claim: (userId: number, key: string, nowMs: number, ttlMs: number): boolean => {
    const db = getDb();
    return db.transaction(() => {
      // Remove any expired entry so a legitimately repeated request after the TTL can proceed.
      db.prepare(
        'DELETE FROM event_dedupe_keys WHERE user_id = ? AND dedupe_key = ? AND expires_at <= ?'
      ).run(userId, key, nowMs);
      const result = db.prepare(
        'INSERT OR IGNORE INTO event_dedupe_keys (user_id, dedupe_key, expires_at) VALUES (?, ?, ?)'
      ).run(userId, key, nowMs + ttlMs);
      return result.changes === 1; // 1 = new key (proceed), 0 = duplicate (skip)
    })();
  },
};

// IP-based rate limiting queries (#8). Atomic fixed-window counter via a transaction.
export const rateLimitQueries = {
  /**
   * Increment the counter for `key` within a fixed window. Returns:
   *   { allowed: true, count, remaining, resetAt }  — under the limit
   *   { allowed: false, count, remaining: 0, resetAt } — over the limit (do NOT increment further)
   */
  check: (key: string, limit: number, windowMs: number, nowMs: number): { allowed: boolean; count: number; remaining: number; resetAt: number } => {
    const db = getDb();
    return db.transaction(() => {
      const existing = db.prepare(
        'SELECT count, window_start, expires_at FROM rate_limits WHERE key = ?'
      ).get(key) as { count: number; window_start: number; expires_at: number } | undefined;

      // Fresh window (no row, or previous window expired).
      if (!existing || existing.expires_at <= nowMs) {
        const resetAt = nowMs + windowMs;
        db.prepare('INSERT OR REPLACE INTO rate_limits (key, count, window_start, expires_at) VALUES (?, 1, ?, ?)').run(key, nowMs, resetAt);
        // Prune expired rows once per insert to keep the table lean (best-effort).
        db.prepare('DELETE FROM rate_limits WHERE expires_at <= ? AND key != ?').run(nowMs, key);
        return { allowed: true, count: 1, remaining: limit - 1, resetAt };
      }

      // Existing active window — check before incrementing.
      if (existing.count >= limit) {
        return { allowed: false, count: existing.count, remaining: 0, resetAt: existing.expires_at };
      }
      const newCount = existing.count + 1;
      db.prepare('UPDATE rate_limits SET count = ? WHERE key = ?').run(newCount, key);
      return { allowed: true, count: newCount, remaining: limit - newCount, resetAt: existing.expires_at };
    })();
  },
};

// Vapi auth event log (#2 telemetry). Only logs mismatches — not every accepted call.
// record() is fire-and-forget; never throw so it never disrupts the auth path.
export const vapiAuthLogQueries = {
  record: (endpoint: string, status: string): void => {
    try {
      const db = getDb();
      db.prepare('INSERT INTO vapi_auth_log (endpoint, status, created_at) VALUES (?, ?, ?)').run(endpoint, status, Date.now());
      // Keep the table lean — prune oldest rows beyond 1000.
      db.prepare('DELETE FROM vapi_auth_log WHERE id NOT IN (SELECT id FROM vapi_auth_log ORDER BY id DESC LIMIT 1000)').run();
    } catch { /* never let telemetry fault disrupt the auth path */ }
  },
  // Recent events for the admin monitoring endpoint.
  recent: (limit = 50): { id: number; endpoint: string; status: string; created_at: number }[] => {
    return getDb().prepare(
      'SELECT id, endpoint, status, created_at FROM vapi_auth_log ORDER BY id DESC LIMIT ?'
    ).all(limit) as { id: number; endpoint: string; status: string; created_at: number }[];
  },
  // Count of mismatch-allowed events since sinceMs — drives the admin dashboard summary.
  mismatchCount: (sinceMs: number): number => {
    const row = getDb().prepare(
      "SELECT COUNT(*) AS n FROM vapi_auth_log WHERE status = 'mismatch-allowed' AND created_at >= ?"
    ).get(sinceMs) as { n: number };
    return row.n;
  },
};

// Hard delete-confirmation tokens (#9). Single-use, short TTL.
// issue(): generate a fresh random token, purge old ones for this user, persist.
// consume(): validate + mark used in one synchronous transaction (no TOCTOU).
export const deleteConfirmQueries = {
  issue: (userId: number, nowMs: number, ttlMs: number): string => {
    // 4 random bytes → 8 uppercase hex chars (e.g. "AB12CD34"). Opaque and log-friendly.
    const { randomBytes } = require('crypto') as typeof import('crypto');
    const token = randomBytes(4).toString('hex').toUpperCase();
    const db = getDb();
    // Purge expired/used tokens for this user to keep the table lean.
    db.prepare('DELETE FROM delete_confirm_tokens WHERE user_id = ? AND (used = 1 OR expires_at <= ?)').run(userId, nowMs);
    db.prepare('INSERT INTO delete_confirm_tokens (token, user_id, expires_at, used) VALUES (?, ?, ?, 0)').run(token, userId, nowMs + ttlMs);
    return token;
  },
  consume: (token: string, userId: number, nowMs: number): boolean => {
    const db = getDb();
    return db.transaction(() => {
      const row = db.prepare(
        'SELECT user_id, expires_at, used FROM delete_confirm_tokens WHERE token = ?'
      ).get(token) as { user_id: number; expires_at: number; used: number } | undefined;
      if (!row || row.user_id !== userId || row.expires_at <= nowMs || row.used) return false;
      db.prepare('UPDATE delete_confirm_tokens SET used = 1 WHERE token = ?').run(token);
      return true;
    })();
  },
};

// Append-only action audit log (#7).
// record() is fire-and-forget — never throws so a DB fault never disrupts a tool call.
// recent() is for Core's "Recent Activity" dashboard; recentAll() is for the admin panel.
// RETENTION: rows older than AUDIT_RETENTION_DAYS are pruned on each record() call
// (best-effort, ~1% chance per insert to avoid per-call overhead).
const AUDIT_RETENTION_DAYS = 90;

export interface AuditEntry {
  userId: number;
  briefingId?: number | null;
  action: string;
  argsJson: string;           // JSON string of the tool args
  resultText?: string | null;
  ok: boolean;
  snapshotBefore?: string | null;  // JSON calendar state before mutation (optional)
  snapshotAfter?: string | null;   // JSON calendar state after mutation (optional)
}

export interface AuditRow {
  id: number;
  user_id: number;
  briefing_id: number | null;
  action: string;
  args_json: string;
  result_text: string | null;
  ok: number;           // 0 or 1 (SQLite stores booleans as integers)
  snapshot_before: string | null;
  snapshot_after: string | null;
  created_at: string;
}

export const auditLogQueries = {
  /** Append a new entry. Never throws — non-critical path. */
  record: (entry: AuditEntry): void => {
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO audit_log
          (user_id, briefing_id, action, args_json, result_text, ok, snapshot_before, snapshot_after)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entry.userId,
        entry.briefingId ?? null,
        entry.action,
        entry.argsJson,
        entry.resultText ?? null,
        entry.ok ? 1 : 0,
        entry.snapshotBefore ?? null,
        entry.snapshotAfter ?? null,
      );
      // Prune old rows ~1% of the time to avoid per-call overhead.
      if (Math.random() < 0.01) {
        db.prepare(
          `DELETE FROM audit_log WHERE created_at < datetime('now', '-${AUDIT_RETENTION_DAYS} days')`
        ).run();
      }
    } catch { /* never let audit faults disrupt tool calls */ }
  },

  /** Recent actions for a specific user (Core's "Recent Activity" feed). */
  recent: (userId: number, limit = 20): AuditRow[] => {
    return getDb().prepare(
      'SELECT * FROM audit_log WHERE user_id = ? ORDER BY id DESC LIMIT ?'
    ).all(userId, limit) as AuditRow[];
  },

  /** All recent actions across all users — admin panel view. */
  recentAll: (limit = 100): AuditRow[] => {
    return getDb().prepare(
      'SELECT * FROM audit_log ORDER BY id DESC LIMIT ?'
    ).all(limit) as AuditRow[];
  },

  /** Count of successful actions for a user in the last N days — for user stats. */
  successCount: (userId: number, days = 30): number => {
    const row = getDb().prepare(
      `SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ? AND ok = 1 AND created_at >= datetime('now', ?)`
    ).get(userId, `-${days} days`) as { n: number };
    return row.n;
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
  completeMany: (ids: number[], userId: number) => {
    if (!ids.length) return 0;
    const db = getDb();
    const stmt = db.prepare(
      "UPDATE tasks SET completed = 1, completed_at = datetime('now') WHERE id = ? AND user_id = ? AND completed = 0"
    );
    const tx = db.transaction((taskIds: number[]) => {
      let changes = 0;
      for (const id of taskIds) changes += stmt.run(id, userId).changes;
      return changes;
    });
    return tx(ids) as number;
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

// Day-1 preview briefing — one record per user, generated once.
export const previewBriefingQueries = {
  get: (userId: number): { id: number; content: string; created_at: string } | undefined => {
    return getDb().prepare('SELECT * FROM preview_briefings WHERE user_id = ?').get(userId) as any;
  },
  create: (userId: number, content: string): void => {
    getDb().prepare(
      'INSERT OR IGNORE INTO preview_briefings (user_id, content) VALUES (?, ?)'
    ).run(userId, content);
  },
};

// Undo log — records the inverse of each calendar action so it can be reversed.
export const undoQueries = {
  record: (userId: number, label: string, payload: unknown) => {
    return getDb().prepare('INSERT INTO undo_log (user_id, label, payload) VALUES (?, ?, ?)').run(userId, label, JSON.stringify(payload));
  },
  getLatest: (userId: number) => {
    return getDb().prepare('SELECT * FROM undo_log WHERE user_id = ? AND undone = 0 ORDER BY id DESC LIMIT 1').get(userId) as { id: number; label: string; payload: string } | undefined;
  },
  markUndone: (id: number) => {
    return getDb().prepare('UPDATE undo_log SET undone = 1 WHERE id = ?').run(id);
  },
  // Fetch a specific log entry (owned by userId — guards against cross-user undo).
  getById: (userId: number, id: number) => {
    return getDb().prepare('SELECT * FROM undo_log WHERE id = ? AND user_id = ? AND undone = 0').get(id, userId) as { id: number; label: string; payload: string; undone: number; created_at: string } | undefined;
  },
  // Last N actions for the Activity feed (includes already-undone so users see the full trail).
  listRecent: (userId: number, limit = 20) => {
    return getDb().prepare('SELECT id, label, undone, created_at FROM undo_log WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit) as { id: number; label: string; undone: number; created_at: string }[];
  },

  // Plan-level undo support — groups mutations under a planId so they can be
  // reverted together. Core passes planId from applyCalendarPlan to recordUndo.
  recordForPlan: (userId: number, label: string, payload: unknown, planId: string) => {
    return getDb().prepare(
      'INSERT INTO undo_log (user_id, label, payload, plan_id) VALUES (?, ?, ?, ?)'
    ).run(userId, label, JSON.stringify(payload), planId);
  },
  getByPlanId: (userId: number, planId: string): { id: number; label: string; payload: string }[] => {
    return getDb().prepare(
      'SELECT id, label, payload FROM undo_log WHERE user_id = ? AND plan_id = ? AND undone = 0 ORDER BY id DESC'
    ).all(userId, planId) as { id: number; label: string; payload: string }[];
  },
  markPlanUndone: (userId: number, planId: string): void => {
    getDb().prepare(
      'UPDATE undo_log SET undone = 1 WHERE user_id = ? AND plan_id = ? AND undone = 0'
    ).run(userId, planId);
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
  current_timezone: string | null;
  created_at: string;
}

// The timezone EDG3 should treat the user as currently in: a travel override if set,
// otherwise their home timezone. Use this anywhere a call/briefing needs "the user's timezone".
export function effectiveTimezone(user: { current_timezone?: string | null; timezone?: string | null }): string {
  // Validate each candidate — a stale/garbage current_timezone must never crash a call.
  if (isValidTimeZone(user.current_timezone)) return user.current_timezone!;
  if (isValidTimeZone(user.timezone)) return user.timezone!;
  return 'America/Los_Angeles';
}

export interface Priority {
  id: number;
  user_id: number;
  text: string;
  week_of: string;
  rank: number;
  energy_cost?: 'high' | 'medium' | 'low' | null;
  created_at: string;
}

export interface EnergyLog {
  id: number;
  user_id: number;
  date: string;
  level: 'red' | 'yellow' | 'green';
  source: 'whoop' | 'manual' | 'override';
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
  retry_attempted: number;
  calendar_actions: string | null;
  edge_promises: string | null;
  tool_actions: string | null;
  error_code: string | null;
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
  scope: string | null;
  updated_at: string;
}

export interface GmailDraftLog {
  id: number;
  user_id: number;
  recipient: string | null;
  subject: string | null;
  draft_id: string;
  created_at: number;
}

export interface Fact {
  id: number;
  user_id: number;
  category: 'person' | 'project' | 'goal' | 'preference' | 'fact';
  statement: string;
  entity: string | null;
  learned_at: string;
  confidence: 'high' | 'low';
  source_briefing_id: number | null;
  source?: string | null;
}

// Whoop OAuth tokens. access_token + refresh_token are health-data PII → encrypted.
export interface WhoopToken {
  id: number;
  user_id: number;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string | null;
  updated_at: string;
}

export interface EnergyLog {
  id: number;
  user_id: number;
  date: string;
  level: 'red' | 'yellow' | 'green';
  source: 'whoop' | 'manual' | 'override';
  created_at: string;
}

export const whoopQueries = {
  upsert: (userId: number, accessToken: string, refreshToken: string, expiresAt: number, scope?: string | null) => {
    return getDb().prepare(`
      INSERT INTO whoop_tokens (user_id, access_token, refresh_token, expires_at, scope, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        access_token  = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expires_at    = excluded.expires_at,
        scope         = COALESCE(excluded.scope, whoop_tokens.scope),
        updated_at    = excluded.updated_at
    `).run(userId, encryptField(accessToken), encryptField(refreshToken), expiresAt, scope ?? null);
  },
  get: (userId: number): WhoopToken | undefined => {
    const row = getDb().prepare('SELECT * FROM whoop_tokens WHERE user_id = ?').get(userId) as WhoopToken | undefined;
    if (!row) return undefined;
    row.access_token  = decryptField(row.access_token);
    row.refresh_token = decryptField(row.refresh_token);
    return row;
  },
  delete: (userId: number) => {
    return getDb().prepare('DELETE FROM whoop_tokens WHERE user_id = ?').run(userId);
  },
};

export const factQueries = {
  getAll: (userId: number): Fact[] => {
    return getDb().prepare(
      'SELECT * FROM facts WHERE user_id = ? ORDER BY category, learned_at DESC'
    ).all(userId) as Fact[];
  },

  // Upsert: dedupe by (category, entity) when entity present; by (category, first-80-chars-statement) otherwise.
  // Updates statement + learned_at when a fact evolved; skips exact duplicates; inserts new facts.
  upsertFact: (
    userId: number,
    category: string,
    statement: string,
    entity?: string | null,
    confidence: 'high' | 'low' = 'high',
    sourceBriefingId?: number | null,
  ): void => {
    const db = getDb();
    let existing: Fact | undefined;
    if (entity) {
      existing = db.prepare(
        'SELECT * FROM facts WHERE user_id=? AND category=? AND LOWER(entity)=LOWER(?)'
      ).get(userId, category, entity) as Fact | undefined;
    } else {
      existing = db.prepare(
        "SELECT * FROM facts WHERE user_id=? AND category=? AND entity IS NULL AND LOWER(SUBSTR(statement,1,80))=LOWER(SUBSTR(?,1,80))"
      ).get(userId, category, statement) as Fact | undefined;
    }
    if (existing) {
      if (existing.statement.toLowerCase() !== statement.toLowerCase()) {
        db.prepare("UPDATE facts SET statement=?, learned_at=datetime('now') WHERE id=?").run(statement, existing.id);
      }
    } else {
      db.prepare(
        'INSERT INTO facts (user_id, category, statement, entity, confidence, source_briefing_id) VALUES (?,?,?,?,?,?)'
      ).run(userId, category, statement, entity ?? null, confidence, sourceBriefingId ?? null);
    }
  },

  getByCategory: (userId: number, category: string): Fact[] => {
    return getDb().prepare(
      'SELECT * FROM facts WHERE user_id=? AND category=? ORDER BY learned_at DESC'
    ).all(userId, category) as Fact[];
  },

  updateFact: (userId: number, id: number, statement: string, entity: string | null): void => {
    getDb().prepare(
      "UPDATE facts SET statement=?, entity=?, learned_at=datetime('now') WHERE id=? AND user_id=?"
    ).run(statement, entity, id, userId);
  },

  deleteFact: (userId: number, id: number): void => {
    getDb().prepare('DELETE FROM facts WHERE id=? AND user_id=?').run(id, userId);
  },

  // Replace all source='priority-sync' facts for a user with the current priority texts.
  syncPriorityFacts: (userId: number, priorityTexts: string[]): void => {
    const db = getDb();
    db.prepare("DELETE FROM facts WHERE user_id=? AND source='priority-sync'").run(userId);
    for (const text of priorityTexts) {
      db.prepare(
        "INSERT INTO facts (user_id, category, statement, entity, confidence, source) VALUES (?,?,?,?,?,?)"
      ).run(userId, 'goal', text, null, 'high', 'priority-sync');
    }
  },
};

export interface FocusMilestone {
  id: number;
  user_id: number;
  priority_id: number;
  title: string;
  done: number;
  sort_order: number;
  created_at: string;
  completed_at: string | null;
}

export const focusMilestoneQueries = {
  // All milestones for a user, grouped by focus area then sort order.
  listForUser: (userId: number): FocusMilestone[] => {
    return getDb().prepare(
      'SELECT * FROM focus_milestones WHERE user_id = ? ORDER BY priority_id, sort_order, id'
    ).all(userId) as FocusMilestone[];
  },
  // Milestones for a single focus area, ordered for display.
  listForPriority: (userId: number, priorityId: number): FocusMilestone[] => {
    return getDb().prepare(
      'SELECT * FROM focus_milestones WHERE user_id = ? AND priority_id = ? ORDER BY sort_order, id'
    ).all(userId, priorityId) as FocusMilestone[];
  },
  create: (userId: number, priorityId: number, title: string) => {
    return getDb().prepare(
      'INSERT INTO focus_milestones (user_id, priority_id, title) VALUES (?, ?, ?)'
    ).run(userId, priorityId, title);
  },
  markDone: (id: number, userId: number) => {
    return getDb().prepare(
      "UPDATE focus_milestones SET done = 1, completed_at = datetime('now') WHERE id = ? AND user_id = ?"
    ).run(id, userId);
  },
  markUndone: (id: number, userId: number) => {
    return getDb().prepare(
      'UPDATE focus_milestones SET done = 0, completed_at = NULL WHERE id = ? AND user_id = ?'
    ).run(id, userId);
  },
  remove: (id: number, userId: number) => {
    return getDb().prepare(
      'DELETE FROM focus_milestones WHERE id = ? AND user_id = ?'
    ).run(id, userId);
  },
};

export interface CalendarScore {
  id: number;
  user_id: number;
  date: string;
  focus_score: number;
  energy_score: number;
  edge_score: number | null;
  focus_drivers: string | null;
  energy_drivers: string | null;
  created_at: string;
}

export const calendarScoreQueries = {
  upsert: (
    userId: number,
    date: string,
    scores: { edgeScore: number; focusScore: number; energyScore: number; focusDrivers: string[]; energyDrivers: string[] }
  ): void => {
    getDb().prepare(`
      INSERT INTO calendar_scores (user_id, date, edge_score, focus_score, energy_score, focus_drivers, energy_drivers)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, date) DO UPDATE SET
        edge_score     = excluded.edge_score,
        focus_score    = excluded.focus_score,
        energy_score   = excluded.energy_score,
        focus_drivers  = excluded.focus_drivers,
        energy_drivers = excluded.energy_drivers,
        created_at     = datetime('now')
    `).run(
      userId, date,
      scores.edgeScore, scores.focusScore, scores.energyScore,
      JSON.stringify(scores.focusDrivers),
      JSON.stringify(scores.energyDrivers),
    );
  },

  getRange: (userId: number, fromDate: string, toDate: string): CalendarScore[] => {
    return getDb().prepare(
      'SELECT * FROM calendar_scores WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date ASC'
    ).all(userId, fromDate, toDate) as CalendarScore[];
  },

  getLatest: (userId: number): CalendarScore | undefined => {
    return getDb().prepare(
      'SELECT * FROM calendar_scores WHERE user_id = ? ORDER BY date DESC LIMIT 1'
    ).get(userId) as CalendarScore | undefined;
  },
};

export interface EnergyProfile {
  user_id: number;
  peak_start: number;
  peak_end: number;
  trough_start: number;
  trough_end: number;
  updated_at: string;
}

export const energyProfileQueries = {
  get: (userId: number): EnergyProfile | undefined => {
    return getDb().prepare(
      'SELECT * FROM energy_profile WHERE user_id = ?'
    ).get(userId) as EnergyProfile | undefined;
  },

  upsert: (userId: number, profile: { peakStart: number; peakEnd: number; troughStart: number; troughEnd: number }): void => {
    getDb().prepare(`
      INSERT INTO energy_profile (user_id, peak_start, peak_end, trough_start, trough_end)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        peak_start   = excluded.peak_start,
        peak_end     = excluded.peak_end,
        trough_start = excluded.trough_start,
        trough_end   = excluded.trough_end,
        updated_at   = datetime('now')
    `).run(userId, profile.peakStart, profile.peakEnd, profile.troughStart, profile.troughEnd);
  },
};

export interface EventEnergyTag {
  id: number;
  user_id: number;
  google_event_id: string;
  type: string;
  demand: 'high' | 'med' | 'low';
  title_hash: string;
  tagged_at: string;
}

export const eventEnergyTagQueries = {
  get: (userId: number, eventId: string): EventEnergyTag | undefined => {
    return getDb().prepare(
      'SELECT * FROM event_energy_tags WHERE user_id = ? AND google_event_id = ?'
    ).get(userId, eventId) as EventEnergyTag | undefined;
  },

  upsert: (
    userId: number,
    eventId: string,
    tag: { type: string; demand: 'high' | 'med' | 'low'; titleHash: string }
  ): void => {
    getDb().prepare(`
      INSERT INTO event_energy_tags (user_id, google_event_id, type, demand, title_hash)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, google_event_id) DO UPDATE SET
        type       = excluded.type,
        demand     = excluded.demand,
        title_hash = excluded.title_hash,
        tagged_at  = datetime('now')
    `).run(userId, eventId, tag.type, tag.demand, tag.titleHash);
  },

  getMany: (userId: number, eventIds: string[]): EventEnergyTag[] => {
    if (eventIds.length === 0) return [];
    const placeholders = eventIds.map(() => '?').join(', ');
    return getDb().prepare(
      `SELECT * FROM event_energy_tags WHERE user_id = ? AND google_event_id IN (${placeholders})`
    ).all(userId, ...eventIds) as EventEnergyTag[];
  },
};

// ── Daily focus ───────────────────────────────────────────────────────────────
export interface DailyFocusRecord {
  id: number;
  user_id: number;
  date: string;          // YYYY-MM-DD in user's local timezone
  focus_areas: string;   // JSON: FocusArea[]
  generated_at: string;
  confirmed: number;     // 0 | 1
}

export const dailyFocusQueries = {
  upsert: (userId: number, date: string, areasJson: string, generatedAt: string): void => {
    getDb().prepare(`
      INSERT INTO daily_focus (user_id, date, focus_areas, generated_at, confirmed)
      VALUES (?, ?, ?, ?, 0)
      ON CONFLICT(user_id, date) DO UPDATE SET
        focus_areas  = excluded.focus_areas,
        generated_at = excluded.generated_at,
        confirmed    = 0
    `).run(userId, date, areasJson, generatedAt);
  },

  getToday: (userId: number, date: string): DailyFocusRecord | null => {
    return (getDb().prepare(
      `SELECT * FROM daily_focus WHERE user_id = ? AND date = ?`
    ).get(userId, date) ?? null) as DailyFocusRecord | null;
  },

  confirm: (userId: number, date: string): void => {
    getDb().prepare(
      `UPDATE daily_focus SET confirmed = 1 WHERE user_id = ? AND date = ?`
    ).run(userId, date);
  },
};

export interface CalendarPlanExecution {
  id: number;
  user_id: number;
  plan_id: string;
  status: 'applied' | 'reverted';
  mutation_count: number;
  applied_at: string;
  reverted_at: string | null;
}

// Idempotency + lifecycle tracking for applyCalendarPlan (hero loop).
// Core generates a UUID plan_id before the apply call, checks get() first,
// then calls markApplied() after all mutations succeed. On undo, undoPlan()
// in lib/undo.ts calls markReverted() here.
// ── Open loops / commitment tracking ──────────────────────────────────────────
// description is encrypted at rest (email-derived PII). Retention: resolved/dismissed
// rows auto-pruned after 30 days via prune() (called by the extraction job).

export type OpenLoopType   = 'commitment_made' | 'awaiting_you' | 'deadline';
export type OpenLoopSource = 'email' | 'call' | 'calendar';
export type OpenLoopStatus = 'open' | 'done' | 'dismissed';

export interface OpenLoop {
  id:           number;
  userId:       number;
  description:  string;       // decrypted
  type:         OpenLoopType;
  source:       OpenLoopSource;
  dueDate:      string | null;
  status:       OpenLoopStatus;
  createdAt:    string;
  resolvedAt:   string | null;
  snoozedUntil: string | null; // YYYY-MM-DD: loop hidden from surfaces until this date
}

interface OpenLoopRow {
  id: number; user_id: number; description: string; type: string; source: string;
  due_date: string | null; status: string; created_at: string; resolved_at: string | null;
  snooze_until: string | null;
}

function decryptOpenLoopRow(r: OpenLoopRow): OpenLoop {
  return {
    id:           r.id,
    userId:       r.user_id,
    description:  decryptField(r.description),
    type:         r.type as OpenLoopType,
    source:       r.source as OpenLoopSource,
    dueDate:      r.due_date,
    status:       r.status as OpenLoopStatus,
    createdAt:    r.created_at,
    resolvedAt:   r.resolved_at,
    snoozedUntil: r.snooze_until,
  };
}

export const openLoopQueries = {
  /** List open loops for a user, optionally filtered by status.
   *  Snoozed loops (snooze_until > today) are excluded unless includeSnoozed is true.
   *  Open loops are ordered by due_date (soonest first, nulls last) then created_at. */
  list: (userId: number, status?: OpenLoopStatus, opts: { includeSnoozed?: boolean } = {}): OpenLoop[] => {
    const today = new Date().toISOString().slice(0, 10);
    const snoozeClause = opts.includeSnoozed
      ? ''
      : `AND (snooze_until IS NULL OR snooze_until <= '${today}')`;
    const sql = status
      ? `SELECT * FROM open_loops WHERE user_id = ? AND status = ? ${snoozeClause} ORDER BY due_date ASC NULLS LAST, created_at ASC`
      : `SELECT * FROM open_loops WHERE user_id = ? ${snoozeClause} ORDER BY status ASC, due_date ASC NULLS LAST, created_at ASC`;
    const rows = (status
      ? getDb().prepare(sql).all(userId, status)
      : getDb().prepare(sql).all(userId)) as OpenLoopRow[];
    return rows.map(decryptOpenLoopRow);
  },

  /** Insert a new open loop. description is encrypted at rest. */
  insert: (
    userId: number,
    data: { description: string; type: OpenLoopType; source: OpenLoopSource; due_date?: string | null },
  ): { lastInsertRowid: number } => {
    return getDb().prepare(
      `INSERT INTO open_loops (user_id, description, type, source, due_date) VALUES (?, ?, ?, ?, ?)`
    ).run(userId, encryptField(data.description), data.type, data.source, data.due_date ?? null) as { lastInsertRowid: number };
  },

  /** Mark a loop as resolved (done). User-scoped: ignores loops belonging to other users. */
  resolve: (userId: number, id: number): void => {
    getDb().prepare(
      `UPDATE open_loops SET status = 'done', resolved_at = datetime('now') WHERE id = ? AND user_id = ?`
    ).run(id, userId);
  },

  /** Mark a loop as dismissed. User-scoped. */
  dismiss: (userId: number, id: number): void => {
    getDb().prepare(
      `UPDATE open_loops SET status = 'dismissed', resolved_at = datetime('now') WHERE id = ? AND user_id = ?`
    ).run(id, userId);
  },

  /** Snooze a loop until a given YYYY-MM-DD date. Loop remains open but is hidden from
   *  briefings and call surfaces until the snooze date passes. User-scoped. */
  snooze: (userId: number, id: number, until: string): void => {
    getDb().prepare(
      `UPDATE open_loops SET snooze_until = ? WHERE id = ? AND user_id = ? AND status = 'open'`
    ).run(until, id, userId);
  },

  /** Clear any active snooze on a loop, making it visible again immediately. */
  unsnooze: (userId: number, id: number): void => {
    getDb().prepare(
      `UPDATE open_loops SET snooze_until = NULL WHERE id = ? AND user_id = ?`
    ).run(id, userId);
  },

  /** Prune done/dismissed loops older than 30 days (retention minimization). Call infrequently. */
  prune: (): void => {
    getDb().prepare(
      `DELETE FROM open_loops WHERE status != 'open' AND resolved_at < datetime('now', '-30 days')`
    ).run();
  },
};

export const supportMessageQueries = {
  insert: (userId: number, type: 'feedback' | 'question' | 'issue', message: string): void => {
    getDb().prepare(
      'INSERT INTO support_messages (user_id, type, message) VALUES (?, ?, ?)'
    ).run(userId, type, message);
  },

  list: (opts: { limit?: number } = {}): Array<{ id: number; userId: number; type: string; message: string; status: string; createdAt: string }> => {
    const limit = opts.limit ?? 100;
    const rows = getDb().prepare(
      'SELECT id, user_id, type, message, status, created_at FROM support_messages ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as Array<{ id: number; user_id: number; type: string; message: string; status: string; created_at: string }>;
    return rows.map(r => ({ id: r.id, userId: r.user_id, type: r.type, message: r.message, status: r.status, createdAt: r.created_at }));
  },
};

export const calendarPlanQueries = {
  // Returns the execution record if this plan was already applied (idempotency check).
  get: (userId: number, planId: string): CalendarPlanExecution | undefined => {
    return getDb().prepare(
      'SELECT * FROM calendar_plan_executions WHERE user_id = ? AND plan_id = ?'
    ).get(userId, planId) as CalendarPlanExecution | undefined;
  },

  // Record that a plan was applied. INSERT OR IGNORE: idempotent on double-submit.
  markApplied: (userId: number, planId: string, mutationCount: number): void => {
    getDb().prepare(
      'INSERT OR IGNORE INTO calendar_plan_executions (user_id, plan_id, mutation_count) VALUES (?, ?, ?)'
    ).run(userId, planId, mutationCount);
  },

  // Record that a plan was reverted (called by undoPlan in lib/undo.ts).
  markReverted: (userId: number, planId: string): void => {
    getDb().prepare(
      "UPDATE calendar_plan_executions SET status = 'reverted', reverted_at = datetime('now') WHERE user_id = ? AND plan_id = ?"
    ).run(userId, planId);
  },
};
