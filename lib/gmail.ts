import { google, gmail_v1 } from 'googleapis';
import { getOAuthClient } from './calendar';
import { getDb, auditLogQueries } from './db';
import { hasGmailReadScope, getGmailTokens, getCalendarTokens, persistRefreshedToken, type ResolvedGoogleToken } from './google-auth';
import { encryptField, decryptField } from './crypto';
import { isLikelySpam } from './emailActivityFilter'; // Core pure helper (Round 7 — full-body fact extraction)

// Gmail access primitive for EDG3 — READ-ONLY inbox signal + draft cleanup.
//
// Ownership (PM ruling 2026-06-09, ROADMAP.md §3): this file + lib/google-auth.ts are
// Security's. Edge NEVER sends mail.
//
// (R12 T2: the email-DRAFTING feature was removed — `createDraft` + its compose scope are gone.
// The only remaining mutation is `deleteDraft` (users.drafts.delete), retained as the inverse op
// for existing undo records. The read path is `gmail.readonly` only — inbox signal for briefings,
// the Focus score, and fact extraction. users.messages.send is never imported or called here.)

// Thrown when the user hasn't granted the required Gmail access — callers should prompt re-auth.
export class GmailScopeError extends Error {
  readonly code = 'gmail_scope_missing';
  constructor(message = 'Gmail access not granted. The user must re-authorize Google.') {
    super(message);
    this.name = 'GmailScopeError';
  }
}

// Build a Gmail client from an already-resolved Google token. The token's `source` tells
// us which account's row to write a refreshed access token back to — so a refresh on the
// dedicated Gmail account never overwrites the calendar account's row (and vice versa).
function gmailClientFor(userId: number, tokenRow: ResolvedGoogleToken): gmail_v1.Gmail {
  const auth = getOAuthClient();
  auth.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token || undefined,
    expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined,
  });
  auth.on('tokens', (t) => {
    if (t.access_token) {
      persistRefreshedToken(userId, tokenRow.source, {
        access_token: t.access_token,
        refresh_token: t.refresh_token || tokenRow.refresh_token || undefined,
        expiry: t.expiry_date?.toString(),
        scope: tokenRow.scope,
      });
    }
  });
  return google.gmail({ version: 'v1', auth });
}

// Delete a Gmail draft by id — the inverse op for undo (lib/undo.ts `deleteDraft`).
// Not rate-limited: undo must always be able to clean up. Still draft-only.
export async function deleteDraft(userId: number, draftId: string): Promise<void> {
  // Must target the same account the draft was created on → resolve Gmail account first.
  const tokenRow = getGmailTokens(userId);
  if (!tokenRow) throw new GmailScopeError('No Google account is connected for this user.');
  const gmail = gmailClientFor(userId, tokenRow);
  await gmail.users.drafts.delete({ userId: 'me', id: draftId });
  console.log(`[gmail] Draft deleted for user ${userId}: draftId=${draftId}`);
}

// --- READ side (email-reply tracking) ---------------------------------------
// READ-ONLY, and only ever called with a threadId Edge itself created (Core passes
// threadIds from watched_threads). No inbox-listing is exposed to callers.

export interface ThreadMessage {
  id: string;
  from: string;
  date: string;
  fromMe: boolean; // true if this message was sent by the user (label SENT) — i.e. our own outreach
  text: string;    // plain-text body (falls back to Gmail's snippet)
}

// Decode a base64url Gmail body part to UTF-8.
function decodeB64Url(data?: string | null): string {
  if (!data) return '';
  try { return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); }
  catch { return ''; }
}

// Walk a message payload for the first text/plain part (depth-first); fall back to the
// top-level body. Returns '' if none found (caller falls back to the snippet).
function extractPlainText(payload?: gmail_v1.Schema$MessagePart): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decodeB64Url(payload.body.data);
  for (const part of payload.parts ?? []) {
    const t = extractPlainText(part);
    if (t) return t;
  }
  if (payload.body?.data && !payload.mimeType?.startsWith('multipart')) return decodeB64Url(payload.body.data);
  return '';
}

