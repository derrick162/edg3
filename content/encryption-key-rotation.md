# Encryption key rotation — READ BEFORE TOUCHING DATA_ENCRYPTION_KEY

_Security-engineer reference. Last reviewed: 2026-06-18 (Vijay)._

---

## The single rule

**Never change `DATA_ENCRYPTION_KEY` without first running a re-encryption migration.**

If you rotate the key on Railway without migrating the data:
- Every encrypted field in the database becomes permanently unreadable
- There is no automatic fallback — AES-256-GCM decryption with the wrong key throws immediately
- Affected fields: briefing transcripts, calendar/Whoop OAuth tokens, memory notes, facts, episodes, briefing context packs, notifications, Gmail draft log, watched threads, daily focus plans, open loop descriptions, focus milestones

This is a **data-loss event**, not a recoverable error.

---

## When is rotation necessary?

Rotate only when:
1. You have strong reason to believe the key was exposed (leaked secret, unauthorized Railway access)
2. A security audit explicitly requires rotation (e.g., key is too old, algorithm change)
3. You're deprecating one Railway project and migrating to a new one

Do NOT rotate as routine maintenance. Key age alone is not a reason to rotate.

---

## How to rotate safely

### Step 0 — Take a verified backup first

Before touching anything:
1. Trigger `maybeDailyBackup()` manually (or wait for the 3am cron to run)
2. If off-box backup is configured (`BACKUP_S3_*` vars set): verify the latest snapshot is in object storage and newer than 1 hour
3. If not configured: download the SQLite file from the Railway volume directly as a local backup
4. **Test the backup**: spin up a local copy of the app pointing at the backup file, verify reads work. A backup you haven't restored is not a backup.

### Step 1 — Write and run a re-encryption migration

The migration must:
1. Read every encrypted field from the database using the **old** key
2. Re-encrypt each value with the **new** key
3. Write the new ciphertext back to the database

Template (run as a one-shot script, not in production code):

```typescript
import { getDb } from './lib/db';
import { decryptField, encryptField } from './lib/crypto';

// Set OLD_KEY and NEW_KEY as env vars before running
const OLD_KEY = process.env.OLD_DATA_ENCRYPTION_KEY!;
const NEW_KEY = process.env.NEW_DATA_ENCRYPTION_KEY!;

// Override the module-level key for old-key reads
// (requires temporary patch to crypto.ts or inline re-implementation)

const db = getDb();

// Example: re-encrypt briefings.transcript
const rows = db.prepare('SELECT id, transcript FROM briefings WHERE transcript LIKE "enc:1:%"').all();
for (const row of rows as Array<{ id: number; transcript: string }>) {
  const plaintext = decryptField(row.transcript, OLD_KEY);  // decrypt with old key
  const newCiphertext = encryptField(plaintext, NEW_KEY);   // re-encrypt with new key
  db.prepare('UPDATE briefings SET transcript = ? WHERE id = ?').run(newCiphertext, row.id);
}
// Repeat for: briefings.user_response, calendar_tokens.access_token, calendar_tokens.refresh_token,
// whoop_tokens.access_token, whoop_tokens.refresh_token, episodes.content_raw,
// briefing_context_packs.context_pack, memories.content, facts.statement, pattern_cache.patterns,
// focus_milestones.title, open_loops.description, notifications.title, notifications.body,
// daily_focus.focus_areas, gmail_drafts_log.recipient, gmail_drafts_log.subject,
// watched_threads.recipient, watched_threads.context
```

Run this migration locally against a **copy** of the production database first. Verify all reads work before running against production.

### Step 2 — Swap the key atomically

1. Set `NEW_DATA_ENCRYPTION_KEY` on Railway (do not yet remove the old one)
2. Update app code to use the new key name
3. Deploy
4. Verify reads work on all encrypted endpoints
5. Remove the old key from Railway secrets

### Step 3 — Verify

After rotating:
- `/api/briefing` returns decrypted content (not empty)
- `/api/memory` returns decrypted notes
- Calendar connects without token errors
- Whoop connects without token errors

---

## Where the key is stored

- **Primary:** Railway environment secret `DATA_ENCRYPTION_KEY`
- **Backup location:** [Document here — e.g., "1Password vault 'EDG3 Production Secrets'"] ← Fill this in
- **Who has access:** [Document here]

⚠️ The backup location must be in a different failure domain than Railway. If Railway is compromised, the backup must still be recoverable.

---

## What `safeDecryptField` does (and why)

Content-path reads (briefings, facts, memories, episodes) use `safeDecryptField()` from `lib/crypto.ts`:
- If decryption succeeds: returns the plaintext
- If decryption fails (wrong key, corrupted data): logs `[crypto] DECRYPT_FAILURE` and returns an empty string

This prevents a missing/rotated key from crashing the 7am briefing call. **It does not fix the underlying problem** — it degrades gracefully while you investigate.

Auth-path reads (calendar tokens, Whoop tokens) use the throwing `decryptField()` — a missing key on the auth path surfaces as a clear error rather than a silent empty.

---

## Recovery if the key is lost

If `DATA_ENCRYPTION_KEY` is lost and no backup exists:
1. All encrypted fields are unreadable — **this is permanent**
2. Users must reconnect Google (new OAuth tokens), reconnect Whoop (new tokens), and their memory/facts/transcripts are gone
3. There is no cryptographic recovery path

This is why the key backup matters. Do it now if you haven't.

---

_See also: `content/data-protection.md` for the full encryption coverage map._
