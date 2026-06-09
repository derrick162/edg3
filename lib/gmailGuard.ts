import { calendarQueries, gmailQueries } from './db';
import { hasGmailScope } from './google-auth';

// Security guardrails wrapped around Core's draft mechanics (lib/gmail.ts).
//
// Ownership split: Core owns the *draft behavior* (createGmailDraft/deleteGmailDraft
// in lib/gmail.ts); Security owns the *trust controls* — scope gate, anti-spam rate
// limit, and audit logging (all cross-cutting Security concerns). Core's draftEmail
// handler calls into this module so those controls live in one place and Core's file
// stays the pure mechanics.
//
// Usage in the draftEmail handler:
//   await assertCanDraft(userId);                       // before each createGmailDraft
//   const { id } = await createGmailDraft(userId, msg); // Core's helper
//   recordDraftCreated(userId, msg.to, msg.subject, id);// after success (audit)
//
// Draft-only is structurally guaranteed by Core's module (it never imports
// messages.send); this layer adds who-may-draft, how-often, and what-was-drafted.

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

// True once the user has granted Gmail access (for onboarding/settings re-consent UI).
export function userHasGmailScope(userId: number): boolean {
  return hasGmailScope(calendarQueries.get(userId)?.scope);
}

/**
 * Gate a draft attempt. Call once per draft, BEFORE Core's createGmailDraft.
 * @throws GmailScopeError      if the user hasn't granted gmail.compose (→ re-consent)
 * @throws GmailRateLimitError  if the per-user hourly draft cap is exceeded
 */
export async function assertCanDraft(userId: number): Promise<void> {
  const tokenRow = calendarQueries.get(userId);
  if (!tokenRow) throw new GmailScopeError('No Google account is connected for this user.');
  if (!hasGmailScope(tokenRow.scope)) throw new GmailScopeError();

  const lastHour = gmailQueries.countSince(userId, Date.now() - 60 * 60 * 1000);
  if (lastHour >= DRAFTS_PER_HOUR) {
    throw new GmailRateLimitError(`Draft limit reached (${DRAFTS_PER_HOUR}/hour). Try again later.`);
  }
}

// Append-only audit of a created draft. Call AFTER a successful createGmailDraft.
// recipient + subject are encrypted at rest inside the query layer (#4 crypto).
export function recordDraftCreated(userId: number, to: string, subject: string, draftId: string): void {
  gmailQueries.logDraft(userId, to, subject ?? '', draftId);
  console.log(`[gmail] Draft recorded for user ${userId}: draftId=${draftId}`);
}
