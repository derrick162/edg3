# 🔒 EDG3 — Security & Reliability Lane

> Backlog for the **Edg3 Security & Reliability** session. Governed by the shared
> [`ROADMAP.md`](ROADMAP.md) constitution — read that first (ownership map,
> worktree isolation, merge protocol). Work on branch `security` in
> `C:\Users\Derrick\edg3-security`. Update this changelog in the same commit that
> ships work, and claim files in the constitution's Status Board before touching
> anything in the ⚠️ Shared list.

## ⚡ Standing order — read this before every ticket

**Do not stop between tickets.** Your job is not done when one ticket is done — it is done when the entire current dispatch is complete and preflight is green.

After every ticket:
1. Run `npm run preflight` from `C:\Users\Derrick\edg3-security`
2. If green → commit with a clear message → immediately start the next ticket in this dispatch
3. If preflight fails → fix it (up to 2 attempts) → if still failing, note the blocker in the Status Board and move to the next independent ticket; only stop if fully blocked

**Only stop if:**
- All tickets in the current dispatch AND the pillar backlogs are exhausted AND the QA checklist is complete, OR
- You hit a genuine blocker that requires PM input (note it clearly in the Status Board), OR
- Preflight has failed 3+ times and you cannot identify the root cause

**In all other cases: keep going.** You do not need PM approval between tickets. Commit small, run preflight, move to the next ticket.

