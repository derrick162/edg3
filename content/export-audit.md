# Data Export Accuracy Audit
_PM/Security spec for PILLAR-TRUST T3-3. Audit of `app/api/account/export/route.ts` against what EDG3 actually stores. Route to Vijay (Security)._

---

## What's included in the current export (v1)

`GET /api/account/export` returns a JSON file with:
- `profile` (name, email, timezone, call_time, phone_number, profile_summary, data_consent)
- `priorities`
- `memories`
- `facts` (active only — valid_until IS NULL)
- `tasks` (last 365 days)
- `briefings` (all, with transcript + calendar_actions + edge_promises)
- `emailDraftHistory` (gmail_drafts_log — recipient + subject + date)
- `energyLog`
- `dailyFocus`
- `calendarScores`
- `energyProfile`
- `eventEnergyTags`
- `openLoops`

Correctly excluded (internal infrastructure — users don't need these):
- OAuth tokens (`google_tokens`, `whoop_tokens`) — excluded for security
- Dedup keys, failed webhooks, background job failures — internal plumbing
- `briefing_context_packs` — derived/regeneratable cache

---

## What's MISSING from the export

These tables store user data and should be included:

### 1. `episodes` — MISSING (HIGH priority)
The encrypted ground-truth call records (from `lib/episodeStore.ts`). Contains:
- `occurred_at` (when the call happened)
- encrypted transcript
- extracted topics
- extracted commitments
- source (always 'call')

**Why it matters:** The episode store is the raw history of what Derrick said on every call. It's the most complete record of what Edge knows — more complete than `briefings` (which stores the AI-generated summary) and `memories` (which stores extracted text). A user who deletes their account and wants their data back would want this.

**Fields to include in export:**
```json
{ "occurredAt": "...", "source": "call", "topics": [...], "commitments": [...] }
```
Transcript optional (large, but arguably the most important piece of the export).

---

### 2. `fact_history` — MISSING (MEDIUM priority)
The versioned audit trail of fact changes — every time a fact was created, updated, or retired. Contains:
- `fact_id`, `statement` (the old value), `retired_at`, `retired_reason`, `source`

**Why it matters:** The privacy policy now says users can "see and correct" their data. The `fact_history` table is the history of how Edge's memory of the user changed over time. Users may want to verify that bad extractions were corrected and the old (incorrect) value isn't stored anywhere.

**Fields to include in export:**
```json
{ "factId": 123, "statement": "...", "retiredAt": "...", "retiredReason": "extraction-update", "source": "extraction" }
```

---

### 3. `audit_log` — MISSING (HIGH priority)
Every calendar mutation, email draft, and other action Edge took on the user's behalf. This is what powers the Activity tab in the dashboard.

**Why it matters:** This is the most important transparency record. If a user wants to know everything Edge ever did to their calendar or email, this is the source of truth. The GDPR/privacy requirement for "right to access" squarely covers this.

**Fields to include in export:**
```json
{ "action": "createEvent", "description": "Created 'Team sync' · Jun 15 at 2 PM", "args": {...}, "ok": true, "createdAt": "..." }
```
Omit `session_id` and other internal fields.

---

### 4. `undo_history` — MISSING (LOW priority)
The undo records — what actions were reversed and when.

**Why it matters:** Adds completeness to the activity log. If an event was created and then undone, the export should show both records so the user has a complete picture.

**Fields to include in export:**
```json
{ "actionType": "createEvent", "metadata": {...}, "createdAt": "...", "usedAt": "..." }
```

---

## Recommended additions to the export endpoint

In `app/api/account/export/route.ts`, add these sections:

```typescript
// Episodes — call ground-truth records
const episodeRows = (db.prepare(
  'SELECT occurred_at, source, topics, commitments FROM episodes WHERE user_id = ? ORDER BY occurred_at DESC'
).all(userId) as Array<{ occurred_at: string; source: string; topics: string | null; commitments: string | null }>)
  .map(r => ({
    occurredAt: r.occurred_at,
    source: r.source,
    topics: r.topics ? JSON.parse(decryptField(r.topics)) : [],
    commitments: r.commitments ? JSON.parse(decryptField(r.commitments)) : [],
  }));

// Fact history — versioned memory audit trail
const factHistoryRows = (db.prepare(
  'SELECT fh.fact_id, fh.statement, fh.retired_at, fh.retired_reason, fh.source FROM fact_history fh JOIN facts f ON f.id = fh.fact_id WHERE f.user_id = ? ORDER BY fh.retired_at DESC'
).all(userId) as Array<{ fact_id: number; statement: string; retired_at: string; retired_reason: string | null; source: string | null }>)
  .map(r => ({
    factId: r.fact_id,
    statement: r.statement,
    retiredAt: r.retired_at,
    retiredReason: r.retired_reason ?? null,
    source: r.source ?? null,
  }));

// Audit log — every action Edge took on the user's behalf
const auditRows = (db.prepare(
  'SELECT action, description, ok, created_at FROM audit_log WHERE user_id = ? ORDER BY created_at DESC'
).all(userId) as Array<{ action: string; description: string | null; ok: number; created_at: string }>)
  .map(r => ({
    action: r.action,
    description: r.description ?? null,
    ok: !!r.ok,
    createdAt: r.created_at,
  }));

// Undo history — what was reversed
const undoRows = (db.prepare(
  'SELECT action_type, created_at, used_at FROM undo_history WHERE user_id = ? ORDER BY created_at DESC'
).all(userId) as Array<{ action_type: string; created_at: string; used_at: string | null }>)
  .map(r => ({
    actionType: r.action_type,
    createdAt: r.created_at,
    usedAt: r.used_at ?? null,
  }));
```

And add to the payload:
```typescript
episodes: episodeRows,
factHistory: factHistoryRows,
activityLog: auditRows,
undoHistory: undoRows,
```

---

## Also: `facts` export should include retired facts

The current export only returns **active** facts (`valid_until IS NULL`). A user should also be able to see the full history of facts that were retired — what Edge used to believe about them.

Update the facts export to include both active and retired, with a `status` field:
```typescript
facts: factQueries.getAll(userId).map(f => ({
  category: f.category,
  entity: f.entity ?? null,
  statement: f.statement,
  learnedAt: f.learned_at,
  status: f.valid_until ? 'retired' : 'active',
  retiredAt: f.valid_until ?? null,
})),
```

This requires `getAll` to return retired facts too (or a separate `getAllIncludingRetired` query). Check `lib/db.ts` factQueries.

---

## Also: bump export version to '2'

After adding these fields, change `version: '1'` → `version: '2'` in the payload so users/support can tell which format they received.

---

## Also: the active facts query issue

Currently `factQueries.getAll(userId)` — verify that this query returns active facts with confidence_score and last_confirmed_at columns (both added in Round 6). If not, update the export map to include:
```json
{ "confidenceScore": 0.85, "lastConfirmedAt": "2026-06-15T..." }
```
These fields are useful for users who want to understand how Edge's confidence in a fact has decayed.

---

## Acceptance criteria

- Export includes episodes, fact_history, audit_log, undo_history
- All encrypted fields are decrypted in the response (same as existing briefings handling)
- Export version bumped to '2'
- Test: create a user, populate all tables with known values, export, verify all tables appear and data matches

---

_PM/CTO: Kevin, June 2026. Source: PILLAR-TRUST.md T3-3. Audit of `app/api/account/export/route.ts`._