// Read a single Gmail thread's messages (read-only). Requires gmail.readonly.
export async function readThread(userId: number, threadId: string): Promise<ThreadMessage[]> {
  // Read ops require gmail.readonly, which is granted on the primary (calendar) account —
  // the dedicated Gmail account is compose-only — so read from the calendar account.
  const tokenRow = getCalendarTokens(userId);
  if (!tokenRow) throw new GmailScopeError('No Google account is connected for this user.');
  if (!hasGmailReadScope(tokenRow.scope)) {
    throw new GmailScopeError('Gmail read access not granted (gmail.readonly). The user must re-authorize Google.');
  }
  const gmail = gmailClientFor(userId, tokenRow);
  const res = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
  const messages = res.data.messages ?? [];
  return messages.map((m) => {
    const headers = m.payload?.headers ?? [];
    const header = (name: string) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
    const body = extractPlainText(m.payload).trim();
    return {
      id: m.id ?? '',
      from: header('From'),
      date: header('Date'),
      fromMe: (m.labelIds ?? []).includes('SENT'),
      text: body || (m.snippet ?? ''),
    };
  });
}

// --- Email signal for Focus Recommendation + memory -------------------------
// Fetches a DIGEST of recent inbox threads used by Core's recommendFocusAreas()
// (prioritization) and extractAndUpsertFactsFromEmail() (memory). Design contract:
//   - Default (no fullBodies): format:'metadata' only — header metadata + Gmail's
//     own auto-truncated snippet (~100 chars). NO message bodies fetched.
//   - With { fullBodies:true } (Round 7): for up to 10 non-spam threads we ALSO call
//     readThread() to fetch the actual inbound body text (capped 2000 chars/thread) so
//     Edge builds memory from what emails SAY, not just subject lines.
//   - Nothing is stored either way: bodies/snippets live in-memory on the returned
//     items and are dropped after extraction. The audit log records thread count +
//     subjects only — zero body text ever enters the audit log or DB.
//
// PRIVACY NOTE: this accesses arbitrary inbox threads, not just threads Edge started,
// and (with fullBodies) reads their bodies in-memory. This is a USE-CASE EXPANSION of
// the gmail.readonly scope. ⚠️ Security/PM: update google-verification.md + the privacy
// page to state Edge reads inbox body text (in-memory, for memory; never stored/sold).
// See also the CASA flag in ROADMAP-SECURITY.md.

// Absolute ceiling on threads fetched per call regardless of opts.max.
const EMAIL_SIGNAL_CAP = 50;

export interface EmailSignalItem {
  threadId: string;
  sender: string;     // From header of the thread's first message
  subject: string;    // Subject header of the thread's first message
  snippet: string;    // Gmail's own auto-truncated snippet (~100 chars, no body fetch)
  date: string;       // Date header of the most recent message in the thread
  isUnread: boolean;
  isImportant: boolean;
  // Round 7 (Core, cross-lane): full inbound body text, present only when getRecentEmailSignal
  // is called with { fullBodies: true }. In-memory only — NEVER stored (the audit log still
  // records subjects only). Capped to keep token cost bounded.
  body?: string;
}

export interface EmailSignal {
  items: EmailSignalItem[];
  fetchedAt: string;    // ISO timestamp — caller may cache for one session
  scopeMissing: boolean; // true when user hasn't granted gmail.readonly yet
}

/**
 * Truncate body text to `cap` chars at the last clean sentence boundary (a `.` or
 * newline) before the limit — so the LLM extractor never receives a mid-word/mid-sentence
 * fragment. Falls back to a hard cut only when no boundary exists in the window.
 * Pure + exported for direct unit testing.
 */
export function truncateAtSentenceBoundary(text: string, cap: number): string {
  if (text.length <= cap) return text;
  const window = text.slice(0, cap);
  const boundary = Math.max(window.lastIndexOf('.'), window.lastIndexOf('\n'));
  return (boundary > 0 ? window.slice(0, boundary + 1) : window).trimEnd();
}