**When the dispatch is exhausted → move to the pillars (in this order):**
1. Read `PILLAR-TRUST.md` — work through items in order, highest tier first (Security owns Tier 0 and Tier 1 and Tier 4)
2. Read `PILLAR-DAILY-CALL.md` — connection reliability and scheduler items (Security owns DC1, DC3-2)
3. Read `PILLAR-MEMORY.md` — pick up any Memory items tagged (Security) that aren't done
4. When all three pillars are exhausted → run the QA checklists in all three pillar files
5. Log QA results in `content/qa-log.md` (create if it doesn't exist)

## 📥 PM DISPATCH — 2026-06-23 (ROUND 19 — Quota-error retry cascade fix + gratitude re-call fix + greeting time fix)

> `git merge master` first. Three small tickets. **Do before R18 or pillar work.**

---

### T1 — Don't retry ElevenLabs quota-exceeded pipeline errors (HIGH — 30m)

**Root cause (diagnosed 2026-06-22):** `MISSED_CALL_REASONS` in `app/api/vapi/webhook/route.ts` includes `'pipeline-error'`. When an ElevenLabs quota-exceeded error fires, Vapi sends `endedReason = 'pipeline-error-eleven-labs-quota-exceeded'`, which `.includes('pipeline-error')` matches. The webhook then sets `retry_after` and stamps `retry_attempted = 1` on the current briefing. The scheduler sees `retry_after`, creates a **new** briefing row (with `retry_attempted = 0` reset), and fires another call — which fails again — cascading forever until the quota is manually topped up. On 2026-06-22 this produced 14 consecutive failed briefings before Derrick caught it.

**Fix — `app/api/vapi/webhook/route.ts`:**

Add a quota-error guard before the retry branch:

```ts
// Quota errors won't self-heal with a retry — skip retry and mark missed.
const isQuotaError = endedReason.toLowerCase().includes('quota');

if (wasMissed && !briefing.retry_attempted && !isQuotaError) {
  briefingQueries.update(briefing.id, { status: 'missed' });
  db.prepare('UPDATE briefings SET retry_attempted = 1 WHERE id = ?').run(briefing.id);
  scheduleRetry(db, briefing.id, briefing.user_id);
  return NextResponse.json({ received: true });
}
// Quota error or already retried — just mark missed, no retry.
if (wasMissed) {
  briefingQueries.update(briefing.id, { status: 'missed' });
  if (isQuotaError) console.warn(`[webhook] Quota error — call ${call.id} marked missed, no retry scheduled`);
  return NextResponse.json({ received: true });
}
```

Replace the existing `if (wasMissed && !briefing.retry_attempted)` block with the above two blocks.

**Tests:**
- `pipeline-error-eleven-labs-quota-exceeded` → status = `missed`, no `retry_after` stamped
- `pipeline-error` (non-quota) → status = `missed`, `retry_after` stamped (existing behavior preserved)
- `no-answer` → still retries (unchanged)

---

### T2 — Gratitude call re-fires every 10 min after a missed/hung-up call (HIGH — 30m)

**Root cause (diagnosed 2026-06-23):** `runGratitudeAutoCall()` in `lib/proactiveNotifications.ts` self-gates on `gratitudeQueries.getByDate(user.id, today)`. A gratitude entry is only written when the `recordGratitude` Vapi tool fires — i.e., when the user actually says their three items. If a call connects but immediately hangs up (e.g. ElevenLabs quota), no entry is written, so the self-gate never fires. The job re-calls every 10 minutes for the entire 5–11am window (~36 attempts).

**Fix — `lib/proactiveNotifications.ts`, inside `runGratitudeAutoCall`, just before `await scheduleOpenCall`:**

Pre-insert a null-item gratitude entry before placing the call so the self-gate fires on the next tick regardless of outcome. When the call completes normally, `recordGratitude` inserts a second row with the actual items; `getByDate` uses `ORDER BY created_at DESC LIMIT 1` so it always returns the most-recent (real) row.

```ts
// Reserve today's slot BEFORE calling — prevents re-firing if call fails/hangs up.
// recordGratitude inserts the real items on success; getByDate picks the latest row.
try { gratitudeQueries.create(user.id, today, null, null, null); } catch { /* best-effort */ }
await scheduleOpenCall(user.id);
```

**Tests:**
- First auto-call fires → null row inserted → `getByDate` returns the null row → next 10-min tick skips (no second call)
- `scheduleOpenCall` throws → null row already inserted → still no re-call that day
- `recordGratitude` fires on a successful call → second row inserted with real items → `getByDate` returns the real-items row (latest created_at)
- No gratitude entry at all → auto-call fires normally (unchanged behavior for first call each day)

---

### T3 — Fix greeting time boundaries (LOW — 10m)

**Issue (observed 2026-06-23):** Edge says "Good morning" on open calls at 8:15 PM because the evening threshold is `hour >= 18` (6 PM). Correct boundaries:
- Midnight–noon (0–11): morning
- Noon–5 PM (12–16): afternoon
- 5 PM onwards (17+): evening

**Fix — two files, one-line change each:**

`lib/scheduler.ts` — `scheduleOpenCall`, the greeting line:
```ts
// Before:
const greet = hour >= 18 ? 'Good evening' : hour >= 12 ? 'Good afternoon' : 'Good morning';
// After:
const greet = hour >= 17 ? 'Good evening' : hour >= 12 ? 'Good afternoon' : 'Good morning';
```

`app/api/vapi/webhook/route.ts` — inbound `assistant-request` handler, the greeting line:
```ts
// Before:
const greet = hour >= 18 ? 'evening' : hour >= 12 ? 'afternoon' : 'morning';
// After:
const greet = hour >= 17 ? 'evening' : hour >= 12 ? 'afternoon' : 'morning';
```

Also update the Cantonese opener in `scheduleOpenCall` similarly:
```ts
// Before:
const greetYue = hour >= 18 ? '晚上好' : hour >= 12 ? '下午好' : '早晨';
// After:
const greetYue = hour >= 17 ? '晚上好' : hour >= 12 ? '下午好' : '早晨';
```

**Tests:** hour=17 → 'Good evening'; hour=16 → 'Good afternoon'; hour=11 → 'Good morning'; hour=0 → 'Good morning'.

---

### T4 — Gratitude/open call completion blocking morning briefing (HIGH — 20m)

**Root cause (diagnosed 2026-06-24):** `lib/scheduler.ts` has two `alreadyCalled` / `existing` queries that check `scheduled_for LIKE 'today%'` for `status = 'completed'`. These queries do **not** filter on `is_open_call`, so a completed gratitude call (open call, `is_open_call = 1`) satisfies the check and silently skips the morning briefing for the rest of the day. Confirmed: ElevenLabs quota resets overnight → gratitude call fires at ~5-7am → Derrick answers → call completes → `is_open_call = 1` row with `status = 'completed'` exists for today → morning briefing scheduler sees it and skips.

**Fix — `lib/scheduler.ts`, two query edits:**

**1. `checkAndInitiateCalls` outer check (around line 468):**
```ts
// Before:
const alreadyCalled = db.prepare(`
  SELECT 1 FROM briefings
  WHERE user_id = ?
  AND scheduled_for LIKE ?
  AND (
    status = 'completed'
    OR (status = 'calling' AND scheduled_for >= ?)
    OR (status = 'pending' AND scheduled_for >= ?)
    OR (status = 'failed' AND error_code = 'vapi_daily_limit')
  )
`).get(user.id, `${userToday}%`, callingCutoff, pendingCutoff);

// After (add is_open_call guard — open/gratitude calls must not block the morning briefing):
const alreadyCalled = db.prepare(`
  SELECT 1 FROM briefings
  WHERE user_id = ?
  AND scheduled_for LIKE ?
  AND (is_open_call IS NULL OR is_open_call = 0)
  AND (
    status = 'completed'
    OR (status = 'calling' AND scheduled_for >= ?)
    OR (status = 'pending' AND scheduled_for >= ?)
    OR (status = 'failed' AND error_code = 'vapi_daily_limit')
  )
`).get(user.id, `${userToday}%`, callingCutoff, pendingCutoff);
```

**2. `scheduleBriefingCall` inner check (around line 562):**
```ts
// Before:
const existing = getDb().prepare(
  `SELECT status, error_code FROM briefings WHERE user_id = ? AND scheduled_for LIKE ? AND (
    status = 'completed'
    OR (status = 'calling' AND scheduled_for >= ?)
    OR (status = 'pending' AND scheduled_for >= ?)
    OR (status = 'failed' AND error_code = 'vapi_daily_limit')
  ) ORDER BY scheduled_for DESC LIMIT 1`
).get(userId, `${today}%`, callingCutoff, pendingCutoff) ...

// After (same guard):
const existing = getDb().prepare(
  `SELECT status, error_code FROM briefings WHERE user_id = ? AND scheduled_for LIKE ? AND (is_open_call IS NULL OR is_open_call = 0) AND (
    status = 'completed'
    OR (status = 'calling' AND scheduled_for >= ?)
    OR (status = 'pending' AND scheduled_for >= ?)
    OR (status = 'failed' AND error_code = 'vapi_daily_limit')
  ) ORDER BY scheduled_for DESC LIMIT 1`
).get(userId, `${today}%`, callingCutoff, pendingCutoff) ...
```

**Tests:**
- Completed open call (is_open_call=1) today → morning briefing NOT blocked
- Completed open call (is_open_call=1) + no morning briefing → scheduler fires morning briefing at call_time
- Completed morning briefing (is_open_call=0) today → subsequent auto-trigger blocked (unchanged)
- is_open_call NULL (legacy rows) → treated same as 0 → still blocks (safe, conservative)

---

## 📥 PM DISPATCH — 2026-06-22 (ROUND 18 — Inbound call security)

> `git merge master` first. One ticket. **Do before R17 or pillar work.**

---

### T1 — Rate limiting + audit for inbound calls (HIGH — 1.5h)

**Context:** Core R23 T2 adds inbound call support — when Derrick calls the Twilio number, Vapi fires an `assistant-request` webhook and we return a full assistant config for the registered user. Security owns the anti-abuse layer: rate limiting and audit logging for all inbound attempts.

**Rate limiting — `lib/rateLimit.ts` (or equivalent):**

Add a new rate-limit check specifically for inbound calls:

```ts
export async function checkInboundCallRateLimit(phoneNumber: string): Promise<{ allowed: boolean; reason?: string }>
```

Rules:
- Max **5 inbound calls** per phone number per rolling 24-hour window.
- On breach: return `{ allowed: false, reason: 'rate_limit' }`.
- On pass: record the attempt and return `{ allowed: true }`.
- Use the existing `rate_limit_events` table (or add a new `inbound_call_attempts` table if it's cleaner) — one row per attempt with `phone_number TEXT`, `attempted_at INTEGER` (unix ms), `user_id INTEGER NULL` (null for unknown callers).
- Query: `SELECT COUNT(*) FROM inbound_call_attempts WHERE phone_number = ? AND attempted_at > ?` (24h ago).

**Audit logging — `lib/auditLog.ts` (or `lib/db.ts`):**

Every `assistant-request` webhook fires should produce an audit log entry regardless of outcome. Add to `auditLogQueries`:

```ts
logInboundCallAttempt: (opts: {
  phoneNumber: string;
  userId: number | null;
  outcome: 'allowed' | 'rate_limited' | 'unknown_caller';
  vapiCallId?: string;
}) => void
```

Writes to `audit_log` with:
- `action = 'inbound_call_attempt'`
- `user_id = opts.userId` (null for unknown)
- `args = JSON.stringify({ phoneNumber, outcome, vapiCallId })`
- `created_at = Date.now()`

**Integration point (`app/api/vapi/webhook/route.ts`):**

In the `assistant-request` handler (built by Core R23 T2), call `checkInboundCallRateLimit` immediately after parsing the caller number, BEFORE doing any user lookup:

```ts
const limitResult = await checkInboundCallRateLimit(callerNumber);
if (!limitResult.allowed) {
  await auditLogQueries.logInboundCallAttempt({ phoneNumber: callerNumber, userId: null, outcome: 'rate_limited' });
  return NextResponse.json({
    assistant: {
      firstMessage: "You've made several calls recently. Please wait a bit before trying again.",
      maxDurationSeconds: 8,
      model: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', systemPrompt: 'Say the firstMessage and immediately end the call.' },
      voice: { provider: 'azure', voiceId: 'en-US-AriaNeural' },
      endCallAfterSpokenEnabled: true,
    }
  });
}
```

For unknown callers (no matching user), log `outcome: 'unknown_caller'`.
For known users, log `outcome: 'allowed'` with the `userId`.

**⚠️ Shared file note:** `app/api/vapi/webhook/route.ts` is Security-owned for auth/integrity. The `assistant-request` addition there is Core's T2. Security's edit is additive: inserting the rate-limit + audit calls into the flow Core builds. Coordinate so Core's PR lands first; Security's T1 either merges after or is a follow-up patch — no conflict if Security's diff is purely additive.

**Tests:**
- `checkInboundCallRateLimit` — allows first 5, blocks 6th within 24h; resets after 24h window
- `logInboundCallAttempt` — writes correct `action`, `user_id`, `args` fields to `audit_log`
- Integration: webhook with a rate-limited phone number returns the polite decline response

---

## 📥 PM DISPATCH — 2026-06-21 (ROUND 17 — Wire proactive notifications + export consolidation)

> `git merge master` first (master at `264b168`). Two tickets completing work that's already been built. **Do both before R16 or pillar work.**

---

### T1 — Wire proactive notifications into the scheduler (HIGH — 1.5h)

**Problem:** `lib/proactiveNotifications.ts` has two working jobs — `maybeLowRecoveryAlert` and `maybePriorityGapAlert` — but nothing in the codebase calls them. The push infrastructure is live (VAPID keys set on Railway, subscriptions table exists, `lib/push.ts` works), but zero notifications have ever fired because the jobs are dead code.

**Fix — `lib/scheduler.ts`:**
Read the existing scheduler to understand the 30-min cron sweep structure. It already loops over users for the morning call schedule. Add a new sweep block that runs once per 30-min tick for all active users:

```ts
import { maybeLowRecoveryAlert, maybePriorityGapAlert } from './proactiveNotifications';

// In the per-user sweep (or as a separate tick handler):
for (const user of activeUsers) {
  await maybeLowRecoveryAlert(user).catch(e => console.error('low-recovery alert failed', user.id, e));
  await maybePriorityGapAlert(user).catch(e => console.error('priority-gap alert failed', user.id, e));
}
```

Each function already has its own rate-limiting gate (`notificationLogQueries.hasRecentEntry`) so calling them every 30 min is safe — they self-throttle (low_recovery: 20h cooldown, priority_gap: 7d cooldown).

**activeUsers definition:** users who have a push subscription AND have completed at least one briefing call. Check `push_subscriptions` JOIN `briefings WHERE status='completed'` — or reuse `hasCompletedCall` which already lives inside `lib/proactiveNotifications.ts` (extract it if needed).

**Tests:** 2 integration-style tests with mocked `maybeLowRecoveryAlert` + `maybePriorityGapAlert` verifying they're called during the sweep and errors are caught without aborting the loop.

---

### T2 — Consolidate `/api/user/export` and `/api/account/export` (MEDIUM — 45m)

**Problem:** Two GDPR export endpoints now exist doing overlapping work. `/api/account/export` (older, richer — includes `people_models`, full audit log, energy profile, open loops, undo history) and `/api/user/export` (just shipped in R16, simpler). Having two is confusing and will drift.

**Fix:**
Read both routes. The richer one is `/api/account/export`. The right resolution is:

Option A (preferred if clean): Delete `app/api/user/export/route.ts` and add a redirect from `/api/user/export` to `/api/account/export` — either a Next.js redirect in `next.config.ts` or a thin route that calls the account export handler.

Option B: If `/api/user/export` has fields `/api/account/export` doesn't (check), merge the missing fields into `/api/account/export` and then do Option A.

Whichever route survives, ensure its response includes `people_models` (already in `/api/account/export`). Update the Privacy page copy at `app/privacy/page.tsx` if it references the export URL — point it to whichever endpoint you keep.

No new tests needed — existing account export tests cover correctness.

---

## 📥 PM DISPATCH — 2026-06-21 (ROUND 16 — Startup hardening + GDPR data export)

> `git merge master` first (master at `8d83a93`). Two reliability/trust tickets. **Do both before R15 or pillar work.**

---

### T1 — JWT_SECRET startup enforcement: crash loud if not set or still placeholder (HIGH — 45m)

**Problem:** If `JWT_SECRET` is unset or left as a default placeholder like `"change-me"`, the app silently starts with a weak signing key — every session token is forgeable. We should refuse to boot rather than serve compromised tokens.

**Fix — `lib/auth.ts` startup guard:**

Add a `validateJwtSecret()` function called at module init (top of `lib/auth.ts`, outside any request handler):

```ts
const FORBIDDEN_SECRETS = new Set(['change-me', 'secret', 'changeme', 'your-secret', 'jwt-secret', 'mysecret', '']);

function validateJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || FORBIDDEN_SECRETS.has(secret.toLowerCase()) || secret.length < 32) {
    throw new Error(
      `[EDG3] JWT_SECRET is ${!secret ? 'not set' : 'too weak or still a placeholder'}.` +
      ` Set a cryptographically random string of ≥32 characters in your environment.`
    );
  }
}

validateJwtSecret();
```

This fires when `lib/auth.ts` is first imported (i.e., on first request in Next.js), crashing the process loudly rather than silently serving bad tokens. Add `JWT_SECRET=` to `.env.example` with a comment: `# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

**Tests:** 4 cases — unset env var throws, placeholder `"change-me"` throws, short string (< 32 chars) throws, valid 64-char hex string passes.

---

### T2 — `GET /api/user/export` — GDPR-ready data export (MEDIUM — 1.5h)

**Problem:** We store a growing amount of user data (calendar events, facts, memories, tasks, call transcripts, Whoop tokens, outreach logs). Users should be able to download everything we have on them. This is required for GDPR compliance and builds trust — it's also listed in the privacy policy as something users can request.

**Fix — `app/api/user/export/route.ts`:**

```ts
GET /api/user/export
Authorization: session cookie (same as all other routes)
Response: 200 application/json, filename header "edg3-export-{userId}-{date}.json"
```

Fetch and include ALL of the following (in parallel where possible, each `.catch(() => null)`):
- `profile`: from `users` table (name, email, call_time, timezone, created_at — exclude password hash)
- `facts`: all rows from `user_facts` for the user
- `memories`: all rows from `call_memories` for the user (transcript omitted if > 10k chars — include a `truncated: true` flag)
- `tasks`: all rows from `tasks` for the user
- `call_feedback`: all rows (if table exists)
- `outreach_tracking`: all rows
- `notification_log`: all rows from `notification_log` for the user
- `whoop_connected`: boolean (true if whoop_tokens row exists for user — do NOT include the token itself)
- `push_subscriptions_count`: integer count (not the endpoint strings themselves — those are device identifiers)

Return as a single JSON object: `{ exported_at, user_id, profile, facts, memories, tasks, call_feedback, outreach_tracking, notification_log, whoop_connected, push_subscriptions_count }`.

Set response header: `Content-Disposition: attachment; filename="edg3-export-${userId}-${date}.json"`.

**Tests:** 4 cases — unauthenticated 401, authenticated returns 200 with expected top-level keys, whoop_connected true when token row exists, whoop token value not present in response body.

---

## 📥 PM DISPATCH — 2026-06-20 (ROUND 15 — Data durability: SQLite backup to S3 via Litestream)

> `git merge master` first. One high-priority ticket. **Do before any pillar work. This is existential — Railway restarts wipe SQLite without this.**

---

### T1 — Litestream S3 backup: continuous WAL replication + restore on startup (P0 — 2h)

**Why this is P0:** The app runs SQLite on Railway. If the container restarts (deploys, crashes, scale events), the database file is gone. Litestream replicates the WAL to S3 in near-real-time, and a startup script restores from S3 before Next.js boots. Without this, every deploy risks data loss.

**Fix — three parts:**

**Part A — `litestream.yml` config (new file, project root):**
```yaml
dbs:
  - path: /app/edg3.db
    replicas:
      - type: s3
        bucket: ${LITESTREAM_S3_BUCKET}
        path: edg3/db
        region: ${LITESTREAM_S3_REGION:-us-east-1}
        access-key-id: ${LITESTREAM_S3_ACCESS_KEY_ID}
        secret-access-key: ${LITESTREAM_S3_SECRET_ACCESS_KEY}
```

**Part B — `scripts/start.sh` (new file):**
```bash
#!/bin/sh
set -e
# Restore DB from S3 if it doesn't exist locally (first boot or fresh container).
if [ -n "$LITESTREAM_S3_BUCKET" ] && [ ! -f /app/edg3.db ]; then
  echo "Restoring DB from S3..."
  litestream restore -config /app/litestream.yml /app/edg3.db || echo "No backup found — starting fresh."
fi
# Start Litestream replication in background, then start Next.js.
if [ -n "$LITESTREAM_S3_BUCKET" ]; then
  litestream replicate -config /app/litestream.yml &
fi
exec node server.js
```

**Part C — `Dockerfile` updates:**
Check if there's an existing Dockerfile; if not, create one:
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
# Install Litestream binary.
RUN apk add --no-cache curl && \
    curl -fsSL https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64-static.tar.gz | tar xz -C /usr/local/bin
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY litestream.yml ./
COPY scripts/start.sh ./
RUN chmod +x start.sh
CMD ["./start.sh"]
```

If a Dockerfile already exists, add only the Litestream install + start.sh swap (don't rewrite unrelated sections).

**Railway env vars needed (note in Status Board — PM sets these):**
- `LITESTREAM_S3_BUCKET` — S3 bucket name
- `LITESTREAM_S3_ACCESS_KEY_ID` — AWS key with s3:PutObject/GetObject/ListBucket on that bucket
- `LITESTREAM_S3_SECRET_ACCESS_KEY` — secret
- `LITESTREAM_S3_REGION` — optional, defaults to `us-east-1`

**Tests:** Since this is infra/shell, no vitest tests. Instead add a `scripts/verify-backup.sh` that does `litestream snapshots -config litestream.yml` and exits 0 if at least one snapshot exists. Document the restore drill in `docs/backup-restore.md` (create if it doesn't exist): step-by-step recovery from S3 to local + Railway.

⚠️ **Coordinate:** `Dockerfile` is not currently in the ownership map — claim it in the Status Board. If Railway uses Nixpacks (auto-detected, no Dockerfile), check first with `railway status` — if Nixpacks is active, the Dockerfile approach may need a `railway.toml` override instead. Note findings in Status Board before proceeding.

---

## 📥 PM DISPATCH — 2026-06-20 (ROUND 14 — Push notification infrastructure)

> `git merge master` first (master at `8234791`). Two tickets. **Do after R13, before any pillar work.**

---

### T1 — Push notification infrastructure: VAPID + DB + `lib/push.ts` + subscribe routes (HIGH — 2h)

**Why:** Edge is currently call-only. Push notifications make it ambient — low-recovery alerts, priority gaps, pre-meeting briefs — without requiring the user to open the app. Core (R16 T3) ships the front-end; Security owns the server infrastructure.

**Fix — four parts:**

**Part A — VAPID key generation:**
Generate a VAPID keypair. Add to `.env.local` and Railway:
- `VAPID_PUBLIC_KEY` — public key (base64url), also exposed as `NEXT_PUBLIC_VAPID_PUBLIC_KEY` for the front-end
- `VAPID_PRIVATE_KEY` — private key (base64url), server-only
- `VAPID_SUBJECT` — `mailto:derrick@deltaedg3.com`

Generate with: `node -e "const wp = require('web-push'); const k = wp.generateVAPIDKeys(); console.log(k)"` (requires `web-push` — add to `package.json` dependencies).

**Part B — `push_subscriptions` table in `lib/db.ts`:**
```sql
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, endpoint)
)
```
Add `pushSubscriptionQueries` to `lib/db.ts`: `upsert(userId, endpoint, p256dh, auth)`, `getAll(userId)`, `delete(userId, endpoint)`.

**Part C — `lib/push.ts` (new file):**
```ts
export async function sendPushToUser(
  userId: number,
  notification: { title: string; body: string },
): Promise<void>
```
Gets all subscriptions for the user. For each, calls `webpush.sendNotification(subscription, JSON.stringify(notification))`. On 410 (Gone) or 404 (endpoint expired) → deletes that subscription from DB. Catches and logs other errors without throwing (push is best-effort, never blocks the caller). Degrades silently if `VAPID_PRIVATE_KEY` is not set.

**Part D — API routes:**
- `POST /api/notifications/subscribe` — authenticated; upserts `{ endpoint, keys: { p256dh, auth } }` from request body into `push_subscriptions`. Returns `{ ok: true }`.
- `POST /api/notifications/unsubscribe` — authenticated; deletes the subscription by endpoint.

**Tests:** `sendPushToUser` — no subscriptions (no-op), sends to all subs, removes expired 410 subscription, degrades when VAPID key missing (≥4 cases). Route tests: subscribe upserts, unsubscribe deletes.

---

### T2 — Proactive notification cron jobs: low recovery alert + priority gap (MEDIUM — 1.5h)

**Why:** Once the infrastructure exists, wire the first two high-value triggers.

**Fix — extend `lib/scheduler.ts`** with two new scheduled jobs (or add to the existing cron structure):

**Job A — Low recovery alert (runs daily at 7:30 AM user's local time):**
For each active user with Whoop connected:
1. `getLatestRecovery(userId)` — if null or score > 40, skip.
2. `sendPushToUser(userId, { title: 'Recovery Alert', body: 'Your recovery is ${score}% today — Edge adjusted your briefing to protect your energy.' })`.
3. Gate: only fire if the user has completed ≥1 briefing call (don't push to churned users).

**Job B — Priority gap alert (runs daily at 9 AM user's local time, AFTER the morning call):**
For each active user:
1. Check if any priority has 0 calendar hours this week (reuse the alignment check logic from `lib/alignment.ts`).
2. If yes and today is Tuesday–Thursday (Mon is low-signal, Fri is too late): `sendPushToUser(userId, { title: 'Priority Gap', body: '"${priority}" hasn\'t had any time this week. Want Edge to block some?' })`.
3. Gate: only fire once per week per priority (store last-sent date in a simple `notification_log` table or check audit_log).

**`notification_log` table (minimal):**
```sql
CREATE TABLE IF NOT EXISTS notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
)
```
Used to gate repeat notifications. `notificationLogQueries.hasRecentEntry(userId, type, withinHours)` → boolean.

**Tests:** low recovery — skips when score > 40, skips when no Whoop, sends when conditions met; priority gap — skips Mon/Fri, skips when priority has hours, sends when gap detected (≥6 cases).

---

## 📥 PM DISPATCH — 2026-06-20 (ROUND 13 — Gmail primitives: email cache gate + Gmail reading indicator + searchEmailsBySubject helper)

> `git merge master` first (master is at `2ca869f`). Three tickets. **Do all before R12 or pillar work.**

---

### T1 — `getRecentEmailSignal` 24h cache gate + suppress empty audit entries (MEDIUM — 1.5h)

*(Carried from R12 T1 — spec unchanged, just not started yet.)*

**Problem:** The Activity tab shows "Reviewed 30 inbox threads" repeating every 30 minutes. `getRecentEmailSignal` in `lib/gmail.ts` is called from 4 routes on every dashboard load and writes a new audit entry each time regardless of whether anything changed.

**Fix — two parts in `lib/gmail.ts`:**

**Part A — 24h cache gate:** At the top of `getRecentEmailSignal`, before any Gmail API call, query `audit_log` for the most recent `email_signal_fetch` entry for this user. If it exists and `created_at` is within the last 24h: return cached result from `snapshot_after.subjects` — no API call, no new audit entry. If older than 24h or missing: fetch normally. EXEMPTION: `{ fullBodies: true }` calls always fetch live (briefing path needs fresh bodies for fact extraction).

**Part B — suppress empty entries:** Wrap the `auditLogQueries.record(...)` call at the bottom in `if (items.length > 0)` — zero-thread fetches produce no Activity tab entry.

**Tests:** second call within 24h → cached, no new audit entry; call after 24h → fresh fetch; empty result → no audit entry; non-empty → audit entry written (≥4 cases).

---

### T2 — Gmail reading indicator in dashboard sidebar (LOW — 30min)

*(Reassigned from Core R14 T6 — this lives in `app/api/auth/**` which Security owns.)*

**Problem:** The Gmail connect UI was removed during R12 cleanup. The inbox reading feature (`gmail.readonly`) still works via the main Google token — there's just no UI confirming it's active.

**Fix — two parts:**

**Part A — `/api/auth/accounts/route.ts`:** Add `hasGmailScope: boolean` to the `calendar` object. Import `hasGmailReadScope` from `@/lib/google-auth`. Get the calendar token's scope via `calendarQueries.get(user.id)` and pass its `.scope` field to `hasGmailReadScope`. Return:
```ts
calendar: { connected: !!cal, hasGmailScope: hasGmailReadScope(cal?.scope ?? null), email: null }
```
Check `lib/db.ts` for the exact field name on the `calendarQueries.get` row.

**Part B — `app/dashboard/page.tsx` (shared file — claim in Status Board):** Restore `calendarHasGmailScope` state (boolean, default false). In `loadData`, set it from `d.calendar?.hasGmailScope`. In the sidebar, below the Google Calendar connected section:
- `calendarConnected && calendarHasGmailScope` → `● Reading Gmail` in the same muted style as other connected indicators
- `calendarConnected && !calendarHasGmailScope` → `Gmail reading inactive — [re-authorize →]` linking to `/api/auth/google` (same tab)
- `!calendarConnected` → show nothing

No new routes, no OAuth changes.

**Tests:** `hasGmailScope: true` when scope includes gmail.readonly; `false` when scope is null or calendar-only (≥2 cases).

---

### T3 — `searchEmailsBySubject` helper in `lib/gmail.ts` (MEDIUM — 1h)

**Why:** Core's upcoming `briefEvent` tool (R15 T6) needs to pull recent emails that match an event's title — e.g. "brief me on the investor meeting" → find emails with subjects matching "investor". This is a Gmail access primitive that belongs in Security's `lib/gmail.ts`, not in the tool handler.

**Fix — new exported function in `lib/gmail.ts`:**

```ts
export async function searchEmailsBySubject(
  userId: number,
  query: string,
  opts: { days?: number; max?: number } = {}
): Promise<EmailSignal>
```

Implementation:
1. Get calendar token (`getCalendarTokens`). Return `{ items: [], fetchedAt, scopeMissing: true }` if missing or no gmail.readonly scope.
2. Use Gmail search query: `q: \`subject:(${query}) newer_than:${days}d\`` with `maxResults: opts.max ?? 10`.
3. For each thread, fetch snippet only (no full body — this is a lightweight search).
4. Return `EmailSignal` (same shape as `getRecentEmailSignal`) — Core consumes the same interface.
5. **No audit log entry** for this call — it's a targeted search, not the inbox scan.
6. **No cache** — searches are query-specific and called only on-demand from briefEvent, not on every dashboard load.

**Tests:** returns matching items, empty when no match, scopeMissing when no token, days param limits range (≥4 cases).

**Coordination:** Once shipped, notify PM — Core's R15 T6 (`briefEvent`) will import this function. No merge needed before Core can start; they can stub it.

---

## 📥 PM DISPATCH — 2026-06-20 (ROUND 12 — Email signal fetch: once-per-day cache gate)

> `git merge master` first. One ticket. **Do before any R11 or pillar work.**

---

### T1 — `getRecentEmailSignal`: 24h cache gate + suppress empty audit entries (MEDIUM — 1.5h)

**Problem (user-visible):** The Activity tab shows "Reviewed 30 inbox threads" / "Reviewed 20 inbox threads" repeating every 30 minutes all day. Root cause: `getRecentEmailSignal` in `lib/gmail.ts` is called from 4 different API routes (`/api/focus/recommend`, `/api/learned`, `/api/meeting-context`, `/api/priorities/derive`) — every dashboard load hits one or more of them, and each call writes a new `email_signal_fetch` audit entry regardless of whether anything changed.

**Fix — two parts:**

**Part A — 24h cache gate (in `lib/gmail.ts`):**
At the top of `getRecentEmailSignal`, before making any Gmail API call:
1. Query `audit_log` for the most recent `email_signal_fetch` entry for this user: `SELECT id, created_at, snapshot_after FROM audit_log WHERE user_id = ? AND action = 'email_signal_fetch' ORDER BY created_at DESC LIMIT 1`
2. If that entry exists AND `created_at` is within the last 24 hours: return the cached result parsed from `snapshot_after.subjects` (reconstruct as `{ items: subjects.map(s => ({ subject: s })), fetchedAt: created_at, scopeMissing: false }`) — **do NOT make a Gmail API call and do NOT write a new audit entry**.
3. If no recent entry (or it's older than 24h): proceed with the existing Gmail fetch as normal.

This means each user's inbox is scanned at most once every 24 hours, regardless of how many times the dashboard loads.

**Part B — suppress empty audit entries:**
In the `auditLogQueries.record(...)` call at the bottom of `getRecentEmailSignal` (around line 376): wrap it in `if (items.length > 0)` — only log when there are actual threads to report. A fetch that returns zero threads is a no-op and shouldn't appear in the Activity tab at all.

**Test cases (add to `lib/gmail.test.ts`):**
1. Second call within 24h → returns cached result, no new audit entry written, no Gmail API call made
2. Call after 24h → makes fresh Gmail API call, writes new audit entry
3. Empty result (0 threads) → no audit entry written
4. Non-empty result → audit entry written as before

Preflight green. No external steps.

---

### T2 — Email feature code removal: `createDraft`, Gmail compose scope, auth routes (MEDIUM — 1.5h)

**Context:** Derrick dropped the email drafting feature. PM removed the Vapi tools + `lib/vapi.ts` references. Core (T7 in Core R12) is removing the route handlers and `lib/outreach.ts`/`lib/replies.ts`. Security owns the underlying access primitives: `createDraft`, the Gmail compose OAuth flow, and the auth routes.

**What to remove/update:**

**Part A — `lib/gmail.ts`:**
Remove the `createDraft` function and its imports/types (`DraftInput`, `DraftResult`, `GMAIL_DRAFTS_PER_HOUR`, the `gmailQueries.logDraft` call, and the anti-spam rate-limit block). Keep `deleteDraft` — `lib/undo.ts` imports it for backward compat with any existing undo records in the DB. Keep `getRecentEmailSignal`, `GmailScopeError` (used elsewhere), everything else.

**Part B — `lib/google-auth.ts`:**
Remove the Gmail compose scope from all new OAuth grants:
- Remove `GMAIL_COMPOSE_SCOPE` from the `getGmailAuthUrl` scope array (or from wherever it's concatenated into the OAuth URL). Users who already have the scope can keep their existing tokens — no revocation needed.
- Remove the `GMAIL_COMPOSE_SCOPE` constant itself if nothing else references it.

**Part C — Remove Gmail-specific auth routes:**
Delete these files entirely:
- `app/api/auth/google/gmail/route.ts` (connect entry point)
- `app/api/auth/google/gmail/callback/route.ts`
- `app/api/auth/google/gmail/disconnect/route.ts`
- `app/api/auth/google/gmail/ingest/route.ts`
- `app/api/auth/google/gmail/gmail-routes.test.ts`

Note: The `gmailTokenQueries` in `lib/db.ts` and the `gmail_tokens` table can stay — no harm in leaving the schema. Removing them risks a schema migration.

**Part D — `app/privacy/page.tsx`:**
Remove the "Gmail" / "email drafting" section (the one that explains Edge can draft emails). Update to accurately reflect that Edge only reads email for the inbox signal (if `getRecentEmailSignal` is still active) — or remove the Gmail section entirely if the only Gmail use is the readonly signal. Check what the current copy says and adjust to match actual permissions in use.

**Tests:** After deletions, `npm run preflight`. Lower test count expected. Preflight green.

---

## 📥 PM DISPATCH — 2026-06-20 (ROUND 11 — Gmail scope close-out + rate-limit hardening + key rotation doc)

> `git merge master` first (master is at `9918c01`). Three tickets, no Core coordination needed.

---

### T1 — Close out Gmail scope decision from R10 T2 (FAST — 20 min, doc only)

Your R10 T2 audit surfaced that the Gmail second flow requests `gmail.readonly` — and flagged it as "keep vs. tighten." Make the call now and close it out.

**Decision (PM-authorized):** **Keep `gmail.readonly`.** It's required by `extractGmailAccountContacts` for contact ingest, which is a core Clarity Score input. Tightening to a narrower scope would break that feature. The scope is justified.

**What to do:** In `content/security-audit.md`, find the T2 entry for the gmail.readonly decision and update the status from "keep-vs-tighten: open" to "**accepted**: `gmail.readonly` retained — required for `extractGmailAccountContacts` (contact ingest + Clarity Score). Reviewed 2026-06-20." No code change. Preflight green.

---

### T2 — Rate-limit gap check: tool-call + memory routes (MEDIUM — 1.5h)

The R4 T2 rate-limit gap check is in the backlog but it's unclear whether it shipped. Verify and fill any gaps.

**What to check:**
1. `/api/vapi/tool-call/route.ts` — is there a per-user rate limit on tool calls? Without one, a runaway Vapi call loop could rack up API costs or spam the calendar. Add: 60 tool calls per user per minute (in-memory Map with timestamp sliding window is fine for now — no Redis needed until multi-instance Railway).
2. `/api/memory/` routes — is there a per-user rate limit on fact writes? Add: 30 writes per user per minute.
3. `/api/briefing/generate` — already has a once-per-day guard? Confirm it's there. If not, add: block re-generation within 2 hours of the last one.

**Implementation:** Add a lightweight `checkRateLimit(userId, key, maxPerMinute)` helper to `lib/auth.ts` or a new `lib/rateLimit.ts`. Uses `Map<string, number[]>` (timestamps), slides the window. Returns `{ allowed: boolean }`. Apply it at the top of each route handler — 429 with `"Too many requests"` when exceeded. Pure in-memory is fine pre-scale.

**Test:** call the helper 61 times in 60 seconds → 61st returns `allowed: false`. Preflight green.

---

### T3 — Key rotation runbook (FAST — 45 min, doc + utility)

`DATA_ENCRYPTION_KEY` is a single key. If Derrick ever needs to rotate it (key leak, audit requirement), there's no procedure and all encrypted data would be unreadable mid-rotation.

**What to build:**

1. **`reEncryptAllUserData(oldKey: string, newKey: string): Promise<void>`** utility in `lib/crypto.ts`. Fetches all encrypted fields from all tables (`facts`, `memories`, `whoop_tokens`, `gmail_tokens`, `google_tokens`, `people_models` encrypted fields). For each: decrypt with `oldKey`, re-encrypt with `newKey`, write back. Runs as a single transaction per user. Log progress: `"Re-encrypting user ${userId}..."`. Dry-run mode: `reEncryptAllUserData(old, new, { dryRun: true })` logs what it would do but writes nothing.

2. **Runbook entry** in `content/durability-runbook.md`: Add a "Key Rotation" section. Steps: (1) Set new `DATA_ENCRYPTION_KEY_NEXT` env var in Railway. (2) Run `reEncryptAllUserData(process.env.DATA_ENCRYPTION_KEY, process.env.DATA_ENCRYPTION_KEY_NEXT)` from a one-off Railway job. (3) Swap `DATA_ENCRYPTION_KEY` to the new value + remove `_NEXT`. (4) Verify a decrypt round-trip. Note: zero-downtime because the re-encrypt runs before the key swap.

**Test:** encrypt a value with key A → `reEncryptAllUserData(A, B)` → decrypt with key B → same value. Preflight green.

---

## 📥 PM DISPATCH — 2026-06-19 (ROUND 8 — people_models schema + setEnergyLevel Vapi tool schema)

> Master at current HEAD. `git merge master` first. Coordination dispatch — Core (Darren) is building M4-4 social mental models and needs the DB schema from you.

### Ticket 1 — `people_models` table schema (P1 — do first, Darren is unblocked waiting on this)

Add to `lib/db.ts` as a new migration:

```sql
CREATE TABLE IF NOT EXISTS people_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_name TEXT NOT NULL,
  goals TEXT,
  communication_style TEXT,
  relationship_state TEXT,
  last_interaction TEXT,
  health_score REAL NOT NULL DEFAULT 1.0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, person_name)
);
```

All TEXT fields (`goals`, `communication_style`, `relationship_state`, `last_interaction`) must be encrypted at rest with `encryptField`/`decryptField` — same pattern as `briefings.content`.

Add `peopleModelQueries` to `lib/db.ts`:
- `upsert(userId, personName, fields: Partial<{goals, communicationStyle, relationshipState, lastInteraction, healthScore}>)` — UPDATE or INSERT, sets `updated_at = datetime('now')`
- `getForUser(userId, personName)` — single row lookup, decrypts fields
- `listForUser(userId)` — all rows, decrypted
- `deleteForUser(userId, personName)` — for completeness
- Add `peopleModelQueries.deleteAllForUser(userId)` to the account deletion route

**Account deletion:** `app/api/account/delete/route.ts` — add `DELETE FROM people_models WHERE user_id = ?` (same pattern as other user-scoped tables).

**Test:** upsert a row with all fields, read it back via `getForUser`, verify decryption round-trips correctly. Verify account deletion cleans the table. Preflight green.

---

### Ticket 2 — `setEnergyLevel` Vapi tool schema (P2 — after Ticket 1)

The Energy OS shipped the energy signal and day recommendations, but there's no Vapi tool letting Edge set/update the energy level mid-call. Create the route:

**`POST /api/vapi/energy`** (new route) — secured with `checkVapiSecret`:
- Body: `{ userId: number, level: 'red' | 'yellow' | 'green', source: 'self-report' }`
- Writes to `energy_logs` table (already exists per the Energy OS spec)
- Returns `{ ok: true, message: "Energy level updated to [level]" }`

**Rate limit:** 10/hr per user (same as other Vapi tool routes).

Derrick will create the Vapi dashboard tool and paste the UUID — leave a `// TODO: paste UUID` placeholder comment in `lib/vapi.ts` toolIds object once Core tells you where it goes. Coordinate with Darren.

Preflight green.

---

## 📥 PM DISPATCH — 2026-06-18 (ROUND 6 — Predictive context loading + confidence decay schema)

> Master at `c7d2515`. `git merge master` first. **READ FIRST:** `content/memory-research-applied.md`
> (Theory 3: Predictive context loading; Theory 1: Memory confidence decay).
> Two tickets. #1 is fully independent — build now. #2 depends on bi-temporal landing first (Round 5 T1).

### Ticket 1 — ★ Predictive context loading: 11pm pre-call prep job (P1 — build now, independent)

> **Owned by Security/Vijay.** You own `lib/scheduler.ts`. Core provides the builder fn; you wire the cron.
> This is distinct from the sleep-time consolidation agent (which runs *after* calls). This runs *before* —
> assembling tomorrow's optimal briefing context so the call reads a pre-warmed pack, not a live query.

**What it does:**
Nightly at 11pm (user's local timezone), for each active user with a call scheduled tomorrow:
1. Calls `buildBriefingContextPack(userId)` (Core exports this from `lib/briefing.ts` — see constraint below)
2. Writes the result to a new `briefing_context_packs` table (or `user_cache` row keyed by date)
3. The morning call reads the pre-warmed pack first; falls back to live assembly if pack is missing or stale

**Two hard constraints (coordinate with Darren):**
- **Reuse `lib/briefing.ts` context assembly** — do NOT write a parallel assembler. Darren extracts a
  `buildBriefingContextPack(userId): Promise<string>` fn from the existing briefing builder. You call it.
  If they drift, briefings become inconsistent.
- **Respect `data_consent`** — call `isImproveConsented(user)` from `lib/consent.ts` before caching.
  Users in Privacy Mode: cache is allowed (it's their own data), but log no telemetry on the pack contents.

**Schema (Security owns):**
```sql
CREATE TABLE IF NOT EXISTS briefing_context_packs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  pack_date TEXT NOT NULL,          -- YYYY-MM-DD (the date of the briefing this primes)
  context_pack TEXT NOT NULL,       -- encrypted at rest (contains memory content)
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, pack_date)
);
```
- `context_pack` encrypted at rest (same pattern as `memories.content`)
- One row per user per day; upsert on regeneration
- Prune rows older than 7 days (no need to keep stale packs)

**Scheduler entry:** add to `lib/scheduler.ts` alongside the existing briefing scheduler.
One Haiku call per user per night. ~$0.001/user/day.

---

### Ticket 2 — Confidence decay schema (P1 — depends on bi-temporal Round 5 T1 landing first)

> **NOTE:** This IS the active half of the P3 "memory quality scoring" item. Do NOT build as a
> separate system — this is the same thing, built on the `valid_from` column from Round 5 T1.
> Wait for Round 5 T1 to merge before starting this ticket.

**What it does:** Every fact has a confidence score. Facts decay over time. When confidence drops below
a threshold, they surface for reconfirmation. Prevents memory drift — the moat leaking.

**Schema addition (on top of Round 5 T1's `facts` table changes):**
```sql
-- Add to facts table (after valid_from/valid_until land):
confidence REAL NOT NULL DEFAULT 1.0,   -- 1.0 = confirmed; decays to 0.0
last_confirmed_at TEXT DEFAULT (datetime('now'))
```

**Decay logic (Security owns — weekly scheduled job in `lib/scheduler.ts`):**
- Volatile facts (category: priorities, projects, current_focus): decay 0.1/week
- Stable facts (category: personality, working_style, relationships): decay 0.02/week
- Fact confirmed again (mentioned in call or Derrick doesn't correct it): reset to 1.0, update `last_confirmed_at`
- Facts below 0.3 confidence: flagged as "unverified" — surfaced to Core's reconfirmation trigger (see ROADMAP-CORE Round 6 T2)

**Coordinate with Darren:** Core writes the mid-call reconfirmation trigger that reads the low-confidence
queue and surfaces questions during briefings. Security owns the schema + decay scheduler only.

Ship small / green / full preflight (`npm run preflight` from `C:\Users\Derrick\edg3`).
Update changelog + Status Board when done.

---

## 📥 PM DISPATCH — 2026-06-18 (T3-1 part A — Add 'pattern' to facts category constraint)

> Master at `87af54d`. `git merge master` first. 5-minute ticket.

### Ticket 1 — Add `'pattern'` to the facts table CHECK constraint (T3-1 schema gap)

**The gap:** `lib/db.ts:251` has `CHECK(category IN ('person','project','goal','preference','fact'))`. The dashboard renders a Patterns tab (`app/dashboard/page.tsx:2589`) but the constraint blocks any fact with `category='pattern'` from being inserted. Currently `lib/factPatterns.ts` stores patterns as `category='fact'` + `source='historical-pattern'` — they land in the Facts bucket, not Patterns.

**Fix — two changes, both additive:**

1. In `lib/db.ts` schema (line ~251): change the CHECK to include `'pattern'`:
   ```sql
   category TEXT NOT NULL CHECK(category IN ('person','project','goal','preference','fact','pattern'))
   ```
   Note: SQLite CHECK constraints are not enforced via ALTER TABLE — the schema string change takes effect for new DB initializations. Add a runtime migration to cover existing DBs. The simplest safe migration is a no-op here (existing rows are valid; we're only adding a new allowed value). Add a comment noting that this is additive.

2. Update the TypeScript type in `lib/db.ts` (line ~1596) to include `'pattern'`:
   ```typescript
   category: 'person' | 'project' | 'goal' | 'preference' | 'fact' | 'pattern';
   ```

That's it — schema + type only. Core (Darren) does the factPatterns.ts side. No test changes needed; the constraint is structural.

- **Files:** `lib/db.ts` only
- **Preflight:** must pass before commit

---

## 📥 PM DISPATCH — 2026-06-18 (T3-3 — Data export completeness)

> Master at `dc7653d`. `git merge master` first. Spec: `content/export-audit.md` — read it before starting.

### Ticket 1 — Add missing tables to `app/api/account/export/route.ts` (T3-3)

The current export (v1) is missing 4 data sources. Add them:

1. **`episodes`** (HIGH) — call ground-truth records from `lib/episodeStore.ts`. Fields: `occurred_at`, `source`, topics (decrypt + JSON parse), commitments (decrypt + JSON parse). Transcripts optional but preferred.
2. **`audit_log`** (HIGH) — every action Edge took on the user's behalf. Fields: `action`, `description`, `ok`, `created_at`. Omit `session_id`.
3. **`fact_history`** (MEDIUM) — versioned memory audit trail. Join `fact_history` to `facts` on `fact_id` to get `user_id` scoping. Fields: `fact_id`, `statement`, `retired_at`, `retired_reason`, `source`.
4. **`undo_history`** (LOW) — undo records. Fields: `action_type`, `created_at`, `used_at`.

Also:
- **Include retired facts** in the `facts` export: change `factQueries.getAll` to return both active and retired facts; add `status: 'active' | 'retired'` and `retiredAt: string | null` fields.
- **Add `confidenceScore` and `lastConfirmedAt`** to each fact (both columns added in Round 6 — verify they're on the `factQueries.getAll` result).
- **Bump version** from `'1'` to `'2'` in the payload.

Full code snippets in `content/export-audit.md`. This is additive — no schema changes, no auth changes, just additional SELECT queries and payload fields.

- **Files:** `app/api/account/export/route.ts` only (Security owns this route)
- **Test:** verify all 4 new sections appear in a fresh export; verify retired facts appear with `status: 'retired'`

---

## 📥 PM DISPATCH — 2026-06-17 (ROUND 5 — Bi-temporal fact schema)

> Master at `e7357cc`. `git merge master` first. **READ FIRST:** `content/memory-research-applied.md`
> (Zep/Graphiti bi-temporal model). This is the schema foundation for the memory self-learning flywheel —
> Core builds the conflict-resolution logic on top. Coordinate query shape with Darren.

### Ticket 1 — ★ Bi-temporal columns on the `facts` table (P1)
- Add `valid_from TEXT DEFAULT (datetime('now'))` and `valid_until TEXT` (nullable) to the **`facts`** table
  (`lib/db.ts` ~line 228). Additive, defaulted — no migration drama. NOTE: Edge's entity facts live in `facts`,
  NOT `memories` (the spec says "memories" generically, but `memories` is raw call notes — facts is the fact store).
- Add `factQueries.retire(userId, factId)` → sets `valid_until = datetime('now')`; NEVER hard-delete. User-scoped (`AND user_id = ?`).
- Support an "active only" filter (`valid_until IS NULL`) on fact reads. Keep ADDITIVE so existing callers don't
  break — default to active-only or add an `includeRetired` flag; coordinate the exact shape with Darren (he wires
  conflict-resolution on top in `lib/facts.ts`).
- Retired facts are historical record (they feed pattern detection). `facts.statement` is already encrypted at rest — keep it.

### Ticket 2 — verify new memory tables encrypted + scoped (carry-over)
- M2/M3/M4 tables (relationships/patterns/accountability) + `episodes`: confirm content encrypted at rest +
  user-scoped authz. Episode ingestion consent-gating audit (respect `data_consent` / `isImproveConsented`).

> Small / green / full preflight. Update changelog + Status Board.

---

## 📥 PM DISPATCH — 2026-06-18 (ROUND 4 — Launch hardening: audit log gaps + rate-limit sweep)

> Master at `30ff3df`. `git merge master` first (picks up CASA enforcement you already shipped).
> CASA is done. This dispatch is pre-launch hardening — close the remaining trust gaps before September.

### Ticket 1 — Audit log coverage sweep

The `audit_log` table records calendar mutations and email drafts. Before launch, verify it covers every action a user can trigger and close any gaps.

1. List every `POST`/`PATCH`/`DELETE` route in `app/api/**` that mutates user data. For each: confirm it writes to `audit_log` (or explain why it doesn't need to).
2. Routes most likely to be missing: `/api/onboarding/**`, `/api/memory/facts/[id]` (PATCH — fact edits), `/api/priorities/**`, `/api/open-loops/**`.
3. For any missing: add a `recordAuditEvent(userId, action, args, snapshot)` call. Reuse the existing pattern from calendar mutations.
4. Document the full coverage map in `content/security-audit.md` under a new "Audit log coverage" section.

### Ticket 2 — Rate-limit gap check

Round 3 shipped 36 rate-limited route types. Before launch, verify there are no obvious unprotected mutation routes remaining — especially any new routes Core has added since Round 3 (Focus Scoreboard, CASA consent endpoint, any new onboarding routes).

1. Scan `app/api/**` for `POST`/`PATCH`/`DELETE` routes added or modified since your last sweep.
2. Add `rateLimit()` to any unprotected mutation endpoint.
3. Update the rate-limit inventory in `content/security-audit.md`.

Ship small / green / full preflight. Update changelog + Status Board when done.

---

## 📥 PM DISPATCH — 2026-06-18 (Data consent enforcement — CASA requirement)

> Master at `65c04dd`. Sync master first. Full spec: `specs/data-control-onboarding.md`.
> Core owns the DB column + onboarding wiring; Design owns the screen. You own making the choice TRUE.

**Your piece (Security — enforcement layer):**

1. **Enforce Privacy Mode in the data pipeline.** When `users.data_consent = 'privacy'`, that user's calls, transcripts, and facts must NEVER enter any training/improvement pathway or be sent to any third party. Audit every outbound data path (any batch export, model fine-tuning pipeline, analytics sink) and add a `data_consent` check. Right now Edg3 doesn't have a training pipeline, so the primary task is: document the enforcement (what this means today = no data leaves except to OpenAI/Anthropic for inference as required to provide the service) and add a sentinel assertion to any future path that would extract training data.

2. **Privacy Mode must be honored in any inference calls.** If a future session-level or user-level fine-tuning path is added, it must check `data_consent = 'improve'` before including the user's data. Add a comment in any LLM-call path flagging this.

3. **Document for CASA.** Add a section to `content/security-audit.md`: "Data consent and Privacy Mode" — describes the two choices, the DB enforcement, what data flows where under each setting, and the audit trail. Google reviewers will look for this.

4. **Data export includes consent setting.** If there is a `/api/account/export` endpoint (or when it's built), include `data_consent` in the export so users can verify their setting.

**Dependency:** wait for Core to add the `users.data_consent` column before enforcing. Coordinate on timing — this is additive.

---

## 📥 PM DISPATCH — 2026-06-17 (S3 — harden the hero-loop apply path)

> Master at `4f68720` (1015 green). S1+S2 shipped ✅. Sync master first.

**S3 — Audit + harden the hero-loop APPLY path.** Core (Ticket H) is deepening the hero loop —
the one-click **Apply** executes a batch of real calendar mutations (create/move) via
`/api/day-plan/confirm`. As it gets richer + more prominent, that path must be safe:
1. **Idempotency / double-apply** — `/api/day-plan/confirm` uses a `planId` (`issueDeleteToken`).
   Verify a double-click / retry can't apply the same plan twice (duplicate events / double moves).
   Confirm the token is consumed atomically and reuse is rejected.
2. **Undo grouping** — a multi-action plan must be undoable as a unit (recordUndo per action, grouped
   by planId). Verify the undo path covers every applied action.
3. **Rate limit** — confirm `dayPlanConfirm` limit is sane for one-click use.
4. **Authz** — a planId issued for user A must not be applicable by user B (user-scoped).
Coordinate with Darren (he's editing `/api/day-plan/**` for H). Tests. Ship small / green /
full preflight / log changelog.

---

## 📥 PM DISPATCH — 2026-06-16 EVENING (Vijay)

> Master at `2c73f5b` (997 green). Sync master first. Two contained tasks:

**S1 — Harden + audit the new public `/api/waitlist` endpoint.** PM shipped it (`bda358f`) to fix
the dead landing CTA — it's the first **unauthenticated public write** endpoint. Review it:
confirm IP rate-limit is effective (5/hr `waitlist` key), email validation can't be abused
(header injection, oversized input, unicode tricks), no enumeration leak (it returns generic
success — verify), and the `waitlist` table can't be spammed to exhaustion. Add anything missing
(e.g., basic disposable-domain guard is optional). Add the `waitlist` table to the backup/export
set if it's not already covered. Tests.

**S2 — Resolve the parked CSP decision for real.** Strict nonce CSP was reverted (broke prod —
Turbopack didn't emit nonces). EITHER reproduce locally (`next build && next start`, curl the HTML,
confirm `<script>` tags carry `nonce="…"`) and re-enable strict CSP if it genuinely works in a
browser, OR formally close it out: document that `'self' 'unsafe-inline'` is the accepted pre-beta
baseline and remove the "follow-up" TODO so it's not a lingering open item. Don't redeploy strict
CSP without browser-verified enforcement.

Ship small / green / full preflight / log changelog.

---

## Changelog
- **2026-06-23** — **R19 T2 COMPLETE — gratitude auto-call re-fire guard (2120 green).** _(synced master first)_
  - **Root cause:** `runGratitudeAutoCall()` self-gated on `gratitudeQueries.getByDate(user, today)`, but a gratitude row is only written when the `recordGratitude` Vapi tool fires (user actually speaks their items). A call that connected then hung up (e.g. quota error) left no row → the gate never tripped → the job re-called every 10 min for the whole 5–11am window (~36 attempts).
  - **Fix (`lib/proactiveNotifications.ts`):** pre-insert a null-item reservation row immediately before `scheduleOpenCall` — `gratitudeQueries.create(user.id, today, null, null, null)` wrapped in try/catch (best-effort). The gate now trips on the next tick regardless of call outcome. On a successful call `recordGratitude` inserts a second row with the real items.
  - **Hardening (`lib/db.ts`):** `gratitudeQueries.getByDate` now orders `created_at DESC, id DESC` (was `created_at DESC` only). `created_at` is second-resolution, so the reservation row and the real-items row can collide in the same second; the `id DESC` tiebreak guarantees the latest-inserted (real-items) row always wins. Shared-file edit, additive/strictly-more-correct — flagged for Core awareness.
  - **Tests:** new `lib/gratitude-autocall.test.ts` (real in-memory DB; `./scheduler` + `./whoop` mocked). 4 cases: first tick fires + reserves null row → next tick skips; scheduleOpenCall throws → reservation still blocks the retry; recordGratitude real-items row wins getByDate; out-of-window tick is a no-op. 130 files / 2120 green.
- **2026-06-23** — **R19 T1 COMPLETE — quota-error retry cascade fix (2116 green).** _(synced master first)_
  - **Root cause:** `endedReason = 'pipeline-error-eleven-labs-quota-exceeded'` matched `MISSED_CALL_REASONS` via `'pipeline-error'`, so the webhook stamped `retry_after`; the scheduler then spun up a fresh briefing and re-fired — cascading forever (14 consecutive failed briefings on 2026-06-22) since a quota error never self-heals on retry.
  - **Fix (`app/api/vapi/webhook/route.ts`):** added `const isQuotaError = endedReason.toLowerCase().includes('quota')`. Split the single missed-call branch into two: `if (wasMissed && !briefing.retry_attempted && !isQuotaError)` → mark missed + stamp retry + `scheduleRetry` (unchanged transient path); else `if (wasMissed)` → mark missed only, `console.warn` on quota, **no retry**. Quota errors and already-retried calls now terminate cleanly.
  - **Tests:** new `app/api/vapi/webhook/quota-retry.test.ts` (real-DB integration, mirrors `inbound.test.ts` harness; global `fetch` stubbed to reject so the transcript fetch falls through fast). 3 cases: quota error → missed + **no** `retry_after`; non-quota pipeline error → missed + retry stamped (preserved); `no-answer` → still retries. 129 files / 2116 green.
- **2026-06-22** — **R18 T1 COMPLETE — webhook wiring landed after Core R23 T2 merged (2113 green).** _(synced master first)_
  - Layered the (additive) Security calls into Core's `assistant-request` handler (`app/api/vapi/webhook/route.ts`): `checkInboundCallRateLimit(callerNumber)` runs **right after the caller number is parsed, BEFORE the user lookup** (so unregistered abusers are throttled too) → on breach: `logInboundCallAttempt('rate_limited')` + return the **8s polite-decline** assistant config (no briefing created). Unknown caller → `logInboundCallAttempt('unknown_caller')` + existing 15s decline. Registered caller → `logInboundCallAttempt('allowed', userId, vapiCallId)` + the normal personalized open call.
  - +2 integration tests in Core's `inbound.test.ts` (rate-limited → 8s decline + no briefing + rate_limited audit; allowed → attempt recorded + allowed audit). Added the `@/lib/rateLimit` mock mapping + inbound_call_attempts/audit cleanup to its `beforeEach`. 128 files / 2113 green. **R18 fully shipped.**
- **2026-06-22** — **R18 T1 — inbound-call rate limit + audit (helpers shipped standalone; webhook wiring pending Core R23 T2) (2103 green).** _(synced master first)_
  - `inbound_call_attempts` table (`lib/db.ts`) — phone-keyed ledger, `user_id` **nullable** (unknown callers), `attempted_at` unix ms; index on `(phone_number, attempted_at)`; registered in `USER_SCOPED_DELETE_ORDER` (drift guard green). `inboundCallQueries.countSince/record`.
  - `checkInboundCallRateLimit(phoneNumber, userId?)` (`lib/rateLimit.ts`) — **5 inbound calls / rolling 24h per phone**; blocked → `{ allowed:false, reason:'rate_limit' }` (records nothing); pass → records the attempt → `{ allowed:true }`. Fails OPEN on DB fault.
  - `auditLogQueries.logInboundCallAttempt({ phoneNumber, userId, outcome, vapiCallId })` — writes `action='inbound_call_attempt'`. **⚠️ Spec wanted `user_id=null` for unknown callers, but `audit_log.user_id` is `NOT NULL` — used sentinel `0` for unknown callers (invisible in any user's Activity tab; queryable for security review). Known users log with their userId.** `ok=1` only for `allowed`.
  - **8 tests** (5/24h cap, blocked-not-recorded, 24h window reset, per-phone isolation, userId stored; audit known/unknown/rate_limited; deletion-order drift).
  - **⏳ Webhook wiring DEFERRED (coordination):** Core R23 T2's `assistant-request` handler is **not in `app/api/vapi/webhook/route.ts` yet** — so the rate-limit + audit calls aren't wired in. Once Core's PR lands I'll layer them into the handler (purely additive: `checkInboundCallRateLimit` after parsing the caller number → on breach `logInboundCallAttempt(rate_limited)` + return the 8s polite-decline assistant config; else `logInboundCallAttempt(allowed|unknown_caller)`). Integration test (webhook → polite decline) lands with that wiring.
- **2026-06-21** — **R17 — wire proactive notifications into the sweep (T1) + consolidate export endpoints (T2) (2070 green).** _(synced master first)_
  - **T1:** `runProactiveNotifications` was already wired to the `*/30` cron (R14 T2), but reworked to Kevin's model: eligibility = **users with ≥1 push subscription AND ≥1 completed briefing** (SQL `JOIN push_subscriptions` + `EXISTS completed briefing` — skips users who can't receive a push / never used the product); calls **both** jobs every sweep (they self-throttle: low-recovery 20h, priority-gap 7d). **Per-JOB try/catch** so a low-recovery failure can't skip priority-gap and one user's error never aborts the sweep. Moved the **Tue–Thu weekday gate into `maybePriorityGapAlert`** (self-gate, preserves the R14 timing intent within the every-sweep model). 11 tests (both-jobs-called, per-user-error-continues, weekday gate).
  - **T2:** consolidated the two GDPR exports. First **merged** the 4 fields `/api/user/export` had that `/api/account/export` lacked — `callFeedback`, `notificationLog`, `whoopConnected` (bool), `pushSubscriptionsCount` (int) — into the canonical `/api/account/export` (`version` '4'→'5'). Then replaced `app/api/user/export/route.ts` with a **thin delegator** (`export { GET } from '../../account/export/route'`) so existing callers keep working and get the complete export; deleted the old user-export test. `/api/account/export` is now the single source of truth.
- **2026-06-21** — **R16 — JWT_SECRET startup enforcement (T1) + `GET /api/user/export` GDPR export (T2) (2068 green).** _(synced master first)_
  - **T1:** `validateJwtSecret(secret?)` in `lib/auth.ts` — throws a loud, actionable error (with a generate-key hint) if `JWT_SECRET` is unset, < 32 chars, or a known placeholder (distinctive multi-char tokens; short generics like `secret`/`changeme` are already caught by the length gate). `getJwtSecret()` now routes through it (every auth op rejects weak secrets). **Enforcement wired in `instrumentation.ts` `register()`** — the real Node server-boot hook — **not** module-init, which would break `next build` (runs without runtime env) and every test that imports auth before setting the env. `.env.example` created (JWT_SECRET + DATA_ENCRYPTION_KEY + VAPID + Litestream + service keys, all blank, with generate commands) and **un-ignored in `.gitignore`** (`!.env.example` — template carries no secrets). 4 tests.
  - **T2:** `GET /api/user/export` (`app/api/user/export/route.ts`) — auth-gated self-serve GDPR export: profile (no password hash), facts, memories (content truncated > 10k), tasks, callFeedback, notificationLog, `whoopConnected` (boolean only), `pushSubscriptionsCount` (int only) — no tokens ever in the body. `Content-Disposition: attachment`. 4 tests (401, expected keys, whoopConnected true on token row, secret values absent). **⚠️ Spec's `outreach_tracking` omitted — that table/feature was removed in R12 (email drafting deleted); no such data exists. Also note: this overlaps `/api/account/export` (comprehensive) — flagged to PM for possible consolidation.**
- **2026-06-20** — **`GET /api/notifications/history` — proactive notification feed for the dashboard panel (2060 green).** _(PM dispatch; synced master first)_
  - `notificationLogQueries.listForUser(userId, limit=10)` added (`lib/db.ts`) — newest-first `notification_log` rows.
  - `app/api/notifications/history/route.ts`: authed GET, user-scoped, limit 10. Renders each `{type, payload, sent_at}` row into `{type, title, body, sentAt}` (the shape `NotificationHistoryPanel` consumes) — `low_recovery`/`priority_gap` mapped to the same copy `lib/proactiveNotifications.ts` pushes; unknown types degrade gracefully. 4 tests.
  - **🔔 @Cam (Design):** `components/ui/NotificationHistoryPanel.tsx` currently fetches `/api/notifications` (the in-app feed) — repoint it to **`/api/notifications/history`** to show the proactive push log. Response shape: `{ notifications: [{ type, title, body, sentAt }] }`.
  - R15 T1 (Litestream) confirmed already-built (findings on Status Board); Trust Tier 0/1 + DAILY-CALL DC1/DC3-2 Security items all shipped. 118 files / 2060 green.
- **2026-06-20** — **R14 T2 — Proactive notification cron jobs: low-recovery + priority-gap (1990 green).**
  - `lib/proactiveNotifications.ts` (new): `maybeLowRecoveryAlert` (Whoop recovery ≤40% → push; gated on ≥1 completed call + once/day via `notification_log`), `maybePriorityGapAlert` (reuses `computeAlignment` — any priority at 0 calendar hours → push; once/week/user gate runs BEFORE the calendar+LLM calls to bound cost). `runProactiveNotifications(now)` sweeps active users and dispatches by LOCAL time: Job A at 7:30, Job B at 9:00 Tue–Thu (Mon low-signal, Fri too late). 12 tests.
  - `lib/scheduler.ts`: new `*/30 * * * *` cron → **dynamic** `import('./proactiveNotifications')` (same pattern as `./briefing`) so its heavy deps (calendar/alignment/whoop/push) stay out of the scheduler module-load graph — avoids breaking other suites' partial mocks.
  - **Note (per-priority simplification):** the priority-gap gate is once/week/**user** (not strictly per-priority) so the expensive alignment runs at most once/week/user; the specific gap priority is recorded in `notification_log.payload`. 110 files / 1990 green.
- **2026-06-20** — **R14 T1 — Push notification infrastructure: VAPID + DB + `lib/push.ts` + subscribe routes (1978 green).** _(synced master first)_
  - Added `web-push` dependency (+ `@types/web-push`). **VAPID keys generated into `.env.local`** (gitignored; ⚠️ **Railway/prod keys are Derrick's separate external step** — `VAPID_PUBLIC_KEY`/`NEXT_PUBLIC_VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`).
  - `lib/db.ts` (claimed): `push_subscriptions` table (UNIQUE user+endpoint, CASCADE) + `pushSubscriptionQueries.upsert/getAll/delete`; `notification_log` table + `notificationLogQueries.record/hasRecentEntry`. Both added to `USER_SCOPED_DELETE_ORDER` (deletion drift-guard passes). Indexes added.
  - `lib/push.ts` (new): `sendPushToUser(userId, {title, body})` — best-effort, never throws; no-op when VAPID unset or no subs; deletes 410/404-expired endpoints; logs other errors. 6 tests.
  - Routes: `POST /api/notifications/subscribe` (validates `{endpoint, keys:{p256dh,auth}}` → upsert) + `/unsubscribe` (delete by endpoint), authed + `pushSubscribe` rate-limit (30/hr). 7 route tests.
  - 109 files / 1978 green. _(T2 cron jobs next.)_
- **2026-06-20** — **R13 — Gmail primitives: cache gate (already shipped) + reading indicator + `searchEmailsBySubject` (1965 green).** _(synced master first)_
  - **T1 — already on master** (`6abf51c`, R12 T1): `getRecentEmailSignal` 24h cache gate + suppress-empty audit + `fullBodies` bypass. Verified present; no work needed.
  - **T2 — Gmail reading indicator.** `app/api/auth/accounts/route.ts`: added `calendar.hasGmailScope = hasGmailReadScope(cal?.scope ?? null)` (READONLY, not the removed compose). `app/dashboard/page.tsx` (claimed shared file; minimal additive diff): restored `calendarHasGmailScope` state, set from `d.calendar?.hasGmailScope` in `loadData`, sidebar shows "● Reading Gmail" (granted) / "Gmail reading inactive — re-authorize →" (`/api/auth/google`) / nothing if calendar not connected. 4 route tests.
  - **T3 — `searchEmailsBySubject(userId, query, opts)`** in `lib/gmail.ts`: targeted `subject:(${term}) newer_than:${days}d` search → snippet-only `EmailSignal` (same shape as `getRecentEmailSignal`). **No audit entry, no cache** (on-demand search, not the daily scan). Query sanitized (strips `()"{}` ) so an event title can't break the Gmail query grammar. `scopeMissing` when no calendar token / no gmail.readonly. 5 tests. **📣 @Kevin: ready for Core's R15 T6 `briefEvent` to import.**
- **2026-06-20** — **PILLAR-TRUST T3-3 COMPLETED — data export accuracy (1940 green).** _(pillar work; no open dispatch)_
  - Closed the remaining T3-3 sub-items (the HIGH items — episodes/audit_log/fact_history — shipped in R10 T1). `app/api/account/export/route.ts`: **facts** now exported with `includeRetired:true` + per-fact `status` (active/retired) + `retiredAt` + `confidence` + `confidenceScore` + `lastConfirmedAt`; added **`undoHistory`** (undo label + undone flag + timestamp; internal restore payload excluded). `version` '3' → '4'. +1 test (active+retired metadata, undoHistory). Reconciled the PILLAR-TRUST T3-3 marker DISPATCHED → ✅ FIXED. **Security pillar surface now fully exhausted** — only Core/Design-owned or Phase-2-gated items remain.
- **2026-06-20** — **R12 Ticket 2 FOLLOW-UP — `createDraft` + `gmail.compose` scope removed (Core R12 T7 unblocked it) (1939 green).** _(synced master first)_
  - `lib/gmail.ts`: removed `createDraft`, `DraftInput`/`DraftResult`, `GMAIL_DRAFTS_PER_HOUR`, the anti-spam rate-limit block, `buildRawMessage`, the `gmailQueries.logDraft` audit, and `userHasGmailScope`. Dropped the now-unused `gmailQueries`/`hasGmailScope` imports. **`deleteDraft` retained** (`lib/undo.ts` backward-compat). `GmailScopeError` kept for read-path scope errors (message genericized — no longer compose-specific). File header rewritten: read-only inbox signal + draft-delete only.
  - `lib/google-auth.ts`: **deleted `GMAIL_COMPOSE_SCOPE`**, removed it from `GOOGLE_SCOPES`, and removed `hasGmailScope` (its consumers — createDraft guard, userHasGmailScope, accounts-status field — are all gone). `missingRequiredScopes` now returns just `[GMAIL_READONLY_SCOPE]` for calendar-only users.
  - `app/api/auth/accounts/route.ts`: dropped the `hasGmailScope` response field (drafting status is meaningless now).
  - Tests: removed `createDraft guardrails` + `userHasGmailScope` describes from `gmail.test.ts`; updated `google-auth.test.ts` (asserts compose is **no longer** requested; `missingRequiredScopes` → readonly only). `security-audit.md` R12 T2 note marked done.
  - **Net result: `gmail.readonly` is now the ONLY Gmail scope EDG3 requests** — no compose, no send. 105 files / 1939 green (lower count expected — draft tests removed). Clean `.next` rebuild.
- **2026-06-20** — **R12 Ticket 2 — email-drafting feature removal: dedicated-Gmail flow + contact ingest gone; createDraft DEFERRED on Core (1993 green).** _(synced master first)_
  - **Shipped (Parts C + D + the cleanly-orphaned removals):**
    - Deleted `app/api/auth/google/gmail/{route,callback,disconnect,ingest}.ts` + `gmail-routes.test.ts` (Part C).
    - `lib/google-auth.ts`: removed the dedicated-Gmail-account OAuth flow orphaned by Part C — `getGmailAuthUrl`, `exchangeGmailCode`, `emailFromIdToken`, `saveGmailTokens`, `disconnectGmailAccount`, `GMAIL_ACCOUNT_SCOPES`, `GmailTokenExchange`. (`getGmailTokens`/`persistRefreshedToken`/`hasLinkedGmailAccount` retained.)
    - `lib/gmail.ts`: removed `extractGmailAccountContacts` + `EmailContact` + `parseFromHeader` + the `gmail_contacts_fetch` audit (the ingest feature).
    - `app/privacy/page.tsx` (Part D): Gmail section + Google-API disclosure rewritten to read-only (`gmail.readonly`) — all "drafting/creates drafts/never sends" language removed; inbox-reading-for-briefings kept (still active).
    - `lib/google-auth-accounts.test.ts` rewritten (drop the removed-fn tests; seed via `gmailTokenQueries.upsert`). `content/security-audit.md` R12 T2 note added.
  - **⚠️ DEFERRED — Part A (`createDraft`) + the `gmail.compose` scope cleanup — BLOCKED on Core's R12 T7.** `app/api/vapi/tool-call/route.ts:909` (Core-owned `draftEmail` handler) still imports + calls `createDraft`; removing it now would red the build. `createDraft`, `DraftInput`/`DraftResult`, `GMAIL_DRAFTS_PER_HOUR`, the anti-spam block, `logDraft`, plus `GMAIL_COMPOSE_SCOPE` (in `GOOGLE_SCOPES` + `hasGmailScope`/`missingRequiredScopes`) all land once Core removes that handler. **`deleteDraft` retained permanently** (`lib/undo.ts`). Net once both land: `gmail.readonly` is the only Gmail scope. ⚠️ **PM ordering note: Core R12 T7 must land before/with my follow-up createDraft removal.**
  - `gmail_tokens` table + `gmailTokenQueries` retained (no schema change, per dispatch). 107 files / 1993 green; clean `.next` rebuild (stale route validator types).
- **2026-06-20** — **R12 Ticket 1 — `getRecentEmailSignal` 24h cache gate + suppress empty audit entries (1990 green).** _(synced master first)_
  - **Part A (cache gate):** `getRecentEmailSignal` (`lib/gmail.ts`) now checks the most recent `email_signal_fetch` audit receipt; if it's < 24h old it returns the cached subjects (reconstructed from the encrypted `snapshot_after`) — **no Gmail API call, no new audit row**. Fixes the Activity tab flooding with "Reviewed N inbox threads" every ~30 min as the dashboard hit the 4 caller routes. `parseSqliteUtcMs` parses SQLite's tz-less `datetime('now')` as UTC (avoids a timezone-offset bug in the window math).
  - **⚠️ Correctness guard beyond the literal spec — `fullBodies` is EXEMPT from the cache.** The briefing path calls with `{ fullBodies: true }` and needs FRESH message bodies for Round-7 fact extraction; a subjects-only cache can't serve that. The 4 flooding callers are all metadata-mode (no `fullBodies`), so the spam fix is unaffected. Without this exemption the literal spec would have silently degraded briefing fact-extraction. (Flagged to Kevin.)
  - **Part B (suppress empty):** the `auditLogQueries.record` is now wrapped in `if (items.length > 0)` — a zero-thread fetch writes no receipt (and can't poison the cache with an empty snapshot).
  - Tests (`lib/gmail.test.ts`): the 4 spec cases (cached-within-24h, refetch-after-24h, empty→no-audit, non-empty→audit) + a 5th for the `fullBodies` cache bypass. Converted the old "snapshotAfter null on empty" test to the new no-audit contract. Also reset `h.dbGet` default in `beforeEach` (clearAllMocks doesn't reset return values → would leak a cache row across tests). 47 gmail tests green; 107 files / 1990 total.
- **2026-06-20** — **R11 Ticket 3 — DATA_ENCRYPTION_KEY rotation utility + runbook (1969 green).**
  - **`reEncryptAllUserData(oldKey, newKey, {dryRun})`** in `lib/crypto.ts` — re-keys every encrypted-at-rest field. **Per-user transactions** (atomic per user), **resumable** (a cell already on the new key is detected + skipped, so a re-run after a partial failure is safe), **fail-loud** (a cell decrypting with neither key aborts — never silently drops data), `dryRun` reads/verifies but writes nothing. Added pure explicit-key primitives `encryptWithKey`/`decryptWithKey` + extracted `deriveKeyFromRaw` (shared with the env-key path). Lives in `crypto.ts` per dispatch; uses a **dynamic `import('./db')`** to avoid the static circular dep (db.ts imports crypto.ts).
  - **`ENCRYPTED_COLUMNS` inventory** (`lib/db.ts`) — authoritative list of all **19 encrypted tables/columns** (incl. easy-to-miss `fact_history.statement` + `audit_log.snapshot_after` that the dispatch's example list omitted). A missed column = permanently unreadable after a key swap, so this is the single source of truth.
  - **Drift guard caught a real bug:** the inventory test flagged `pattern_cache` (PK is `user_id`, no `id` column) — would have thrown on a real rotation. Fixed the `idColumn`. 7 tests in `lib/key-rotation.test.ts` (round-trip A→B, dry-run writes nothing, resumable, abort-on-corruption, skip-plaintext, inventory↔schema cross-check).
  - **Runbook:** "Key Rotation" section in `content/durability-runbook.md` — generate key → set `_NEXT` → dry-run → run → swap → verify; zero-downtime (re-encrypt before swap), backup-first, resumable-if-interrupted.
- **2026-06-20** — **R11 Ticket 2 — rate-limit gap check: tool-call webhook hardened (1969 green).**
  - **Gap found + closed:** `/api/vapi/tool-call` had **no** per-user rate limit — a runaway Vapi tool loop could rack up Google/LLM cost or spam the calendar. Added `vapiToolCall` 60/min/user via the existing limiter; on exceed the webhook answers in the Vapi `{results}` shape with a graceful spoken "give me a few seconds" message (NOT a raw 429, which would hard-error mid-call) and the tools don't execute. 3 tests.
  - **The other two targets were already covered** (verified, not rebuilt): memory writes — `factEdit` 20/hr on `facts/[id]` PATCH/DELETE + rollback; briefing re-gen — `briefingGenerate` 5/hr on `/api/briefing/generate`.
  - **Deviation from spec (justified):** reused the existing **SQLite-backed** `checkRateLimit` instead of building the proposed new in-memory `Map` helper — the existing one is strictly better (survives restarts + works multi-instance, which the in-memory version explicitly wouldn't) and avoids a duplicate rate-limit system. Same outcome, more robust.
- **2026-06-20** — **R11 Ticket 1 — Gmail `gmail.readonly` scope decision closed (doc only).** Updated `content/security-audit.md`: the R10 T2 "keep-vs-tighten: open" item is now **✅ ACCEPTED (PM Kevin, 2026-06-20)** — `gmail.readonly` retained on the dedicated flow; required by `extractGmailAccountContacts` for contact ingest (a Clarity Score input), disclosed + audited. No code change.
- **2026-06-19** — **R10 Ticket 3 — privacy/verification body-reading disclosure consistency (launch-blocker accuracy) (1959 green).**
  - **Calendar write-scope: verified ACCURATE** — `app/privacy/page.tsx:45` already says Edge "read your calendar and **create, edit, move, and delete events** on your behalf" with undo; NO "read-only"/"never modifies" language. The 2026-06-09 incident concern is fully resolved (nothing to fix there).
  - **Found + fixed a real Gmail inconsistency:** the Google API Limited-Use list (`page.tsx:110`) still claimed Gmail reads "metadata (sender, subject, auto-snippet — **never message bodies**)" — contradicting the (correct) inbox-reading paragraph at `:52` and the actual Round-7 behavior. The R7 disclosure pass updated `:52` but missed `:110`. Corrected `:110` to match: bodies read in-memory for a few recent non-promo threads, never stored.
  - **`specs/google-verification.md`:** fixed **4 remaining stale "bodies never fetched" claims** (least-privilege bullet `:182`, focus-prioritization narrative `:268`, security least-privilege `:307`, demo-script step 7 `:343`) that would have shown a CASA reviewer contradictory statements. All now state: headers+snippet for every thread, plus body text (`format:'full'`, ≤10 threads, ~2000 chars) read in-memory + discarded, never stored. Line 119 was already accurate. Preflight green.
- **2026-06-19** — **R10 Ticket 2 — Gmail multi-account OAuth second-flow security review (1959 green).**
  - Reviewed the dedicated Gmail flow vs the calendar flow: **CSRF state** ✅ (`randomBytes(20)` → `oauthStateQueries.create(state,uid,'gmail')`; callback `consume` + `flow==='gmail'` check, state required), **rate limits** ✅ (`gmailConnect` 10/hr, `gmailDisconnect` 5/hr, `gmailIngest` 6/hr — all in `lib/rateLimit.ts`), **audit** ✅ (`gmailAccountConnect`/`gmailAccountDisconnect`). Documented in `content/security-audit.md` ("Gmail multi-account flow" section).
  - **Scope finding (corrects the dispatch premise):** the dedicated flow DOES request `gmail.readonly`, but this is **REQUIRED, not a regression** — `extractGmailAccountContacts` (post-link contact ingest via `/ingest`) reads the dedicated account's `From` headers and gates on `hasGmailReadScope`. Removing it would silently break contact ingest. **Did NOT remove the scope**; corrected the misleading "(compose-only)" route comment, and **surfaced the keep-vs-tighten decision to Kevin** in the audit doc (recommend keep: disclosed + audited + onboarding value). No functional code change.
- **2026-06-19** — **R10 Ticket 1 — complete data export: 4 deferred tables added (T3-3 follow-up, Kevin-authorized) (1959 green).** _(synced master first)_
  - `app/api/account/export/route.ts`: added `episodes` (contentSummary via `safeDecryptField`, topics/commitments JSON-parsed), `factHistory` (versioned memory audit trail — `fact_history` has its own `user_id`, so no join needed; statement decrypted), `focusMilestones` (title decrypted; column is `completed_at` → `doneAt`), `supportMessages` (user-scoped read — the existing `supportMessageQueries.list()` is admin-only; message decrypted). **All four use `safeDecryptField`** so a single undecryptable row degrades to `''` rather than 500-ing the whole GDPR export. Export `version` bumped `'1'` → `'3'` (the dispatch's "from 2" was off-by-one — actual prior was `'1'`).
  - **Spec corrections (actual schema vs dispatch):** `fact_history` retire field is `reason` (not `source`); `focus_milestones` done-timestamp is `completed_at` (not `done_at`); `fact_history` is directly user-scoped. Exported accordingly.
  - Tests (`app/api/account/account.test.ts`): top-level-sections test now asserts the 4 new keys + `version:'3'`; new test verifies all 4 sections return decrypted readable strings (not ciphertext). 19 account tests green; 104 files / 1959 total.
- **2026-06-19** — **R9 Ticket 1 — full email-body support hardened + Gmail-read audit gap closed (1958 green).** _(synced master first)_
  - **Finding:** `getRecentEmailSignal({ fullBodies })` was already implemented (Round 7) — option, per-thread `readThread`, `body?` field, 10-thread cap, 2000-char cap, `isLikelySpam` gating all present. The one real deviation from the R9 spec was the body cap: a hard `slice(0,2000)` that could cut mid-sentence and feed the extractor a garbled fragment.
  - **`truncateAtSentenceBoundary(text, cap)`** (exported, pure, `lib/gmail.ts`): cuts at the last `.`/`\n` before the cap; falls back to a hard cut only when no boundary exists. Wired into the fullBodies path. **7 new tests** in `lib/gmail.test.ts` (3 fullBodies integration: body attached when `true`, omitted by default + no full-body fetch, spam threads skip `readThread`; 4 truncation: under-cap passthrough, period cut, newline cut, no-boundary fallback). 43 gmail tests green.
  - **Audit follow-up (per dispatch):** audited `POST /api/auth/google/gmail/ingest` + the new R8 read paths. `gmailIngest` rate-limit (6/hr) confirmed present (`lib/rateLimit.ts:69`). **Closed a real audit gap:** `extractGmailAccountContacts` (the ingest read primitive) created person facts downstream but emitted **no audit receipt** — added a `gmail_contacts_fetch` entry with the contact emails encrypted in `snapshotAfter` (mirrors `getRecentEmailSignal`'s `email_signal_fetch` receipt), so the Activity tab shows what Edge scanned. `content/security-audit.md` gets a dated R9 section; no open gaps on the Gmail body-reading/ingest surface (bodies never persisted; every read path now writes an encrypted user-visible receipt). 104 files / 1958 total.
- **2026-06-19** — **T3-1-A — `'pattern'` added to facts category CHECK + type (1918 green).** `lib/db.ts`: facts CHECK now `('person','project','goal','preference','fact','pattern')` + `Fact.category` union updated, so factPatterns can land in the Patterns tab (Core does the factPatterns.ts side). **Honest note (corrects the dispatch):** SQLite can't ALTER a CHECK, so a no-op migration does NOT enable `category='pattern'` INSERTs on a long-lived pre-change DB — only a table rebuild would, and I did **not** rebuild the core memory table unprompted. Given the ephemeral-volume situation prod DBs initialize fresh with the new CHECK; a deliberate guarded/transaction-wrapped facts rebuild is available on request if a persistent pre-change DB needs it. **Type ripple (forced, mechanical):** added a `pattern` key to two Core `Record<Fact['category'], number>` maps to keep the build green — `lib/factConfidence.ts` (reconfirmation priority 5 — patterns are derived, not reconfirmed aloud) + `lib/memorySalience.ts` (weight 0.6 — derived insight below stated facts). 101 files / 1918 total.
- **2026-06-19** — **Esther dispatch — T2: `people_models` added to data export; T1: already shipped (1918 green).**
  - **T2 (built):** `GET /api/account/export` now includes a `peopleModels` section from `peopleModelQueries.listForUser` — `personName`, `goals`, `communicationStyle`, `relationshipState`, `lastInteraction`, `healthScore`, `updatedAt`. The four encrypted fields are decrypted by `listForUser` (`safeDecryptNullable`). +1 test (present + decrypted) + `peopleModels` added to the export-shape assertion; mock extended.
  - **T1 (already done overnight, verified):** the privacy page (`app/privacy/page.tsx`) already discloses email-body reading accurately — "Email body text is read in memory only and is never stored, shared, or sold — discarded immediately after Edg3 derives its summary" + the data-usage list line. No change needed (was the Round 7 disclosure fix, commit earlier). 101 files / 1918 total.
- **2026-06-19** — **Round 8 Ticket 2 — `setEnergyLevel` Vapi tool: ALREADY SHIPPED (no new code).** Verified against the dispatch: the `setEnergyLevel` Vapi tool exists (UUID `8aac93a3-…` wired in `lib/vapi.ts:275`, created 2026-06-14) and is fully handled in `app/api/vapi/tool-call/route.ts:1224` — validates level (red/yellow/green), maps source→manual/override, computes the user-local date, writes `energy_log` via `energyLogQueries.upsert`, returns spoken confirmations. Vapi tools dispatch through the single tool-call webhook, so a separate `POST /api/vapi/energy` route would be **dead code nothing calls** — I drafted it, confirmed redundancy, and reverted it (kept the tree clean). **Spec notes for PM:** the table is `energy_log` (singular, not `energy_logs`) and its CHECK is `whoop|manual|override` (no `self-report`) — the handler already maps unknown sources → `manual`, so no change needed. **Ticket 2 = done, pre-existing.**
- **2026-06-19** — **Round 8 Ticket 1 — `people_models` schema (unblocks Darren / M4-4) (1898 green).** New `people_models` table (`lib/db.ts`): `(user_id, person_name UNIQUE, goals, communication_style, relationship_state, last_interaction, health_score, updated_at)`. `goals`/`communication_style`/`relationship_state`/`last_interaction` encrypted at rest (`encryptNullable`/`safeDecryptNullable` — PII about third parties); `person_name` plaintext UNIQUE key (same tier as `people_profiles.canonical_name`). `peopleModelQueries.upsert/getForUser/listForUser/deleteForUser` — partial-upsert preserves prior fields via COALESCE (health_score binds the raw param, not `excluded`, so an omitted score doesn't reset to the 1.0 default). Added to `USER_SCOPED_DELETE_ORDER` → auto-covered by `deleteUserData` + backup-verify + drift-guard. `lib/people-models.test.ts` (8 tests, real in-memory DB: encrypt round-trip, upsert-dedup, COALESCE-preserve, default health_score, list/delete, deletion-registration). 📣 **@Darren: `peopleModelQueries` is ready** for the social-model pipeline.
- **2026-06-18 (overnight)** — **PRIVACY/COMPLIANCE: disclose Round 7 email-body reading (1890 green).** Core's Round 7 shipped full email body reading (`lib/gmail.ts`, in-memory for fact extraction) and flagged Security to update disclosures. The privacy page was **actively false** afterward — claimed "Edg3 never reads email body content" while the code reads bodies. Fixed `app/privacy/page.tsx` (accurate "Inbox reading" — metadata + body text, in-memory, never stored; derived facts user-deletable) and `specs/google-verification.md` (corrected 6 now-false "bodies never fetched" claims across the scope table, CASA flag, mitigations, data table, and the "do NOT do" list). Also rate-limited the new `/api/auth/google/gmail/ingest` route (`gmailIngest` 6/hr) — verified metadata-only (`From` header). ⚠️ **PM/Derrick (external):** (1) deploy the corrected privacy page before any further Google OAuth review; (2) update the actual CASA questionnaire answer for `gmail.readonly` to match (the spec doc is updated; the submission form is not). Also resolved a real `lib/db.ts` merge between my tested `applyMigrations` and master's `oauth_state` gmail-CHECK migration.
  - **Symptom:** deploys logged `no such column: valid_until` / `no such column: retry_after`; migrations weren't applying on existing DBs (Kevin was running ALTERs by hand).
  - **Root cause:** `CREATE INDEX idx_facts_active ON facts(..., valid_until)` was in the **pre-migration** CREATE block. `valid_until` is migration-added, so on an existing DB whose `facts` table predates it, `CREATE TABLE IF NOT EXISTS` is a no-op and the index creation throws `no such column: valid_until` — **aborting the entire schema `db.exec()` before the migration loop runs**, so no migration columns ever get added. (The per-migration try/catch was correct; the abort was upstream of it.)
  - **Fix:** moved the index into `DEFERRED_INDEXES` (created **after** `SCHEMA_MIGRATIONS`, try/caught); extracted `applyMigrations(db)` (exported, testable); **deduped** the array (`valid_from`/`valid_until` each appeared twice — the `NOT NULL DEFAULT (datetime('now'))` `valid_from` variant can't ALTER-ADD anyway). Added the ordering rule as a code comment so it can't regress.
  - **Tests:** `lib/db-migrations.test.ts` (NEW, 6, real sqlite) — reproduces the prod scenario (old facts/briefings → columns added, no abort), idempotency, fault-independence, + a no-duplicate-columns guard that would have caught the original dupes.
  - **Kevin:** your manual ALTERs are safe (idempotent). After this deploys, migrations self-heal — no more manual intervention.
- **2026-06-18 (overnight)** — **Round 6 T1 — Predictive context loading: fixed to 11pm USER-LOCAL (1849 green).** _(synced master first)_
  - **Verification:** the table (`briefing_context_packs`), `briefingContextPackQueries`, the `runNightlyContextPacks` job, the morning read path (`lib/briefing.ts`, date-keyed with live-assembly fallback), and consent handling were all already shipped earlier tonight (+ M2-4 empty-pack guard). `buildBriefingContextPack` is now exported by Core (Darren landed it), so the job is fully live. Consent: the dispatch clarifies caching IS allowed in Privacy Mode (own data) — only telemetry is suppressed — which the code already does.
  - **Gap found + fixed (the one real deviation):** the cron fired at **11pm UTC**, not **11pm user-local** as specced — skewing pack freshness from ~3pm to ~10am-next-day by timezone and mis-computing "tomorrow" for far offsets. Now: hourly cron (`0 * * * *`); `runNightlyContextPacks` builds only for users whose **local hour is 23** (same local-time pattern as the call scheduler), so each user is built once at their local 11pm (~8h before the 7am call). Added an **idempotency guard** — if tomorrow's pack already exists, skip the LLM call (cheap on the 23 non-matching hours + restart-safe).
  - **Tests:** +2 in `lib/scheduler.round6.test.ts` (skips a user not at local 11pm; skips the build when tomorrow's pack already exists); existing tests retimed to the user's local 11pm (06:00 UTC = 23:00 PDT). 97 files / 1849 total.
- **2026-06-18 (overnight)** — **★ FEATURE: Multi-account Google linking — token layer COMPLETE (1832 green).** _(synced master first)_
  - **For Darren (UI unblocked):** `GET /api/auth/accounts` is ready. Contract: `{ calendar: { connected, email, hasGmailScope }, gmail: { connected, email } }`. Connect a Gmail account: `GET /api/auth/google/gmail` → `{ url }` (open it). Disconnect: `POST /api/auth/google/gmail/disconnect`. **Note:** `calendar.email` is `null` (not stored on the legacy calendar_tokens row); `calendar.hasGmailScope` tells you if the primary grant can already draft. `gmail.email` is populated.
  - **Design deviation from the spec (documented):** spec said "add `account_type` to `google_tokens`." There is no `google_tokens` table — tokens live in `calendar_tokens` (whose `user_id` is UNIQUE). Rather than rebuild that encrypted table to add a composite-unique account_type, I added a separate **`gmail_tokens`** table (mirrors `whoop_tokens`). Zero-migration-risk, identical outcome, UI contract unaffected.
  - **[A] schema/queries:** `gmail_tokens` (access/refresh encrypted, email plaintext) + `gmailTokenQueries.upsert/get/delete`; added to `USER_SCOPED_DELETE_ORDER` (deletion + backup-verify auto-cover; drift-guard confirms).
  - **[B] routing (`lib/google-auth.ts`):** `getCalendarTokens` / `getGmailTokens` (gmail account, else falls back to calendar) / `saveGmailTokens` / `disconnectGmailAccount` / `hasLinkedGmailAccount` / `persistRefreshedToken` (refresh writes back to the source account).
  - **[C] `lib/gmail.ts`:** DRAFT path → `getGmailTokens` (uses the Gmail account when linked); READ path (reply tracking / email signal) stays on the calendar account, since `gmail.readonly` lives there (the dedicated account is compose-only). 36 existing gmail tests green via backwards-compat fallback.
  - **[D] OAuth flow + routes:** `getGmailAuthUrl` / `exchangeGmailCode` / `emailFromIdToken` in `google-auth.ts` (own redirect URI + compose/openid/email scopes — kept out of Core's `lib/calendar.ts`); routes `GET /api/auth/google/gmail`, `/callback`, `POST /disconnect`; `/api/auth/accounts` status. CSRF `flow='gmail'`; rate limits `gmailConnect` 10/hr, `gmailDisconnect` 5/hr; audit `gmailAccountConnect`/`Disconnect`.
  - **Spec #5 (rename calendar disconnect): not needed** — calendar is a separate table, so `/api/calendar/disconnect` already affects only the calendar account.
  - **Tests:** `gmail-tokens.test.ts` (6), `google-auth-accounts.test.ts` (routing + emailFromIdToken, 16), `gmail-routes.test.ts` (status + disconnect, 6). 96 files / 1832 total.
  - ⚠️ **EXTERNAL (Kevin):** register `GMAIL_REDIRECT_URI` (`<app>/api/auth/google/gmail/callback`) in the Google Cloud console + set the env var (defaults to localhost); `gmail.compose` is a restricted scope needing OAuth verification + CASA before prod.
- **2026-06-18 (overnight)** — **PILLAR-TRUST T1-1 — Webhook retry + dead-letter on processing failure (1809 green).** _(synced master first — 1803 green merged batch)_
  - **`lib/retry.ts` (NEW):** `withRetry(fn, {attempts, baseDelayMs, label, onRetry, sleep})` — 3 attempts default, exponential backoff (200ms→400→800), injectable sleep for instant tests. Returns first success, throws last error on exhaustion.
  - **`app/api/vapi/webhook/route.ts`:** (1) the Vapi transcript fetch now runs inside `withRetry` (3×, backoff) — a transient Vapi 5xx / network blip no longer drops us straight to the partial transcript; final failure is non-fatal (proceeds with partial). (2) A `dlq` context is armed when entering the critical call-ended path; if anything in that path throws, the outer catch writes `failedWebhookQueries.record(userId, callId, briefingId, error)` so a "call happened but nothing was learned" failure is dead-lettered, not silent. Best-effort — never masks the original error.
  - **Daily check (req #3): already in place** — `failedWebhookQueries.recentCount(24)` is logged by the 3am cron (`[health] WARN: N webhook(s) in dead-letter queue`) and contributes DEGRADED to the 6am health digest.
  - **Design note:** retry wraps the flaky *external* op (transcript fetch) rather than the whole handler — re-running the full block would risk double side-effects (briefing update + fire-and-forget jobs). The idempotency gate (`claimWebhookEvent`) already prevents Vapi-redelivery double-processing; the DLQ captures terminal failures for diagnosis/manual recovery.
  - **Tests:** `lib/retry.test.ts` (NEW, 6) — first-success, retry-then-succeed, exhaust-and-throw, exponential-backoff sequence, onRetry callback, attempts=1. DLQ mechanism already covered by `lib/failure-logging.test.ts`. 93 files / 1809 total.
- **2026-06-18 (overnight)** — **T3-3 follow-up — relationship memory (people) added to data export (1708 green).**
  - Continuing T3-3 "verify nothing is missing." Added `people` to `GET /api/account/export` from `peopleProfileQueries.listForUser` — name, email, interaction count, last/upcoming interaction, updatedAt. This is "what Edge knows about people in your life" (the relationship-memory store), high transparency value. canonical_name/email are stored plaintext (accepted gap) so zero decryption risk. +mock + shape assertion. 90 files / 1708 total.
  - **Deferred to Derrick's judgment (NOT built unsupervised — each needs decryption + a per-table "is this exportable user data" call):** `episodes` (call episode store — overlaps briefings.transcript; encrypted content_raw), `fact_history` (retired facts — encrypted statement), `focus_milestones` (sub-goals; possibly encrypted title), `support_messages` (user's own support submissions). Intentionally excluded (internal/operational, not portability data): pattern_cache, briefing_context_packs, call_attempts, failed_webhooks, background_job_failures, notifications, dedupe/token tables, OAuth tokens. **Recommend a 5-min review of this list in the morning to confirm the export boundary.**
- **2026-06-18 (overnight)** — **T3-3 follow-up — activity log added to data export (1708 green).**
  - Esther's dispatch listed the activity log as required in the export; my earlier T3-3 review had marked it "intentionally omitted." On reflection she's right — users see it in the dashboard Activity tab, so it belongs in their data export (GDPR portability).
  - **`app/api/account/export/route.ts`:** new `activityLog` section from `auditLogQueries.recent(userId, 10000)` — exports `action`, parsed `args`, `result`, `ok`, `briefingId`, `createdAt`. **Internal/encrypted state snapshots (`snapshot_before`/`snapshot_after`, which can hold encrypted email subjects) are deliberately excluded** — only the human-readable record is exported.
  - **Tests:** +1 in `account.test.ts` (activity log present, args parsed, no encrypted snapshot leak) + `activityLog` added to the export-shape assertion; mock extended with `auditLogQueries.recent`. `content/security-audit.md` export description corrected. 90 files / 1708 total.
- **2026-06-18 (overnight)** — **T0-1 §4 — Automated restore drill (1707 green).**
  - Every existing backup test **mocks** better-sqlite3, so the real create→snapshot→reopen→data-survives path was never exercised — "backups you've never restored are not backups."
  - **`lib/backup-restore-drill.test.ts` (NEW, real SQLite, no mocks):** builds a real DB (full schema) at a temp path, seeds known rows, calls the actual `createBackup()` (the same online-backup the 3am cron uses), then `verifyBackup()` (integrity_check ok + row counts), then **reopens the snapshot read-only and asserts the actual data survived** (emails + task text, not just counts). This is the closest a unit test gets to the manual Railway restore drill. The live volume-restore remains an external Kevin step.
  - 90 test files / 1707 total.
- **2026-06-18 (overnight)** — **T3-4 cascade test + 2 account-deletion BUG FIXES + T4-3 lock-held warning (1705 green).**
  - **🐞 BUG FOUND + FIXED (account deletion would 500):** `support_messages` and `fact_history` both have `user_id NOT NULL REFERENCES users(id)` with **no ON DELETE CASCADE**, and **neither was in the account-deletion route**. With `foreign_keys = ON`, deleting any user who had filed support feedback or had a retired fact would throw an FK constraint error → account deletion 500s, leaving the user undeletable. Both added to the deletion set. Surfaced by the new drift-guard test (below) — exactly its purpose.
  - **T3-4 — `deleteUserData(userId)` extracted to `lib/db.ts`** from the inline route logic, driven by an exported `USER_SCOPED_DELETE_ORDER` (single source of truth, leaf-first, FK-safe) and **wrapped in a transaction** — a missing-table FK error now rolls back instead of half-deleting an account. `app/api/account/route.ts` calls it.
  - **`lib/db-account-deletion.test.ts` (NEW, real in-memory DB):** (1) **drift guard** — introspects every live table with a `user_id` column and asserts it's in `USER_SCOPED_DELETE_ORDER` (fails when a new user-scoped table is added without updating deletion — this is what caught the 2 gaps); + no dead entries. (2) **cascade clean** — seeds 9 child tables (incl. the fixed gaps) for a target + a bystander, runs `deleteUserData`, asserts target fully gone (no FK throw) and bystander untouched; (3) empty-user no-op.
  - `app/api/account/account.test.ts` updated: deletion now delegates to `deleteUserData` (mocked) — replaced the obsolete inline-SQL-count assertions with delegation + 500-on-throw tests.
  - **T4-3 follow-up (Esther):** scheduler dispatch lock now **logs a warning naming the current holder** when an acquire is refused (was silent) — a real second instance/replica is now visible in logs. `schedulerLockQueries.currentHolder()` added (`lib/db.ts`) + 3 tests in `lib/scheduler-lock.test.ts`.
  - 89 test files / 1705 total.
- **2026-06-18 (overnight)** — **PILLAR-MEMORY M2-4 — Context-pack non-empty verification + metrics (1699 green).**
  - The 11pm pre-warm job (`runNightlyContextPacks`) logged `built/total` but would silently cache an **empty** pack — which poisons the morning call's live-assembly fallback (an empty cached pack is worse than no pack). It also lacked the M2-4-requested per-pack metrics.
  - **`lib/scheduler.ts`:** now measures `durationMs`, computes `packSize` (trimmed length), and **skips caching empty packs** — counts them, logs `Context pack EMPTY user=…`, and records a `nightly_context_packs` background-job failure so the 6am digest flags it. Per-pack metrics logged (`size=`, `durationMs=`) for non-privacy users; userId-only + suppressed metrics under Privacy Mode (respects `data_consent`). Summary line now reports `N empty (skipped)`.
  - **Tests:** +2 in `lib/scheduler.round6.test.ts` (empty pack not encrypted/upserted; prune still runs when all empty). 88 files / 1699 total.
- **2026-06-18 (overnight)** — **PILLAR-TRUST T0-2 step 3 — Startup encryption-key presence check (1697 green). Tier 0 + Tier 1 (Security) now COMPLETE.**
  - T0-2 steps 1/2/4 were already shipped (key-backup doc `content/encryption-key-rotation.md`, `safeDecryptField` graceful content-path degradation, `STRICT_ENCRYPTION=1` fail-closed writes). The remaining gap was step 3: nothing alarmed if `DATA_ENCRYPTION_KEY` was missing at boot — PII would silently write as plaintext.
  - **`lib/durability.ts`:** `assessEncryptionReadiness(env)` pure helper — CRITICAL in prod when the key is unset (distinguishes plaintext-risk vs. strict-mode write-failure); ok in dev or when key present. Wired into `runStartupDurabilityCheck()` (loud boot log + `health_log` write).
  - **`lib/scheduler.ts` `runHealthDigest`:** daily 6am check — DEGRADED if `DATA_ENCRYPTION_KEY` unset in prod.
  - **Tests:** +4 in `lib/durability.test.ts` (dev skip, key present, missing-no-strict plaintext, missing-strict write-fail). 88 files / 1697 total.
  - **Tier 0 status:** T0-1 ✅, T0-2 ✅, T0-4 ✅ (all Security). T0-3 e2e smoke test is Core-owned (Darren). **Tier 1 (Security): T1-1…T1-5 all ✅** from prior sessions.
- **2026-06-18 (overnight)** — **PILLAR-TRUST T0-4 — Single-instance scheduler lock (1693 green).**
  - **Risk:** the per-minute call-dispatch cron has no cross-instance guard. With >1 Railway replica (or an overlapping slow tick), two instances can both pass the `alreadyCalled` check before either writes a briefing row → **double-dial** the 7am call. The existing `alreadyCalled` guard only protects within a single sequential instance.
  - **`scheduler_lock` table** (`lib/db.ts`): `(lock_name PK, holder, acquired_at, expires_at)`. `schedulerLockQueries.acquire(name, holder, ttlSeconds)` claims atomically via SQLite upsert — `ON CONFLICT DO UPDATE ... WHERE expires_at < now OR holder = excluded.holder`, returns `changes === 1`. A held lock blocks others until expiry; an expired lock (crashed holder) is reclaimable; an instance can refresh its own. `release()` deletes only if still held (no stomping). Fails **open** on DB fault (never blocks the morning call).
  - **`lib/scheduler.ts`:** per-process `INSTANCE_ID = pid-<rand>`; the per-minute cron now `acquire('dispatch', INSTANCE_ID, 55)` → runs `checkAndInitiateCalls` only if claimed → `release` in `finally`. TTL 55s < 60s tick so a crashed holder self-heals before the next tick. `scheduler_lock` is a system table (no `user_id`) — correctly NOT in the account-deletion route.
  - **Tests:** `lib/scheduler-lock.test.ts` (NEW, 7 tests) against a **real in-memory better-sqlite3** (`DB_PATH=':memory:'`) — verifies acquire/block/refresh/independent-names/expiry-reclaim/release/no-stomp with the actual SQLite engine, since the atomicity is the whole point. 88 test files / 1693 total.
- **2026-06-18 (overnight)** — **PILLAR-TRUST T0-1 — Boot-time data-durability self-check (1686 green).**
  - **Audit:** DB lives at `/data/edg3.db` (`lib/db.ts:8`). Off-box replication is already coded — Litestream (`scripts/start.sh` + `litestream.yml`, ~1s RPO, restores on fresh volume) + daily snapshot push (`lib/backup.ts`). Both activate only when their S3 env vars are set. The real risk is **silent**: ephemeral volume + unset replication env = invisible data loss. Cannot check the Railway dashboard from code (no CLI/token) — so the fix is to make the risk LOUD.
  - **`lib/durability.ts` (NEW):** `assessDurability(env)` pure decision matrix — classifies prod boot state as ok/warn/critical. CRITICAL on: no off-box replication, DB absent at boot w/o replication, or zero users in prod DB. WARN on: DB absent-but-replication-configured (restore should've run), or DB not under `/data`. `runStartupDurabilityCheck()` gathers real env + DB stats, logs loudly (`[durability] 🚨 ...`), writes to `health_log`. Best-effort — never throws, never blocks boot.
  - **`instrumentation.ts`:** runs the durability check FIRST on boot, before anything opens the DB (so `dbExistedAtBoot` is accurate).
  - **`lib/scheduler.ts` `runHealthDigest`:** added a daily off-box-replication check — 6am digest goes DEGRADED if `LITESTREAM_S3_BUCKET`/`BACKUP_S3_BUCKET` unset in prod. So the risk surfaces every morning, not just at boot.
  - **`content/durability-runbook.md` (NEW):** documents what's coded vs. the external steps a human must do — confirm `/data` is a persistent Railway volume, set `LITESTREAM_S3_*`, run the restore drill. ⚠️ **Kevin action items flagged.**
  - **Tests:** `lib/durability.test.ts` (NEW, 12 tests) — full decision matrix (dev skip, healthy prod, 4 critical paths, 3 warn paths, null-user-count cold start). 87 test files / 1686 total.
- **2026-06-18** — **PILLAR-TRUST T1-2 — End-to-end call health check (1674 green).**
  - **Approach:** reused existing `background_job_failures` + `health_log` infrastructure rather than a new table.
  - **`app/api/vapi/webhook/route.ts`:** added `backgroundJobFailureQueries.record()` to all 4 async post-call `.catch()` handlers — `fact_extraction`, `sleep_consolidation`, `episode_store`, `open_loops_extraction`. Failures now surface in the 6am health digest's existing "background job failures" check (already queries `backgroundJobFailureQueries.recentCount(24)`).
  - **`lib/scheduler.ts` `runHealthDigest()`:** new transcript health check — SQL query counts completed briefings in the last 24h with empty/short transcripts (< 50 chars). Surfaces as `N completed call(s) have no transcript` in the degraded summary.
  - **2 new tests** in `lib/health-digest.test.ts`: degraded on empty transcript; nominal when 0 empty. 86 test files / 1674 total.
- **2026-06-18** — **PILLAR-TRUST T3-2 + T3-3 — Activity log completeness + data export accuracy (1672 green, no new tests).**
  - **T3-2 — Activity log completeness:** Audit found 6 gap routes. Added `auditLogQueries.record()` to: `POST /api/tasks` (createTask), `PATCH /api/tasks/[id]` (completeTask/uncompleteTask), `DELETE /api/tasks/[id]` (deleteTask), `POST /api/tasks/complete-all` (bulkCompleteTasks), `POST /api/profile` (updateProfile — logs length not content), `POST /api/focus/dismiss` (dismissFocus). Accepted gaps documented: account deletion (immediately erased by cascade), auth events (not Activity tab concern), voice_preference toggle (settings-only), priorities-keep (timestamp refresh only), energy log (informational), call triggers (briefings table is the record), support submissions (not user data).
  - **T3-3 — Data export accuracy:** `GET /api/account/export` reviewed. Confirmed: exports all 10 user-scoped tables (profile, priorities, tasks, calendar tokens, memory, facts, briefings, notifications, open-loops, focus). Correctly omits `password_hash` and OAuth tokens. Decrypts all PII fields. `dataConsent` field included. Activity log intentionally omitted (ephemeral audit trail, not primary data). Whoop tokens intentionally omitted (sensitive OAuth material). No code changes needed.
  - Documentation: `content/security-audit.md` audit log coverage table updated — T3-2 routes moved from "not logged" to "covered"; stale entries removed.
- **2026-06-18** — **PILLAR-TRUST T4-4 — Write-idempotency sweep (1672 green).**
  - **Audit findings:** `createEvent/copyDayEvents` already protected by `event_dedupe_keys` (5-min TTL). `deleteEvent/cleanupEvents/cleanupDuplicates/applyCalendarPlan` protected by `delete_confirm_tokens`. `moveEvent/colorEvent/colorEventsByEnergy/draftEmail` unguarded — can double-execute on Vapi retry. Webhook end-of-call-report had a TOCTOU race in the `status !== 'completed'` check.
  - **`webhook_dedup_keys` table** added to `lib/db.ts`: `(event_key TEXT PRIMARY KEY, processed_at)`. `webhookDedupeQueries.claim(eventKey)` uses atomic `INSERT OR IGNORE` — eliminates the TOCTOU race. Pruned at 24h via 3am cron.
  - **`tool_call_dedup_keys` table** added: `(toolcall_id TEXT PRIMARY KEY, result TEXT, processed_at)`. `toolCallDedupeQueries.claim/recordResult/getCached/prune` exported from `lib/db.ts`. 10-minute TTL matches Vapi retry window.
  - **`lib/idempotency.ts`** extended: `claimWebhookEvent(callId, type)` + `claimToolCall(toolCallId)` + `recordToolCallResult(toolCallId, result)` + `getToolCallCached(toolCallId)`. All fail open (never block on DB fault).
  - **`app/api/vapi/webhook/route.ts`**: atomic `claimWebhookEvent` gate added before the soft `status !== 'completed'` check — duplicate retries return immediately.
  - **`app/api/vapi/tool-call/route.ts`**: `claimToolCall` gate wraps `executeTool` for all tool calls with a Vapi toolCallId. Duplicate returns cached result (or in-flight message). `recordToolCallResult` writes result back for concurrent retries to consume.
  - **Tests:** 10 new tests in `lib/idempotency.test.ts` covering `claimWebhookEvent`, `claimToolCall`, `recordToolCallResult`, `getToolCallCached` (first call, duplicate, fail-open). 86 test files / 1672 total.
- **2026-06-18** — **PILLAR-DAILY-CALL DC1-3 — Scheduled call time accuracy audit (1662 green).**
  - **Audit result:** calls fire within 0–60 seconds of scheduled time (cron granularity) + briefing generation overhead (typically 5–20s). The 120-minute grace window handles cold-starts correctly — if Railway restarts after call_time, the first cron tick fires the call within 1 minute of restart.
  - **Timing delta log added** to `checkAndInitiateCalls`: `[scheduler] Calling user X — scheduled HH:MM TZ, Nmin late (cold-start/missed-tick catch-up)` or `(on time)`. Visible in Railway logs.
  - **2 new DC1-3 tests:** cold-start at call_time+2min fires, missed-tick at call_time+1min fires. 1662 total.
- **2026-06-18** — **PILLAR-TRUST T4-2 + DC1-2 — Vapi pre-call health check + retry at T+5min (1660 green).**
  - **T4-2 — Vapi pre-call health check with dashboard notification:**
    - `pingVapiHealth()` private fn in `lib/scheduler.ts`: lightweight GET to `https://api.vapi.ai/phone-number` (8s timeout, no-op when `VAPI_API_KEY` unset → returns true). Returns true on 2xx/404, false on error/timeout.
    - Inserted before `initiateCall` in `scheduleBriefingCall`: if ping fails → marks briefing `failed` with `error_code='vapi_error'`, creates a `call_failed` notification ("Edge couldn't place your call this morning"), throws `CallError` to surface cleanly. Notification also written on `initiateCall` failure.
    - Tests: global `fetch` stub (`vi.stubGlobal`) added to both scheduler test files — returns `{ ok: true }` by default, restored after each `vi.resetAllMocks()`.
  - **DC1-2 — Retry at T+5min (was T+10min):**
    - `app/api/vapi/webhook/route.ts` `scheduleRetry` path: changed `'+10 minutes'` → `'+5 minutes'` so DB-flagged retries fire sooner after call setup failures.
  - 86 test files / 1660 tests total.
- **2026-06-18** — **PILLAR-TRUST T0-2(partial) + T1-3(completion) + T4-1 + DC1-1 — Encryption key rotation doc + 6am health digest + Google token auth tracking + call attempt log (1660 green).**
  - **T0-2 — Encryption key rotation protocol:** `content/encryption-key-rotation.md` written. Documents: the single rule (never rotate without a re-encryption migration), when rotation is necessary, step-by-step safe rotation process with template migration script, what `safeDecryptField` does vs. throwing variant, and the catastrophic recovery note. Accepted gaps and `DATA_ENCRYPTION_KEY` backup location placeholder included.
  - **T1-3 completion — 6am health digest + health_log table:**
    - `health_log` table added to `lib/db.ts` schema: `(id, status TEXT CHECK('ok'|'degraded'), summary TEXT, checked_at TEXT)`. Index on `checked_at DESC`. `healthLogQueries.write/getLatest/prune` exported.
    - `runHealthDigest()` exported from `lib/scheduler.ts`: checks failed calls (last 24h), webhook DLQ, background job failures, and calendar auth issues. Writes `health_log` row (status=ok/degraded + combined summary). Logs `[health] HEALTH: OK` or `[health] HEALTH: DEGRADED — reason1; reason2`. New 6am UTC cron fires this before the 7am call window.
  - **T4-1 — Google token refresh reliability:**
    - `calendar_auth_failures INTEGER DEFAULT 0` and `calendar_reconnect_required INTEGER DEFAULT 0` columns added to `calendar_tokens` (via migration). `calendarQueries.recordAuthFailure(userId)` increments counter + sets `calendar_reconnect_required = 1` at ≥3 failures with ALERT log. `calendarQueries.clearAuthFailures(userId)` resets both on successful auth. `calendarQueries.needsReconnect(userId)` checks the flag.
    - `checkCalendarTokenHealth(userId)` added to `lib/google-auth.ts` (Security-owned): makes a lightweight `calendarList.list` probe; on 401/invalid_grant → calls `recordAuthFailure`; on success → clears failures. Returns `{ ok, needsReconnect }`.
    - 6am health digest proactively calls `checkCalendarTokenHealth` for all active users before the 7am call.
  - **DC1-1 — Call attempt log:**
    - `call_attempts` table added: `(id, user_id, scheduled_for, status CHECK('connected'|'failed'|'retrying'), fail_reason, attempted_at)`. Index on `(user_id, attempted_at DESC)`. `callAttemptQueries.record/getRecent/failedCount/prune` exported.
    - `checkAndInitiateCalls` now records a `call_attempts` row on each attempt: `connected` on success, `failed` on exception.
    - `callAttemptQueries.failedCount(24)` checked by 6am health digest — contributes to DEGRADED status.
    - `call_attempts` added to account deletion (belt-and-suspenders; has CASCADE but listed for completeness).
  - **Tests:** `lib/health-digest.test.ts` (NEW, 11 tests): `runHealthDigest` OK path (writes 'ok', prunes on every run), DEGRADED paths (failed calls, webhook DLQ, job failures, combined issues, calendar auth failures). Scheduler.test.ts + scheduler.hardening.test.ts mocks updated with `healthLogQueries`, `callAttemptQueries`, `calendarQueries` new methods.
  - 86 test files / 1660 tests total.
- **2026-06-18** — **PILLAR-TRUST T1-5 + T3-4 + T4-3 — Rate limit sweep clean + account deletion completeness + WAL (1596 green).**
  - **T1-5 — Rate limit sweep:** Full scan of all 37 user-facing POST/PATCH/DELETE routes in `app/api/`. All mutation routes are protected with `checkRateLimit()`. No gaps found. `vapi/webhook` and `vapi/verify-promises` use Vapi secret auth (correct — no user session on these paths). No code changes needed.
  - **T4-3 — WAL + busy_timeout:** Already confirmed in overnight hardening commit: `db.pragma('journal_mode = WAL')` was pre-existing; `db.pragma('busy_timeout = 5000')` added. ✅ Complete.
  - **T3-4 — Account deletion completeness (BUG FIX):**
    - **Bug found:** `briefing_context_packs` has no `ON DELETE CASCADE` on its `user_id` FK. With `foreign_keys = ON` active (confirmed in `getDb()`), deleting the `users` row would throw a FK constraint error for any user with context packs — account deletion would 500.
    - **Fix:** `app/api/account/route.ts` — added explicit `DELETE FROM briefing_context_packs WHERE user_id = ?` before the `users` delete. Also added explicit deletes for `episodes`, `people_profiles`, `pattern_cache`, `failed_webhooks`, `background_job_failures` (belt-and-suspenders; these have CASCADE but weren't in the list).
    - **Tests:** `app/api/account/account.test.ts` — updated mock to capture `preparedSqls`; added 3 tests: total DELETE count ≥ 30, explicit `briefing_context_packs` delete present, explicit `episodes` delete present. Updated stale "≥ 17" assertion to "≥ 30".
  - 82 test files / 1596 tests total.
- **2026-06-18** — **PILLAR-TRUST T1-4 — Encryption audit + coverage map in content/data-protection.md.**
  - Full audit of all 28 tables in `lib/db.ts`: verified encrypt-on-write and decrypt-on-read call sites for each table.
  - 14 tables confirmed encrypted at rest (AES-256-GCM): briefings, calendar_tokens, whoop_tokens, episodes, briefing_context_packs, memories, facts, pattern_cache, focus_milestones, open_loops, notifications, daily_focus, gmail_drafts_log, watched_threads.
  - 3 accepted gaps documented with rationale: `people_profiles.canonical_name`/`.email` (plaintext for `LOWER()` lookup, same tier as users.name), `priorities.text` (needed for full-text alignment queries), `undo_log.payload` (calendar event JSON, low-risk).
  - `safeDecryptField`/`safeDecryptNullable` used on all content-path reads; auth token reads use throwing `decryptField` (misconfiguration surfaces clearly).
  - `content/data-protection.md`: added full internal encryption coverage map (table × PII level × write/read coverage × notes). No code changes — documentation only.
  - No test changes — audit is observational. 82 test files / 1594 tests still green.
- **2026-06-18** — **PILLAR-TRUST T1-1 + T1-3 — Dead-letter queue + background job failure logging (1594 green).**
  - **T1-1 — Webhook dead-letter queue:**
    - `failed_webhooks` table in `lib/db.ts`: `(id, user_id, vapi_call_id, briefing_id, failed_at, error)`. Index on `failed_at DESC`.
    - `failedWebhookQueries`: `record(userId, vapiCallId, briefingId, error)` — never throws, truncates error to 2000 chars; `recentCount(sinceHours)` — for daily health check; `prune(keepDays=30)`.
    - `checkAndInitiateCalls` retry catch: if the DB-flagged retry also fails, writes to `failed_webhooks` dead-letter so the failure is preserved for diagnosis.
    - 3am cron: calls `failedWebhookQueries.prune()` + daily health check logs `[health] WARN: N webhook(s) in dead-letter queue` if any exist in last 24h.
  - **T1-3 — Background job failure logging:**
    - `background_job_failures` table in `lib/db.ts`: `(id, job, user_id, failed_at, error, consecutive)`. Index on `(job, user_id, failed_at DESC)`.
    - `backgroundJobFailureQueries`: `record(job, userId, error)` — reads prior consecutive count, increments, logs `ALERT` when ≥3 consecutive failures; `recentCount(sinceHours)`; `maxConsecutive(job)`; `prune(keepDays=30)`.
    - `runNightlyContextPacks` per-user catch now calls `backgroundJobFailureQueries.record('nightly_context_packs', userId, err)`.
    - `decayFactConfidenceScores` catch now calls `backgroundJobFailureQueries.record('decay_fact_confidence', null, err)`.
    - 3am cron: calls `backgroundJobFailureQueries.prune()` + daily health check logs warn if any failures in last 24h.
  - **Tests:** `lib/failure-logging.test.ts` (NEW, 20 tests): `failedWebhookQueries.record` (insert SQL, arg passing, null userId, error truncation), `.recentCount`, `.prune`; `backgroundJobFailureQueries.record` (insert SQL, args, null userId, consecutive=1 on first fail, increment on prior row), `.recentCount`, `.maxConsecutive` (returns 0 when null), `.prune`. Scheduler test mock + hardening test mock updated to include both new query objects.
  - 82 test files / 1594 tests total.
- **2026-06-18** — **Overnight hardening — DB durability + encryption graceful degradation + durable retry (1574 green).**
  - **DB Durability (#1):**
    - `lib/backup.ts`: `pushBackupToObjectStorage(info)` — dependency-free off-box backup to any S3-compatible endpoint (AWS S3, Cloudflare R2). Manual AWS Signature V4 via `node:crypto` (no SDK). Activated by setting `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY` env vars on Railway. Returns `{ ok, message }` — silently skips when not configured.
    - `maybeDailyBackup()` now calls `pushBackupToObjectStorage` after every snapshot AND for fresh existing snapshots (in case prior push failed). Backup call removed from webhook trigger — now solely on 3am cron.
    - `busy_timeout = 5000` added to `getDb()` to prevent SQLite write-contention errors under concurrent requests.
    - Restore steps documented in `lib/backup.ts` comment for Kevin's emergency runbook.
    - ⚠️ **Kevin action required:** set `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY` on Railway to activate off-box backup.
  - **Encryption key graceful degradation (#2):**
    - `safeDecryptField(value, field)` + `safeDecryptNullable(value, field)` added to `lib/crypto.ts`: catch→log `[crypto] DECRYPT_FAILURE`→return empty string/null instead of throwing. Do NOT use for OAuth tokens (those should still throw to surface misconfiguration).
    - All content-path read functions in `lib/db.ts` updated to use safe variants: `decryptMemoryRow`, `decryptFactRow`, `upsertFact` conflict detection, `patternCacheQueries.get`, `briefingContextPackQueries.get`, `decryptEpisodeRow`. Auth token reads left as throwing — deliberate.
  - **Durable retry (#3a):**
    - `app/api/vapi/webhook/route.ts`: replaced in-memory `retryCall()` (with `setTimeout(10min)`) with synchronous `scheduleRetry(db, briefingId, userId)` that stamps `retry_after = datetime('now', '+10 minutes')` in the DB. Survives server restarts.
    - `lib/scheduler.ts` `checkAndInitiateCalls()`: new loop after the per-user call block queries `briefings WHERE status='missed' AND retry_after IS NOT NULL AND retry_after <= datetime('now')`, clears `retry_after = NULL` before firing, calls `scheduleBriefingCall(userId, { force: true })`. Errors are caught per-row — one failed retry does not block others.
  - **Tests:** 27 new tests across 3 files:
    - `lib/crypto.test.ts` (+11): `safeDecryptField` — normal decrypt, missing-key degrades to empty string, rotated-key degrades, plaintext passthrough, empty input. `safeDecryptNullable` — null/undefined passthrough, normal decrypt, missing-key degrades to null.
    - `lib/backup.test.ts` (+11): `pushBackupToObjectStorage` — not configured returns ok=false; file missing returns ok=false; valid config makes PUT with AWS4-HMAC-SHA256 Authorization; S3 403 returns ok=false; network error returns ok=false; BACKUP_S3_PREFIX respected.
    - `lib/scheduler.hardening.test.ts` (NEW, 5 tests): retry pickup fires when row exists, clears retry_after before firing, no-op when no rows, handles multiple users, error in one retry doesn't block others.
    - Crypto mock updated in `db.bitemporal.test.ts`, `episodes.test.ts`, `db.encryption.test.ts`, `scheduler.round6.test.ts` to include `safeDecryptField`/`safeDecryptNullable`. `scheduler.test.ts` mock updated to handle `retry_after IS NOT NULL` query.
  - 81 test files / 1574 tests total.
- **2026-06-18** — **Round 6 — Predictive context loading + confidence decay schema (1553 green).**
  - **Ticket 1 — Predictive context loading (11pm nightly cron):**
    - `briefing_context_packs` table added to `lib/db.ts`: `(id, user_id, pack_date, context_pack encrypted, generated_at, UNIQUE(user_id, pack_date))`. Index on `(user_id, pack_date)`.
    - `briefingContextPackQueries`: `upsert(userId, packDate, contextPack)` (encrypt + ON CONFLICT upsert), `get(userId, packDate)` (decrypt on read), `prune()` (DELETE rows >7 days).
    - `runNightlyContextPacks(now?)` in `lib/scheduler.ts`: queries all active users, computes "tomorrow" in user's local timezone, calls `buildBriefingContextPack(userId)` (dynamic runtime check — activates automatically when Core/Darren exports the fn from `lib/briefing.ts`, no-ops with log until then). Encrypts + upserts result. Privacy Mode: pack cached (user's own data), content details not logged. Prunes stale packs after each run.
    - Cron: `'0 23 * * *'` (11pm UTC daily) in `startScheduler()`.
  - **Ticket 2 — Confidence decay schema:**
    - DDL: `confidence_score REAL NOT NULL DEFAULT 1.0` + `last_confirmed_at TEXT DEFAULT (datetime('now'))` added to `facts` table. Migrations: two `ALTER TABLE facts ADD COLUMN` entries (additive, safe rollout).
    - `factQueries.confirmFact(userId, factId)`: resets `confidence_score = 1.0` + `last_confirmed_at = datetime('now')`; user-scoped; active-only guard.
    - `factQueries.decayByCategories(categories, amount)`: `UPDATE facts SET confidence_score = MAX(0.0, confidence_score - ?) WHERE valid_until IS NULL AND category IN (...)`. No-op on empty categories.
    - `decayFactConfidenceScores()` in `lib/scheduler.ts`: volatile tier (priorities, projects, current_focus) −0.1/week; stable tier (personality, working_style, relationships) −0.02/week. Facts below 0.3 = "unverified" — Core's reconfirmation trigger reads this queue.
    - Cron: `'0 4 * * 0'` (4am UTC every Sunday) in `startScheduler()`.
  - **Tests:** `lib/scheduler.round6.test.ts` — 24 tests: briefingContextPackQueries (encrypt/decrypt/upsert SQL/prune), factQueries.confirmFact (SQL/user-scoped/valid_until guard), factQueries.decayByCategories (MAX floor/categories/active-only/no-op), runNightlyContextPacks (graceful degradation/user processing/prune), decayFactConfidenceScores (two-tier/amounts/categories). 80 test files / 1553 tests total.
  - **Coordination note for Darren (Core):** `buildBriefingContextPack(userId: number): Promise<string>` — export from `lib/briefing.ts` when ready; the 11pm cron activates automatically. `factQueries.confirmFact(userId, factId)` ready for the reconfirmation trigger to call when a user confirms a fact mid-call. `confidence_score < 0.3` is the unverified threshold to surface.
- **2026-06-18** — **Email signal quality fix — exclude Promotions/Social/Forums from inbox signal (1529 green).**
  - `lib/gmail.ts` `getRecentEmailSignal`: two-layer filter stops marketing/newsletter mail from entering fact extraction, meeting-prep, and priority derivation pipelines.
    1. **Query filter (primary):** `q` now appends `-category:promotions -category:social -category:forums` — keeps Primary + Updates (transactional/meeting signal); drops bulk marketing tabs using Gmail's own classifier. No third-party API.
    2. **Label safety-net (defense-in-depth):** after `threads.get`, any thread whose message labels include `CATEGORY_PROMOTIONS`, `CATEGORY_SOCIAL`, or `CATEGORY_FORUMS` is dropped before assembling `items`.
  - 2 new tests in `lib/gmail.test.ts`: query contains all three exclusions; label filter drops 3 bulk threads and passes the 1 primary thread. 79 test files / 1529 tests.
- **2026-06-18** — **Round 5 — Bi-temporal fact schema + M2/M3 encryption audit (1527 green).**
  - **Ticket 1 — Bi-temporal columns on `facts`:**
    - DDL: added `valid_from TEXT NOT NULL DEFAULT (datetime('now'))` + `valid_until TEXT` to `facts` table; `CREATE INDEX idx_facts_active ON facts(user_id, category, valid_until)`.
    - Migrations: two `ALTER TABLE facts ADD COLUMN` entries; safe additive rollout — no migration drama.
    - `factQueries.retire(userId, factId)`: sets `valid_until = datetime('now')`; user-scoped (`AND user_id = ?`); guards against double-retiring (`AND valid_until IS NULL`). NEVER hard-deletes.
    - `factQueries.getAll` + `getByCategory`: active-only filter (`valid_until IS NULL`) by default; `{ includeRetired: true }` flag exposes full history for pattern detection. Additive — zero callers broken.
    - `factQueries.upsertFact`: conflict-detection SELECT queries now filter `AND valid_until IS NULL` so retired history never interferes with new-fact dedup.
    - `Fact` interface: `valid_from?` + `valid_until?` added (optional in TS — DB always populates; tests predate columns).
  - **Ticket 2 — M2/M3/M4/episode encryption audit:**
    - **M2 `people_profiles`**: user-scoped ✅; `canonical_name` + `email` unencrypted (needed for `LOWER()` lookup, same tier as `users.name`/`users.email`) — documented as accepted gap.
    - **M3 `pattern_cache`**: `patterns` column now **encrypted at rest** via `encryptField`/`decryptField`. Behavioral data (peak/trough patterns, calendar habits) is personal PII. Legacy plaintext rows pass through transparently.
    - **M4 accountability**: pure module — reads from `tasks` + `open_loops` (both user-scoped). No DB table, no encryption action needed. ✅
    - **Episodes**: `content_raw` encrypted ✅; user-scoped ✅; consent JSDoc in `episodeQueries.insert` + `persistCallEpisode` corrected — episodes store data for the user's OWN experience (valid under all consent modes); improvement/training pipelines gate at consumption side.
  - **Tests:** `lib/db.bitemporal.test.ts` — 15 new tests (retire guards, active-only filters, upsert conflict-detection SQL, pattern_cache encrypt/decrypt, legacy passthrough). 79 test files / 1527 tests total.
- **2026-06-18** — **Round 4 — Audit log coverage + rate-limit sweep (1501 green).**
  - **Ticket 1 — Audit log coverage:** Added `auditLogQueries.record(...)` to 12 previously-ungapped routes: `calendar/disconnect` (ok+fail), `whoop/disconnect` (ok+fail), `calendar/reminder` DELETE + POST (ok+fail), `onboarding/call-time`, `onboarding/profile`, `profile/timezone`, `priorities/[id]/energy`, `priorities/[id]/milestones` POST, `milestones/[id]` PATCH (complete/uncomplete) + DELETE. Full coverage map updated in `content/security-audit.md`.
  - **Ticket 2 — Rate-limit sweep:** Added 6 new `LIMITS` entries to `lib/rateLimit.ts`: `calendarDisconnect` (5/hr), `whoopDisconnect` (5/hr), `calendarReminder` (10/hr), `profileTimezone` (20/hr), `priorityEnergy` (30/hr), `milestoneWrite` (60/hr). Applied to all corresponding routes. Rate-limit inventory in `content/security-audit.md` updated to 42 total keys.
  - **Tests:** 6 new route test files (calendar/disconnect, whoop/disconnect, profile/timezone, priorities/[id]/energy, priorities/[id]/milestones, milestones/[id]) — 45 new tests covering 401, 429, 400 validation, 200 happy path, audit record assertions. 77 test files / 1501 tests total.
- **2026-06-18** — **Episode store — ground-truth episodic memory tier, schema + encryption (1456 green).**

  PM dispatch (Kevin — cross-session): build the missing episodic memory tier per `specs/episode-store.md`.

  **`episodes` table** added to `lib/db.ts` (additive migration, `CREATE TABLE IF NOT EXISTS`):
  - `id, user_id (FK+idx), source ('call'|'calendar'|'email'), occurred_at (ISO; compound idx with user_id), content_raw TEXT (AES-256-GCM encrypted — rawest PII we hold), topics TEXT (JSON arr), commitments TEXT (JSON arr), created_at`
  - Compound index `(user_id, occurred_at DESC)` for temporally-ordered user lookups.

  **`episodeQueries`** (exported from `lib/db.ts`):
  - `insert(userId, source, occurredAt, contentRaw, topics?, commitments?)` — encrypts `content_raw` via `encryptField`. JSDoc gates: callers MUST check `isImproveConsented(user)` before calling — episodes hold raw PII and must not persist for Privacy Mode users.
  - `recent(userId, limit?)` — newest-first, user-scoped at SQL level.
  - `search(userId, {topic?, since?, unresolvedCommitments?, limit?})` — `since`/`unresolvedCommitments` filtered in SQL; `topic` post-filtered (JSON array substring match).
  - `prune(retentionDays?)` — default 365 days; deletes by `occurred_at` age to bound storage while preserving the year-of-history moat value.

  **`lib/episodes.test.ts`** — 18 new tests: insert encryption, recent user-scoping + decryption, search filters, authz (no cross-user leakage), prune smoke tests.

  **Coordination note for Core (Darren):** `episodeQueries` is ready. Wire the write path after each call ends: check `isImproveConsented(user)` → `episodeQueries.insert(userId, 'call', occurredAt, groundedTranscript, topics, commitments)`. Wire the query path in `lib/briefing.ts` for prior-commitment recall.

- **2026-06-18** — **Memory moat audit — M1–M4 encryption gaps closed (1384 green).**

  Audit of new memory-moat tables from Core's recent sprint. Two encryption gaps found and fixed.

  **`focus_milestones.title` — encrypted at rest.** Previously stored plaintext. Added `decryptFocusMilestoneRow` helper (same pattern as `decryptOpenLoopRow`). `create()` now wraps with `encryptField(title)`; `listForUser()` and `listForPriority()` map through the helper on read. Legacy plaintext rows pass through transparently (existing `decryptField` behavior).

  **`support_messages.message` — encrypted at rest.** `insert()` now wraps with `encryptField(message)`; `list()` decrypts on read. Added admin-only JSDoc comment to `list()` — it has no `WHERE user_id` clause intentionally (admin view), but that scope gap is now documented so it's never accidentally called from a user-facing route. No user-facing route currently calls `list()`.

  **All other M1–M4 tables verified clean:** `daily_focus.focus_areas` already encrypted; `event_energy_tags` no PII; `calendar_plan_executions` no PII; `open_loops.description` already encrypted with `decryptOpenLoopRow`.

  **S3 audit complete:** `/api/day-plan/confirm` already has all 4 required properties — idempotency (atomic `consumeDeleteToken` transaction), user-scoped authz at DB level, undo grouping by planId, rate limiting. Existing 13-test suite covers all S3 requirements. No code changes needed.

  **Tests:** 8 route tests (`app/api/support/route.test.ts` — auth, rate limit, validation, success path) + 8 DB-level encryption tests (`lib/db.encryption.test.ts` — verifies `encryptField`/`decryptField` called correctly for both tables). 1384 green total.

- **2026-06-18** — **CASA consent enforcement wired — Privacy Mode now blocks improvement-data storage (1368 green).**

  PM dispatch (Kevin — Round 4 continuation): wire `isImproveConsented(user)` into the actual LLM improvement paths.

  **What changed:**

  1. **`lib/briefing.ts` — enforcement gate.** `analyzeUserResponse()` now gates the two post-call memory writes on `isImproveConsented(user)`:
     - `memoryQueries.create(userId, 'transcript', ...)` — raw grounded call transcript
     - `memoryQueries.create(userId, 'insight', ...)` — LLM-extracted insight from the call
     - Both are omitted for Privacy Mode users. The briefing generation itself (all Anthropic inference calls) still runs for both modes — the product still works. Only the long-term improvement-data corpus is gated.
     - Added `import { isImproveConsented } from './consent'` to briefing.ts imports.
     - Updated the module-level comment to document that enforcement is now live at `analyzeUserResponse`.

  2. **`lib/facts.ts` + `lib/outreach.ts` — sentinel comments clarified.** Both were carrying "DATA CONSENT SENTINEL" markers left by the prior session. Replaced with clear explanatory comments: these paths are inference-only (no improvement-data storage), so there's nothing to gate here. The sentinel meaning is preserved (future callers who store must check consent), but the ambiguous language is gone.

  3. **`lib/briefing.consent.test.ts`** — 6 new tests proving the gate works:
     - Privacy Mode (`data_consent: 'privacy'`) → `transcript` + `insight` memory NOT written
     - Null consent (new-user default) → same as Privacy Mode (opt-IN required)
     - Undefined consent → same as Privacy Mode
     - Improve-consented (`data_consent: 'improve'`) → BOTH memories ARE written
     - Improve-consented → transcript content matches the grounded user response
     - Privacy Mode + tasks → tasks still extracted (tasks are not improvement data; gate is narrow)
     - Key fix discovered: vitest mock paths must match the actual import specifier used in the tested module (`'./db'` not `'@/lib/db'` for relative imports in `lib/briefing.ts`).

  **Privacy Mode trade-off (documented):** Privacy Mode users still receive a full briefing — all LLM inference runs, the `facts` table still accumulates structured knowledge, and all calendar/task operations still work. The only difference: their raw call transcripts and extracted insights are not written to the `memories` table. Edge's in-context memory of past calls is slightly less rich for Privacy Mode users, but the product remains fully functional.

  1368/1368 green, tsc clean, next build clean.

- **2026-06-18** — **Audit log coverage sweep — Round 4 Ticket 1 complete (1362 green).**

  PM dispatch: verify audit_log covers every user-triggered mutation and close gaps.

  **Code changes:**
  - `POST /api/onboarding/priorities` → `priorities_set` audit entry (includes added/removed diff vs prior week)
  - `POST /api/priorities/derive/accept` → `priorities_accepted` audit entry
  - `POST /api/open-loops` (resolve/dismiss/snooze) → `loop_resolve` / `loop_dismiss` / `loop_snooze` audit entries
  - Fixed `app/api/priorities/derive/route.test.ts` mock (was missing `auditLogQueries` → 3 tests failed)

  **Documentation** (`content/security-audit.md`):
  - New "Audit Log Coverage" section: 12 action types covered, 17 routes intentionally not logged (with justification each)
  - Rate-limit gap check for routes added since Round 3 sweep
  - Readiness Summary: updated audit-log bullet + test count (64 files / 1362 tests)
  - CASA section: consent_update audit now confirmed live

  **Intentionally not logged (top decisions):**
  - `DELETE /api/account` — GDPR: cascade deletes audit_log records as part of the deletion; server log provides operator visibility
  - Auth events (login/signup/logout) — session_version tracks invalidation; not Activity-tab data
  - Minor state operations (notifications markRead, energy log, milestone toggles, reminder setup/teardown)

  1362/1362 green, tsc clean, next build clean.

- **2026-06-18** — **Backup coverage fix + consent route + data_consent migration (1340 green).**

  Three hardening tasks shipped in one session:

  1. **`lib/backup.ts` — bug fix + expanded table coverage.**
     - **Bug**: `verifyBackup` was checking `'milestones'` (always returned `-1`) but the
       actual table is `'focus_milestones'`. Fixed.
     - Added 5 missing user-data tables to the verification list: `energy_profile`,
       `event_energy_tags`, `calendar_plan_executions`, `undo_log`, `gmail_drafts_log`.
     - 2 new tests: asserts all 20 required tables appear in `rowCounts`; confirms
       the stale `'milestones'` key is gone and `'focus_milestones'` is present.
     - Fixed `better-sqlite3` mock to use `function` keyword (required for `new` constructor calls in vitest).

  2. **`POST /api/auth/consent`** — new route for users to switch between Privacy Mode and Help-improve-Edg3.
     - Auth-gated (`getSession()` → 401), rate-limited (`consentUpdate`: 10/hr per user).
     - Validates input strictly: only `'improve'` | `'privacy'` accepted → 400 otherwise.
     - Calls `userQueries.updateConsent(userId, consent)` + writes `consent_update` audit log entry with `prev` and `new` consent values.
     - 7 tests: 401 unauthenticated, 400 invalid value, 400 missing field, 200 `privacy`, 200 `improve`, audit record shape, 429 rate limit.

  3. **`data_consent` column migration** (`lib/db.ts`):
     - Added `ALTER TABLE users ADD COLUMN data_consent TEXT CHECK(data_consent IN ('improve', 'privacy'))` to the migrations array.
     - Safe and idempotent (wrapped in try-catch per existing pattern).
     - Unblocks CASA enforcement — column is now live on startup; the `/api/auth/consent` route can write to it immediately. No Core deploy required for the column to exist.

  1340/1340 green, tsc clean, next build clean.

- **2026-06-18** — **Memory encryption + consent helper + memory authz tests (1331 green).**

  PM dispatch: memory is the moat — every memory field encrypted, user-scoped, consent-gated.

  1. **`memories.content` encrypted at rest** (`lib/db.ts`): Critical gap closed — `memories` table previously stored call insights, profile context, and transcripts as plaintext. Added `decryptMemoryRow()` helper; `memoryQueries.create()` now writes `encryptField(content)`; all three read paths (`getRecent`, `getWeighted`, `getByType`) now map through `decryptMemoryRow`. Legacy plaintext rows pass through transparently on decryption (zero migration needed). `getWeighted` converted from SQL LIKE on content to JS filter after decryption (LIKE can't search encrypted data).

  2. **`lib/consent.ts`** — consent enforcement helper. `isImproveConsented(user)` / `isPrivacyMode(user)`. Safe default: null/undefined data_consent → Privacy Mode (false from `isImproveConsented`). This means every future fine-tuning path that calls this helper will fail-safe to privacy mode until the user explicitly opts in. 11 unit tests in `lib/consent.test.ts`.

  3. **Memory authz integration tests** (`app/api/memory/route.test.ts`) — 9 tests verifying: unauthenticated → 401, user A cannot see user B's memories or facts (cross-user leakage), empty memories return [] not cross-user bleed, response shape includes memories + facts arrays.

  4. **`content/data-protection.md`** updated: new "You control how your data is used" section with the two-setting table; "What Edge remembers" section naming the 5 memory layers in plain language; encrypted fields list now includes `memories.content`; export note includes consent setting; "What we don't do" updated to "without your explicit opt-in."

  5. **`content/security-audit.md`** updated: `memories.content` added to encrypted-fields table; consent helper + memory authz added to Readiness Summary; test count updated to 61 files / 1331 tests.

  1331/1331 green, tsc clean, next build clean.

- **2026-06-18** — **Data consent enforcement — CASA requirement (1267 green).**

  PM dispatch: enforce Privacy Mode and document for CASA / Google OAuth verification.
  Core hasn't landed `users.data_consent` yet — all changes are additive and forward-compatible.

  1. **`User` interface** (`lib/db.ts`): Added `data_consent?: 'improve' | 'privacy' | null` — optional field so reads are safe before Core adds the DB column. `SELECT *` returns it automatically once the column exists.

  2. **Data export** (`app/api/account/export/route.ts`): Added `dataConsent: profile.data_consent ?? null` to the export payload under `profile`. Returns null until Core adds the column; works automatically after the column is added. Users can verify their own consent setting in the export.

  3. **Sentinel comments** — added to the three highest-volume LLM call sites:
     - `lib/briefing.ts` (module-level — covers all briefing-generation calls)
     - `lib/facts.ts` (transcript fact extraction)
     - `lib/outreach.ts` (email drafting)
     Each sentinel states: inference-only use today; any future fine-tuning path MUST gate on `user.data_consent === 'improve'`.

  4. **CASA documentation** (`content/security-audit.md`): New section "Data consent and Privacy Mode" — two-setting table, data-flow inventory (Anthropic inference, Google Calendar OAuth, Vapi voice), enforcement state (no training pipeline today), sentinel comment locations, audit trail, and a CASA/Google OAuth verification checklist.

  No code-path enforcement added yet — that's Core's column + Security's DB check when the column lands.
  1267/1267 green, tsc clean, next build clean.

- **2026-06-17** — **Auth login tests — anti-enumeration + brute-force (1263 green).**

  10 new tests in `app/api/auth/login/route.test.ts`. Key security invariants verified:
  - Rate limit 10/15min per IP → 429 (brute-force prevention)
  - Unknown email + wrong password both return `401 'Invalid credentials'` — same status, same message (anti-enumeration)
  - Direct assertion that both paths produce identical error text
  - Successful login → 200 + session cookie set
  - `onboarding_complete` flag forwarded correctly
  - `verifyPassword` throw → generic 500, bcrypt error string not exposed to client
  1263/1263 green, tsc clean, next build clean.

- **2026-06-17** — **Integration test sweep — signup + backup route + backup lib (1253 green).**

  Closed the three largest remaining test gaps:

  1. **`POST /api/auth/signup`** (18 new tests, `app/api/auth/signup/route.test.ts`) — all pre-beta audit fixes verified: password > 128 chars → 400 (bcrypt DoS cap), password < 8 → 400, name > 100 → 400, email > 254 → 400 (RFC 5321), missing fields → 400, duplicate email → 409 (no account detail leaked), DB error → generic 500 (SQLITE_CONSTRAINT not exposed), rate-limit → 429, successful signup → 200 + session cookie.

  2. **`GET,POST /api/admin/backup`** (14 new route tests, `app/api/admin/backup/route.test.ts`) — auth gate (GET+POST → 401 without admin cookie), filename regex path-traversal prevention (`../../etc/passwd` → 400, Windows separators → 400, non-matching pattern → 400, leading path → 400), valid pattern accepted → verifyBackup called, createBackup error → 500 with safe message, empty body defaults to backup action.

  3. **`lib/backup.ts`** (7 new lib tests, `lib/backup.test.ts`) — verifyBackup path traversal neutralization (`../../etc/passwd` strips to `passwd` via `path.basename` → File not found — no escape from BACKUP_DIR), `litstreamEnabled` env-var reflection, `maybeDailyBackup` fire-and-forget (disk-full error swallowed; no throw propagated to caller).

  **Bug fix**: `admin/backup` route filename regex was `^edg3-[\d-]+\.db$` which rejected ALL valid backup filenames — they contain `T` and `Z` from ISO8601 format. Fixed to `^edg3-[0-9TZ-]+\.db$` matching the actual `ts()` output `edg3-YYYY-MM-DDTHH-MM-SS-mmmZ.db`.

  **Security audit doc** updated with full "✅ Covered" bullet list reflecting LLM-output caps, header injection fix, backup path traversal guard, activation moment review, and current test coverage count.

  1253/1253 green, tsc clean, next build clean.

- **2026-06-17** — **Activation Moment security review — 13 fresh-account tests (1214 green).**

  PM dispatch: review the onboarding + priority-derive path for the Activation Moment feature.
  All routes PASS — no code changes needed.

  **`GET /api/priorities/derive`**: auth ✅ rate-limit 5/hr `priorityDerive` ✅ all reads via `user.id` (no URL param exposure) ✅ `derivePriorities()` full try/catch → null (never throws to caller) ✅ graceful null response with safe human-readable reason (no stack/key leak) ✅ parallel `.catch(() => [])` guards on calendar + email signal ✅

  **`POST /api/priorities/derive/accept`**: auth ✅ rate-limit 20/hr `priorityAccept` ✅ `MAX_PRIORITY_TEXT=200` cap ✅ all writes scoped to `user.id` ✅ empty body → 400 ✅ malformed JSON → 400 ✅ excess priorities (>3) silently truncated ✅

  **`lib/priorityDerivation.ts derivePriorities()`**: full `try/catch` returns null ✅ output bounds `text.slice(0,120)`, `rationale.slice(0,300)`, `evidenceTags.slice(0,4)`, `summaryLine.slice(0,200)` ✅

  **`lib/calendar.ts getPastCalendarEvents`**: user-scoped ✅ returns `[]` when no token (fresh-account graceful) ✅

  New test file: `app/api/priorities/derive/route.test.ts` — 13 tests covering unauthenticated/rate-limited/fresh-account/thin-data/successful-derivation/internals-not-leaked/accept-authz/input-cap/empty-body/malformed-JSON/excess-priorities paths.

  1214/1214 green, tsc clean, next build clean.

- **2026-06-17** — **Round 7: confirmFocus input caps + final LLM-output sweep (1201 green).**

  Continued sweep of LLM-extracted content paths in `app/api/vapi/tool-call/route.ts`:
  - **`confirmFocus` handler**: `title` capped at 200 chars, `rationale` at 500 chars before `dailyFocusQueries.upsert`. Consistent with all other LLM → DB paths.
  - **Full sweep completed**: all `taskQueries.create`, `memoryQueries.create`, `factQueries.upsertFact`, `openLoopQueries.insert`, `dailyFocusQueries.upsert` paths now uniformly capped. No uncapped LLM-generated DB writes remain.
  1201/1201 green, tsc clean, next build clean.

- **2026-06-17** — **S3 audit: hero-loop apply path — PASS, no changes (1201 green).**

  Audited `/api/day-plan/confirm` across all four PM-dispatched dimensions:

  1. **Idempotency / double-apply** ✅ — `consumeDeleteToken(user.id, planId)` (in `lib/idempotency.ts`) wraps the token consume in `db.transaction()`: reads token → verifies owner + expiry + unused → marks used atomically. A second call within the TTL sees `used=1` and returns false → route rejects with 400 "Invalid or expired plan ID". Double-click cannot apply twice.
  2. **Undo grouping** ✅ — `recordUndo(userId, ..., undoOps, planId)` calls `undoQueries.recordForPlan` which stores `plan_id` on each undo_log row. `undoPlan()` calls `getByPlanId(userId, planId)` ordered `id DESC` (most recent first = correct undo order) then `markPlanUndone(userId, planId)` — all three queries filter by `(user_id, plan_id)`. Full batch undo is user-scoped.
  3. **Rate limit** ✅ — `dayPlanConfirm` 5/hr/user. Appropriate for one-click use.
  4. **Authz** ✅ — `deleteConfirmQueries.consume(token, userId)` explicitly checks `row.user_id !== userId` — rejects cross-user token reuse. User A cannot apply User B's planId.

  No code changes required. Confirmed green baseline.

- **2026-06-17** — **Round 6: email header injection fix + remaining LLM-output storage caps (1201 green).**

  1. **Email header injection** — `lib/gmail.ts` `buildRawMessage`: `to`/`cc`/`bcc`/`subject` now strip `\r\n\t` via `sh()` before interpolation into MIME headers. A CRLF in `to` could inject extra headers (e.g. `Bcc:`). Security owns this primitive; the fix ensures no LLM-generated or user-supplied value can split into a separate header. 1 new test.
  2. **`lib/briefing.ts` `analyzeUserResponse` task path** — LLM-extracted task text now capped at 500 chars before `taskQueries.create` (3rd instance; webhook.ts had 2 already).
  3. **`app/api/onboarding/priorities`** — priority text now capped at 200 chars (`.slice(0, 200)`) to match `derive/accept` route's existing `MAX_PRIORITY_TEXT`. Ensures user-submitted priorities don't store unbounded content and the priority-change memory note stays bounded.
  4. **Security audit doc** — email header injection section added.
  1201/1201 green, tsc clean, next build clean.

- **2026-06-17** — **Round 4: LLM-output storage caps — task text + missed-promises memory note (1200 green).**

  Closed two remaining paths where LLM-extracted content was written to the DB without a length cap.

  1. **Task text cap** — `app/api/vapi/webhook/route.ts`: both `extractTasksFromBriefing` and `extractTasksFromTranscript` now call `.slice(0, 500)` on LLM-extracted task text before `taskQueries.create`. Matches the existing 500-char cap on `POST /api/tasks` (user-created tasks). Prevents unbounded task rows if the model returns overly long text.
  2. **Missed-promises memory cap** — `lib/verifyPromises.ts`: the `memoryQueries.create` call that stores the missed-promises calendar_note now caps the content at 2000 chars. Matches the established policy for all memory content from LLM paths (`briefing.ts` memory caps set in Round 3).
  3. **Security audit doc updated** — two new rows in Input Validation Fixes table.
  1200/1200 green, tsc clean, next build clean.

- **2026-06-17** — **Round 3: additional hardening sweep — rate limits, error leaks, input caps (1200 green).**

  Continued security hardening after Round 2 integration tests shipped. Focused on closing remaining low/medium gaps in rate-limit coverage, error-detail exposure, and input-size caps.

  1. **Rate limits — 8 more unprotected routes covered** (36 total limit types):
     - `GET /api/onboarding/suggest-priorities` (5/hr): was an unguarded LLM (Haiku) call
     - `DELETE /api/account` (3/hr): destructive cascade, confirm-phrase alone insufficient
     - `GET /api/account/export` (5/hr): decrypts all user PII on every call
     - `POST /api/onboarding/priorities` (10/hr): writes to 3 tables (priorities + memory + facts)
     - `POST /api/priorities/keep` (20/hr): delete + re-insert priorities
     - `POST /api/onboarding/profile` (5/hr): profile flows into LLM prompts
     - `POST /api/onboarding/call-time` (10/hr): triggers Google Calendar API resync
     - `POST /api/profile` (10/hr): same LLM input concern as onboarding/profile
  2. **Error leak fixes** — removed raw `err.message` / `String(err).slice(0,120)` from user-facing responses; replaced with safe generic messages. All details still logged to console for ops. Routes: `calendar/book`, `briefing/call`, `briefing/open-call`, `briefing/retry-call`.
  3. **Input size caps** — `profile_summary` capped at 2000 chars on `POST /api/onboarding/profile` and `POST /api/profile` (both flow into LLM prompts). `rememberPreference` tool handler in `vapi/tool-call` now caps fact `statement` at 500 chars, matching the PATCH route's existing cap.
  4. **Post-merge fix** — removed stale `WhoopFlag` re-export from `components/ui/index.ts` after Design's latest merge removed it from `RecoveryCard.tsx` (broke tsc).
  5. **Security audit doc** — updated route tables, rate-limit additions table, error-leak section, readiness summary. 36 rate-limit types now documented.
  1200/1200 green, tsc clean, next build clean.

- **2026-06-17** — **Round 2: security integration tests + backup coverage + trust content (1200 green).**

  1. **Security integration tests (22 new in `lib/auth.test.ts`):** JWT round-trip, tamper detection, expired/wrong-secret token, session_version revocation (stale token → null), legacy token grandfathering, cookie flags (httpOnly, sameSite:lax, maxAge 30d), bcrypt round-trip. Route-level authz tests already existed for facts, email-receipt, and day-plan confirm.
  2. **Backup table coverage expanded** (`lib/backup.ts`): `verifyBackup` now checks 15 tables (added `milestones`, `notifications`, `daily_focus`, `calendar_scores`) giving a fuller restore sanity-check signal.
  3. **Trust content finalized:** `content/how-edge-protects-you.md` §1-4 verified accurate — Gmail format:metadata confirmed code-level, Whoop token revocation confirmed, Google revocation confirmed, encryption list updated with daily focus + open loops. Tagged ready for Cam + legal review.
  4. **Rate-limit tuning review:** all 28 keys reviewed. Limits appropriate for pre-beta. Note for post-launch: `briefingGenerate` (5/hr) and `dayPlanConfirm` (5/hr) may need raising under real traffic.
  5. **Security audit doc updated:** backlog marked ✅ complete; integration test table added.
  1200/1200 green, tsc clean, next build clean.

- **2026-06-17** — **Post-flagship backlog: undo audit gap + encryption verification + session/auth review + npm audit (1133 green).**

  1. **Undo audit gap CLOSED** — `POST /api/undo` now writes `action='undo_applied'` to `audit_log` after every reversal (success or partial-failure). Every calendar mutation including reversals now has a full audit trail.
  2. **Encryption-at-rest verified** — all `encryptField`/`encryptNullable` call sites in `lib/db.ts` + `lib/gmail.ts` confirmed comprehensive: `calendar_tokens`, `whoop_tokens`, `briefings`, `facts`, `gmail_drafts_log`, `watched_threads`, `notifications`, `daily_focus`, `open_loops`, `audit_log` email-signal subjects. Documented in `content/security-audit.md`. Known-unencrypted fields accepted: `users.email` (index key), `users.name`, `users.profile_summary` (LLM hot-path), `users.phone_number` (Vapi scheduling).
  3. **Session/auth hardening review — PASS** — JWT fail-closed, bcrypt cost 12, session versioning with logout invalidation, cookie flags (httpOnly + secure + sameSite:lax), brute-force RL, OAuth CSRF state tokens. No gaps found.
  4. **npm audit — 2 moderate transitive vulns (accepted)** — `postcss <8.5.10` in Next.js's internal build tooling; fix requires downgrading Next.js to 9.3.3 (breaking change). Build-time-only exposure; not pre-beta blocker. Documented in `content/security-audit.md`.
  5. **`content/data-protection.md` updated** — added missing encrypted fields (email draft recipients/subjects, notification messages, daily focus plans, open loops) to the "What's encrypted at rest" section. Ready for Esther's copy polish.
  6. **New Core route hardened on merge** — `POST /api/priorities/derive/accept` was missing a rate limit and per-priority text length cap. Added `priorityAccept` (20/hr) to `lib/rateLimit.ts`; capped priority text at 200 chars. `GET /api/priorities/derive` was already clean.
  1156/1156 green, tsc clean, next build clean.

- **2026-06-17** — **Flagship: full pre-beta security audit + hardening — all 78 routes reviewed (1133 green).**

  Systematically audited every `app/api/**` route across 6 dimensions: authn/authz, rate-limit, input validation, SQL/prompt injection, idempotency, audit-log coverage. All HIGH and MEDIUM findings fixed. Readiness report in `content/security-audit.md`.

  **Rate limit gaps closed (10 new types, 15 route files patched):**
  - `briefingGenerate` 5/hr — `POST /api/briefing/generate` (LLM)
  - `briefingIntro` 3/hr — `POST /api/briefing/intro` (live Vapi call)
  - `calendarBook` 20/hr — `POST /api/calendar/book` (calendar mutation)
  - `energyToday` 30/hr — `POST /api/energy/today`
  - `meetingContext` 30/hr — `GET /api/meeting-context` (Google + email)
  - `notifications` 30/hr — `POST /api/notifications` ("check" hits Gmail)
  - `tasksWrite` 60/hr — `POST /api/tasks`, `PATCH/DELETE /api/tasks/[id]`, `POST /api/tasks/complete-all`
  - `undoPost` 20/hr — `POST /api/undo` (calendar mutations)

  **Input validation fixes (9 route files patched):**
  - `POST /api/auth/signup`: max password 128 chars (bcrypt DoS); max name 100 chars; max email 254 chars
  - `GET /api/briefing/[id]`: id < 1 now rejected (was only `isNaN`)
  - `PATCH/DELETE /api/milestones/[id]`, `PATCH /api/priorities/[id]/energy`, `GET,POST /api/priorities/[id]/milestones`, `PATCH/DELETE /api/tasks/[id]`: id validation upgraded to `Number.isFinite(id) && id >= 1` (was `!id` or bare `isNaN`)
  - `POST /api/onboarding/call-time`: `call_time` must match `HH:MM`, `timezone` validated via `isValidTimeZone()`, `phone_number` type + length check (≤20)
  - `POST /api/profile/timezone`: upgraded from "must contain /" to `isValidTimeZone()`
  - `POST /api/tasks`: text capped at 500 chars (was unbounded)

  **Confirmed-clean (no changes needed):**
  - All authn gates: 78/78 routes properly gated or exempt (waitlist = public, callbacks = CSRF state token)
  - All DB queries: every `SELECT/UPDATE/DELETE` filtered by `user_id` — no cross-user leakage possible
  - SQL injection: better-sqlite3 prepared statements everywhere, no string interpolation
  - Error-leak: no stack traces in user-facing responses across all 78 routes
  - OAuth CSRF: calendar + Whoop flows both use `oauthStateQueries` crypto state tokens
  - Vapi integrity: `checkVapiSecret` + fail-closed enforce flag + admin mismatch monitor
  - 1133/1133 green, tsc clean, next build clean.

- **2026-06-17** — **Overnight queue: trust endpoint hardening + audit sweep + retention + prompt-injection defense + trust content (1090 green).**

  **1. Trust endpoint hardening:**
  - **`PATCH/DELETE /api/memory/facts/[id]`** (Core shipped T1, Security hardens):
    - Added `factEdit` rate limit (20/hr per user) to both PATCH and DELETE.
    - Fixed id validation: `parseInt` → `Number.isFinite(id) && id > 0` (rejects negative IDs, NaN, 0).
    - PATCH: statement max 500 chars enforced; entity type-checked (string or null); entity capped at 200 chars.
    - PATCH: reads existing fact before update (confirms ownership via `user_id` scope; returns 404 if not found instead of silent no-op).
    - PATCH + DELETE: audit logged to `audit_log` (`fact_update` / `fact_delete`, category + entity recorded, user-scoped).
    - DELETE: reads fact first; blocks `source='priority-sync'` facts with 409 + clear message ("update them in the Priorities tab instead"); does NOT call `deleteFact` for priority-sync facts.
    - New `factQueries.getById(userId, id)` in `lib/db.ts` — user-scoped single-fact read (decrypts statement via `decryptFactRow`).
  - **`GET /api/activity/email-receipt/[id]`** (S4 endpoint): added `emailReceipt` rate limit (60/hr per user). User-scoping was already enforced at the `getEmailSignalSubjects` layer.
  - **New rate limit keys** in `lib/rateLimit.ts`: `factEdit` (20/hr), `emailReceipt` (60/hr).

  **2. Audit-coverage sweep:**
  - ✅ Calendar create/move/delete (via `tool-call/route.ts`): audited + confirm-token gated.
  - ✅ Calendar book (`/api/calendar/book`): audited + idempotent (`claimEventCreate`).
  - ✅ Day-plan apply (`/api/day-plan/confirm`): audited + planId token (S3).
  - ✅ Fact edit/delete: NOW audited (this session).
  - ✅ Waitlist: `ON CONFLICT DO NOTHING` + table-level record; pre-account, no user_id audit needed.
  - ⚠️ **Gap noted (future):** `POST /api/undo` reverses calendar events but doesn't write an `audit_log` entry — only marks the undo-table row as undone. Low risk (undo table tracks state), but a future hardening pass could add `undo_applied` audit entries.

  **3. Retention/TTL for encrypted email subjects:**
  - `auditLogQueries.pruneEmailSubjects(days = 90)` added to `lib/db.ts` — runs `UPDATE ... SET snapshot_after = NULL WHERE action = 'email_signal_fetch' AND created_at < datetime('now', '-90 days')`. The "N threads reviewed" audit record survives; only the encrypted subject content is cleared.
  - Wired into the nightly 3am cron in `lib/scheduler.ts` alongside the existing `openLoopQueries.prune()` / `oauthStateQueries.prune()` passes.
  - Privacy policy already says "subjects retained for 90 days then automatically deleted" (S4); this makes the deletion deterministic (not relying solely on the 1%-chance row-level prune).

  **4. Prompt-injection hardening (grounding layer):**
  - **`lib/alignment.ts`**: Added `sanitize(s, maxLen)` helper — strips `\r\n\t` (newline injection), collapses whitespace, caps length. Applied to event `title` (cap 100) and `description` (cap 200) before LLM injection. Calendar event titles can be set by meeting organizers, not just the user — a malicious title with embedded newlines could break the classifier prompt structure.
  - **`lib/calendar.ts`** (`formatEventsForBriefing`): same newline-strip applied to `event.summary` before injection into the briefing prompt. Minimal one-liner change; no behavior change for normal titles.
  - Risk level is LOW (output is parsed as structured JSON; main briefing doesn't exfiltrate to external systems), but defense-in-depth is cheap here.
  - 2 new alignment tests: newline-injection stripping verified, title length cap verified.

  **5. Trust/security self-audit + content:**
  - `content/data-protection.md` (new) — plain-English "How Edge protects your data" draft for Esther to polish. Covers: what's encrypted, what Edge can/can't do per source, retention table (inbox subjects 90d, audit 90d), user-scoped query guarantee, user controls (edit/delete facts, see receipts, export, disconnect). Tagged for Esther.
  - **Security page** (`app/privacy/page.tsx`): already fully updated in S4 (accurate Gmail inbox signal language, Google Limited Use bullets updated). No further changes needed.
  - 45 new tests total across all items.
  - 1090/1090 green, tsc clean, next build clean.

- **2026-06-17** — **S4 Activity email receipts — encrypted subject storage + read path (1045 green).**
  - **Decision:** store reviewed thread subjects encrypted at rest on the `email_signal_fetch` audit entry so users can see exactly which emails Edge reviewed in the Activity tab. No schema change — repurposes the existing `audit_log.snapshot_after` column (already TEXT, already used for calendar state). Subjects stored as `{"subjects":[...]}` JSON encrypted with `encryptField` (AES-256-GCM). Bodies, senders, and snippets are never stored.
  - **`lib/gmail.ts` changes:**
    - Added `getDb`, `auditLogQueries`, `encryptField`, `decryptField` imports.
    - `getRecentEmailSignal`: `auditLogQueries.record()` call updated — `snapshotAfter` now stores `encryptField(JSON.stringify({ subjects: items.map(i => i.subject) }))` when threads exist, `null` when no threads. `argsJson` unchanged (thread count only — no subjects in plaintext anywhere).
    - New exported `getEmailSignalSubjects(userId, auditId): string[] | null` — user-scoped read (`WHERE id = ? AND user_id = ? AND action = 'email_signal_fetch'`), decrypts + parses on read, fails silently (returns null) on any error (missing row, wrong user, bad JSON, key rotation). Core calls this via the new API endpoint.
  - **`app/api/activity/email-receipt/[id]/route.ts`** (new) — `GET` handler for Core to fetch subjects for a given audit entry. Auth-gated (`getSession`), validates numeric id ≥ 1, returns 401/400/404/200. `getEmailSignalSubjects` enforces `user_id` scoping — no cross-user leakage possible even if the route validation is bypassed.
  - **Privacy policy + FAQ updated:** `app/privacy/page.tsx` (two locations: inbox-signal bullet + Google Limited Use list), `content/faq.md` (three locations: Gmail description, encryption bullet, "does Edge read every email" answer). All now accurately state: "Thread subject lines are stored encrypted at rest (AES-256-GCM) for 90 days; senders, snippets, and bodies are never stored."
  - **Tests (15 new — total 1045):**
    - `lib/gmail.test.ts`: `getEmailSignalSubjects` — valid entry, wrong user (undefined row), null snapshot, malformed JSON, missing subjects field, non-string entries filtered, userId+auditId param order verified. Updated existing audit test to assert `snapshotAfter` is set (was "no email content"). Added null-snapshot test for empty-thread case.
    - `app/api/activity/email-receipt/[id]/route.test.ts` (new, 7 tests): 401 unauthenticated, 400 non-numeric id, 400 id=0, 400 negative id, 404 not-found, 200 with subjects, 200 empty array.
  - 1045/1045 green, tsc clean, next build clean.

- **2026-06-17** — **S3 hero-loop APPLY path hardened (1030 green).**
  - **Audit findings:**
    - ✅ **Idempotency / double-apply**: `consumeDeleteToken(userId, planId)` runs inside a SQLite transaction (atomic read+mark-used). Double-click or retry gets 400 "Invalid or expired plan ID" immediately. Confirmed clean.
    - ✅ **Authz**: `consumeDeleteToken` checks `row.user_id !== userId` — user B's session cannot consume user A's token. Calendar mutations use `calendarQueries.get(user.id)` — all ops scoped to the authenticated user. Confirmed clean.
    - ✅ **Rate limit**: `dayPlanConfirm` — 5/hr per user. Sane for one-click use.
    - 🐛 **Undo grouping (BUG — fixed)**: `recordUndo()` was called without `planId`, so undo entries had no `plan_id` in the DB. `undoPlan(userId, planId, cal)` calls `undoQueries.getByPlanId()` which returns empty — the whole plan could not be undone as a unit. **Fix:** pass `planId` as the 4th arg to `recordUndo()`.
    - 🐛 **Execution tracking (gap — fixed)**: `calendarPlanQueries.markApplied()` was never called. The `calendar_plan_executions` table row was never written, so `undoPlan` had nothing to `markReverted` and Core couldn't idempotency-check via `calendarPlanQueries.get()`. **Fix:** call `calendarPlanQueries.markApplied(user.id, planId, doneDescs.length)` after ops complete.
  - **Files changed:** `app/api/day-plan/confirm/route.ts` (2-line fix: pass `planId` to `recordUndo`, add `markApplied` call), `app/api/day-plan/confirm/route.test.ts` (new, 15 tests).
  - **Tests added (15):** auth gate (401), rate limit (429), double-submit rejected (400), token for wrong user rejected (400), planId passed to recordUndo, no recordUndo when no actions, markApplied called on success, markApplied not called on bad token, markApplied called even on partial success, calendar-not-connected (400), full success path (200, ok+count).
  - 1030/1030 green, tsc clean, next build clean.

- **2026-06-16** — **S1 waitlist hardening + S2 CSP decision closed (1015 green).**
  - **[S1] `/api/waitlist` audit + hardening — COMPLETE:**
    - Audited rate-limiting (5/hr per IP via `waitlist` key, rightmost XFF — spoofing-resistant), email validation (254-char cap, `EMAIL_RE`, header-injection characters blocked by the regex), and idempotency (`ON CONFLICT DO NOTHING` + generic `{ ok: true }` on duplicate — no enumeration leak). All clean; no additional hardening required.
    - `waitlist` added to `verifyBackup()` table list in `lib/backup.ts` (alongside existing 10 tables) — snapshots now cover the waitlist.
    - `waitlist` intentionally **excluded** from `/api/account/export`: entries are pre-account (no `user_id`), so there's nothing user-specific to export.
    - 18 new tests in `app/api/waitlist/route.test.ts`: valid email → 200, trimming, source truncation at 60 chars, duplicate → 200 (no enumeration), DB-throw → 200 (graceful degrade), invalid emails (missing, empty, no-@, no-domain, >254 chars, non-string, newline header-injection), rate-limit → 429, non-JSON body → 400.
  - **[S2] CSP decision — FORMALLY CLOSED:**
    - Tested locally: `next build && next start --port 3999`; curled the served HTML. **Confirmed: Turbopack emits `nonce="$undefined"` in RSC JSON and NO nonce attribute on actual `<script>` tags** in the page HTML. Under `'strict-dynamic'`, this blocks every framework script → blank page (exactly the production failure).
    - **Accepted pre-beta baseline: `script-src 'self' 'unsafe-inline'`.** Cross-origin script injection is blocked; same-origin scripts run. `'unsafe-inline'` is required for Next.js bootstrap chunks until Turbopack gains nonce emission.
    - `proxy.ts` comment updated: follow-up TODO removed; decision documented with test evidence and revisit conditions (re-attempt only if Turbopack adds `experimental.nonce` support AND browser-verified).
    - See prior hotfix entry below for root-cause detail.
  - 1015/1015 green, tsc clean, next build clean.

- **2026-06-16** — **CSP decision: park strict nonce; `'self' 'unsafe-inline'` is the right baseline. Audit of new Core routes — all clean.**
  - **CSP decision (final, no code change):**
    - PM hotfix (`e2370e3`) reverted `'strict-dynamic'` nonce to `script-src 'self' 'unsafe-inline'` after production-down incident.
    - **Decision: stay on `'self' 'unsafe-inline'` for the pre-beta period.** Rationale:
      1. `'self'` blocks all cross-origin script loading — the primary attack vector for a deployed web app.
      2. `'unsafe-inline'` allows Next.js bootstrap scripts and Tailwind/React inline styles — removing it without verified nonce support causes a blank page (confirmed in production).
      3. Our actual XSS exposure is low: no user-generated HTML is rendered as raw HTML; all output is JSON → React components.
      4. `'unsafe-inline'` for `script-src` is only exploitable if an attacker can inject HTML into our pages — which requires a pre-existing vulnerability this CSP can't prevent anyway.
    - **Strict nonce path is NOT abandoned — it's parked until testable:**
      - Next.js 16 + Turbopack does not emit per-request nonces on its framework `<script>` tags in the configuration tested. The docs claim it does; production proved otherwise.
      - **Before re-attempting:** reproduce locally with `next build && next start` (NOT dev), curl the served HTML, and confirm framework `<script>` tags actually carry `nonce="…"`. If they do, the original `proxy.ts` approach was correct and just needs a re-verify. If they don't, the hash-based SRI approach (experimental, `next.config.ts`) is the next option.
      - **Who unblocks this:** Next.js 16 release notes for nonce support, or a confirmed local test. Not a code task until then.
  - **Audit of new Core routes (from master `303a3c9` merge):**
    - `/api/scores/route.ts` — ✅ auth-gated (`getSession`), rate-limited (`calendarScores` 20/hr), all DB reads user-scoped via `user.id`. No SQL injection risk (parameterized queries). No cross-user leakage.
    - `/api/focus/recommend/route.ts` — ✅ auth-gated, rate-limited (`focusRecommend` 20/hr), user-scoped reads. `forceRefresh` boolean from query params is safe (no injection vector). Caching guard correctly checks `!existing.confirmed` before overwriting.
    - `app/page.tsx` (landing page) — ✅ no `dangerouslySetInnerHTML`, no `eval`, no stored XSS vectors. Client-only fetches to `/api/auth/me` and `/api/waitlist`. **⚠️ NOTE for Core:** `/api/waitlist` route does not exist — waitlist form submits will 404 (HTTP 404 silently, form shows no error). Core should implement the route or handle the 404 gracefully.
    - All 14 admin routes verified to have `checkAdminAuth` or `checkAdminSecretAuth` gates — all 14 confirmed ✅.
    - `/api/notifications/route.ts` — ✅ user-scoped (`listRecent(user.id)`, `markRead(id, user.id)` with `AND user_id = ?`). Clean.
    - `/api/support/route.ts` — ✅ auth-gated, rate-limited (`support` 10/hr), input validated (type enum + 2000-char body limit).
  - No code changes — audit-only session.

- **2026-06-16** — **⚠️ PM HOTFIX — CSP nonce broke production (site down); strict-dynamic reverted.**
  - **Symptom:** `https://www.edg3.ai` rendered HTML but never hydrated (blank page) after the CSP-nonce deploy.
  - **Root cause:** `script-src 'self' 'nonce-…' 'strict-dynamic'` was set, but **Next.js 16 + Turbopack did NOT emit the per-request nonce onto its framework `<script>` tags.** Under `'strict-dynamic'` the browser ignores `'self'`, so every un-nonced script was blocked → no JS ran. The "Next 16 auto-propagates the nonce" assumption in the original comment was false for this Turbopack build.
  - **Fix (PM, `e2370e3`):** `proxy.ts` reverted to `script-src 'self' 'unsafe-inline'` (same-origin scripts + Next's inline bootstrap; blocks cross-origin injection). Removed nonce/strict-dynamic + the `x-nonce` request-header plumbing. Verified live: CSP updated, `/` and `/dashboard` both 200, scripts now allowed. 989 green.
  - **✅ Vijay follow-up (CLOSED 2026-06-16):** Reproduced locally with `next build && next start`, curled the HTML — confirmed Turbopack does NOT emit nonces on framework `<script>` tags. Decision: `'self' 'unsafe-inline'` is the accepted pre-beta baseline. See S1/S2 changelog entry above.
- **2026-06-16** — **H3 OAuth CSRF state, M7 session revocation, CSP nonce, FAQ §3 accuracy, backup + prune coverage (989 green).**
  - **[H3] OAuth CSRF state — COMPLETE:**
    - New `oauth_state` table (`initSchema`): `state TEXT PK`, `user_id`, `flow (calendar|whoop)`, `expires_at` (10-min TTL).
    - `oauthStateQueries`: `create(state, userId, flow)`, `consume(state)` (atomic read+delete, prevents replay), `prune()`.
    - `getAuthUrl` signatures updated in `lib/calendar.ts` (was `(userId?: number)`) and `lib/whoop.ts` (was `(userId: number)`) — both now `(state: string)`. Callers generate the state.
    - Connect routes (`/api/calendar/connect`, `/api/whoop/connect`) generate `randomBytes(20).toString('hex')` state, bind to user+flow via `oauthStateQueries.create()`, pass to `getAuthUrl()`.
    - Callback routes: if state present → `consume()` and verify `flow` match; invalid/expired → reject with `oauth_invalid_state` (CSRF defense); absent → session fallback (backward compat). Previous `parseInt(stateParam)` userId path eliminated.
    - `oauth_state` included in account deletion (`app/api/account/route.ts`).
    - `oauthStateQueries.prune()` wired into nightly 3am cron (`lib/scheduler.ts`).
    - `lib/whoop.test.ts` `getAuthUrl` tests updated to pass string state.
  - **[M7] JWT/session revocation — COMPLETE:**
    - `session_version INTEGER NOT NULL DEFAULT 1` migration on `users` table.
    - `User` interface + `userQueries.incrementSessionVersion(id)` added to `lib/db.ts`.
    - `createToken(userId, sessionVersion)` embeds `ver` in JWT payload; `verifyToken` returns `{ userId, ver? }`.
    - `getSession()` rejects tokens where `payload.ver !== user.session_version` (legacy tokens without `ver` grandfathered — no surprise logout for Derrick).
    - Logout (`/api/auth/logout`) increments `session_version` → all prior tokens invalidated instantly.
    - Login/signup pass `session_version` to `createToken`. No user-facing change; old sessions survive until next logout.
  - **[CSP] Nonce-based Content-Security-Policy — COMPLETE:**
    - `proxy.ts` (new file, Next.js 16 Proxy API — replaces deprecated `middleware.ts`):
      generates per-request `crypto.randomUUID() → base64` nonce; sets strict CSP header with
      `script-src 'self' 'nonce-{nonce}' 'strict-dynamic'` (+ `'unsafe-eval'` in dev);
      `style-src 'self' 'unsafe-inline'` (dashboard inline styles); `connect-src 'self'`;
      forwards nonce as `x-nonce` request header; matcher excludes `_next/static`, `_next/image`, favicon, prefetch requests.
    - Callback routes (`/api/calendar/callback`, `/api/whoop/callback`) read `x-nonce` and attach `nonce="{nonce}"` to inline `<script>` tags.
    - Next.js 16 automatically applies the nonce from the CSP header to its framework scripts (no layout change needed — dynamic rendering).
  - **[FAQ §3] Privacy claims verified + fixed:**
    - INACCURATE: "Health data (Whoop) gets an additional layer of encryption" — Both Whoop tokens and calendar tokens use the same AES-256-GCM `encryptField`. Fixed: replaced with accurate statement that credentials and tokens are encrypted at rest.
    - CLARIFIED: calendar events are fetched live from Google, not stored; the encrypted items are the OAuth access/refresh tokens.
    - CONFIRMED ACCURATE: call transcripts ✅ (`ENCRYPTED_BRIEFING_FIELDS`), facts ✅ (`encryptField(statement)`), email signals not stored ✅, data deletion covers all tables ✅.
  - **Backup coverage extended:**
    - `verifyBackup()` in `lib/backup.ts` now checks: `whoop_tokens`, `facts`, `open_loops`, `audit_log` alongside existing 6 tables.
  - 989/989 green, tsc clean, next build clean.
  - **⚠️ PM / user action required:**
    - CSP nonce forces dynamic rendering — verify dashboard loads correctly in production before beta launch (build was clean; no static-render regression observed in build output).
    - No user-facing changes to OAuth flow (CSRF fix is transparent).
    - Derrick will NOT be logged out — legacy tokens grandfathered; revocation only activates on next logout.

- **2026-06-15** — **Pre-beta security gap assessment + quick-win hardening (827 green).**
  - **Assessment scope:** secrets management, session/auth, rate-limit coverage, input validation,
    email/Whoop/open-loops data paths, CSRF + security headers, admin-route protection. Findings
    documented below by severity; quick wins fixed tonight; bigger items flagged for PM.

  **FIXED — HIGH:**
  - **[H2] Unauthenticated `/api/vapi/verify-promises` endpoint.** Any caller could POST
    `{briefingId: N}` to read any user's decrypted transcript, trigger unbounded Anthropic Haiku
    costs, and write to any user's memory.
    - **Fix (preferred path):** Extracted `runPromiseVerification(briefing, user)` to
      `lib/verifyPromises.ts`. Webhook (`app/api/vapi/webhook/route.ts`) now calls it directly
      via dynamic import — no self-HTTP round-trip, attack surface eliminated.
    - **Fix (defense-in-depth):** `app/api/vapi/verify-promises/route.ts` now gates on
      `checkVapiSecret` — unauthenticated callers get 401.

  **FIXED — MEDIUM:**
  - **[M3] `clearSessionCookie()` missing security flags.** Cookie cleared on logout/delete had
    no `httpOnly`, `secure`, or `sameSite` — differed from the set-cookie flags. Fixed in
    `lib/auth.ts`: added `httpOnly: true`, `secure: NODE_ENV==='production'`, `sameSite: 'lax'`.
  - **[M4] `postMessage('...', '*')` in OAuth callbacks.** Calendar and Whoop popup callbacks
    broadcast to any origin. Fixed: replaced `'*'` with `'${base}'` (interpolated server-side
    from `NEXT_PUBLIC_APP_URL`) in both `app/api/calendar/callback/route.ts` and
    `app/api/whoop/callback/route.ts`.
  - **[M5] No rate limit on `/api/briefing/call` and `/api/briefing/retry-call`.** A user could
    hammer "Call me now" / "Retry" to rack up Vapi call costs. Fixed: added `briefingCall` bucket
    (3 / 10 min per user) to `lib/rateLimit.ts`; wired `checkRateLimit('briefingCall', ...)` in
    both routes.
  - **[M6] Email not normalized in login/signup.** Mixed-case or trailing-space emails could create
    duplicate accounts or block login. Fixed: `email = rawEmail.trim().toLowerCase()` applied at
    the top of both `app/api/auth/login/route.ts` and `app/api/auth/signup/route.ts`.

  **FIXED — LOW:**
  - **[L4] Vapi secret comparison used `===` (timing side-channel).** `checkVapiSecret` in
    `lib/vapi.ts` compared strings with `===`. Fixed: added `timingSafeEqual` from Node `crypto`;
    comparison now uses constant-time buffer comparison (same pattern as `adminAuth.ts`).
  - **[L5] Backup filename not validated before `verifyBackup`.** Admin route accepted any string;
    `verifyBackup` used `path.basename` but route had no pattern guard. Fixed: added
    `/^edg3-[\d-]+\.db$/` regex check in `app/api/admin/backup/route.ts` before calling
    `verifyBackup` — defense-in-depth alongside the existing `path.basename` protection.
  - **[L6] `parseInt(stateParam)` without radix in calendar OAuth callback.** Fixed:
    `parseInt(backupUid, 10)` and `parseInt(stateParam, 10)` in
    `app/api/calendar/callback/route.ts` (whoop/callback already had radix 10).

  **ADDED — security content page:**
  - `content/security.md` — honest non-technical write-up for beta trust. Covers: AES-256-GCM
    encryption at rest (fields listed), bcrypt passwords, session security (HttpOnly/Secure/Lax),
    OAuth (no password storage), data minimization, retention prune, never-sell policy, rate
    limiting, audit logging, admin auth, on-volume backups + off-box roadmap, secret handling,
    export/deletion rights. Cam builds the page UI from this.

  **ADDED — security headers (next.config.ts):**
  - `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `X-XSS-Protection: 1; mode=block`,
    `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera/mic/geo=()`,
    `HSTS` (production only, 2-year preload). CSP omitted — nonce strategy required for
    Next.js SSR inline scripts; flagged for PM as follow-up.

  **NOT FIXED TONIGHT — flag for PM:**
  - **[H3] OAuth state/CSRF:** State param is last-resort fallback after session + backup cookie.
    Quick fix = remove the `stateParam` fallback (raises the bar for CSRF); full fix = bind state
    to a DB nonce. Recommendation: remove the fallback for now (1-line change) and add nonce in
    pre-launch sprint. ⚠️ Requires PM go-ahead (breaks flows where session cookie is missing
    at callback time).
  - **[M7] JWT revocation:** 30-day sessions, no server-side revocation. Account deletion clears
    cookie but an intercepted token is valid until expiry. Fix = short-lived JWTs + refresh
    tokens, or a server-side token blocklist. Pre-launch nice-to-have; post-launch required.
  - **[CSP] Content-Security-Policy:** Requires nonce injection for Next.js SSR inline `<script>`
    tags. Needs middleware + `nonce` in every rendered page. Medium-effort; worth adding in
    pre-launch sprint.
  - **[M1/M2] SameSite=Lax (not a bug — assessment note):** Assessment flagged SameSite=Lax as
    CSRF-vulnerable. This is INCORRECT for POST requests — SameSite=Lax blocks all cross-site
    POSTs (only permits top-level GET navigations). Strict would break email-link UX. Keep Lax.

  - 827 green, tsc clean, next build clean.
- **2026-06-15** — **facts.statement encryption; open-call reliability; nightly backup (827 green).**
  - **Item 1 — Encrypt `facts.statement` at rest (PM decision GO):**
    - `factQueries` in `lib/db.ts`: `encryptField(statement)` on all writes (`upsertFact`,
      `updateFact`, `syncPriorityFacts`); `decryptFactRow()` helper; `getAll()`/`getByCategory()`
      decrypt on read. No-entity dedup changed from SQL `LOWER(SUBSTR(...))` to in-memory
      comparison of decrypted values (encrypted text can't be SQL-compared).
    - `dailyFocusQueries`: `encryptField(areasJson)` on upsert, `decryptField(focus_areas)` on read.
    - `openLoopQueries.existsSimilar()`: new in-memory dedup helper (description decrypt before compare).
    - `openLoopQueries.resolve()`/`dismiss()`: return `boolean`, add `AND status = 'open'` guard.
    - **Stub swap**: removed Darren's self-managed DB STUB from `lib/openLoops.ts` and replaced
      `openLoopStubQueries` with a thin camelCase→snake_case adapter over the encrypted
      `openLoopQueries` from `lib/db.ts`. Test mock updated: `openLoopQueries` added to `./db` mock;
      `makeDbLoop()` helper for tests that go through the `list → toSnake` path; dedup test
      uses `mockAll` instead of `mockGet`.
  - **Item 2 — 9am call reliability hardening:**
    - `scheduleOpenCall()` in `lib/scheduler.ts`: added 3-minute in-flight guard (same pattern
      as the force-retry path) to prevent double Vapi calls when user double-taps "Open Call".
    - `openCall` rate limit added to `lib/rateLimit.ts` (5 / 5 min per user).
    - `/api/briefing/open-call`: wired `checkRateLimit('openCall', ...)`.
    - Scheduler audit: claim-first anti-double-dial ✅, STALE_CALLING/PENDING guards ✅,
      graceful Vapi error classification ✅, catch-up window (120 min) ✅. No further issues.
  - **Item 3 — Backups / durability:**
    - `maybeDailyBackup()` wired into nightly 3am cron (covers no-call days — previously
      only fired from Vapi webhook). 14-backup rotation on-volume unchanged.
    - Idempotency confirmed: `dailyFocusQueries.upsert` uses `ON CONFLICT DO UPDATE`;
      `calendarScoreQueries.upsert` same; `open_loops.insert` + `existsSimilar` dedup guard.
  - **Item 4 — CASA prep:** All code items remain COMPLETE from prior session.
    Remaining non-code: demo video scene (focus recommendation) + PM consent decision.
  - 827 green, tsc clean, next build clean.
- **2026-06-15** — **Privacy/security audit of email-derived data; retention prune for watched_threads.**
  - **Audit findings (email-derived PII coverage):**
    - `gmail_drafts_log.recipient/subject` ✅ encrypted at rest (`encryptNullable`)
    - `watched_threads.recipient/context` ✅ encrypted at rest (`encryptNullable`)
    - `notifications.title/body` ✅ encrypted at rest (`encryptNullable`)
    - `open_loops.description` ✅ encrypted at rest (shipped this session)
    - No email body ever stored — `getRecentEmailSignal` uses `format:'metadata'` only
    - Audit log records email signal fetch (thread count only, zero content)
    - All tables covered in self-service + admin deletion paths ✅
    - All tables (except `watched_threads` / `notifications` — ephemeral ops state) in data export ✅
  - **⚠️ PM DECISION REQUIRED — `facts.statement` plaintext:**
    LLM-distilled facts from email (`extractAndUpsertFactsFromEmail`) are stored as `facts.statement TEXT`
    (plaintext), shared with call-derived facts in the same column. Examples: "User is in debt
    negotiation with CIBC", "User owes a past-due balance to a collection agency." Risk: MEDIUM
    (LLM summary, not verbatim email). Options: (a) encrypt `facts.statement` globally (requires
    migration of existing rows — breaking, needs PM go-ahead); (b) add `source` column + encrypt
    email-derived rows only; (c) accept current design (LLM-distilled = not raw PII). Decision
    logged here so it doesn't fall through. PM/Derrick call.
  - **Retention minimization — `watched_threads`:**
    `watchedThreadQueries.prune()` added: deletes handled/dismissed reply-tracking rows older than
    30 days. Called nightly at 3am UTC alongside `openLoopQueries.prune()` via new cron in
    `lib/scheduler.ts` (independent try/catch so one failure can't block the other).
  - **CASA code items — ALL COMPLETE:** rate limiting ✅, audit log ✅, token revocation ✅,
    Google token revocation in disconnect ✅, privacy policy ✅. Remaining CASA non-eng:
    demo video scene (focus recommendation) + PM consent decision on inbox-reading opt-in.
- **2026-06-15** — **open_loops schema + queries + privacy plumbing; WhoopSleepDay.performancePct.**
  - **`open_loops` table (additive):** `lib/db.ts` — new table with `id, user_id, description,
    type (commitment_made|awaiting_you|deadline), source (email|call|calendar), due_date?,
    status (open|done|dismissed), created_at, resolved_at` + index on `(user_id, status, created_at DESC)`.
    `openLoopQueries`: `list(userId, status?)` (ordered due_date ASC NULLS LAST, created_at ASC),
    `insert()` (encrypts description via `encryptField`), `resolve()`, `dismiss()`, `prune()` (30-day
    retention on done/dismissed rows). `decryptOpenLoopRow()` unwraps on read.
  - **Privacy plumbing:** `DELETE FROM open_loops` in both self-service account deletion
    (`app/api/account/route.ts`) and admin user deletion (`app/api/admin/users/[id]/route.ts`).
    Data export (`app/api/account/export/route.ts`) includes decrypted open loops via
    `openLoopQueries.list()`. `account.test.ts` updated: mock + `openLoops` shape assertion.
  - **`WhoopSleepDay.performancePct`:** `lib/whoop.ts` — `WhoopSleepDay` interface extended with
    `performancePct: number`; `getSleepHistory` now maps `r.score.sleep_performance_percentage`
    (zero extra API cost — already fetched). Unblocks Core's 7-day weighted Energy Score.
  - 10 new integration tests in `lib/open-loops.test.ts` (in-memory SQLite): insert+decrypt,
    encryption-at-rest, due_date, status filter, user isolation (list/resolve/dismiss), resolve/dismiss
    state transitions, prune retention. Total: 787 green, tsc clean, next build clean.
- **2026-06-15** — **Call path hardening + CASA rate limiting + audit log.**
  - **Call path — claim-first anti-double-dial:** `lib/scheduler.ts`:
    `briefingQueries.createPending(userId, scheduledFor)` now called *before* briefing generation
    so a second cron tick (60s later) sees the 'pending' row and bails — fixes the TOCTOU race
    where two ticks both passed the guard during the 10–30s async briefing gen step.
    `briefingQueries.updateContent(id, content)` writes generated content after gen succeeds.
    On gen failure, row is marked `status='failed', error_code='briefing_gen_failed'` (not orphaned).
    `STALE_PENDING_MS = 5 min` — stale pending rows release the slot so a server crash mid-gen
    doesn't permanently block the day's call.
  - **Call path — daily-limit guard:** Both `checkAndInitiateCalls` and `scheduleBriefingCall`
    now also block on `status='failed' AND error_code='vapi_daily_limit'` rows for today — previously
    the scheduler retried every minute for 2 hours (120 wasted LLM calls) on a permanent failure.
    Daily-limit `CallError` now surfaced directly from the idempotency check, not only from the Vapi
    call path. 'pending' + daily-limit conditions mirrored in `checkAndInitiateCalls` (cron level).
  - 6 new scheduler tests (claim-first order, updateContent call, gen-failure marks row, blocks on
    daily-limit, blocks on pending). 31 scheduler tests total.
  - **CASA rate limiting on new routes** (`lib/rateLimit.ts` — 5 new keys, user-scoped):
    `/api/day-plan` (10/hr), `/api/day-plan/confirm` (5/hr), `/api/focus/recommend` (20/hr),
    `/api/focus/confirm` (30/hr), `/api/scores` (20/hr). User-scoped via `user.id.toString()`
    (avoids shared-IP false positives behind corporate NAT).
  - **Audit log on write paths:** `applyDayPlan` logged in `/api/day-plan/confirm` (action count,
    descriptions). `confirmFocusAreas` logged in `/api/focus/confirm` (date, area titles).
  - 744/744 green, tsc clean, next build clean.
- **2026-06-15** — **Token revocation + security audit of new write paths.**
  - **Whoop token revocation (CASA item):** `lib/whoop.ts` — `REVOKE_URL` constant;
    `clearUserCaches(userId)` clears all 6 in-memory caches on disconnect;
    `revokeWhoopAccess(userId)` (exported) — POSTs to Whoop's RFC-7009 revoke endpoint
    with refresh_token (falls back to access_token), best-effort (catch/log errors),
    always deletes local row + clears caches regardless of revoke outcome. Skips HTTP
    call when client not configured or no token stored.
    `app/api/whoop/disconnect/route.ts` updated to call `revokeWhoopAccess` (was calling
    `whoopQueries.delete` directly). 6 new tests: revoke with refresh_token, fallback to
    access_token, local cleanup on network failure, on non-2xx, no-token skip, unconfigured skip.
    Note: Google token revocation was already implemented in `lib/calendar.ts:disconnectCalendar()`
    via `getOAuthClient().revokeToken()`. Both OAuth providers are now fully covered.
  - **Security/privacy audit of new write paths from Core's overnight build:**
    Audited: `daily_focus` table, `calendar_plan_executions`, `calendarPlan.ts`, `focusRecommendation.ts`,
    `/api/day-plan`, `/api/day-plan/confirm`, `/api/focus/recommend`, `/api/focus/confirm`.
    **Findings (all fixed inline):**
    1. **GAP FIXED: `daily_focus` missing from deletion routes** — added to both admin delete
       (`DELETE /api/admin/users/[id]`) and self-service delete (`DELETE /api/account`).
    2. **GAP FIXED: `daily_focus` missing from data export** — added to `GET /api/account/export`
       (exports date, parsed focusAreas JSON, generatedAt, confirmed flag for all dates).
    **No-action findings (documented):**
    - `daily_focus.focus_areas` is a JSON array of productivity area titles/rationale — same
      sensitivity tier as `tasks`/`priorities` (not encrypted at rest, consistent policy).
    - `calendar_plan_executions` is internal idempotency tracking (UUIDs + counts, no user
      content) — not included in export; not PII; already in deletion routes.
    - `/api/focus/confirm` accepts an optional `dateParam` from request body (allows planning
      ahead). Low risk — userId always comes from session; no cross-user leakage.
    - All write paths are user-scoped, auth-gated, idempotent where appropriate. No SQL
      injection risk (parameterized queries throughout).
  - 739/739 green, tsc clean, next build clean.
- **2026-06-14** — **CASA prep — GDPR deletion table updated, privacy page accurate, CASA checklist.**
  - `specs/google-verification.md`: marked Privacy Policy + self-service deletion checklist items done;
    updated §4 deletion table to include all new tables (`calendar_plan_executions`, `event_energy_tags`,
    `calendar_scores`, `energy_profile`, `focus_milestones`, `energy_log`) in correct leaf-first order;
    removed "gap" note (self-service deletion shipped 2026-06-13); fixed "inbox-wide scan" wording in §5
    security answer; added focus recommendation demo scene (scene 7); updated last-updated date.
  - **Remaining CASA items (PM + user):** (1) Google token revocation in disconnect flow → Core lane;
    (2) demo video recorded and uploaded; (3) PM decision on separate inbox-reading consent step;
    (4) document reviewed by user before submission.
- **2026-06-14** — **Privacy plumbing — data export coverage + privacy page accuracy.**
  - `GET /api/account/export`: added `calendarScores` (all days, focus/energy scores + JSON drivers),
    `energyProfile` (peak/trough hours), `eventEnergyTags` (eventId, type, demand, taggedAt).
    Encryption assessment: none of these store credentials or health PII — same tier as tasks/priorities;
    title_hash is a SHA-derived internal key, not exportable user content (omitted from export).
  - `app/privacy/page.tsx`: Gmail section rewritten to accurately disclose inbox signal reading:
    metadata-only (sender, subject, auto-snippet — never bodies), in-memory, not stored, audit-count
    only. Previously said "reads only threads Edge created" which became false after
    `getRecentEmailSignal` landed. Limited Use section + "How We Use" updated. Date bumped to 2026-06-14.
  - `account.test.ts`: `energyProfileQueries` added to mock; new export shape assertions
    (`calendarScores`, `energyProfile`, `eventEnergyTags`). 673/673 green.
- **2026-06-14** — **`applyCalendarPlan` durability — batch idempotency + plan-level undo group.**
  - `lib/db.ts`: `calendar_plan_executions` table — `UNIQUE(user_id, plan_id)` + `INSERT OR IGNORE`
    makes plan apply idempotent (double-submit on retry/re-render silently no-ops). Tracks
    `status` (applied/reverted), `mutation_count`, `applied_at`, `reverted_at`. Index on
    `(user_id, plan_id)`. Migration: `ALTER TABLE undo_log ADD COLUMN plan_id TEXT` (idempotent).
  - `undoQueries` extended: `recordForPlan(userId, label, payload, planId)` — inserts undo entry
    with plan association; `getByPlanId(userId, planId)` — returns entries `ORDER BY id DESC`
    (most-recent-first = correct undo order); `markPlanUndone(userId, planId)` — sets `undone=1`
    on all plan entries (prevents double-undo).
  - `calendarPlanQueries` exported: `get`, `markApplied` (INSERT OR IGNORE idempotent),
    `markReverted` (UPDATE status/reverted_at). `CalendarPlanExecution` interface exported.
  - `lib/undo.ts`: `recordUndo` extended with optional `planId?` — routes to `recordForPlan`
    when present. `undoPlan(userId, planId, cal)` — executes all entries in a plan batch in
    reverse-insertion order; marks plan undone + reverted; returns `{ reverted: count }`.
  - Deletion routes: `calendar_plan_executions` added to both admin + self-service delete (leaf-first).
  - 22 new tests: `lib/calendar-plan.test.ts` (in-memory SQLite — idempotency, user isolation,
    markReverted, plan-vs-standalone); `lib/undo.test.ts` (mock-based — empty plan, reverse order,
    partial failure, markPlanUndone + markReverted side effects). 673/673 green.
  - **Core handoff:** Generate a UUID `planId` before calling any hero-loop mutations. Pass `planId`
    to `recordUndo(userId, label, ops, planId)` for each mutation. After all mutations succeed, call
    `calendarPlanQueries.markApplied(userId, planId, mutationCount)`. Check
    `calendarPlanQueries.get(userId, planId)` first — if found, it's a replay (idempotent). For undo,
    call `undoPlan(userId, planId, cal)` to revert the whole batch at once.
- **2026-06-14** — **Email signal primitive — `getRecentEmailSignal` for Focus Recommendation.**
  - `lib/gmail.ts`: `getRecentEmailSignal(userId, { days?, max? }) → EmailSignal` — fetches a
    compact digest of recent INBOX threads for Core's `recommendFocusAreas()`. Privacy-first:
    - `format:'metadata'` enforced at the API call — only headers (From, Subject, Date) and
      Gmail's own auto-truncated snippet (~100 chars) are fetched. Message bodies never requested.
    - No storage of email content — derive signal in-memory, return to caller, discard.
    - Audit log: thread count + days window only. Zero email content in the log.
    - INBOX label only; hard cap of 50 threads per call regardless of `opts.max`.
    - Scope gate: returns `{ items: [], scopeMissing: true }` gracefully when `gmail.readonly`
      not granted — caller degrades without throwing.
    - Individual thread-fetch failures swallowed via `Promise.allSettled` — partial result
      always returned instead of aborting.
  - `EmailSignalItem` interface: `{ threadId, sender, subject, snippet, date, isUnread, isImportant }`.
  - `EmailSignal` interface: `{ items, fetchedAt, scopeMissing }`. Exported from `lib/gmail.ts`.
  - `lib/gmail.test.ts`: 10 new tests (25 total) — scope gates, empty inbox, metadata mapping,
    snippet-from-list (not body), partial-failure resilience, audit entry contents, inbox-only
    filter, max-cap enforcement. All verify no body content is ever fetched/stored.
  - **⚠️ CASA FLAG documented in `specs/google-verification.md`:** `gmail.readonly` use-case
    expands from "read only watched_threads" to also "read recent INBOX metadata for AI
    prioritization." Scope itself unchanged (already in `GOOGLE_SCOPES`). Required actions before
    CASA re-submission: (1) update Privacy Policy to disclose inbox reading; (2) update §5
    questionnaire answers; (3) add focus recommendation demo scene; (4) PM decision on separate
    consent step for inbox reading.
  - 651/651 green, tsc clean, next build clean.
  - **Core handoff:** `getRecentEmailSignal(userId, { days: 14, max: 20 })` from `@/lib/gmail`.
    Returns `EmailSignal`. Pass `items` as context into the `recommendFocusAreas` LLM call.
    When `scopeMissing: true`, prompt re-consent or degrade gracefully. Nothing to store —
    the signal is ephemeral input to the LLM, same as calendar events.
- **2026-06-14** — **Event energy tag cache — `event_energy_tags` table (additive).**
  - `lib/db.ts`: `event_energy_tags (id, user_id, google_event_id, type, demand CHECK('high','med','low'),
    title_hash, tagged_at)`. UNIQUE(user_id, google_event_id) + upsert-on-conflict. Index on
    `(user_id, google_event_id)`. `title_hash` enables automatic cache invalidation when an event is renamed.
  - `eventEnergyTagQueries` exported: `get(userId, eventId)`, `upsert(userId, eventId, {type, demand,
    titleHash})`, `getMany(userId, eventIds[])` (batch lookup; empty input → empty array).
  - `EventEnergyTag` interface exported.
  - Table added to admin + self-service deletion routes (leaf-first FK order).
  - `lib/event-energy-tags.test.ts`: 10 in-memory integration tests — get/miss, upsert overwrite, cross-user
    isolation, getMany partial hits + user scoping.
  - 591/591 green, tsc clean, next build clean.
  - **Core handoff:** `eventEnergyTagQueries` live from `@/lib/db`. Call `getMany(userId, eventIds)` to
    batch-read cached tags before scoring; `upsert(userId, eventId, {type, demand, titleHash})` to write
    after LLM classifies. Compare `title_hash` (e.g. `sha256(title).slice(0,8)`) on read — if mismatched,
    re-classify and upsert the new tag.
- **2026-06-14** — **Calendar scoring engine schema — `calendar_scores` + `energy_profile` tables (additive).**
  - `lib/db.ts`: `calendar_scores (id, user_id, date, focus_score, energy_score, focus_drivers TEXT/json,
    energy_drivers TEXT/json, created_at)`. UNIQUE(user_id, date) + upsert-on-conflict. Index on
    `(user_id, date)`. Stores daily Focus + Energy scores (1–10) with JSON driver arrays for explanation UI.
  - `calendarScoreQueries` exported: `upsert(userId, date, {focusScore, energyScore, focusDrivers,
    energyDrivers})`, `getRange(userId, fromDate, toDate)`, `getLatest(userId)`. All user-scoped.
  - `CalendarScore` interface exported.
  - `lib/db.ts`: `energy_profile (user_id PK, peak_start, peak_end, trough_start, trough_end, updated_at)`.
    One row per user (PK = user_id); upsert via `ON CONFLICT(user_id) DO UPDATE SET …`. Stores the user's
    stated energy windows as integer hours (0–23) for the Energy Score engine.
  - `energyProfileQueries` exported: `get(userId)`, `upsert(userId, {peakStart, peakEnd, troughStart,
    troughEnd})`. User-scoped (PK enforces isolation).
  - `EnergyProfile` interface exported.
  - Both tables added to admin + self-service deletion routes (leaf-first FK order).
  - `lib/calendar-scores.test.ts`: 11 in-memory integration tests — upsert semantics, getLatest ordering,
    getRange bounds + user isolation, energy profile CRUD + upsert overwrite + cross-user isolation.
  - 581/581 green, tsc clean, next build clean.
  - **Core handoff:** `calendarScoreQueries` + `energyProfileQueries` are live from `@/lib/db`. Wire into
    `lib/calendarScore.ts` (scoring engine) — call `calendarScoreQueries.upsert` to persist each day's
    score, and `energyProfileQueries.get` to read peak/trough for the Energy Score input.
- **2026-06-14** — **Focus Scoreboard schema — `focus_milestones` table (additive).**
  - `lib/db.ts`: `focus_milestones (id, user_id, priority_id, title, done, sort_order,
    created_at, completed_at)`. FK to `priorities(id)`. Index on `(user_id, priority_id)`.
    `CREATE TABLE IF NOT EXISTS` — additive, idempotent.
  - `focusMilestoneQueries` exported: `listForUser(userId)`, `listForPriority(userId, priorityId)`,
    `create(userId, priorityId, title)`, `setDone(id, userId, done)` (manages `completed_at`
    automatically), `remove(id, userId)`. All queries filter by `user_id` — security invariant.
  - `FocusMilestone` interface exported.
  - `focus_milestones` added to admin + self-service deletion routes (leaf-first FK order).
  - `lib/focus-milestones.test.ts`: 12 in-memory integration tests — CRUD, done lifecycle
    (completed_at set/cleared), user isolation (wrong userId = no-op on setDone/remove),
    cross-priority filtering. 555/555 green, tsc clean, next build clean.
  - **Core handoff:** `focusMilestoneQueries` is live from `@/lib/db`. Wire into
    `GET/POST /api/priorities/[id]/milestones` + dashboard Focus Scoreboard.
- **2026-06-14** — **Energy OS schema — `energy_log` table (additive).**
  - `lib/db.ts`: `energy_log` table — `(user_id, date, level, source, created_at)`, unique on
    `(user_id, date)` (one record per user per day). `level` CHECK `('red','yellow','green')`;
    `source` CHECK `('whoop','manual','override')`. Index on `(user_id, date)`.
  - `energyLogQueries.getForDate(userId, date)` — returns today's energy record or `undefined`.
  - `energyLogQueries.setEnergy(userId, date, level, source)` — upserts via `INSERT OR REPLACE`.
    Callers pass the user's local YYYY-MM-DD date. Override source wins over Whoop tier (per spec).
  - `EnergyLog` interface exported from `lib/db.ts`.
  - `energy_log` rows added to both admin + self-service user-deletion routes; included in data export.
  - 9 new in-memory integration tests covering: basic CRUD, upsert (one row per user-date after N
    writes), cross-date isolation, cross-user isolation. 522/522 green, tsc clean, next build clean.
  - **Core action items:** consume `energyLogQueries` from `lib/briefing.ts` (derive from Whoop
    recovery tier + store as 'whoop'), from `vapi.ts` call handler (ask/store 'manual', store
    override as 'override'), and from a new `GET/POST /api/energy` dashboard quick-set endpoint.
- **2026-06-13** — **Data export + self-service account deletion (GDPR / Google CASA launch requirement).**
  - `GET /api/account/export` — user-scoped, returns a full JSON download of all user data:
    profile (no password_hash), priorities, memories, facts, tasks, briefings (with decrypted
    transcript/user_response), and email draft history (recipient/subject decrypted). Sets
    `Content-Disposition: attachment` so browsers download the file. 10000-row cap on
    briefings/memories (ample for any real user at launch).
  - `DELETE /api/account` — user-scoped, irreversible self-service deletion. Requires body
    `{ "confirm": "delete my account" }` (explicit contract for Core's UI — 400 without it).
    Deletes all 16 tables in FK-safe order (same coverage as admin route: whoop_tokens,
    calendar_tokens, gmail_drafts_log, watched_threads, notifications, audit_log, facts,
    briefings, preview_briefings, memories, priorities, tasks, undo_log, event_dedupe_keys,
    delete_confirm_tokens, users). Clears the session cookie on success.
  - `lib/db.ts`: `Briefing` interface completed (was missing `retry_attempted`,
    `calendar_actions`, `edge_promises`, `tool_actions` fields).
  - 15 new tests (auth guards, response shape, confirm contract, deletion coverage,
    cookie clearing). 490/490 green, tsc clean, next build clean.
  - **Core action items:** wire "Export my data" link → `GET /api/account/export` and
    "Delete account" confirmation flow → `DELETE /api/account` (with the exact phrase UI).
    Also add Google token revocation call in `lib/calendar.ts` disconnect (CASA requirement).
- **2026-06-13** — **Call reliability: idempotency guard + error_code persistence + call-status endpoint.**
  - `lib/db.ts`: `briefings` table gains `error_code TEXT` column (migration + `ALLOWED_FIELDS`
    + `Briefing` interface + `briefingQueries.getTodayForUser(userId, datePrefix)` helper).
  - `lib/scheduler.ts`:
    - `CallError.code` extended with `'already_called'`.
    - `getTodayCallStatus(userId)` — exported query wrapper returning today's briefing status
      in the user's local timezone; used by the status endpoint.
    - `triggerBriefingCallNow(userId)` — exported safe re-trigger; catches `CallError` and
      returns `{ ok: false, code, message }` instead of throwing (Core can call this from the
      "I didn't get my call" button without try/catch boilerplate).
    - Idempotency guard inside `scheduleBriefingCall`: checks for an existing
      `calling`/`completed` briefing for today before creating a new record — throws
      `CallError('already_called')` so the on-demand path can't double-fire.
    - Both Vapi error catch blocks now persist `error_code` alongside `status: 'failed'`
      so the dashboard can surface WHY a call failed.
  - `app/api/vapi/call-status/route.ts` (new): `GET` endpoint, user-scoped. Returns
    `{ status, errorCode, briefingId, scheduledFor }` for today's call or
    `{ status: 'none', ... }` when no briefing exists. Core reads this for the
    "Call me now" button state and error messaging.
  - 10 new tests (idempotency guard × 4, `triggerBriefingCallNow` × 4, error_code
    persistence × 1, existing assertions updated to `objectContaining`). 475/475 green,
    tsc clean, next build clean.
- **2026-06-13** — **At-rest encryption verification + user deletion completeness + Google CASA prep.**
  - `lib/db-encryption.test.ts` (11 tests): integration proof that ciphertext is
    stored on disk for `calendar_tokens` (access+refresh), `whoop_tokens`
    (access+refresh), and `briefings` (transcript+user_response). Each test writes
    via the normal query helper, reads raw SQLite bytes and asserts `enc:1:` prefix,
    then reads via the normal get path and asserts plaintext round-trip. Also verifies
    no-key degradation (plaintext stored transparently). 452/452 green.
  - `app/api/admin/users/[id]/route.ts`: user deletion was missing 9 tables.
    Added `whoop_tokens` (health PII — critical), `gmail_drafts_log`,
    `watched_threads`, `notifications`, `audit_log`, `facts`, `preview_briefings`,
    `undo_log`, `event_dedupe_keys`, `delete_confirm_tokens`. All user data is now
    fully purged on account deletion.
  - `specs/google-verification.md`: Google CASA prep document — scope inventory
    (calendar.readonly, calendar.events, gmail.compose, gmail.readonly) with
    justifications and code pointers; data handling + storage table; security
    controls summary; retention/deletion policy; draft Google security questionnaire
    answers; demo video shot-list (7 scenes); CASA process notes and pre-submission
    checklist. Two action items surfaced: (a) self-service `DELETE /api/account`
    endpoint needed before CASA (currently admin-only); (b) Google token revocation
    call missing from disconnect flow (Core lane).
- **2026-06-13** — **Whoop history fetch primitive.**
  Added `getRecoveryHistory(userId, days=14)`, `getSleepHistory(userId, days=14)`,
  `getStrainHistory(userId, days=14)` to `lib/whoop.ts`. Each uses the WHOOP v2
  date-range `start` param + `limit=25` and follows `next_token` pagination via a
  new `whoopGetAll` helper (max 50 records). Returns `{ date, recoveryScore | durationMs | strain }[]`
  sorted oldest-first; naps filtered from sleep history; PENDING_SCORE records dropped.
  Caches per user (1h TTL, consistent with point-in-time fns). Degrades to `[]` on
  any failure — never throws. Raw record types extended with `created_at?` (recovery)
  and `start?` (sleep, cycle). New public exports: `WhoopRecoveryDay`, `WhoopSleepDay`,
  `WhoopStrainDay`. 20 new tests (IDs 300–317). 391/391 green, tsc clean, next build clean.
  🤝 **For Core:** import `getRecoveryHistory`, `getSleepHistory`, `getStrainHistory`
  from `lib/whoop.ts` — all return `[]` when Whoop is not connected, so safe to call
  unconditionally.
- **2026-06-13** — **Litestream restore drill + encryption ops-readiness.**
  Ticket 1: `scripts/restore-drill.sh` — standalone shell script that downloads
  Litestream, runs `litestream restore` to a temp path, verifies the restored DB
  with `better-sqlite3` (`PRAGMA integrity_check` + row counts on key tables), and
  exits 0/1 with a clear PASS/FAIL summary. Documented in `LAUNCH.md` §10 (restore
  drill log, how-to, PITR manual-restore command). Ticket 2: `lib/healthCheck.ts`
  — `runHealthChecks()` asserts 5 launch-critical conditions: `DATA_ENCRYPTION_KEY`
  (critical), `JWT_SECRET` (critical), DB connectivity (critical), Litestream S3
  replication (high), `VAPI_SECRET_ENFORCE` (high). Returns `status: ok | degraded
  | critical` + per-check detail. New admin endpoint `GET /api/admin/health` wraps
  it (HTTP 503 on critical). Logs `console.warn` on any failure so Railway log
  surfaces it. `LAUNCH.md` §9 (encryption ops: key generation, STRICT_ENCRYPTION
  rollout, how to verify), §2 env-var table updated (WHOOP_, LITESTREAM_, STRICT_
  ENCRYPTION). 8 new tests. 338/338 green.
  🤝 **For PM:** After setting `DATA_ENCRYPTION_KEY` + `STRICT_ENCRYPTION=1` on Railway,
  hit `GET /api/admin/health` (admin cookie) to confirm. After setting `LITESTREAM_S3_*`,
  run `sh scripts/restore-drill.sh` from the Railway shell and record the result in
  LAUNCH.md §10 restore drill log.
- **2026-06-13** — **Whoop OAuth integration — foundation layer.**
  New `whoop_tokens` table in `lib/db.ts` (encrypted at rest — health data PII; same
  `encryptField`/`decryptField` pattern as `calendar_tokens`). `whoopQueries`: `upsert`,
  `get` (decrypt-on-read), `delete`. New `lib/whoop.ts`: `getAuthUrl(userId)`,
  `exchangeCode(code)`, `refreshAccessToken` (auto-refresh 5 min before expiry),
  `getLatestRecovery(userId)` → `{ recoveryScore, hrv, restingHeartRate }`,
  `getLastSleep(userId)` → `{ durationMs, performancePct, efficiencyPct }` (naps
  skipped), `getRecentStrain(userId)` → `{ strain, avgHeartRate }`, `hasWhoopConnected`.
  All public fetch fns degrade to `null` when `WHOOP_CLIENT_ID`/`WHOOP_CLIENT_SECRET`
  unset or on any network failure. 1-hour in-memory cache per user (daily briefing pull).
  Routes: `/api/whoop/connect` (start OAuth, sets backup uid cookie), `/api/whoop/callback`
  (exactly `https://edg3.ai/api/whoop/callback` — matches Whoop dev-app redirect URI),
  `/api/whoop/disconnect`, `/api/whoop/status`. 21 new tests. 311/311 green. tsc + next
  build clean.
  🤝 **For Core:** consume `getLatestRecovery`, `getLastSleep`, `getRecentStrain` from
  `@/lib/whoop` in `lib/briefing.ts`. All return `null` when disconnected/unscored —
  safe to skip. `hasWhoopConnected(userId)` for the dashboard "Connect Whoop" button.
  **Env needed on Railway:** `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET` (user is creating
  the Whoop dev app; PM will set these).
- **2026-06-11** — **[CRITICAL] Surface Vapi/briefing failures — "Call me now" no longer fails opaquely.**
  `scheduleBriefingCall` and `scheduleOpenCall` previously awaited `initiateCall` and
  `generateDailyBriefing` with no try/catch — any Vapi rejection (e.g. free-tier daily
  cap) threw an unhandled 500 with no information for the dashboard. Fix: new `CallError`
  class with `userMessage` + `code` (`vapi_daily_limit` / `vapi_error` /
  `briefing_gen_failed`); `classifyVapiError()` detects the daily-limit string vs generic
  failures. Both scheduler functions now catch Vapi errors → set briefing to `'failed'` →
  throw `CallError`. Briefing gen failure is separately guarded. Routes
  (`/api/briefing/call`, `/api/briefing/open-call`) return HTTP 503 with
  `{ error, code }` so the dashboard can tell "daily cap" from "broken". 7 new tests for
  CallError + 7 catch-up window tests retained. 290/290 green.
- **2026-06-11** — **[CRITICAL] Scheduler catch-up window — missed morning calls fixed.**
  Root cause: `checkAndInitiateCalls` matched the call tick by exact minute
  (`userCurrentTime !== user.call_time`) — any server restart during that minute
  caused a silent miss with no retry. Fix: replaced exact-match with a 120-minute
  catch-up window (`userMinutes >= callMinutes && userMinutes < callMinutes + 120`).
  The existing once-daily dedupe (check for `calling`/`completed` briefing today)
  prevents double-firing within the window. `checkAndInitiateCalls` exported with
  injectable `now: Date` for deterministic testing. 7 new tests covering: fires at
  call_time, fires after missed tick, doesn't fire before call_time, doesn't fire
  past grace window, doesn't double-fire, multiple ticks = one call, fires at last
  minute of window. 283/283 green.
- **2026-06-10** — **[LOW-MED] rateLimit loud-fail + crypto strict-mode.** (a) `checkRateLimit`
  catch now logs loudly via `console.error` — a silent fault was erasing brute-force
  protection with no observable signal. (b) `encryptField` in `lib/crypto.ts` supports
  `STRICT_ENCRYPTION=1`: throws instead of silently passing plaintext when
  `DATA_ENCRYPTION_KEY` is unset — prevents misconfigured deploys from persisting
  plaintext PII. Health signal: `/api/admin/backup` GET already exposes `encryptionEnabled`.
  3 new tests; 172/172 green.
- **2026-06-10** — **[MEDIUM] Fixed XFF rate-limit bypass in `getClientIP`.** The old
  `split(',')[0]` (leftmost hop) was fully client-controlled — an attacker could send a
  random `X-Forwarded-For` per request and get a fresh rate-limit bucket every time,
  defeating brute-force protection on login/signup. Fix: take the rightmost hop instead
  (Railway's load balancer appends the IP it observed, so the rightmost entry is
  proxy-verified). 2 new tests (rightmost-wins + spoofed-leftmost rejected). 169/169 green.
- **2026-06-10** — **[HIGH] Fixed admin auth bypass on CoS-agent routes.** Two routes
  (`app/api/admin/calendar/events`, `app/api/admin/latest-briefing`) used a local
  `checkAuth()` with `===` — the exact timing side-channel `timingSafeEqual` was added
  to kill. Both had no rate limiting. Fix: new `checkAdminSecretAuth(req)` in
  `lib/adminAuth.ts` (timingSafeEqual on `ADMIN_SECRET`/`x-admin-secret` header);
  new `adminApi` bucket in `lib/rateLimit.ts` (60/min); both routes now use the shared
  helpers. 6 new tests. 167/167 green.
- **2026-06-10** — **Gmail READ access code-complete** (was already implemented;
  added missing test coverage). `readThread(userId, threadId)` in `lib/gmail.ts` with
  `hasGmailReadScope` scope gate, `GMAIL_READONLY_SCOPE` in `lib/google-auth.ts`,
  `GOOGLE_SCOPES` includes both compose + readonly. `watched_threads` table +
  `watchedThreadQueries` in `lib/db.ts`. 10 new tests for `readThread` +
  `hasGmailReadScope` + snippet-fallback behavior. 160/160 green.
  ⚠️ **Prod landmine:** `gmail.readonly` is a Google *restricted* scope → needs
  Google app verification + CASA before prod rollout. Same queue as `gmail.compose`.
  🤝 **For Core:** `readThread(userId, threadId)` is the guarded primitive. Import from
  `@/lib/gmail`. Pass only `threadId`s from `watched_threads` (threads Edge created).
- **2026-06-10** — Shipped **#7 Harden audit log**. New append-only `audit_log` table
  in `lib/db.ts` (no row cap — unlike `briefings.tool_actions` which was capped at 50;
  90-day retention with ~1% prune on each insert). Columns: `user_id`, `briefing_id`
  (null = web), `action`, `args_json`, `result_text`, `ok`, `snapshot_before`,
  `snapshot_after`, `created_at`. Index on `(user_id, created_at DESC)`. New
  `auditLogQueries`: `record()` (never throws), `recent(userId, limit)` (Core's
  dashboard feed), `recentAll(limit)` (admin panel), `successCount(userId, days)`.
  Wired into `tool-call/route.ts` (every voice tool call — alongside the legacy
  `tool_actions` JSON blob for backward compat) and `book/route.ts` (web "Book it"
  path). Admin endpoint `/api/admin/audit` (GET with userId/limit/action/failures
  filters). `AuditEntry` + `AuditRow` types exported for Core's dashboard queries.
  16 new tests; preflight green (150/150, tsc, next build).
  🤝 **For Core:** `auditLogQueries.recent(userId, limit)` is the data source for the
  "Recent Activity" feed. Import from `@/lib/db`. The `snapshot_before`/`snapshot_after`
  fields are null for now — a future pass will populate them as handlers capture
  pre/post calendar state.
- **2026-06-10** — Shipped **#10 Harden admin auth**. Two fixes: (1) `edg3_admin`
  cookie now stores `HMAC-SHA256(ADMIN_PASSWORD, "edg3-admin-session-v1")` — a
  derived token — instead of the raw password; cookie leak no longer exposes the
  secret. (2) All password/cookie comparisons use `crypto.timingSafeEqual` —
  constant-time compare prevents timing side-channels. New `lib/adminAuth.ts`:
  `checkAdminAuth(req)`, `verifyAdminPassword(submitted)`, `getAdminCookieToken()`.
  All 11 admin routes migrated from inline `checkAdminAuth` / async `checkAdmin`
  stubs to the shared utility (removes ~60 lines of duplicated code). Admin login
  also wired into existing rate-limiter (#8 missed it). 15 new tests; preflight
  green (134/134, tsc, next build). Note: existing admin sessions (old cookie format)
  are invalidated — admin must re-login after deploy.
- **2026-06-10** — Shipped **#8 Rate limiting** on auth + admin endpoints. New
  `lib/rateLimit.ts`: `checkRateLimit(type, ip)` (fixed-window counter via
  `rate_limits` SQLite table, atomic transaction, fails open on fault),
  `getClientIP()` (prefers `x-forwarded-for` for Railway proxy), `rateLimitResponse()`
  (429 + `Retry-After` / `X-RateLimit-Reset` headers). Limits: `login` 10/15min,
  `signup` 5/hr, `triggerCall` 3/5min. Wired into `auth/login`, `auth/signup`,
  `admin/trigger-call`. `rate_limits` table + `rateLimitQueries.check()` in db.ts.
  12 new tests; preflight green (117/117, tsc, next build).
- **2026-06-10** — Shipped **#5 off-box durability (Litestream)**. `litestream.yml`:
  S3-compatible replication (72h WAL retention, 6h full snapshots, 1s sync interval,
  configurable endpoint for B2/R2/MinIO). `scripts/start.sh`: conditional wrapper —
  active only when `LITESTREAM_S3_BUCKET` is set; auto-restores DB on fresh volume;
  falls back to plain start on download failure (never blocks the app). `railway.toml`
  start command updated. `lib/backup.ts`: `verifyBackup(file)` opens snapshot read-only
  (separate connection, never touching live DB), runs `PRAGMA integrity_check`, returns
  row counts for key tables — supports restore drill without downtime. `litstreamEnabled()`
  for admin UI. Admin backup endpoint: GET exposes `litstreamEnabled`; POST supports
  `{ action: 'verify' }` to run the drill in-process. 105/105 preflight green.
  ⚠️ **Ops:** set S3 env vars + redeploy + run the restore drill (see #5 checklist).
- **2026-06-10** — Shipped **#2 Vapi secret enforcement (code side)**. The two-stage
  gate (`checkVapiSecret`) was already implemented; added observability to make the
  24h fail-open window actionable. New `vapi_auth_log` table + `vapiAuthLogQueries`
  persist every mismatch event (accepted calls not logged — low noise). New admin
  endpoint `/api/admin/vapi-secret`: returns `enforceMode`, `secretSet`,
  `mismatches24h` (24h window), `readyToEnforce` flag, and last 50 events. Wired into
  both `webhook` and `tool-call` routes. New `lib/vapi.test.ts` (10 tests for all 4
  `checkVapiSecret` states). preflight green (105/105, tsc, next build).
  ⚠️ **Ops follow-up:** set `VAPI_SERVER_SECRET` on Railway → monitor
  `/api/admin/vapi-secret` for 24h (confirm `readyToEnforce: true`) → set
  `VAPI_SECRET_ENFORCE=true` → redeploy.
- **2026-06-10** — Shipped **#9 Hard delete-confirmation** (server-issued one-time token).
  Replaces the `confirmed=true` boolean (which the model could self-set) with a
  `confirmToken` that the server generates and the model must present back verbatim.
  `delete_confirm_tokens` table (2-min TTL, `consume()` is atomic transaction, single-use).
  `issueDeleteToken`/`consumeDeleteToken` in `lib/idempotency.ts`. `deleteEvent` handler
  updated; `consumeDeleteToken` fails CLOSED (false on any DB fault). System prompt
  instruction in `lib/vapi.ts` updated. 7 new tests; preflight green (95/95, tsc, next build).
  ⚠️ **Ops follow-up:** update the `deleteEvent` Vapi tool schema in the dashboard — add
  `confirmToken: string` (optional), remove `confirmed: boolean`.
- **2026-06-10** — Shipped **#3 Event-creation idempotency** (both creation paths). New
  `lib/idempotency.ts`: `claimEventCreate(userId, key)` + `buildEventDedupeKey(title, start)`.
  New `event_dedupe_keys` SQLite table (5-min TTL, atomic `INSERT OR IGNORE`, composite PK).
  Guards: voice `createEvent` (timed + all-day), `createRecurringEvent`, `copyDayEvents` in
  `tool-call/route.ts`; web "Book it" in `app/api/calendar/book/route.ts`. Fails open — a DB
  fault never blocks a real write. 10 new tests; full suite 71/71, tsc clean.
- **2026-06-09** — Shipped **★ Gmail draft-only access primitive + scope + undo op**
  (gates Core's email feature). Per PM ownership ruling, `lib/gmail.ts` +
  `lib/google-auth.ts` are Security's guarded primitive; Core's `lib/outreach.ts`
  composes and calls it. Delivered: `lib/google-auth.ts` (scope authority incl.
  `gmail.compose` + `hasGmailScope`/`missingRequiredScopes`); `lib/gmail.ts`
  `createDraft(userId, {to,subject,body})` with built-in scope gate (`GmailScopeError`),
  per-user hourly rate limit (`GMAIL_DRAFTS_PER_HOUR` → `GmailRateLimitError`), and
  append-only `gmail_drafts_log` audit (recipient/subject encrypted at rest) — exposes
  only `drafts.create`/`drafts.delete`, never `messages.send`; plus `deleteDraft` +
  `userHasGmailScope`. `calendar_tokens.scope` persisted (re-consent detection);
  `lib/calendar.ts` requests the scope + `include_granted_scopes`; new **`deleteDraft`
  UndoOp** in `lib/undo.ts` → Security's `deleteDraft`. **Core wiring:** `createDraft(
  userId, { to: recipient.email, subject, body })` then record `deleteDraft` undo.
  ⚠️ Prod landmine: `gmail.compose` is a Google restricted scope (verification + CASA)
  before rollout beyond the owner dogfooding via the unverified-app path.
- **2026-06-09** — Shipped **#4 Data-at-rest encryption** + **#5 code-side
  durability** (commit `80b4d30`). `lib/crypto.ts`: AES-256-GCM field encryption,
  transparent + backward-compatible (legacy plaintext passes through; no-op until
  `DATA_ENCRYPTION_KEY` is set → fail-safe rollout, lazy re-encrypt on next write;
  8/8 unit tests green). Wired in `lib/db.ts` to encrypt `calendar_tokens`
  (access/refresh) **and** `briefings` PII (`transcript`, `user_response`) on write,
  decrypt on read; read sites (admin briefings, verify-promises, webhook) decrypt
  via `decryptBriefingRow`. `lib/backup.ts`: online `.backup()` SQLite snapshots w/
  rotation + opportunistic `maybeDailyBackup()`; admin-gated `app/api/admin/backup`.
  H1 ✅, Transcript-PII ✅. **Ops follow-up:** set `DATA_ENCRYPTION_KEY` on Railway
  (until then encryption no-ops); off-box replication (Litestream) for volume-loss
  is the remaining ops half of #5.
- **2026-06-09** — Shipped **#6 Undo** (commit `28f364d`): every mutation records
  inverse ops in a new `undo_log`; reversible by voice (`undoLastAction`) and
  dashboard. H3 now ✅. Defused **#1 JWT fallback** in code (`lib/auth.ts` fails
  closed — throws if `JWT_SECRET` unset, no public default). **Ops follow-up
  still open:** rotate `JWT_SECRET` on Railway (invalidates existing sessions).
- **2026-06-09** — Roadmap re-derived from a verified code audit (not the
  spreadsheet). Re-ranked around trust + cost-to-fix. Added the JWT fallback
  landmine as the new #1 (previously unlisted). Confirmed H6 done, C2 mitigated,
  M4 mostly handled.

---

## How priorities are ranked
By (a) armed landmines that are cheap to defuse, (b) highest-frequency real
user-trust failure, then (c) genuine gaps. Effort is rough dev-days.

## Verified status of prior audit findings
| ID | Item | Verified state |
|----|------|----------------|
| C1 | Vapi webhook auth | ✅ Code done (#2) — `checkVapiSecret` two-stage rollout: fail-open with persisted mismatch log (Stage A), then `VAPI_SECRET_ENFORCE=true` to reject (Stage B). Admin endpoint `/api/admin/vapi-secret` shows 24h mismatch count + `readyToEnforce` flag. ⚠️ **Ops:** set `VAPI_SERVER_SECRET` on Railway, watch mismatches24h for 24h, then set `VAPI_SECRET_ENFORCE=true`. |
| C2 | Unauthorized/cross-user mutation | ✅ Mitigated — user is bound server-side via `call.id → briefing.user_id`. Model can't pick the user. |
| C3 | Idempotency on writes | ✅ Done — `lib/idempotency.ts` `claimEventCreate` + 5-min `event_dedupe_keys` table. Guards `createEvent` (timed + all-day), `createRecurringEvent`, `copyDayEvents` (voice) and `book/route.ts` (web "Book it"). Fails open so DB fault never blocks a real write. |
| H1 | Token encryption | ✅ Done (`80b4d30`) — `calendar_tokens` encrypted at rest (AES-256-GCM via `lib/crypto.ts`); transparent legacy read. _Ops: set `DATA_ENCRYPTION_KEY` on Railway to activate._ |
| H2 | Action audit log | ✅ Done (#7) — new append-only `audit_log` table (no cap; 90-day retention; `snapshot_before`/`snapshot_after` columns). Wired into both voice (`tool-call/route.ts`) and web (`book/route.ts`). `auditLogQueries.recent(userId)` exported for Core's dashboard. Legacy `tool_actions` kept in parallel for backward compat until Core migrates. Admin endpoint `/api/admin/audit`. |
| H3 | Undo last action | ✅ Done (`28f364d`) — `undo_log` records inverse ops on every mutation; reversible via `undoLastAction` (voice) + dashboard banner. |
| H4 | Rate limiting | ✅ Done (#8) — `lib/rateLimit.ts` + `rate_limits` table. Fixed-window counters: login 10/15min, signup 5/hr, trigger-call 3/5min. Fails open on DB fault. |
| H5 | Backups / PITR | ✅ Fully code-complete — on-volume snapshots (`80b4d30`) + off-box Litestream (`litestream.yml`, `scripts/start.sh`). `verifyBackup()` for restore drills. ⚠️ Ops: set S3 env vars on Railway + run restore drill (see #5 in 30-Day plan). |
| H6 | Destructive confirmation | ✅ Done + hardened (#9) — server-issued one-time `confirmToken` closes model self-confirmation hole. Model must present a server-issued token; `confirmed=true` shortcut removed. |
| M4 | Timezone/recurring | ✅ Mostly handled — IANA passed + validated everywhere. |
| — | **JWT fallback secret** | ✅ Fixed in code — `lib/auth.ts` fails closed (throws if `JWT_SECRET` unset, no public default). ⚠️ **Ops:** still rotate the secret on Railway. |
| — | Transcript PII | ✅ Done (`80b4d30`) — `briefings.transcript` + `user_response` encrypted at rest (same `lib/crypto.ts` path). |
| — | Retry reliability | ⚠️ `retryCall` uses in-process `setTimeout(10m)` — lost on deploy/restart. |

---

## 30-Day plan

### Week 1 — Defuse landmines (cheap, catastrophic if left)
- [x] **1. Remove JWT fallback** → code fails closed (throws if `JWT_SECRET` unset). _Ops follow-up: rotate the secret on Railway._ _½d_
- [x] **2. Enforce Vapi secret** — code-side two-stage gate already implemented + now observable. Added persisted `vapi_auth_log` table + `vapiAuthLogQueries` + admin endpoint `/api/admin/vapi-secret` (shows `secretSet`, `enforceMode`, `mismatches24h`, `readyToEnforce`). 10 unit tests for `checkVapiSecret`. ⚠️ **Ops (still needed):** (1) set `VAPI_SERVER_SECRET` on Railway to match the Vapi dashboard secret, (2) watch `/api/admin/vapi-secret` for 24h — confirm `mismatches24h=0`, (3) set `VAPI_SECRET_ENFORCE=true` on Railway + redeploy.
- [x] **3. Idempotency** on `createEvent` / `createRecurringEvent` / `copyDayEvents` — 5-min TTL dedupe key per (user, normalized-title, start-minute). Guards both voice (tool-call) and web (book/route.ts) creation paths. Additive — fails open. _1d_

### Week 2 — Protect data at rest
- [x] **4. Encrypt** `calendar_tokens` **and** `transcripts` — done (`80b4d30`): AES-256-GCM
  field encryption (`lib/crypto.ts`), transparent/backward-compatible, no-op until
  `DATA_ENCRYPTION_KEY` set. _Ops follow-up: set the key on Railway to activate._ _2–3d_
- [x] **5. SQLite durability** — fully code-complete. On-volume snapshots done (`80b4d30`).
  Off-box now wired: `litestream.yml` (S3 config, 72h retention, 6h snapshots),
  `scripts/start.sh` (conditional Litestream wrapper — active when `LITESTREAM_S3_BUCKET`
  set, plain start otherwise), `railway.toml` updated to `sh scripts/start.sh`.
  Auto-restore on fresh volume (missing DB → `litestream restore` before app boots).
  `lib/backup.ts` + `verifyBackup()` (read-only snapshot integrity_check + row counts),
  `litstreamEnabled()`. Admin endpoint enhanced: GET shows `litstreamEnabled`;
  POST `{ action: 'verify', file }` runs the drill in-process.
  ⚠️ **Ops follow-up (to complete the restore drill):**
  (1) Set `LITESTREAM_S3_BUCKET`, `LITESTREAM_S3_ACCESS_KEY_ID`,
      `LITESTREAM_S3_SECRET_ACCESS_KEY` on Railway.
  (2) Redeploy → confirm Litestream logs `[start] Starting Litestream replication`.
  (3) POST `/api/admin/backup` `{ action: 'backup' }` → then
      POST `{ action: 'verify', file: '<snapshot>' }` → confirm `valid: true`.
  (4) Simulate volume loss (or use Railway shell): rename DB → redeploy → verify app
      restores from S3 and row counts match.

### Week 3 — Finish half-built trust features
- [x] **6. Wire the undo_log** — done (`28f364d`): inverse ops recorded on every mutation; "undo last action" in dashboard + voice. _1.5–2d_
- [x] **7. Harden audit log** — append-only `audit_log` table (no cap; 90-day retention). Columns incl. `snapshot_before`/`snapshot_after` (null today; future pass populates). Wired into `tool-call/route.ts` (voice) + `book/route.ts` (web). Admin endpoint `/api/admin/audit`. `auditLogQueries.recent(userId)` exported for Core's dashboard feed. 16 tests.
  - 🤝 **For Core:** import `auditLogQueries` from `@/lib/db`. `recent(userId, limit)` is the data source for "Recent Activity".

### Week 4 — Abuse + correctness hardening
- [x] **8. Rate-limit** auth/signup + admin trigger-call. `lib/rateLimit.ts`: `checkRateLimit(type, ip)` + `rateLimitResponse()`. `rate_limits` SQLite table (fixed-window, self-expiring, atomic transaction). Wired: login (10/15min), signup (5/hr), trigger-call (3/5min). 12 tests. preflight green.
- [x] **9. Hard delete-confirm** — server-issued one-time `confirmToken` replaces `confirmed=true`; model must present the server's token. `delete_confirm_tokens` table (2-min TTL, single-use, consume is a transaction). System prompt updated. ⚠️ Ops: add `confirmToken: string` to the `deleteEvent` Vapi tool schema in the dashboard and remove `confirmed`. _½d_
- [x] **10. Harden admin auth** — new `lib/adminAuth.ts`: HMAC-derived cookie token (never stores raw password), `timingSafeEqual` throughout, all 11 admin routes migrated to shared utility, admin login rate-limited. 15 tests.

### Incoming from PM (coordinate with Core)
- [x] **★ TOP PRIORITY (2026-06-10): Gmail READ access for reply tracking (scope + guarded thread read)** — _gates Core's email-reply tracking feature (`ROADMAP-CORE.md`)._
  - **Scope:** add `gmail.readonly` to the OAuth scopes (alongside the existing `gmail.compose`) in `lib/google-auth.ts`. Re-consent flow: detect the missing read scope (extend `missingRequiredScopes`) and prompt re-auth. ⚠️ `gmail.readonly` is **broad** (reads all mail) — there is no "only my threads" Gmail scope, so the **privacy guardrail is in our code**: Core only ever passes `threadId`s that Edge itself created. State this clearly in the consent/settings copy.
  - **Guarded primitive Core calls:** `readThread(userId, threadId)` in `lib/gmail.ts` → returns that thread's messages (from, date, snippet/body), **read-only**. Same OAuth client/token; add audit logging + a per-user rate limit; never expose a broad inbox-list call to Core.
  - **Extend `createDraft`** to also return `threadId` (currently `{draftId, messageId}`) so Core can register the watched thread.
  - **Schema:** `watched_threads` table (Shared `lib/db.ts`) — coordinate with Core on columns (threadId, userId, context, last_seen, status).
  - ⚠️ **Production landmine:** `gmail.readonly` is a Google **restricted** scope → another **verification + CASA** round (same as `gmail.compose`). Bundle with the existing verification effort; flag to PM.
  - **Effort ~2d.** Deliver scope + `readThread` + `createDraft` threadId, then PM green-lights Core.

- [x] **★ TOP PRIORITY: Gmail access for draft-only email (scope + guardrails)** — **Security side DELIVERED** (per PM ownership ruling: `lib/gmail.ts` + `lib/google-auth.ts` are Security's guarded access primitive; Core's `lib/outreach.ts` composes and calls `createDraft`).
  - ✅ **Scope:** `gmail.compose` via new **`lib/google-auth.ts`** (scope authority + `hasGmailScope`/`missingRequiredScopes`). Scope string matches the consent screen: `https://www.googleapis.com/auth/gmail.compose`. `lib/calendar.ts` sources scopes from it + requests `include_granted_scopes` so calendar-only users re-consent without dropping calendar.
  - ✅ **Guarded primitive Core calls** — **`lib/gmail.ts`**: `createDraft(userId, {to, subject, body, cc?, bcc?})` → `{draftId, messageId}`. Built-in scope gate (`GmailScopeError`→re-consent), per-user hourly rate limit (`GMAIL_DRAFTS_PER_HOUR` default 20 → `GmailRateLimitError`), and append-only `gmail_drafts_log` audit (recipient/subject encrypted at rest). Exposes ONLY `drafts.create` + `drafts.delete` — `messages.send` is never imported (test asserts it's never called).
  - ✅ **Re-consent detection:** granted scopes persisted on `calendar_tokens.scope` (callback passes `tokens.scope`); `userHasGmailScope(userId)` + `missingRequiredScopes()` let onboarding/settings prompt re-auth. **Core builds the prompt UI.**
  - ✅ **Token sensitivity:** the Gmail-enabled token rides the same encrypted `calendar_tokens` row as #4 (encrypted at rest).
  - ✅ **Undo op:** new `deleteDraft` UndoOp in `lib/undo.ts` → calls Security's `deleteDraft(userId, draftId)` (`drafts.delete`, not rate-limited so undo always cleans up).
  - ✅ Tests: `lib/gmail.test.ts` (createDraft guardrails + deleteDraft + draft-only) + `lib/google-auth.test.ts`. Full suite green, tsc clean.
  - ⚠️ **Production landmine (still open, ops/PM):** `gmail.compose` is a Google **restricted scope** → public/production rollout requires Google **OAuth app verification + a CASA security assessment** (weeks). Owner can dogfood now via the unverified-app path; **hard gate before rolling email to all users.**
  - 🔄 **Parallel user-side track (Google Cloud Console):**
    - ✅ Gmail API enabled (2026-06-09).
    - ✅ `gmail.compose` scope added under Data Access (2026-06-09). Code scope string matches: `https://www.googleapis.com/auth/gmail.compose`.
    - ⏳ App is **"In production"** → restricted-scope rollout to all users needs Google **verification + CASA** (multi-week, long lead). Owner can dogfood now via the unverified-app path; PM offered to draft the verification packet (scope justification, demo-video script, Gmail privacy-policy language).
  - **Handoff to Core:** `outreach.ts` composes `{recipient, subject, body}` → in the `draftEmail` handler call `await createDraft(userId, { to: recipient.email, subject, body })`; record undo via the `deleteDraft` op; handle `GmailScopeError`→re-consent, `GmailRateLimitError`→back off. Coordinate before merging into `tool-call/route.ts`.
- [ ] **Secure the travel API credential** — ⏸ PARKED (travel feature parked 2026-06-09). When resumed: own the `AMADEUS_*` secret + a rate-limit/cost guardrail on the lookup endpoint.

### Closed / deprioritized (do not re-open without reason)
- H6 confirmation gate — **done**.
- C2 cross-user mutation — **mitigated** (server-side user binding); monitor only.
- M4 timezone — **mostly handled**; only add explicit recurring-scope read-back if gaps surface.

---

## Production env vars to verify (cannot be checked from code)
On Railway, confirm both are set correctly — these are the difference between
the landmines being armed or defused:
- `JWT_SECRET` — must be a real random secret (not unset → fallback).
  **2026-06-09: fresh secret generated; rotate on Railway (set + redeploy).**
  Logs out all sessions once — that's expected. Confirm here once saved.
- `VAPI_SECRET_ENFORCE=true` — and `VAPI_SERVER_SECRET` set.
