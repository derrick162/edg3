import { google, gmail_v1 } from 'googleapis';
import { getOAuthClient } from './calendar';
import { getDb, gmailQueries, auditLogQueries } from './db';
import { hasGmailScope, hasGmailReadScope, getGmailTokens, getCalendarTokens, persistRefreshedToken, type ResolvedGoogleToken } from './google-auth';
import { encryptField, decryptField } from './crypto';
import { isLikelySpam } from './emailActivityFilter'; // Core pure helper (Round 7 — full-body fact extraction)

// Gmail access primitive for EDG3 — the GUARDED, DRAFT-ONLY entry point.
//
// Ownership (PM ruling 2026-06-09, ROADMAP.md §3): this file + lib/google-auth.ts are
// Security's. Core's lib/outreach.ts *composes* emails ({recipient, subject, body}) and
// calls createDraft() here to actually create the Gmail draft. Edge NEVER sends mail.
//
// HARD GUARDRAIL: the only mutations exposed are createDraft (users.drafts.create) and
// deleteDraft (users.drafts.delete — the inverse op for undo). users.messages.send is
// never imported or called anywhere in this module.
//
// Trust controls baked into createDraft:
//   - Scope gate: refuses unless the user granted gmail.compose (typed GmailScopeError
//     so callers can trigger re-consent).
//   - Per-user rate limit (anti-spam): caps drafts/hour (GMAIL_DRAFTS_PER_HOUR).
//   - Audit: every draft recorded in gmail_drafts_log (recipient/subject encrypted at rest).

const DRAFTS_PER_HOUR = Math.max(1, parseInt(process.env.GMAIL_DRAFTS_PER_HOUR || '20', 10) || 20);

// Thrown when the user hasn't granted Gmail access — callers should prompt re-auth.
export class GmailScopeError extends Error {
  readonly code = 'gmail_scope_missing';
  constructor(message = 'Gmail access not granted (gmail.compose). The user must re-authorize Google.') {
    super(message);
    this.name = 'GmailScopeError';
  }
}

// Thrown when the per-user hourly draft cap is exceeded (anti-spam).
export class GmailRateLimitError extends Error {
  readonly code = 'gmail_rate_limited';
  constructor(message: string) {
    super(message);
    this.name = 'GmailRateLimitError';
  }
}

export interface DraftInput {
  to: string;       // "Name <email>" or bare "email"
  subject: string;
  body: string;     // plain text
  cc?: string;
  bcc?: string;
}

export interface DraftResult {
  draftId: string;
  messageId: string | null;
  threadId: string | null;
}