// R12 — once-per-day cache window. getRecentEmailSignal is called from several dashboard
// routes on every load; without a gate each call re-scanned the inbox AND wrote an
// Activity-tab receipt, flooding it with "Reviewed N inbox threads" every ~30 min.
const EMAIL_SIGNAL_CACHE_MS = 24 * 60 * 60 * 1000;

// Parse a SQLite datetime('now') string ("YYYY-MM-DD HH:MM:SS", UTC, no tz suffix) as UTC.
function parseSqliteUtcMs(s: string): number {
  if (typeof s !== 'string') return NaN;
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  const hasTz = iso.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(iso);
  return Date.parse(hasTz ? iso : iso + 'Z');
}

// Return a cached EmailSignal reconstructed from the most recent email_signal_fetch audit
// receipt IF it's < 24h old, else null. The receipt only stores subjects (encrypted), so the
// cached items carry subject only — enough for the metadata/prioritization callers. The
// briefing path ({ fullBodies: true }) bypasses this and always fetches fresh bodies.
function readEmailSignalCache(userId: number): EmailSignal | null {
  try {
    const row = getDb().prepare(
      "SELECT created_at, snapshot_after FROM audit_log WHERE user_id = ? AND action = 'email_signal_fetch' ORDER BY created_at DESC LIMIT 1"
    ).get(userId) as { created_at: string; snapshot_after: string | null } | undefined;
    if (!row || !row.snapshot_after) return null; // no prior scan, or it was an empty (un-snapshotted) fetch
    const createdMs = parseSqliteUtcMs(row.created_at);
    if (isNaN(createdMs) || Date.now() - createdMs > EMAIL_SIGNAL_CACHE_MS) return null; // stale → refetch
    const parsed = JSON.parse(decryptField(row.snapshot_after)) as { subjects?: unknown };
    const subjects = Array.isArray(parsed.subjects)
      ? (parsed.subjects as unknown[]).filter((s): s is string => typeof s === 'string')
      : [];
    return {
      items: subjects.map(subject => ({
        threadId: '', sender: '', subject, snippet: '', date: '', isUnread: false, isImportant: false,
      })),
      fetchedAt: row.created_at,
      scopeMissing: false,
    };
  } catch {
    return null; // any cache read failure → fall through to a live fetch (never block the caller)
  }
}

/**
 * Return a compact prioritization digest of the user's recent inbox threads.
 *
 * Only header metadata + Gmail's own snippet are read — NO message bodies.
 * Nothing is stored. Results are returned in-memory for Core's LLM call.
 *
 * @throws Never — scope issues return scopeMissing:true; individual thread
 *   failures are swallowed via Promise.allSettled so the signal is always partial
 *   rather than absent.
 */
