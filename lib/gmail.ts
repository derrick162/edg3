import { google } from 'googleapis';
import { getOAuthClient } from './calendar';
import { calendarQueries, gmailQueries } from './db';
import { hasGmailScope } from './google-auth';

// Gmail — DRAFT-ONLY email helper for EDG3.
//
// HARD GUARDRAIL: this module exposes exactly one mutation, createDraft(), which
// calls Gmail's users.drafts.create. There is deliberately NO path to
// users.messages.send anywhere here. Edge can prepare an email for the user to
// review and send themselves from Gmail; it can never send on their behalf.
//
// Trust controls layered on top:
//  - Scope gate: refuses unless the user actually granted gmail.compose (else a
//    typed GmailScopeError so callers can trigger re-consent).
//  - Per-user rate limit (anti-spam): caps drafts/hour (GMAIL_DRAFTS_PER_HOUR).
//  - Audit log: every draft is recorded (recipient/subject encrypted at rest).

const DRAFTS_PER_HOUR = Math.max(1, parseInt(process.env.GMAIL_DRAFTS_PER_HOUR || '20', 10) || 20);

// Thrown when the user hasn't granted Gmail access — callers should prompt re-auth.
export class GmailScopeError extends Error {
  readonly code = 'gmail_scope_missing';
  constructor(message = 'Gmail access not granted (gmail.compose). The user must re-authorize Google.') {
    super(message);
    this.name = 'GmailScopeError';
  }
}

// Thrown when the per-user draft rate limit is exceeded.
export class GmailRateLimitError extends Error {
  readonly code = 'gmail_rate_limited';
  constructor(message: string) {
    super(message);
    this.name = 'GmailRateLimitError';
  }
}

export interface DraftInput {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
}

export interface DraftResult {
  draftId: string;
  messageId: string | null;
}

// True if this user has granted Gmail access (for onboarding/settings re-consent UI).
export function userHasGmailScope(userId: number): boolean {
  return hasGmailScope(calendarQueries.get(userId)?.scope);
}

// RFC 2822 message → base64url, as Gmail's `raw` field expects.
function buildRawMessage({ to, subject, body, cc, bcc }: DraftInput): string {
  // Encode non-ASCII headers per RFC 2047 so subjects with accents/emoji survive.
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
  return Buffer.from(mime, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Create a Gmail DRAFT on the user's behalf. Never sends.
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

  // Anti-spam: cap drafts per rolling hour (audit log is the counter).
  const lastHour = gmailQueries.countSince(userId, Date.now() - 60 * 60 * 1000);
  if (lastHour >= DRAFTS_PER_HOUR) {
    throw new GmailRateLimitError(
      `Draft limit reached (${DRAFTS_PER_HOUR}/hour). Try again later.`,
    );
  }

  const auth = getOAuthClient();
  auth.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token || undefined,
    expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined,
  });
  // Persist refreshed access tokens (preserve the existing scope grant).
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

  const gmail = google.gmail({ version: 'v1', auth });
  const res = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: { message: { raw: buildRawMessage({ ...input, to }) } },
  });

  const draftId = res.data.id;
  if (!draftId) throw new Error('Gmail did not return a draft id');
  const messageId = res.data.message?.id ?? null;

  // Audit (recipient/subject encrypted at rest inside the query layer).
  gmailQueries.logDraft(userId, to, input.subject ?? '', draftId);
  console.log(`[gmail] Draft created for user ${userId}: draftId=${draftId}`);

  return { draftId, messageId };
}