// True once the user has granted Gmail compose access — checks the Gmail account if a
// separate one is linked, else the calendar account (which carries gmail.compose).
export function userHasGmailScope(userId: number): boolean {
  return hasGmailScope(getGmailTokens(userId)?.scope);
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

// RFC 2822 plain-text message → base64url, as Gmail's `raw` field expects.
function buildRawMessage({ to, subject, body, cc, bcc }: DraftInput): string {
  // Strip CRLF and other control chars that could enable email header injection.
  const sh = (s: string) => s.replace(/[\r\n\t]/g, ' ').trim();
  // RFC 2047 encode non-ASCII subjects so accents/emoji survive.
  const enc = (s: string) =>
    /^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
  const headers = [
    `To: ${sh(to)}`,
    cc ? `Cc: ${sh(cc)}` : '',
    bcc ? `Bcc: ${sh(bcc)}` : '',
    `Subject: ${enc(sh(subject))}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean);
  const mime = headers.join('\r\n') + '\r\n\r\n' + Buffer.from(body, 'utf8').toString('base64');
  return Buffer.from(mime, 'utf8').toString('base64url');
}

/**
 * Create a Gmail DRAFT on the user's behalf (Core's outreach.ts calls this). Never sends.
 *
 * @throws GmailScopeError      if the user hasn't granted gmail.compose (→ re-consent)
 * @throws GmailRateLimitError  if the per-user hourly draft cap is exceeded
 */
export async function createDraft(userId: number, input: DraftInput): Promise<DraftResult> {
  const to = input?.to?.trim();
  if (!to) throw new Error('createDraft: "to" recipient is required');
  if (!input.subject?.trim() && !input.body?.trim()) {
    throw new Error('createDraft: a subject or body is required');
  }

  // Drafts go through the dedicated Gmail account when linked (falls back to the
  // calendar account's grant for existing single-account users).
  const tokenRow = getGmailTokens(userId);
  if (!tokenRow) throw new GmailScopeError('No Google account is connected for this user.');
  if (!hasGmailScope(tokenRow.scope)) throw new GmailScopeError();

  // Anti-spam: cap drafts per rolling hour (the audit log is the counter).
  const lastHour = gmailQueries.countSince(userId, Date.now() - 60 * 60 * 1000);
  if (lastHour >= DRAFTS_PER_HOUR) {
    throw new GmailRateLimitError(`Draft limit reached (${DRAFTS_PER_HOUR}/hour). Try again later.`);
  }

  const gmail = gmailClientFor(userId, tokenRow);
  const res = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: { message: { raw: buildRawMessage({ ...input, to }) } },
  });

  const draftId = res.data.id;
  if (!draftId) throw new Error('Gmail draft create returned no id');
  const messageId = res.data.message?.id ?? null;
  const threadId = res.data.message?.threadId ?? null;

  // Audit (recipient/subject encrypted at rest inside the query layer).
  gmailQueries.logDraft(userId, to, input.subject ?? '', draftId);
  console.log(`[gmail] Draft created for user ${userId}: draftId=${draftId}`);

  return { draftId, messageId, threadId };
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
  auditLogQueries.record({
    userId,
    action: 'email_signal_fetch',
    argsJson: JSON.stringify({ days, threadCount: items.length }),
    resultText: `${items.length} inbox threads reviewed for prioritization`,
    ok: true,
    snapshotAfter: items.length > 0
      ? encryptField(JSON.stringify({ subjects: items.map(i => i.subject) }))
      : null,
  });

  return { items, fetchedAt, scopeMissing: false };
}

export interface EmailContact {
  name: string;
  email: string;
  count: number;
}

/**
 * Scan the user's dedicated Gmail account (secondary, gmail_tokens) for unique senders.
 * Returns deduplicated contacts sorted by frequency (most frequent first).
 * Only header metadata is fetched — no message bodies are ever read or stored.
 * Falls back to the primary (calendar) account when no dedicated Gmail account is linked.
 */
export async function extractGmailAccountContacts(
  userId: number,
  opts: { days?: number; max?: number } = {},
): Promise<EmailContact[]> {
  const days = Math.max(1, opts.days ?? 60);
  const max = Math.min(opts.max ?? 50, 100);

  const tokenRow = getGmailTokens(userId);
  if (!tokenRow || !hasGmailReadScope(tokenRow.scope)) return [];

  const gmail = gmailClientFor(userId, tokenRow);

  // Get the account's own email address so we can exclude self-emails.
  const accountEmail = (tokenRow as { email?: string | null }).email?.toLowerCase() ?? '';

  const listRes = await gmail.users.threads.list({
    userId: 'me',
    labelIds: ['INBOX'],
    q: `newer_than:${days}d`,
    maxResults: max,
  });
  const threads = listRes.data.threads ?? [];

  const settled = await Promise.allSettled(
    threads.map(async (t) => {
      const detail = await gmail.users.threads.get({
        userId: 'me',
        id: t.id!,
        format: 'metadata',
        metadataHeaders: ['From'],
      });
      const messages = detail.data.messages ?? [];
      // Collect all unique From headers across all messages in the thread.
      return messages
        .map(m =>
          (m.payload?.headers ?? []).find(h => h.name?.toLowerCase() === 'from')?.value ?? null,
        )
        .filter((v): v is string => v !== null);
    }),
  );

  const counts = new Map<string, EmailContact>();
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    for (const raw of r.value) {
      const parsed = parseFromHeader(raw);
      if (!parsed) continue;
      const key = parsed.email.toLowerCase();
      if (accountEmail && key === accountEmail) continue; // skip self
      const existing = counts.get(key);
      if (existing) {
        existing.count++;
        if (!existing.name && parsed.name) existing.name = parsed.name;
      } else {
        counts.set(key, { name: parsed.name, email: parsed.email, count: 1 });
      }
    }
  }

  const contacts = Array.from(counts.values()).sort((a, b) => b.count - a.count);

  // Audit (T3-2 transparency): record that Edge scanned the dedicated Gmail account's
  // sender headers, mirroring getRecentEmailSignal's receipt. Contact emails are stored
  // ENCRYPTED in snapshotAfter so the user can see in the Activity tab which contacts Edge
  // learned, without addresses ever appearing in plaintext in the log. No bodies are read.
  auditLogQueries.record({
    userId,
    action: 'gmail_contacts_fetch',
    argsJson: JSON.stringify({ days, threadCount: threads.length, contactCount: contacts.length }),
    resultText: `${contacts.length} unique email contacts scanned from inbox headers`,
    ok: true,
    snapshotAfter: contacts.length > 0
      ? encryptField(JSON.stringify({ contacts: contacts.map(c => c.email) }))
      : null,
  });

  return contacts;
}

function parseFromHeader(from: string): { name: string; email: string } | null {
  const match = from.match(/^"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  const bare = from.trim();
  if (bare.includes('@')) return { name: '', email: bare };
  return null;
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