export async function getRecentEmailSignal(
  userId: number,
  opts: { days?: number; max?: number; fullBodies?: boolean } = {},
): Promise<EmailSignal> {
  const fetchedAt = new Date().toISOString();
  const days = Math.max(1, opts.days ?? 14);
  const max = Math.min(opts.max ?? 20, EMAIL_SIGNAL_CAP);

  // Read ops use the calendar account (gmail.readonly lives there, not on the compose-only
  // dedicated Gmail account).
  const tokenRow = getCalendarTokens(userId);
  if (!tokenRow || !hasGmailReadScope(tokenRow.scope)) {
    return { items: [], fetchedAt, scopeMissing: true };
  }

  // R12 — once-per-day cache gate: if we already scanned this inbox within 24h, return the
  // cached subjects instead of re-hitting Gmail + writing another Activity-tab receipt.
  // EXEMPTION: the briefing path passes { fullBodies: true } and needs FRESH message bodies
  // for fact extraction (Round 7) — a subjects-only cache can't serve that, so it always
  // fetches live. (The dashboard callers that caused the flooding are all metadata-mode.)
  if (!opts.fullBodies) {
    const cached = readEmailSignalCache(userId);
    if (cached) return cached;
  }

  const gmail = gmailClientFor(userId, tokenRow);

  // List recent INBOX threads — Gmail returns id + snippet in the list response.
  // Exclude Promotions/Social/Forums (Gmail's own categories) so only Primary +
  // Updates flow into fact extraction and meeting-prep signals.
  const listRes = await gmail.users.threads.list({
    userId: 'me',
    labelIds: ['INBOX'],
    q: `newer_than:${days}d -category:promotions -category:social -category:forums`,
    maxResults: max,
  });
  const threads = listRes.data.threads ?? [];

  // Fetch metadata (headers + label IDs) for each thread in parallel.
  // format:'metadata' with metadataHeaders means ONLY those headers are returned
  // — no message bodies ever fetched from the Gmail API.
  const settled = await Promise.allSettled(
    threads.map(async (t) => {
      const detail = await gmail.users.threads.get({
        userId: 'me',
        id: t.id!,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      });
      const messages = detail.data.messages ?? [];
      const firstMsg = messages[0];
      const lastMsg = messages[messages.length - 1] ?? firstMsg;
      const hdr = (msg: typeof firstMsg, name: string): string =>
        (msg?.payload?.headers ?? []).find(
          (h) => h.name?.toLowerCase() === name.toLowerCase(),
        )?.value ?? '';
      const allLabels = messages.flatMap((m) => m.labelIds ?? []);
      // Safety-net: drop bulk categories that Gmail's query filter may let slip through.
      const BULK_CATEGORIES = ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS'];
      if (BULK_CATEGORIES.some((c) => allLabels.includes(c))) return null;
      return {
        threadId: t.id!,
        sender: hdr(firstMsg, 'From'),
        subject: hdr(firstMsg, 'Subject'),
        snippet: t.snippet ?? '',   // from the list response — no extra fetch needed
        date: hdr(lastMsg, 'Date'),
        isUnread: allLabels.includes('UNREAD'),
        isImportant: allLabels.includes('IMPORTANT'),
      } satisfies EmailSignalItem;
    }),
  );

  const items = settled
    .filter((r): r is PromiseFulfilledResult<EmailSignalItem> => r.status === 'fulfilled' && r.value !== null)
    .map((r) => r.value);

  // Round 7 (Core, cross-lane): when fullBodies is requested, fetch the actual inbound body
  // text for memory extraction — not just Gmail's truncated snippet. Skip likely-spam threads
  // BEFORE the (per-thread) readThread call so we don't waste fetches on promo/automated mail.
  // Bodies are kept in-memory on the returned items only; nothing here is stored.
  if (opts.fullBodies && items.length > 0) {
    const FULL_BODY_THREAD_CAP = 10;
    const BODY_CHAR_CAP = 2000;
    const eligible = items
      .filter((i) => !isLikelySpam(i.subject, i.sender))
      .slice(0, FULL_BODY_THREAD_CAP);
    await Promise.allSettled(
      eligible.map(async (item) => {
        try {
          const msgs = await readThread(userId, item.threadId);
          // Only the inbound side — exclude the user's own sent replies (fromMe).
          const inbound = msgs.filter((m) => !m.fromMe).map((m) => m.text).join('\n---\n').trim();
          if (inbound) item.body = truncateAtSentenceBoundary(inbound, BODY_CHAR_CAP);
        } catch {
          /* leave body undefined — extraction falls back to the snippet */
        }
      }),
    );
  }

  // Audit: thread count in argsJson; subjects encrypted in snapshotAfter so the
  // user can see which threads Edge reviewed in the Activity tab receipt, without
  // subjects ever appearing in plaintext in the log. Bodies/snippets are never stored.
  // R12 Part B — only record when there's something to report: a zero-thread fetch is a
  // no-op and shouldn't clutter the Activity tab (and writing it would also poison the
  // 24h cache with an empty receipt).
  if (items.length > 0) {
    auditLogQueries.record({
      userId,
      action: 'email_signal_fetch',
      argsJson: JSON.stringify({ days, threadCount: items.length }),
      resultText: `${items.length} inbox threads reviewed for prioritization`,
      ok: true,
      snapshotAfter: encryptField(JSON.stringify({ subjects: items.map(i => i.subject) })),
    });
  }

  return { items, fetchedAt, scopeMissing: false };
}

