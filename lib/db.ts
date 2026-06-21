import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { isValidTimeZone } from './time';
import { encryptField, encryptNullable, decryptField, decryptNullable, safeDecryptField, safeDecryptNullable } from './crypto';

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
    db.pragma('busy_timeout = 5000'); // wait up to 5s on write contention before throwing
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

// Exported for regression testing: the FULL schema init (CREATE TABLE/INDEX block →
// applyMigrations → deferred indexes). Must succeed against an existing DB that predates
// any migration-added column — see lib/db-migrations.test.ts (prod incident 2026-06-18).
export function initSchema(db: Database.Database) {
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
      is_open_call INTEGER DEFAULT 0,
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

    -- Multi-account Google linking: a SECOND, optional Google account dedicated to Gmail
    -- (e.g. work calendar + personal Gmail). Kept as a separate table (mirroring whoop_tokens)
    -- rather than adding account_type to calendar_tokens — that table's user_id is UNIQUE, so
    -- supporting two accounts there would require rebuilding the encrypted-token table. A new
    -- additive table is zero-migration-risk and yields the same outcome. access/refresh tokens
    -- encrypted at rest; email stored plaintext (display field, same tier as users.email).
    CREATE TABLE IF NOT EXISTS gmail_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expiry TEXT,
      scope TEXT,
      email TEXT,
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

    -- R17 T2 (Core, additive): one-tap post-call quality signal (1–5 stars).
    CREATE TABLE IF NOT EXISTS call_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      briefing_id TEXT,
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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

    -- T4-4 — Webhook-level idempotency gate. Prevents double-processing when Vapi retries
    -- the same end-of-call-report. event_key = "<callId>:<type>". INSERT OR IGNORE is atomic
    -- in SQLite — eliminates the TOCTOU race in the status-flag check. Pruned at 24h via 3am cron.
    CREATE TABLE IF NOT EXISTS webhook_dedup_keys (
      event_key    TEXT PRIMARY KEY,
      processed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- T4-4 — Tool-call idempotency gate. Prevents double-execution of mutations when Vapi
    -- retries a tool call after a transient timeout. toolcall_id comes from Vapi's toolCallList[i].id.
    -- result is stored so concurrent retries can return the same response. Pruned at 10min via 3am cron.
    CREATE TABLE IF NOT EXISTS tool_call_dedup_keys (
      toolcall_id  TEXT PRIMARY KEY,
      result       TEXT NOT NULL DEFAULT '',
      processed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- T0-4 — Single-instance scheduler lock. Guards the per-minute call-dispatch tick so a
    -- second Railway replica (or an overlapping slow tick) can't double-dial the 7am call.
    -- An instance claims the lock atomically before dispatching and releases it after; a lock
    -- with a past expires_at is auto-reclaimable (covers a crashed holder). lock_name is the
    -- resource ('dispatch'); holder is a per-process id; TTL < tick interval so it self-heals.
    CREATE TABLE IF NOT EXISTS scheduler_lock (
      lock_name   TEXT PRIMARY KEY,
      holder      TEXT NOT NULL,
      acquired_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at  TEXT NOT NULL
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
    -- Bi-temporal: valid_from/valid_until enable conflict retirement without hard-delete.
    -- Retired facts (valid_until IS NOT NULL) are historical record; active = valid_until IS NULL.
    CREATE TABLE IF NOT EXISTS facts (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id            INTEGER NOT NULL REFERENCES users(id),
      -- T3-1-A: 'pattern' added so factPatterns can land in the Patterns tab (not Facts).
      -- Additive for new DBs. NOTE: SQLite can't ALTER a CHECK — a long-lived DB created
      -- before this change keeps the old CHECK and would reject category='pattern' INSERTs
      -- until a table rebuild. Given the ephemeral-volume situation, prod DBs initialize fresh
      -- with this CHECK; a deliberate facts rebuild is deferred/flagged (not done unprompted on
      -- the core memory table). Fact inserts are best-effort (try/catch), so no crash either way.
      category           TEXT NOT NULL CHECK(category IN ('person','project','goal','preference','fact','pattern')),
      statement          TEXT NOT NULL,
      entity             TEXT,
      learned_at         TEXT NOT NULL DEFAULT (datetime('now')),
      confidence         TEXT NOT NULL DEFAULT 'high' CHECK(confidence IN ('high','low')),
      source_briefing_id INTEGER REFERENCES briefings(id),
      valid_from         TEXT NOT NULL DEFAULT (datetime('now')),
      valid_until        TEXT,
      confidence_score   REAL NOT NULL DEFAULT 1.0,
      last_confirmed_at  TEXT DEFAULT (datetime('now'))
    );

    -- Immutable audit trail: snapshot of a fact's value before it was retired or updated.
    -- Written before every retire/update — never modified after insert.
    CREATE TABLE IF NOT EXISTS fact_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      fact_id     INTEGER NOT NULL,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      statement   TEXT NOT NULL,
      entity      TEXT,
      category    TEXT NOT NULL,
      retired_at  TEXT NOT NULL DEFAULT (datetime('now')),
      reason      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_fact_history_fact ON fact_history(fact_id);
    CREATE INDEX IF NOT EXISTS idx_fact_history_user ON fact_history(user_id, retired_at DESC);

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
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date              TEXT NOT NULL,
      focus_areas       TEXT NOT NULL DEFAULT '[]',
      generated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      confirmed         INTEGER NOT NULL DEFAULT 0,
      dismissed_titles  TEXT NOT NULL DEFAULT '[]',
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

    -- Public landing-page waitlist signups (no auth — pre-account).
    CREATE TABLE IF NOT EXISTS waitlist (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      email      TEXT NOT NULL UNIQUE,
      source     TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Relationship Memory (M2) — per-person interaction index.
    -- Built from calendar attendees; tracks how often + when each person interacts.
    -- updated_at set on every sync so staleness can be detected.
    CREATE TABLE IF NOT EXISTS people_profiles (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      canonical_name       TEXT NOT NULL,
      email                TEXT,
      interaction_count    INTEGER NOT NULL DEFAULT 0,
      last_interaction     TEXT,      -- ISO date of most recent past event with this person
      upcoming_interaction TEXT,      -- ISO date of next future event (if any)
      updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_people_profiles_unique
      ON people_profiles(user_id, canonical_name);

    -- Round 8 (M4-4): social mental models — what Edge knows about the people in the
    -- user's life (Core writes via Darren's social-model pipeline). goals/communication_style/
    -- relationship_state/last_interaction are encrypted at rest (PII about third parties);
    -- person_name stays plaintext as the UNIQUE lookup key (same tier as people_profiles.canonical_name).
    CREATE TABLE IF NOT EXISTS people_models (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      person_name         TEXT NOT NULL,
      goals               TEXT,
      communication_style TEXT,
      relationship_state  TEXT,
      last_interaction    TEXT,
      health_score        REAL NOT NULL DEFAULT 1.0,
      updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, person_name)
    );

    -- Pattern cache: computed behavioral patterns from calendar + Whoop history.
    -- One row per user, refreshed on each briefing call (fire-and-forget).
    -- Stores a JSON array of PatternInsight objects; computed_at for freshness.
    CREATE TABLE IF NOT EXISTS pattern_cache (
      user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      patterns    TEXT NOT NULL DEFAULT '[]',
      computed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Episode store (episodic memory tier).
    -- content_raw is the preserved call transcript (or lightly-processed record for email/calendar).
    -- Encrypted at rest — this is the rawest PII we hold; never leaks cross-user.
    -- topics + commitments are JSON string[] — tagged at write time; used for briefing recall.
    -- Retention: rows older than 18 months may be pruned; episodeQueries.prune() handles it.
    CREATE TABLE IF NOT EXISTS episodes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source       TEXT NOT NULL CHECK(source IN ('call', 'calendar', 'email')),
      occurred_at  TEXT NOT NULL,
      content_raw  TEXT NOT NULL,
      topics       TEXT NOT NULL DEFAULT '[]',
      commitments  TEXT NOT NULL DEFAULT '[]',
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- OAuth CSRF state tokens — one-time-use, short-lived (10 min).
    -- Generated in /api/[calendar|whoop]/connect; consumed (verified + deleted) in /api/[...]/callback.
    CREATE TABLE IF NOT EXISTS oauth_state (
      state      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      flow       TEXT NOT NULL CHECK(flow IN ('calendar','whoop','gmail')),
      expires_at TEXT NOT NULL
    );

    -- Pre-warmed briefing context generated nightly before the user's morning call.
    -- Reduces cold-start latency. One row per user per day; upsert on regeneration.
    -- context_pack encrypted at rest (contains memory content).
    CREATE TABLE IF NOT EXISTS briefing_context_packs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id),
      pack_date    TEXT NOT NULL,
      context_pack TEXT NOT NULL,
      generated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, pack_date)
    );

    -- Dead-letter queue for webhook calls that failed even after retry.
    -- Populated by lib/scheduler.ts when the DB-flagged retry also fails.
    -- Daily check logs a warning to Railway if any rows exist in the last 24h.
    CREATE TABLE IF NOT EXISTS failed_webhooks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
      vapi_call_id TEXT,
      briefing_id INTEGER REFERENCES briefings(id) ON DELETE SET NULL,
      failed_at   TEXT NOT NULL DEFAULT (datetime('now')),
      error       TEXT NOT NULL
    );

    -- Structured failure log for background cron jobs (sleep-time consolidation,
    -- pattern detection, predictive context loading, etc.). Populated by the cron
    -- runners in lib/scheduler.ts. Retained for 30 days; pruned on each daily run.
    CREATE TABLE IF NOT EXISTS background_job_failures (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      job         TEXT NOT NULL,
      user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
      failed_at   TEXT NOT NULL DEFAULT (datetime('now')),
      error       TEXT NOT NULL,
      consecutive INTEGER NOT NULL DEFAULT 1
    );

    -- System-level health log written by the 6am health digest cron (runs before the
    -- 7am call). One row per check; no user_id — this is infrastructure-level state.
    -- Status 'ok' = all systems nominal; 'degraded' = at least one failure category.
    -- Core / Design can surface this in an admin panel. Retained for 30 days.
    CREATE TABLE IF NOT EXISTS health_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      status     TEXT NOT NULL CHECK(status IN ('ok', 'degraded')),
      summary    TEXT NOT NULL,
      checked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Per-attempt log for every scheduled morning call (DC1-1). Written before Vapi
    -- is contacted so even early failures are captured. status = connected on success,
    -- failed on all-retries-exhausted, retrying on the first failure (retry pending).
    CREATE TABLE IF NOT EXISTS call_attempts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scheduled_for TEXT NOT NULL,
      status        TEXT NOT NULL CHECK(status IN ('connected', 'failed', 'retrying')),
      fail_reason   TEXT,
      attempted_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- R14 — Web Push (VAPID) subscriptions. One row per browser/device endpoint per user.
    -- endpoint/p256dh/auth are the W3C PushSubscription fields (per-device push credentials,
    -- not user PII) — stored plaintext, same tier as a device token.
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint   TEXT NOT NULL,
      p256dh     TEXT NOT NULL,
      auth       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, endpoint)
    );

    -- R14 — Notification send log. Gates repeat proactive notifications (low-recovery,
    -- priority-gap) so we don't re-notify the same thing within a window.
    CREATE TABLE IF NOT EXISTS notification_log (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type    TEXT NOT NULL,
      payload TEXT,
      sent_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    -- NOTE: idx_facts_active references facts.valid_until, a MIGRATION-added column. It must
    -- NOT live in this pre-migration block — on an existing DB whose facts table predates
    -- valid_until, creating it here throws "no such column" and aborts the whole schema exec
    -- BEFORE migrations run (leaving valid_until/retry_after/etc. unapplied). It's created in
    -- applyMigrations() AFTER the column is added (see DEFERRED_INDEXES). Prod incident 2026-06-18.
    CREATE INDEX IF NOT EXISTS idx_whoop_tokens_user ON whoop_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_energy_log_user_date ON energy_log(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_focus_milestones_user ON focus_milestones(user_id, priority_id);
    CREATE INDEX IF NOT EXISTS idx_calendar_scores_user_date ON calendar_scores(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_event_energy_tags_user ON event_energy_tags(user_id, google_event_id);
    CREATE INDEX IF NOT EXISTS idx_daily_focus_user_date ON daily_focus(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_calendar_plan_executions_user ON calendar_plan_executions(user_id, plan_id);
    CREATE INDEX IF NOT EXISTS idx_open_loops_user ON open_loops(user_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_people_profiles_user ON people_profiles(user_id, interaction_count DESC);
    CREATE INDEX IF NOT EXISTS idx_episodes_user_occurred ON episodes(user_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_context_packs_user_date ON briefing_context_packs(user_id, pack_date);
    CREATE INDEX IF NOT EXISTS idx_failed_webhooks_failed_at ON failed_webhooks(failed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bg_job_failures_job_user ON background_job_failures(job, user_id, failed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_health_log_checked_at ON health_log(checked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_call_attempts_user ON call_attempts(user_id, attempted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_notification_log_user_type ON notification_log(user_id, type, sent_at DESC);
  `);

  applyMigrations(db);
}

// Additive ALTER-TABLE migrations for databases that predate a column. Each is wrapped in
// try/catch so an "already exists" (or non-constant-default) error on one NEVER aborts the
// rest — that independence is the whole point. Exported for regression testing.
//
// ORDERING RULE (prod incident 2026-06-18): any index that references a migration-added
// column MUST be created AFTER this loop (see DEFERRED_INDEXES below), never in the
// pre-migration CREATE block — otherwise it throws on existing DBs and blocks all migrations.
export const SCHEMA_MIGRATIONS: readonly string[] = [
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
  // Round 5 — bi-temporal facts (Graphiti model). valid_from is added nullable here; a fresh
  // DB gets it NOT NULL DEFAULT via CREATE TABLE. (SQLite can't ALTER-ADD a NOT NULL column
  // with a non-constant default like datetime('now'), so the migrated form stays nullable —
  // harmless: read paths treat valid_until IS NULL as "active" and don't require valid_from.)
  "ALTER TABLE facts ADD COLUMN valid_from TEXT",
  "ALTER TABLE facts ADD COLUMN valid_until TEXT",
  "ALTER TABLE open_loops ADD COLUMN snooze_until TEXT",
  "ALTER TABLE daily_focus ADD COLUMN dismissed_titles TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE users ADD COLUMN data_consent TEXT CHECK(data_consent IN ('improve', 'privacy'))",
  "ALTER TABLE users ADD COLUMN voice_preference TEXT NOT NULL DEFAULT 'daniel'",
  // R12 T6 — per-user speaking-speed preset (slow/default/fast) applied on every call.
  "ALTER TABLE users ADD COLUMN voice_speed TEXT NOT NULL DEFAULT 'default'",
  "ALTER TABLE people_profiles ADD COLUMN email TEXT",
  // Round 6 T2 — confidence decay (0.0–1.0; decays weekly; below 0.3 = unverified)
  "ALTER TABLE facts ADD COLUMN confidence_score REAL NOT NULL DEFAULT 1.0",
  "ALTER TABLE facts ADD COLUMN last_confirmed_at TEXT DEFAULT (datetime('now'))",
  // Retry durability: DB-flagged retry time survives server restarts (replaces in-memory setTimeout)
  "ALTER TABLE briefings ADD COLUMN retry_after TEXT",
  // Learning pipeline reliability: per-call extraction status (success/partial/failed)
  "ALTER TABLE briefings ADD COLUMN learning_status TEXT",
  // T4-1 — track consecutive Google auth failures; flag when refresh fails 3+ times
  "ALTER TABLE calendar_tokens ADD COLUMN calendar_auth_failures INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE calendar_tokens ADD COLUMN calendar_reconnect_required INTEGER NOT NULL DEFAULT 0",
  // Multi-account: oauth_state.flow CHECK was ('calendar','whoop') — recreate to allow 'gmail'.
  // Rows are ephemeral CSRF tokens (minutes TTL), so dropping non-matching rows on rebuild is fine.
  "ALTER TABLE oauth_state RENAME TO oauth_state_old; CREATE TABLE oauth_state (state TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), flow TEXT NOT NULL CHECK(flow IN ('calendar','whoop','gmail')), expires_at TEXT NOT NULL); INSERT OR IGNORE INTO oauth_state SELECT state, user_id, flow, expires_at FROM oauth_state_old WHERE flow IN ('calendar','whoop'); DROP TABLE oauth_state_old",
  // R12 T4 — distinguish ad-hoc open calls from scheduled morning briefings for Momentum scoring.
  "ALTER TABLE briefings ADD COLUMN is_open_call INTEGER DEFAULT 0",
  // Backfill historical open calls (scheduleOpenCall prefixes their content with '[Open call]').
  "UPDATE briefings SET is_open_call = 1 WHERE is_open_call = 0 AND content LIKE '[Open call]%'",
];

// Indexes that reference migration-added columns. Created AFTER SCHEMA_MIGRATIONS so the
// column is guaranteed to exist. Each is try/caught for the same independence guarantee.
export const DEFERRED_INDEXES: readonly string[] = [
  "CREATE INDEX IF NOT EXISTS idx_facts_active ON facts(user_id, category, valid_until)",
];

export function applyMigrations(db: Database.Database): void {
  for (const migration of SCHEMA_MIGRATIONS) {
    try { db.exec(migration); } catch { /* column already exists / non-constant default — skip */ }
  }
  // Column-dependent indexes run only after the columns above are guaranteed present.
  for (const idx of DEFERRED_INDEXES) {
    try { db.exec(idx); } catch (e) { console.error('[db] deferred index failed:', idx, e); }
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
  incrementSessionVersion: (id: number) => {
    return getDb().prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ?').run(id);
  },
  setDataConsent: (id: number, consent: 'improve' | 'privacy') => {
    return getDb().prepare('UPDATE users SET data_consent = ? WHERE id = ?').run(consent, id);
  },
  setVoicePreference: (id: number, pref: 'daniel' | 'aria') => {
    return getDb().prepare("UPDATE users SET voice_preference = ? WHERE id = ?").run(pref, id);
  },
  // R12 T6 — set the user's speaking-speed preset.
  setVoiceSpeed: (id: number, speed: 'slow' | 'default' | 'fast') => {
    return getDb().prepare("UPDATE users SET voice_speed = ? WHERE id = ?").run(speed, id);
  },
};

// OAuth CSRF state — one-time-use tokens that bind a flow to a userId.
export const oauthStateQueries = {
  create: (state: string, userId: number, flow: 'calendar' | 'whoop' | 'gmail'): void => {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10-minute TTL
    getDb().prepare(
      'INSERT OR REPLACE INTO oauth_state (state, user_id, flow, expires_at) VALUES (?, ?, ?, ?)'
    ).run(state, userId, flow, expiresAt);
  },
  // Atomically verify + delete a state token. Returns {userId, flow} on success; null if missing/expired.
  consume: (state: string): { userId: number; flow: string } | null => {
    const db = getDb();
    const row = db.prepare(
      "SELECT user_id, flow FROM oauth_state WHERE state = ? AND expires_at > datetime('now')"
    ).get(state) as { user_id: number; flow: string } | undefined;
    if (!row) return null;
    db.prepare('DELETE FROM oauth_state WHERE state = ?').run(state);
    return { userId: row.user_id, flow: row.flow };
  },
  // Prune expired tokens (called from cron — defensive cleanup).
  prune: (): void => {
    getDb().prepare("DELETE FROM oauth_state WHERE expires_at <= datetime('now')").run();
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
  // Read-only history: priorities across the most recent N distinct weeks (newest first),
  // for priority-drift pattern detection (M2-3). text is plaintext (not encrypted at rest).
  getRecentWeeks: (userId: number, weeks = 8): Priority[] => {
    return getDb().prepare(
      `SELECT * FROM priorities WHERE user_id = ? AND week_of IN (
         SELECT DISTINCT week_of FROM priorities WHERE user_id = ? ORDER BY week_of DESC LIMIT ?
       ) ORDER BY week_of DESC, rank`
    ).all(userId, userId, weeks) as Priority[];
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
// Memory content is PII (transcripts, insights, personal context) — encrypted at rest.
// Legacy plaintext rows transparently pass through decryptField (see lib/crypto.ts design).
function decryptMemoryRow(r: Memory): Memory {
  return { ...r, content: safeDecryptField(r.content, 'memory.content') };
}

// Special content tags that determine priority in getWeighted().
// These are stored inside the (encrypted) content; getWeighted() fetches a
// generous window and filters after decryption so LIKE can't be used.
const HIGH_PRIORITY_TAGS = ['[USER NOTE]', '[PRIORITY CHANGE]', '[TRAVEL TIMEZONE]'];

export const memoryQueries = {
  create: (userId: number, type: string, content: string, metadata?: string) => {
    return getDb().prepare(
      'INSERT INTO memories (user_id, type, content, metadata) VALUES (?, ?, ?, ?)'
    ).run(userId, type, encryptField(content), metadata || null);
  },
  getRecent: (userId: number, limit = 20) => {
    return (getDb().prepare(
      'SELECT * FROM memories WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(userId, limit) as Memory[]).map(decryptMemoryRow);
  },
  getWeighted: (userId: number, limit = 20) => {
    // Content is encrypted — LIKE queries can't search it. Fetch a generous window
    // (200 most recent rows) and apply priority filtering in JS after decryption.
    const all = (getDb().prepare(
      'SELECT * FROM memories WHERE user_id = ? ORDER BY created_at DESC LIMIT 200'
    ).all(userId) as Memory[]).map(decryptMemoryRow);

    // Priority: explicit user notes and priority changes always first,
    // then recent insights, then transcripts (deduped to avoid noise).
    const high = all
      .filter(m => HIGH_PRIORITY_TAGS.some(t => m.content.includes(t)))
      .slice(0, 10);
    const insights = all
      .filter(m => m.type === 'insight')
      .slice(0, 8);
    const recent = all
      .filter(m =>
        !['profile', 'transcript'].includes(m.type) &&
        !HIGH_PRIORITY_TAGS.some(t => m.content.includes(t))
      )
      .slice(0, 5);

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
    return (getDb().prepare(
      'SELECT * FROM memories WHERE user_id = ? AND type = ? ORDER BY created_at DESC LIMIT ?'
    ).all(userId, type, limit) as Memory[]).map(decryptMemoryRow);
  },
  // NOTE: searchContent and countTopicMentions use LIKE on content — they are
  // unused (no callers) and would not function on encrypted content. Left defined
  // in case a caller is added; a future caller must switch to in-JS filtering.
  searchContent: (userId: number, keyword: string) => {
    return (getDb().prepare(
      "SELECT * FROM memories WHERE user_id = ? AND content LIKE ? ORDER BY created_at DESC LIMIT 10"
    ).all(userId, `%${keyword}%`) as Memory[]).map(decryptMemoryRow);
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
  updateLearningStatus: (briefingId: number, update: Record<string, unknown>): void => {
    try {
      const row = getDb().prepare('SELECT learning_status FROM briefings WHERE id = ?').get(briefingId) as { learning_status: string | null } | undefined;
      let current: Record<string, unknown> = {};
      try { if (row?.learning_status) current = JSON.parse(row.learning_status); } catch { /* ok */ }
      getDb().prepare('UPDATE briefings SET learning_status = ? WHERE id = ?')
        .run(JSON.stringify({ ...current, ...update }), briefingId);
    } catch { /* non-fatal — learning status is observability only */ }
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
  // R12 T4 — count completed ad-hoc open calls in the last N days (not day-bucketed) for Momentum.
  getOpenCallCount: (userId: number, days: number): number => {
    const row = getDb().prepare(
      `SELECT COUNT(*) as n FROM briefings WHERE user_id = ? AND is_open_call = 1 AND status = 'completed' AND scheduled_for >= datetime('now', ?)`
    ).get(userId, `-${days} days`) as { n: number };
    return row?.n ?? 0;
  },
  // R12 T4 — set the open-call flag (called by scheduleOpenCall right after insert).
  markOpenCall: (id: number): void => {
    getDb().prepare('UPDATE briefings SET is_open_call = 1 WHERE id = ?').run(id);
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
  // T4-1 — auth failure tracking. Increments failure counter; sets reconnect_required after 3+ failures.
  recordAuthFailure: (userId: number): void => {
    try {
      const db = getDb();
      const failures = db.prepare(
        'UPDATE calendar_tokens SET calendar_auth_failures = calendar_auth_failures + 1 WHERE user_id = ?'
      ).run(userId);
      if (failures.changes === 0) return;
      const row = db.prepare('SELECT calendar_auth_failures FROM calendar_tokens WHERE user_id = ?').get(userId) as { calendar_auth_failures: number } | undefined;
      if (row && row.calendar_auth_failures >= 3) {
        db.prepare('UPDATE calendar_tokens SET calendar_reconnect_required = 1 WHERE user_id = ?').run(userId);
        console.error(`[calendar-auth] ALERT: userId=${userId} has had ${row.calendar_auth_failures} consecutive auth failures — flagged for reconnect`);
      }
    } catch { /* best effort */ }
  },
  clearAuthFailures: (userId: number): void => {
    try {
      getDb().prepare(
        'UPDATE calendar_tokens SET calendar_auth_failures = 0, calendar_reconnect_required = 0 WHERE user_id = ?'
      ).run(userId);
    } catch { /* best effort */ }
  },
  needsReconnect: (userId: number): boolean => {
    const row = getDb().prepare('SELECT calendar_reconnect_required FROM calendar_tokens WHERE user_id = ?').get(userId) as { calendar_reconnect_required: number } | undefined;
    return (row?.calendar_reconnect_required ?? 0) === 1;
  },
};

export interface GmailToken {
  id: number;
  user_id: number;
  access_token: string;
  refresh_token: string | null;
  expiry: string | null;
  scope: string | null;
  email: string | null;
  updated_at: string;
}

// Multi-account: tokens for an optional SECOND Google account dedicated to Gmail.
// Mirrors calendarQueries' encryption (access/refresh encrypted; email plaintext display
// field). One row per user (user_id UNIQUE) — upsert replaces.
export const gmailTokenQueries = {
  upsert: (userId: number, accessToken: string, refreshToken: string | null, expiry: string | null, scope?: string | null, email?: string | null) => {
    return getDb().prepare(`
      INSERT INTO gmail_tokens (user_id, access_token, refresh_token, expiry, scope, email, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expiry = excluded.expiry,
        scope = COALESCE(excluded.scope, gmail_tokens.scope),
        email = COALESCE(excluded.email, gmail_tokens.email),
        updated_at = excluded.updated_at
    `).run(userId, encryptField(accessToken), encryptNullable(refreshToken), expiry ?? null, scope ?? null, email ?? null);
  },
  get: (userId: number): GmailToken | undefined => {
    const row = getDb().prepare('SELECT * FROM gmail_tokens WHERE user_id = ?').get(userId) as GmailToken | undefined;
    if (!row) return undefined;
    // Decrypt transparently — legacy plaintext rows pass through unchanged.
    row.access_token = decryptField(row.access_token);
    row.refresh_token = decryptNullable(row.refresh_token);
    return row;
  },
  delete: (userId: number) => {
    return getDb().prepare('DELETE FROM gmail_tokens WHERE user_id = ?').run(userId);
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
  existsToday: (userId: number, type: string): boolean => {
    const now = Date.now();
    const todayStart = now - (now % 86400000); // UTC midnight today in ms
    const row = getDb().prepare(
      'SELECT 1 FROM notifications WHERE user_id = ? AND type = ? AND created_at >= ? LIMIT 1'
    ).get(userId, type, todayStart) as { 1: number } | undefined;
    return !!row;
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

// T4-4 — Webhook-level idempotency (prevents double-processing on Vapi webhook retries).
export const webhookDedupeQueries = {
  claim: (eventKey: string): boolean => {
    try {
      const r = getDb().prepare('INSERT OR IGNORE INTO webhook_dedup_keys (event_key) VALUES (?)').run(eventKey);
      return r.changes === 1; // true = first occurrence, false = duplicate
    } catch { return true; } // fail open — never block webhook processing on a DB fault
  },
  prune: (): void => {
    getDb().prepare("DELETE FROM webhook_dedup_keys WHERE processed_at < datetime('now', '-24 hours')").run();
  },
};

// T4-4 — Tool-call idempotency (prevents double-execution on Vapi retry storms).
export const toolCallDedupeQueries = {
  claim: (toolCallId: string): boolean => {
    try {
      const r = getDb().prepare('INSERT OR IGNORE INTO tool_call_dedup_keys (toolcall_id) VALUES (?)').run(toolCallId);
      return r.changes === 1; // true = new, false = duplicate
    } catch { return true; } // fail open
  },
  recordResult: (toolCallId: string, result: string): void => {
    try {
      getDb().prepare('UPDATE tool_call_dedup_keys SET result = ? WHERE toolcall_id = ?').run(result.slice(0, 2000), toolCallId);
    } catch { /* non-critical */ }
  },
  getCached: (toolCallId: string): string | null => {
    try {
      const row = getDb().prepare('SELECT result FROM tool_call_dedup_keys WHERE toolcall_id = ?').get(toolCallId) as { result: string } | undefined;
      return row && row.result ? row.result : null;
    } catch { return null; }
  },
  prune: (): void => {
    getDb().prepare("DELETE FROM tool_call_dedup_keys WHERE processed_at < datetime('now', '-10 minutes')").run();
  },
};

// T0-4 — Single-instance scheduler lock. Atomic claim via SQLite upsert so only one
// instance dispatches the per-minute call tick (defends against multi-replica double-dial
// and overlapping slow ticks). A held lock blocks others until expires_at; an expired lock
// is reclaimable; an instance can always refresh its own lock.
export const schedulerLockQueries = {
  // Returns true if this holder now owns the lock. ttlSeconds should be < the tick interval
  // so a crashed holder's lock self-expires before the next tick (no permanent deadlock).
  acquire: (lockName: string, holder: string, ttlSeconds: number): boolean => {
    try {
      const r = getDb().prepare(
        `INSERT INTO scheduler_lock (lock_name, holder, acquired_at, expires_at)
         VALUES (?, ?, datetime('now'), datetime('now', ?))
         ON CONFLICT(lock_name) DO UPDATE SET
           holder = excluded.holder,
           acquired_at = excluded.acquired_at,
           expires_at = excluded.expires_at
         WHERE scheduler_lock.expires_at < datetime('now')
            OR scheduler_lock.holder = excluded.holder`,
      ).run(lockName, holder, `+${Math.max(1, Math.floor(ttlSeconds))} seconds`);
      return r.changes === 1;
    } catch {
      // Fail OPEN: a DB fault must not stop the morning call from ever firing. Within a
      // single instance the existing alreadyCalled guard still prevents duplicates.
      return true;
    }
  },
  // Release only if we still hold it (don't stomp a lock another instance reclaimed after expiry).
  release: (lockName: string, holder: string): void => {
    try {
      getDb().prepare('DELETE FROM scheduler_lock WHERE lock_name = ? AND holder = ?').run(lockName, holder);
    } catch { /* non-critical — lock self-expires via TTL */ }
  },
  // Current holder + expiry, for diagnostics when an acquire is refused. Null if free/unknown.
  currentHolder: (lockName: string): { holder: string; expires_at: string } | null => {
    try {
      const row = getDb().prepare('SELECT holder, expires_at FROM scheduler_lock WHERE lock_name = ?').get(lockName) as { holder: string; expires_at: string } | undefined;
      return row ?? null;
    } catch { return null; }
  },
};

// T3-4 — Ordered list of every user-scoped table, deleted leaf-first so foreign keys
// (incl. inter-child FKs like facts.source_briefing_id → briefings) are satisfied with
// foreign_keys = ON. Single source of truth: the deletion route AND the drift-guard test
// both read this, so adding a user-scoped table without adding it here fails the test.
// `users` is intentionally absent — it is deleted last, after all children.
export const USER_SCOPED_DELETE_ORDER: readonly string[] = [
  'open_loops',
  'calendar_plan_executions',
  'daily_focus',
  'event_energy_tags',
  'calendar_scores',
  'energy_profile',
  'focus_milestones',
  'energy_log',
  'whoop_tokens',
  'calendar_tokens',
  'gmail_tokens',
  'gmail_drafts_log',
  'watched_threads',
  'notifications',
  'audit_log',
  'support_messages',
  'fact_history',     // user_id → users; no FK to facts (fact_id is a plain int)
  'facts',            // has FK source_briefing_id → briefings; delete before briefings
  'briefings',
  'preview_briefings',
  'memories',
  'priorities',
  'tasks',
  'call_feedback',
  'undo_log',
  'event_dedupe_keys',
  'delete_confirm_tokens',
  'oauth_state',
  'briefing_context_packs',
  'episodes',
  'people_profiles',
  'people_models',
  'pattern_cache',
  'failed_webhooks',
  'background_job_failures',
  'call_attempts',
  'push_subscriptions',
  'notification_log',
];

// ── Encrypted-column inventory (R11 T3 — key rotation authority) ─────────────────
// Every column that stores `enc:`-prefixed ciphertext at rest, with its primary-key
// column. `reEncryptAllUserData` (lib/crypto.ts) iterates this to re-key all data when
// DATA_ENCRYPTION_KEY rotates. ⚠️ MUST stay in sync with the schema: if you add an
// `encryptField`/`encryptNullable` write to a NEW column, ADD IT HERE — a missed column
// becomes permanently unreadable after a key swap. `idColumn` is the row PK used for the
// UPDATE … WHERE. Guarded by a cross-reference test in lib/key-rotation.test.ts.
export interface EncryptedColumnSpec { table: string; idColumn: string; columns: readonly string[]; }
export const ENCRYPTED_COLUMNS: readonly EncryptedColumnSpec[] = [
  { table: 'memories',               idColumn: 'id', columns: ['content'] },
  { table: 'briefings',              idColumn: 'id', columns: ['transcript', 'user_response'] },
  { table: 'calendar_tokens',        idColumn: 'user_id', columns: ['access_token', 'refresh_token'] },
  { table: 'gmail_tokens',           idColumn: 'user_id', columns: ['access_token', 'refresh_token'] },
  { table: 'whoop_tokens',           idColumn: 'user_id', columns: ['access_token', 'refresh_token'] },
  { table: 'gmail_drafts_log',       idColumn: 'id', columns: ['recipient', 'subject'] },
  { table: 'watched_threads',        idColumn: 'id', columns: ['recipient', 'context'] },
  { table: 'notifications',          idColumn: 'id', columns: ['title', 'body'] },
  { table: 'facts',                  idColumn: 'id', columns: ['statement'] },
  { table: 'fact_history',           idColumn: 'id', columns: ['statement'] },
  { table: 'focus_milestones',       idColumn: 'id', columns: ['title'] },
  { table: 'briefing_context_packs', idColumn: 'id', columns: ['context_pack'] },
  { table: 'people_models',          idColumn: 'id', columns: ['goals', 'communication_style', 'relationship_state', 'last_interaction'] },
  { table: 'pattern_cache',          idColumn: 'user_id', columns: ['patterns'] }, // PK is user_id (no id col)
  { table: 'daily_focus',            idColumn: 'id', columns: ['focus_areas'] },
  { table: 'open_loops',             idColumn: 'id', columns: ['description'] },
  { table: 'support_messages',       idColumn: 'id', columns: ['message'] },
  { table: 'episodes',               idColumn: 'id', columns: ['content_raw'] },
  { table: 'audit_log',              idColumn: 'id', columns: ['snapshot_after'] },
];

// T3-4 — Permanently delete all of a user's data, then the user row. Wrapped in a
// transaction so a missing-table FK error rolls the whole thing back (no half-deleted
// account) instead of leaving orphaned rows. Throws on failure — caller returns 500.
export function deleteUserData(userId: number): void {
  const db = getDb();
  const tx = db.transaction((uid: number) => {
    for (const table of USER_SCOPED_DELETE_ORDER) {
      db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(uid);
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(uid);
  });
  tx(userId);
}

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

  /**
   * Clear encrypted email subjects from audit entries older than `days` days.
   * Nulls snapshot_after on email_signal_fetch rows — the "N threads reviewed"
   * record survives, but the subject content is purged on schedule.
   * Runs nightly from the scheduler; also triggers the standard 1%-chance full prune.
   */
  pruneEmailSubjects: (days = 90): void => {
    getDb().prepare(
      `UPDATE audit_log
         SET snapshot_after = NULL
       WHERE action = 'email_signal_fetch'
         AND snapshot_after IS NOT NULL
         AND created_at < datetime('now', ?)`
    ).run(`-${days} days`);
  },
};

// Failed webhook dead-letter queue
export const failedWebhookQueries = {
  record: (userId: number | null, vapiCallId: string | null, briefingId: number | null, error: string): void => {
    try {
      getDb().prepare(
        'INSERT INTO failed_webhooks (user_id, vapi_call_id, briefing_id, error) VALUES (?, ?, ?, ?)'
      ).run(userId, vapiCallId, briefingId, error.slice(0, 2000));
    } catch { /* best effort — never block the caller */ }
  },

  recentCount: (sinceHours = 24): number => {
    const row = getDb().prepare(
      `SELECT COUNT(*) AS n FROM failed_webhooks WHERE failed_at >= datetime('now', ?)`
    ).get(`-${sinceHours} hours`) as { n: number };
    return row.n;
  },

  prune: (keepDays = 30): void => {
    try {
      getDb().prepare(
        `DELETE FROM failed_webhooks WHERE failed_at < datetime('now', ?)`
      ).run(`-${keepDays} days`);
    } catch { /* best effort */ }
  },
};

// Background job failure log — structured error records for cron jobs
export const backgroundJobFailureQueries = {
  record: (job: string, userId: number | null, error: string): void => {
    try {
      // Count consecutive failures for this job+user pair to surface persistent problems.
      const prev = getDb().prepare(
        `SELECT consecutive FROM background_job_failures WHERE job = ? AND (user_id = ? OR (user_id IS NULL AND ? IS NULL)) ORDER BY failed_at DESC LIMIT 1`
      ).get(job, userId, userId) as { consecutive: number } | undefined;
      const consecutive = (prev?.consecutive ?? 0) + 1;
      getDb().prepare(
        'INSERT INTO background_job_failures (job, user_id, error, consecutive) VALUES (?, ?, ?, ?)'
      ).run(job, userId, error.slice(0, 2000), consecutive);
      if (consecutive >= 3) {
        console.error(`[job-failures] ALERT: job="${job}" userId=${userId} has failed ${consecutive} consecutive times`);
      }
    } catch { /* best effort */ }
  },

  recentCount: (sinceHours = 24): number => {
    const row = getDb().prepare(
      `SELECT COUNT(*) AS n FROM background_job_failures WHERE failed_at >= datetime('now', ?)`
    ).get(`-${sinceHours} hours`) as { n: number };
    return row.n;
  },

  maxConsecutive: (job: string, sinceHours = 168): number => {
    const row = getDb().prepare(
      `SELECT MAX(consecutive) AS m FROM background_job_failures WHERE job = ? AND failed_at >= datetime('now', ?)`
    ).get(job, `-${sinceHours} hours`) as { m: number | null };
    return row.m ?? 0;
  },

  prune: (keepDays = 30): void => {
    try {
      getDb().prepare(
        `DELETE FROM background_job_failures WHERE failed_at < datetime('now', ?)`
      ).run(`-${keepDays} days`);
    } catch { /* best effort */ }
  },
};

// System health log — written by the 6am health digest cron (T1-3)
export const healthLogQueries = {
  write: (status: 'ok' | 'degraded', summary: string): void => {
    try {
      getDb().prepare(
        'INSERT INTO health_log (status, summary) VALUES (?, ?)'
      ).run(status, summary.slice(0, 2000));
    } catch { /* best effort */ }
  },
  getLatest: (): { status: string; summary: string; checked_at: string } | undefined => {
    return getDb().prepare(
      'SELECT status, summary, checked_at FROM health_log ORDER BY checked_at DESC LIMIT 1'
    ).get() as { status: string; summary: string; checked_at: string } | undefined;
  },
  prune: (keepDays = 30): void => {
    try {
      getDb().prepare(
        `DELETE FROM health_log WHERE checked_at < datetime('now', ?)`
      ).run(`-${keepDays} days`);
    } catch { /* best effort */ }
  },
};

// Call attempt log — one row per scheduled call attempt (DC1-1)
export const callAttemptQueries = {
  record: (userId: number, scheduledFor: string, status: 'connected' | 'failed' | 'retrying', failReason?: string): void => {
    try {
      getDb().prepare(
        'INSERT INTO call_attempts (user_id, scheduled_for, status, fail_reason) VALUES (?, ?, ?, ?)'
      ).run(userId, scheduledFor, status, failReason ?? null);
    } catch { /* best effort */ }
  },
  getRecent: (userId: number, sinceHours = 24): Array<{ status: string; fail_reason: string | null; attempted_at: string }> => {
    return getDb().prepare(
      `SELECT status, fail_reason, attempted_at FROM call_attempts WHERE user_id = ? AND attempted_at >= datetime('now', ?) ORDER BY attempted_at DESC`
    ).all(userId, `-${sinceHours} hours`) as Array<{ status: string; fail_reason: string | null; attempted_at: string }>;
  },
  failedCount: (sinceHours = 24): number => {
    const row = getDb().prepare(
      `SELECT COUNT(*) AS n FROM call_attempts WHERE status = 'failed' AND attempted_at >= datetime('now', ?)`
    ).get(`-${sinceHours} hours`) as { n: number };
    return row.n;
  },
  prune: (keepDays = 30): void => {
    try {
      getDb().prepare(
        `DELETE FROM call_attempts WHERE attempted_at < datetime('now', ?)`
      ).run(`-${keepDays} days`);
    } catch { /* best effort */ }
  },
};

// R14 — Web Push subscriptions (one row per device endpoint per user).
export interface PushSubscriptionRow { id: number; user_id: number; endpoint: string; p256dh: string; auth: string; created_at: string; }
export const pushSubscriptionQueries = {
  upsert: (userId: number, endpoint: string, p256dh: string, auth: string): void => {
    getDb().prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`
    ).run(userId, endpoint, p256dh, auth);
  },
  getAll: (userId: number): PushSubscriptionRow[] => {
    return getDb().prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId) as PushSubscriptionRow[];
  },
  delete: (userId: number, endpoint: string): void => {
    getDb().prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, endpoint);
  },
};

// R14 — Notification send log. Gates repeat proactive notifications within a window.
export const notificationLogQueries = {
  record: (userId: number, type: string, payload?: string | null): void => {
    try {
      getDb().prepare('INSERT INTO notification_log (user_id, type, payload) VALUES (?, ?, ?)').run(userId, type, payload ?? null);
    } catch { /* best effort */ }
  },
  /** True if a notification of `type` was sent to the user within the last `withinHours`. */
  hasRecentEntry: (userId: number, type: string, withinHours: number): boolean => {
    const row = getDb().prepare(
      `SELECT 1 FROM notification_log WHERE user_id = ? AND type = ? AND sent_at >= datetime('now', ?) LIMIT 1`
    ).get(userId, type, `-${withinHours} hours`) as { 1: number } | undefined;
    return !!row;
  },
  /** Most-recent N proactive notifications for a user, newest first (for the history panel). */
  listForUser: (userId: number, limit = 10): Array<{ type: string; payload: string | null; sent_at: string }> => {
    return getDb().prepare(
      'SELECT type, payload, sent_at FROM notification_log WHERE user_id = ? ORDER BY sent_at DESC, id DESC LIMIT ?'
    ).all(userId, limit) as Array<{ type: string; payload: string | null; sent_at: string }>;
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
      "SELECT * FROM tasks WHERE user_id = ? AND completed = 0 AND date >= date('now', '-7 days') ORDER BY date ASC"
    ).all(userId) as Task[];
  },
};

// R17 T2 — one-tap post-call quality feedback (1–5 stars).
export interface CallFeedback {
  id: number;
  user_id: number;
  briefing_id: string | null;
  rating: number;
  note: string | null;
  created_at: string;
}
export const callFeedbackQueries = {
  create: (userId: number, briefingId: string | null, rating: number, note?: string | null) => {
    return getDb().prepare(
      'INSERT INTO call_feedback (user_id, briefing_id, rating, note) VALUES (?, ?, ?, ?)'
    ).run(userId, briefingId ?? null, rating, note ?? null);
  },
  recent: (userId: number, limit = 30): CallFeedback[] => {
    return getDb().prepare(
      'SELECT * FROM call_feedback WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(userId, limit) as CallFeedback[];
  },
  // True if this user already rated this briefing (one feedback per call).
  existsForBriefing: (userId: number, briefingId: string): boolean => {
    const row = getDb().prepare(
      'SELECT 1 FROM call_feedback WHERE user_id = ? AND briefing_id = ? LIMIT 1'
    ).get(userId, briefingId);
    return !!row;
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
  session_version: number;
  created_at: string;
  // Added by Core when the data-consent onboarding step ships.
  // 'improve' = user opts in to product improvement use; 'privacy' = inference-only.
  // Optional here so reads are safe before the column exists in the DB.
  data_consent?: 'improve' | 'privacy' | null;
  voice_preference?: 'daniel' | 'aria' | null;
  voice_speed?: 'slow' | 'default' | 'fast' | null;
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
  is_open_call?: number;
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
  category: 'person' | 'project' | 'goal' | 'preference' | 'fact' | 'pattern';
  statement: string;
  entity: string | null;
  learned_at: string;
  confidence: 'high' | 'low';
  source_briefing_id: number | null;
  source?: string | null;
  // Bi-temporal columns (Graphiti model): valid_from = when fact became true; valid_until = when retired (null = current).
  // Retired facts are never hard-deleted — they feed pattern detection and historical queries.
  // Optional in the TS type because existing test fixtures predate the columns; DB always populates both.
  valid_from?: string | null;
  valid_until?: string | null;
  // Confidence decay (Round 6 T2): starts at 1.0, decays weekly by category tier.
  // Below 0.3 = unverified, surfaced for reconfirmation. Optional: DB always populates; tests predate columns.
  confidence_score?: number;
  last_confirmed_at?: string | null;
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

// Decrypt a raw DB row so statement is plaintext. Non-encrypted (legacy) values pass through.
function decryptFactRow(r: Fact): Fact {
  return { ...r, statement: safeDecryptField(r.statement, 'fact.statement') };
}

// Snapshot a fact's current value to fact_history before retirement or user edit.
// Copies the raw (encrypted) statement byte-for-byte — no re-encryption.
function snapshotFactToHistory(factId: number, userId: number, reason: string): void {
  try {
    const db = getDb();
    const row = db.prepare(
      'SELECT statement, entity, category FROM facts WHERE id=? AND user_id=?'
    ).get(factId, userId) as { statement: string; entity: string | null; category: string } | undefined;
    if (!row) return;
    db.prepare(
      'INSERT INTO fact_history (fact_id, user_id, statement, entity, category, reason) VALUES (?,?,?,?,?,?)'
    ).run(factId, userId, row.statement, row.entity ?? null, row.category, reason);
  } catch { /* non-fatal — fact_history is audit-only */ }
}

export const factQueries = {
  // Active facts only by default. Pass includeRetired:true to include history (e.g. pattern detection).
  getAll: (userId: number, opts?: { includeRetired?: boolean }): Fact[] => {
    const sql = opts?.includeRetired
      ? 'SELECT * FROM facts WHERE user_id = ? ORDER BY category, learned_at DESC'
      : 'SELECT * FROM facts WHERE user_id = ? AND valid_until IS NULL ORDER BY category, learned_at DESC';
    return (getDb().prepare(sql).all(userId) as Fact[]).map(decryptFactRow);
  },

  // Returns ALL facts including retired ones — for historical pattern analysis (T4).
  getAllIncludingRetired: (userId: number): Fact[] => {
    return (getDb().prepare(
      'SELECT * FROM facts WHERE user_id = ? ORDER BY category, learned_at ASC'
    ).all(userId) as Fact[]).map(decryptFactRow);
  },

  // Retire a fact bi-temporally (sets valid_until = now). Preserves history — never hard-deletes.
  // Guarded with `AND valid_until IS NULL` so a second call never overwrites the original retire timestamp.
  retire: (userId: number, id: number): void => {
    snapshotFactToHistory(id, userId, 'retired');
    getDb().prepare(
      "UPDATE facts SET valid_until=datetime('now') WHERE id=? AND user_id=? AND valid_until IS NULL"
    ).run(id, userId);
  },

  // Upsert: dedupe by (category, entity) when entity present; by (category, first-80-chars-statement) otherwise.
  // Conflict detection only considers ACTIVE facts (valid_until IS NULL) — retired history is ignored.
  // statement is encrypted at rest; no-entity dedup compares decrypted values in app (SQL SUBSTR
  // cannot match ciphertext).
  // Bi-temporal: on conflict with a low-confidence existing fact, RETIRE old + INSERT new.
  // High-confidence facts (user-corrected) are never overwritten by extraction.
  upsertFact: (
    userId: number,
    category: string,
    statement: string,
    entity?: string | null,
    confidence: 'high' | 'low' = 'high',
    sourceBriefingId?: number | null,
  ): void => {
    const db = getDb();
    let existingId: number | undefined;
    let existingStatement: string | undefined;

    let existingConfidence: 'high' | 'low' | undefined;
    if (entity) {
      const row = db.prepare(
        'SELECT id, statement, confidence FROM facts WHERE user_id=? AND category=? AND LOWER(entity)=LOWER(?) AND valid_until IS NULL'
      ).get(userId, category, entity) as { id: number; statement: string; confidence: 'high' | 'low' } | undefined;
      if (row) { existingId = row.id; existingStatement = safeDecryptField(row.statement, 'fact.statement'); existingConfidence = row.confidence; }
    } else {
      const cands = db.prepare(
        'SELECT id, statement, confidence FROM facts WHERE user_id=? AND category=? AND entity IS NULL AND valid_until IS NULL'
      ).all(userId, category) as Array<{ id: number; statement: string; confidence: 'high' | 'low' }>;
      const match = cands.find(
        r => safeDecryptField(r.statement, 'fact.statement').toLowerCase().slice(0, 80) === statement.toLowerCase().slice(0, 80)
      );
      if (match) { existingId = match.id; existingStatement = safeDecryptField(match.statement, 'fact.statement'); existingConfidence = match.confidence; }
    }

    if (existingId !== undefined) {
      const sameStatement = existingStatement!.toLowerCase() === statement.toLowerCase();
      // User-corrected facts (confidence='high') are not overwritten by new extractions.
      if (existingConfidence === 'high') {
        // Refresh learned_at so facts seen again don't drift toward "stale".
        if (sameStatement) db.prepare("UPDATE facts SET learned_at=datetime('now') WHERE id=? AND user_id=?").run(existingId, userId);
        return;
      }
      if (!sameStatement) {
        // Bi-temporal: snapshot then retire the old fact and insert the updated one.
        snapshotFactToHistory(existingId, userId, 'extraction-update');
        db.prepare("UPDATE facts SET valid_until=datetime('now') WHERE id=? AND user_id=?")
          .run(existingId, userId);
        const info = db.prepare(
          "INSERT INTO facts (user_id, category, statement, entity, confidence, source_briefing_id, valid_from) VALUES (?,?,?,?,?,?,datetime('now'))"
        ).run(userId, category, encryptField(statement), entity ?? null, confidence, sourceBriefingId ?? null);
        // M4-3b: log the new fact creation to fact_history.
        snapshotFactToHistory(Number((info as { lastInsertRowid: number | bigint }).lastInsertRowid), userId, 'created');
      } else {
        // Same statement, low confidence: just refresh freshness.
        db.prepare("UPDATE facts SET learned_at=datetime('now') WHERE id=? AND user_id=?").run(existingId, userId);
      }
    } else {
      const info = db.prepare(
        "INSERT INTO facts (user_id, category, statement, entity, confidence, source_briefing_id, valid_from) VALUES (?,?,?,?,?,?,datetime('now'))"
      ).run(userId, category, encryptField(statement), entity ?? null, confidence, sourceBriefingId ?? null);
      // M4-3b: log the new fact creation to fact_history.
      snapshotFactToHistory(Number((info as { lastInsertRowid: number | bigint }).lastInsertRowid), userId, 'created');
    }
  },

  // Active facts only by default. Pass includeRetired:true to include history (e.g. pattern detection).
  getByCategory: (userId: number, category: string, opts?: { includeRetired?: boolean }): Fact[] => {
    const sql = opts?.includeRetired
      ? 'SELECT * FROM facts WHERE user_id=? AND category=? ORDER BY learned_at DESC'
      : 'SELECT * FROM facts WHERE user_id=? AND category=? AND valid_until IS NULL ORDER BY learned_at DESC';
    return (getDb().prepare(sql).all(userId, category) as Fact[]).map(decryptFactRow);
  },

  updateFact: (userId: number, id: number, statement: string, entity: string | null): void => {
    snapshotFactToHistory(id, userId, 'user-edit');
    // User-initiated edits always clear the ⚠ verify flag (confidence → 'high').
    getDb().prepare(
      "UPDATE facts SET statement=?, entity=?, confidence='high', learned_at=datetime('now') WHERE id=? AND user_id=?"
    ).run(encryptField(statement), entity, id, userId);
  },

  getById: (userId: number, id: number): Fact | undefined => {
    const row = getDb().prepare(
      'SELECT * FROM facts WHERE id = ? AND user_id = ?'
    ).get(id, userId) as Fact | undefined;
    return row ? decryptFactRow(row) : undefined;
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
      ).run(userId, 'goal', encryptField(text), null, 'high', 'priority-sync');
    }
  },

  // Reset confidence_score to 1.0 when a fact is reconfirmed (mentioned again or user doesn't correct it).
  // Also upgrades the categorical confidence to 'high' so a once-garbled ('low') fact the user has
  // now verified stops re-triggering reconfirmation every call (Core M4-1). User-scoped; active only.
  confirmFact: (userId: number, factId: number): void => {
    getDb().prepare(
      "UPDATE facts SET confidence_score = 1.0, confidence = 'high', last_confirmed_at = datetime('now') WHERE id = ? AND user_id = ? AND valid_until IS NULL"
    ).run(factId, userId);
  },

  // Decay confidence_score for active facts in the given categories by `amount` (floored at 0.0).
  // Called weekly by the scheduler: volatile categories decay 0.1/week, stable decay 0.02/week.
  decayByCategories: (categories: string[], amount: number): void => {
    if (!categories.length) return;
    const placeholders = categories.map(() => '?').join(', ');
    getDb().prepare(
      `UPDATE facts SET confidence_score = MAX(0.0, confidence_score - ?) WHERE valid_until IS NULL AND category IN (${placeholders})`
    ).run(amount, ...categories);
  },
};

export interface FactHistory {
  id: number;
  fact_id: number;
  user_id: number;
  statement: string;
  entity: string | null;
  category: string;
  retired_at: string;
  reason: string | null;
}

export const factHistoryQueries = {
  getForFact: (factId: number, userId: number): FactHistory[] => {
    return (getDb().prepare(
      'SELECT * FROM fact_history WHERE fact_id=? AND user_id=? ORDER BY retired_at DESC'
    ).all(factId, userId) as FactHistory[]).map(r => ({ ...r, statement: decryptField(r.statement) }));
  },

  getRecentForUser: (userId: number, limit = 20): FactHistory[] => {
    return (getDb().prepare(
      'SELECT * FROM fact_history WHERE user_id=? ORDER BY retired_at DESC LIMIT ?'
    ).all(userId, limit) as FactHistory[]).map(r => ({ ...r, statement: decryptField(r.statement) }));
  },

  // M4-3b: Restore a historical fact version. Retires the currently active fact with the same
  // fact_id and re-inserts the historical statement as a new active fact (confidence='high').
  rollbackFact: (userId: number, historyId: number): void => {
    const db = getDb();
    // Raw query — statement is still encrypted at rest (same format as facts.statement).
    const hist = db.prepare(
      'SELECT * FROM fact_history WHERE id=? AND user_id=?'
    ).get(historyId, userId) as FactHistory | undefined;
    if (!hist) return;

    // Retire the currently active fact that shares this fact_id, if any.
    const active = db.prepare(
      'SELECT id FROM facts WHERE id=? AND user_id=? AND valid_until IS NULL'
    ).get(hist.fact_id, userId) as { id: number } | undefined;
    if (active) {
      snapshotFactToHistory(active.id, userId, 'retired');
      db.prepare("UPDATE facts SET valid_until=datetime('now') WHERE id=? AND user_id=?").run(active.id, userId);
    }

    // Re-insert historical version (statement already encrypted — no re-encryption needed).
    const info = db.prepare(
      "INSERT INTO facts (user_id, category, statement, entity, confidence, valid_from) VALUES (?,?,?,?,?,datetime('now'))"
    ).run(userId, hist.category, hist.statement, hist.entity ?? null, 'high');
    snapshotFactToHistory(Number((info as { lastInsertRowid: number | bigint }).lastInsertRowid), userId, 'created');
  },

  // M4-3b UI: bulk fetch most-recent activity timestamp per fact_id for a user.
  // Returns a map of fact_id → latest retired_at string. Single query.
  getLatestTimestamps: (userId: number): Record<number, string> => {
    const rows = getDb().prepare(
      'SELECT fact_id, MAX(retired_at) as latest FROM fact_history WHERE user_id=? GROUP BY fact_id'
    ).all(userId) as { fact_id: number; latest: string }[];
    return Object.fromEntries(rows.map(r => [r.fact_id, r.latest]));
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

function decryptFocusMilestoneRow(r: FocusMilestone): FocusMilestone {
  return { ...r, title: decryptField(r.title) };
}

export const focusMilestoneQueries = {
  // All milestones for a user, grouped by focus area then sort order.
  listForUser: (userId: number): FocusMilestone[] => {
    return (getDb().prepare(
      'SELECT * FROM focus_milestones WHERE user_id = ? ORDER BY priority_id, sort_order, id'
    ).all(userId) as FocusMilestone[]).map(decryptFocusMilestoneRow);
  },
  // Milestones for a single focus area, ordered for display.
  listForPriority: (userId: number, priorityId: number): FocusMilestone[] => {
    return (getDb().prepare(
      'SELECT * FROM focus_milestones WHERE user_id = ? AND priority_id = ? ORDER BY sort_order, id'
    ).all(userId, priorityId) as FocusMilestone[]).map(decryptFocusMilestoneRow);
  },
  create: (userId: number, priorityId: number, title: string) => {
    return getDb().prepare(
      'INSERT INTO focus_milestones (user_id, priority_id, title) VALUES (?, ?, ?)'
    ).run(userId, priorityId, encryptField(title));
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

  updateTitle: (id: number, userId: number, title: string) => {
    return getDb().prepare(
      'UPDATE focus_milestones SET title = ? WHERE id = ? AND user_id = ?'
    ).run(title, id, userId);
  },
};

// Nightly pre-warmed briefing context. One row per user per day; upserted on regeneration.
// context_pack is AES-256-GCM encrypted (contains memory content). Pruned after 7 days.
export const briefingContextPackQueries = {
  upsert: (userId: number, packDate: string, contextPack: string): void => {
    getDb().prepare(
      `INSERT INTO briefing_context_packs (user_id, pack_date, context_pack)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, pack_date) DO UPDATE SET
         context_pack = excluded.context_pack,
         generated_at = datetime('now')`
    ).run(userId, packDate, encryptField(contextPack));
  },

  get: (userId: number, packDate: string): string | null => {
    const row = getDb().prepare(
      'SELECT context_pack FROM briefing_context_packs WHERE user_id = ? AND pack_date = ?'
    ).get(userId, packDate) as { context_pack: string } | undefined;
    if (!row) return null;
    return safeDecryptField(row.context_pack, 'briefing_context_packs.context_pack');
  },

  prune: (): void => {
    getDb().prepare(
      "DELETE FROM briefing_context_packs WHERE generated_at < datetime('now', '-7 days')"
    ).run();
  },
};

export interface PeopleProfile {
  id: number;
  user_id: number;
  canonical_name: string;
  email: string | null;
  interaction_count: number;
  last_interaction: string | null;    // ISO date
  upcoming_interaction: string | null; // ISO date
  updated_at: string;
}

export const peopleProfileQueries = {
  listForUser: (userId: number): PeopleProfile[] => {
    return getDb().prepare(
      'SELECT * FROM people_profiles WHERE user_id = ? ORDER BY interaction_count DESC, last_interaction DESC'
    ).all(userId) as PeopleProfile[];
  },
  getByName: (userId: number, canonicalName: string): PeopleProfile | undefined => {
    return getDb().prepare(
      'SELECT * FROM people_profiles WHERE user_id = ? AND LOWER(canonical_name) = LOWER(?)'
    ).get(userId, canonicalName) as PeopleProfile | undefined;
  },
  upsert: (
    userId: number,
    canonicalName: string,
    email: string | null,
    interactionCount: number,
    lastInteraction: string | null,
    upcomingInteraction: string | null,
  ) => {
    return getDb().prepare(`
      INSERT INTO people_profiles (user_id, canonical_name, email, interaction_count, last_interaction, upcoming_interaction, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, canonical_name) DO UPDATE SET
        email = excluded.email,
        interaction_count = excluded.interaction_count,
        last_interaction = excluded.last_interaction,
        upcoming_interaction = excluded.upcoming_interaction,
        updated_at = datetime('now')
    `).run(userId, canonicalName, email, interactionCount, lastInteraction, upcomingInteraction);
  },
};

// Social mental models (M4-4) — a structured per-person model, distinct from raw person facts.
// PII fields encrypted at rest. Kept in sync by sleep-time consolidation; read by the briefing
// builder when a person appears on the calendar.
export interface PeopleModel {
  id: number;
  user_id: number;
  person_name: string;
  goals: string | null;
  communication_style: string | null;
  relationship_state: string | null;
  last_interaction: string | null;
  health_score: number;
  updated_at: string;
}

export interface PeopleModelFields {
  goals?: string | null;
  communicationStyle?: string | null;
  relationshipState?: string | null;
  lastInteraction?: string | null;
  healthScore?: number;
}

// Round 8 (M4-4) — social mental models. goals/communication_style/relationship_state/
// last_interaction encrypted at rest (PII about third parties); person_name is the plaintext
// UNIQUE key. Core (Darren) writes via the social-model pipeline; Edge reads on calls.
function decryptPeopleModelRow(row: PeopleModel): PeopleModel {
  row.goals = safeDecryptNullable(row.goals, 'people_models.goals');
  row.communication_style = safeDecryptNullable(row.communication_style, 'people_models.communication_style');
  row.relationship_state = safeDecryptNullable(row.relationship_state, 'people_models.relationship_state');
  row.last_interaction = safeDecryptNullable(row.last_interaction, 'people_models.last_interaction');
  return row;
}

export const peopleModelQueries = {
  // UPDATE-or-INSERT by (user_id, person_name). Only the provided fields are written; omitted
  // fields are preserved (COALESCE) so partial updates don't clobber prior knowledge.
  upsert: (userId: number, personName: string, fields: PeopleModelFields = {}): void => {
    const healthScore = fields.healthScore ?? null;
    getDb().prepare(`
      INSERT INTO people_models (user_id, person_name, goals, communication_style, relationship_state, last_interaction, health_score, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, 1.0), datetime('now'))
      ON CONFLICT(user_id, person_name) DO UPDATE SET
        goals               = COALESCE(excluded.goals, people_models.goals),
        communication_style = COALESCE(excluded.communication_style, people_models.communication_style),
        relationship_state  = COALESCE(excluded.relationship_state, people_models.relationship_state),
        last_interaction    = COALESCE(excluded.last_interaction, people_models.last_interaction),
        -- reference the raw bind param (NOT excluded, which carries the VALUES default 1.0),
        -- so an omitted health_score preserves the prior value on update.
        health_score        = COALESCE(?, people_models.health_score),
        updated_at          = datetime('now')
    `).run(
      userId,
      personName,
      encryptNullable(fields.goals ?? null),
      encryptNullable(fields.communicationStyle ?? null),
      encryptNullable(fields.relationshipState ?? null),
      encryptNullable(fields.lastInteraction ?? null),
      healthScore,
      healthScore,
    );
  },
  getForUser: (userId: number, personName: string): PeopleModel | undefined => {
    const row = getDb().prepare(
      'SELECT * FROM people_models WHERE user_id = ? AND person_name = ?'
    ).get(userId, personName) as PeopleModel | undefined;
    return row ? decryptPeopleModelRow(row) : undefined;
  },
  listForUser: (userId: number): PeopleModel[] => {
    const rows = getDb().prepare(
      'SELECT * FROM people_models WHERE user_id = ? ORDER BY updated_at DESC'
    ).all(userId) as PeopleModel[];
    return rows.map(decryptPeopleModelRow);
  },
  deleteForUser: (userId: number, personName: string): void => {
    getDb().prepare('DELETE FROM people_models WHERE user_id = ? AND person_name = ?').run(userId, personName);
  },
};

// Pattern cache queries — one row per user, refreshed on each briefing.
// patterns column is encrypted at rest (behavioral PII — peak/trough patterns, calendar habits).
export const patternCacheQueries = {
  get: (userId: number): string | null => {
    const row = getDb().prepare('SELECT patterns FROM pattern_cache WHERE user_id = ?').get(userId) as { patterns: string } | undefined;
    return row ? safeDecryptField(row.patterns, 'pattern_cache.patterns') : null;
  },
  upsert: (userId: number, patternsJson: string) => {
    getDb().prepare(`
      INSERT INTO pattern_cache (user_id, patterns, computed_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET patterns = excluded.patterns, computed_at = datetime('now')
    `).run(userId, encryptField(patternsJson));
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

  getPrior: (userId: number, beforeDate: string): CalendarScore | undefined => {
    return getDb().prepare(
      'SELECT * FROM calendar_scores WHERE user_id = ? AND date < ? ORDER BY date DESC LIMIT 1'
    ).get(userId, beforeDate) as CalendarScore | undefined;
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
  date: string;              // YYYY-MM-DD in user's local timezone
  focus_areas: string;       // JSON: FocusArea[]
  generated_at: string;
  confirmed: number;         // 0 | 1
  dismissed_titles: string;  // JSON: string[]
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
    `).run(userId, date, encryptField(areasJson), generatedAt);
  },

  getToday: (userId: number, date: string): DailyFocusRecord | null => {
    const row = (getDb().prepare(
      `SELECT * FROM daily_focus WHERE user_id = ? AND date = ?`
    ).get(userId, date) ?? null) as DailyFocusRecord | null;
    if (!row) return null;
    return { ...row, focus_areas: decryptField(row.focus_areas) };
  },

  confirm: (userId: number, date: string): void => {
    getDb().prepare(
      `UPDATE daily_focus SET confirmed = 1 WHERE user_id = ? AND date = ?`
    ).run(userId, date);
  },

  addDismissed: (userId: number, date: string, title: string): void => {
    const db = getDb();
    const row = db.prepare(
      `SELECT dismissed_titles FROM daily_focus WHERE user_id = ? AND date = ?`
    ).get(userId, date) as { dismissed_titles: string } | undefined;
    const current: string[] = row ? (() => { try { return JSON.parse(row.dismissed_titles); } catch { return []; } })() : [];
    if (!current.includes(title)) current.push(title);
    db.prepare(
      `UPDATE daily_focus SET dismissed_titles = ? WHERE user_id = ? AND date = ?`
    ).run(JSON.stringify(current), userId, date);
  },

  getRecentDismissed: (userId: number, daysBack = 7): string[] => {
    const cutoff = new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10);
    const rows = getDb().prepare(
      `SELECT dismissed_titles FROM daily_focus WHERE user_id = ? AND date >= ?`
    ).all(userId, cutoff) as Array<{ dismissed_titles: string }>;
    const all: string[] = [];
    for (const r of rows) {
      try { all.push(...JSON.parse(r.dismissed_titles)); } catch { /* skip */ }
    }
    return [...new Set(all)];
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

  /** Mark a loop as resolved (done). Returns true if a row was updated. */
  resolve: (userId: number, id: number): boolean => {
    const res = getDb().prepare(
      `UPDATE open_loops SET status = 'done', resolved_at = datetime('now') WHERE id = ? AND user_id = ? AND status = 'open'`
    ).run(id, userId) as { changes: number };
    return res.changes > 0;
  },

  /** Mark a loop as dismissed. Returns true if a row was updated. */
  dismiss: (userId: number, id: number): boolean => {
    const res = getDb().prepare(
      `UPDATE open_loops SET status = 'dismissed', resolved_at = datetime('now') WHERE id = ? AND user_id = ? AND status = 'open'`
    ).run(id, userId) as { changes: number };
    return res.changes > 0;
  },

  /** Dedup check: true if a similar (first-80-char prefix match) open loop exists. In-memory
   *  comparison so encrypted descriptions are decrypted before comparing. */
  existsSimilar: (userId: number, description: string): boolean => {
    const open = openLoopQueries.list(userId, 'open');
    const prefix = description.trim().toLowerCase().slice(0, 80);
    return open.some(l => l.description.trim().toLowerCase().slice(0, 80) === prefix);
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
    ).run(userId, type, encryptField(message));
  },

  /** Admin-only — returns all users' messages. NEVER call from user-facing routes.
   *  Messages are decrypted inline; the DB stores them encrypted at rest. */
  list: (opts: { limit?: number } = {}): Array<{ id: number; userId: number; type: string; message: string; status: string; createdAt: string }> => {
    const limit = opts.limit ?? 100;
    const rows = getDb().prepare(
      'SELECT id, user_id, type, message, status, created_at FROM support_messages ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as Array<{ id: number; user_id: number; type: string; message: string; status: string; created_at: string }>;
    return rows.map(r => ({ id: r.id, userId: r.user_id, type: r.type, message: decryptField(r.message), status: r.status, createdAt: r.created_at }));
  },
};

export const waitlistQueries = {
  // Insert a signup; idempotent on email (duplicate signups are silently ignored).
  // Returns true if a NEW row was created, false if the email already existed.
  add: (email: string, source?: string): boolean => {
    const info = getDb().prepare(
      'INSERT INTO waitlist (email, source) VALUES (?, ?) ON CONFLICT(email) DO NOTHING'
    ).run(email.trim().toLowerCase(), source ?? null);
    return info.changes > 0;
  },

  count: (): number => {
    const row = getDb().prepare('SELECT COUNT(*) AS n FROM waitlist').get() as { n: number };
    return row.n;
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

// ── Episode store (episodic memory tier) ─────────────────────────────────────
// Ground-truth episode records: preserved call/calendar/email events, encrypted
// at rest, user-scoped, consent-gated, retention-bounded.
// topics + commitments are JSON string[] for quick briefing-time recall.
// See specs/episode-store.md for the research rationale and build plan.

export type EpisodeSource = 'call' | 'calendar' | 'email';

export interface Episode {
  id:           number;
  userId:       number;
  source:       EpisodeSource;
  occurredAt:   string;        // ISO datetime
  contentRaw:   string;        // decrypted
  topics:       string[];      // parsed from JSON
  commitments:  string[];      // parsed from JSON
  createdAt:    string;
}

interface EpisodeRow {
  id:          number;
  user_id:     number;
  source:      string;
  occurred_at: string;
  content_raw: string;         // encrypted
  topics:      string | null;
  commitments: string | null;
  created_at:  string;
}

function safeJsonArray(v: string | null): string[] {
  if (!v) return [];
  try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; }
  catch { return []; }
}

function decryptEpisodeRow(r: EpisodeRow): Episode {
  return {
    id:          r.id,
    userId:      r.user_id,
    source:      r.source as EpisodeSource,
    occurredAt:  r.occurred_at,
    contentRaw:  safeDecryptField(r.content_raw, 'episode.content_raw'),
    topics:      safeJsonArray(r.topics),
    commitments: safeJsonArray(r.commitments),
    createdAt:   r.created_at,
  };
}

export const episodeQueries = {
  /** Insert a new episode. Episodes serve the user's OWN experience (recall, pattern detection)
   *  and are stored regardless of data_consent setting. Do NOT gate insertion on isImproveConsented.
   *  Any future improvement/training pipeline that reads episodes MUST check isImproveConsented
   *  at the consumption side. Returns the new episode's row id. */
  insert: (
    userId: number,
    source: EpisodeSource,
    occurredAt: string,
    contentRaw: string,
    topics: string[] = [],
    commitments: string[] = [],
  ): number => {
    const info = getDb().prepare(
      'INSERT INTO episodes (user_id, source, occurred_at, content_raw, topics, commitments) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(userId, source, occurredAt, encryptField(contentRaw), JSON.stringify(topics), JSON.stringify(commitments));
    return Number((info as { lastInsertRowid: number | bigint }).lastInsertRowid);
  },

  /** Most-recent N episodes for a user, newest first.
   *  User-scoped: WHERE user_id = ? enforced at the SQL level. */
  recent: (userId: number, limit = 20): Episode[] => {
    return (getDb().prepare(
      'SELECT * FROM episodes WHERE user_id = ? ORDER BY occurred_at DESC LIMIT ?'
    ).all(userId, limit) as EpisodeRow[]).map(decryptEpisodeRow);
  },

  /** Filtered episode search for a user. All filters are AND-combined; all optional.
   *  Accepts both `topic` (single string) and `topics` (string[]) — topic filtering is
   *  post-SQL (JSON array search); since/unresolvedCommitments filter in SQL. */
  search: (
    userId: number,
    opts: {
      topic?: string;
      topics?: string[];
      since?: string;
      unresolvedCommitments?: boolean;
      limit?: number;
    } = {},
  ): Episode[] => {
    const clauses: string[] = ['user_id = ?'];
    const params: unknown[] = [userId];
    if (opts.since) {
      clauses.push('occurred_at >= ?');
      params.push(opts.since);
    }
    if (opts.unresolvedCommitments) {
      clauses.push("commitments IS NOT NULL AND commitments != '[]'");
    }
    params.push(opts.limit ?? 50);
    const rows = (getDb().prepare(
      `SELECT * FROM episodes WHERE ${clauses.join(' AND ')} ORDER BY occurred_at DESC LIMIT ?`
    ).all(...params) as EpisodeRow[]).map(decryptEpisodeRow);
    const needles: string[] = [];
    if (opts.topic) needles.push(opts.topic.toLowerCase());
    if (opts.topics?.length) needles.push(...opts.topics.map(t => t.toLowerCase()));
    if (needles.length) {
      return rows.filter(e =>
        e.topics.some(t => needles.some(n => t.toLowerCase().includes(n) || n.includes(t.toLowerCase())))
      );
    }
    return rows;
  },

  /** Prune episodes whose occurred_at is older than retentionDays (all users).
   *  Default 365 days — run periodically to bound storage while preserving the year of
   *  history that constitutes the switching-cost moat. */
  prune: (retentionDays = 365): void => {
    getDb().prepare(
      "DELETE FROM episodes WHERE occurred_at < datetime('now', ? || ' days')"
    ).run(`-${retentionDays}`);
  },

  /** Prune episodes older than keepDays across all users (scheduler entry point). */
  pruneAll: (keepDays = 548): void => {
    const cutoff = new Date(Date.now() - keepDays * 86_400_000).toISOString().slice(0, 10);
    getDb().prepare("DELETE FROM episodes WHERE occurred_at < ?").run(cutoff);
  },
};
