import { google, gmail_v1 } from 'googleapis';
import { getOAuthClient } from './calendar';
import { calendarQueries, gmailQueries } from './db';
import { hasGmailScope } from './google-auth';

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

// True once the user has granted Gmail access (for onboarding/settings re-consent UI).
export function userHasGmailScope(userId: number): boolean {
  return hasGmailScope(calendarQueries.get(userId)?.scope);
}

// Build a Gmail client from the user's stored Google token. Reuses the SAME OAuth client
// and token row as the calendar (one grant), so it only works once the Gmail scope is granted.
// Persists refreshed access tokens, preserving the existing scope grant.
function gmailClientFor(userId: number): gmail_v1.Gmail {
  const tokenRow = calendarQueries.get(userId);
  if (!tokenRow) throw new GmailScopeError('No Google account is connected for this user.');
  const auth = getOAuthClient();
  auth.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token || undefined,
    expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined,
  });
  auth.on('tokens', (t) => {
    if (t.access_token) {
      calendarQueries.upsert(
        userId,
        t.access_token,
        t.refresh_token || tokenRow.refresh_token || '',
        t.expiry_date?.toString() || '',
        tokenRow.scope,
      );
    }
  });
  return google.gmail({ version: 'v1', auth });
}

// RFC 2822 plain-text message → base64url, as Gmail's `raw` field expects.
function buildRawMessage({ to, subject, body, cc, bcc }: DraftInput): string {
  // RFC 2047 encode non-ASCII subjects so accents/emoji survive.
  const enc = (s: string) =>
    /^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
  const headers = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : '',
    bcc ? `Bcc: ${bcc}` : '',
    `Subject: ${enc(subject)}`,
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

  const tokenRow = calendarQueries.get(userId);
  if (!tokenRow) throw new GmailScopeError('No Google account is connected for this user.');
  if (!hasGmailScope(tokenRow.scope)) throw new GmailScopeError();

  // Anti-spam: cap drafts per rolling hour (the audit log is the counter).
  const lastHour = gmailQueries.countSince(userId, Date.now() - 60 * 60 * 1000);
  if (lastHour >= DRAFTS_PER_HOUR) {
    throw new GmailRateLimitError(`Draft limit reached (${DRAFTS_PER_HOUR}/hour). Try again later.`);
  }

  const gmail = gmailClientFor(userId);
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
  const gmail = gmailClientFor(userId);
  await gmail.users.drafts.delete({ userId: 'me', id: draftId });
  console.log(`[gmail] Draft deleted for user ${userId}: draftId=${draftId}`);
}