/**
 * Return the encrypted thread subjects stored on a specific email_signal_fetch audit entry.
 *
 * User-scoped: the query enforces `user_id = userId` so no cross-user subject leakage.
 * Decrypts on read — subjects are only accessible to the account owner.
 * Returns null when the entry doesn't exist, isn't owned by this user, has no subjects,
 * or decryption fails (e.g. key rotation).
 *
 * Core calls this via GET /api/activity/email-receipt/[id] to render the Activity receipt.
 */
export function getEmailSignalSubjects(userId: number, auditId: number): string[] | null {
  try {
    const row = getDb().prepare(
      "SELECT snapshot_after FROM audit_log WHERE id = ? AND user_id = ? AND action = 'email_signal_fetch'"
    ).get(auditId, userId) as { snapshot_after: string | null } | undefined;
    if (!row?.snapshot_after) return null;
    const parsed = JSON.parse(decryptField(row.snapshot_after)) as { subjects?: unknown };
    if (!Array.isArray(parsed.subjects)) return null;
    return (parsed.subjects as unknown[]).filter((s): s is string => typeof s === 'string');
  } catch {
    return null;
  }
}

/**
 * R13 T3 — targeted SUBJECT search. Finds recent threads whose subject matches `query`.
 * Used by Core's `briefEvent` tool (meeting prep): "brief me on the investor meeting" →
 * pull emails with "investor" in the subject. Returns the same `EmailSignal` shape as
 * `getRecentEmailSignal` (snippet only — no body fetch).
 *
 * Deliberately **no audit-log entry and no 24h cache** — this is an on-demand, query-specific
 * search (called only from briefEvent), not the daily inbox scan that the Activity-tab receipt
 * + cache gate are for.
 *
 * @throws Never — missing scope returns scopeMissing:true; per-thread failures are swallowed.
 */
export async function searchEmailsBySubject(
  userId: number,
  query: string,
  opts: { days?: number; max?: number } = {},
): Promise<EmailSignal> {
  const fetchedAt = new Date().toISOString();
  const days = Math.max(1, opts.days ?? 30);
  const max = Math.min(opts.max ?? 10, EMAIL_SIGNAL_CAP);

  // gmail.readonly lives on the calendar account (same as getRecentEmailSignal).
  const tokenRow = getCalendarTokens(userId);
  if (!tokenRow || !hasGmailReadScope(tokenRow.scope)) {
    return { items: [], fetchedAt, scopeMissing: true };
  }

  // Sanitize the term so an event title can't break the Gmail query grammar
  // (strip parens/quotes/braces that have meaning inside `subject:(...)`).
  const term = query.replace(/[()"{}]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!term) return { items: [], fetchedAt, scopeMissing: false };

  const gmail = gmailClientFor(userId, tokenRow);
  const listRes = await gmail.users.threads.list({
    userId: 'me',
    q: `subject:(${term}) newer_than:${days}d`,
    maxResults: max,
  });
  const threads = listRes.data.threads ?? [];

  // Metadata-only per thread (headers + Gmail's list snippet) — no message bodies fetched.
  const settled = await Promise.allSettled(
    threads.map(async (t) => {
      const detail = await gmail.users.threads.get({
        userId: 'me',
        id: t.id!,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      });
      const messages = detail.data.messages ?? [];
      const firstMsg = messages[0];
      const lastMsg = messages[messages.length - 1] ?? firstMsg;
      const hdr = (msg: typeof firstMsg, name: string): string =>
        (msg?.payload?.headers ?? []).find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
      const allLabels = messages.flatMap((m) => m.labelIds ?? []);
      return {
        threadId: t.id!,
        sender: hdr(firstMsg, 'From'),
        subject: hdr(firstMsg, 'Subject'),
        snippet: t.snippet ?? '',
        date: hdr(lastMsg, 'Date'),
        isUnread: allLabels.includes('UNREAD'),
        isImportant: allLabels.includes('IMPORTANT'),
      } satisfies EmailSignalItem;
    }),
  );

  const items = settled
    .filter((r): r is PromiseFulfilledResult<EmailSignalItem> => r.status === 'fulfilled' && r.value !== null)
    .map((r) => r.value);

  // No audit entry, no cache — see doc comment.
  return { items, fetchedAt, scopeMissing: false };
}
