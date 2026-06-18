// Shared Google OAuth surface for EDG3 (scopes + scope checks).
//
// Why this file exists (Security-owned): the set of Google scopes we request and
// how we reason about which a user has actually *granted* is a trust/secret concern
// shared by Calendar (Core) and Gmail (Security). Centralizing it here keeps the two
// lanes from drifting on scope strings. OAuth-client construction + code exchange
// still live in lib/calendar.ts (Core) — this module only owns the scope contract.

// --- Scope constants ---------------------------------------------------------

export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
] as const;

// gmail.compose lets us create drafts. NOTE: this scope *technically* also permits
// sending — the draft-only limit is enforced in our code (lib/gmail.ts exposes only
// drafts.create; messages.send is never wired), NOT by the scope itself.
//
// ⚠️ PRODUCTION LANDMINE: gmail.compose is a Google *restricted* scope. Public/prod
// use requires Google OAuth app verification + a CASA security assessment (weeks of
// lead time). Fine in "testing" mode with the owner as a test user; hard gate before
// rolling email to all users. Flagged to PM.
export const GMAIL_COMPOSE_SCOPE = 'https://www.googleapis.com/auth/gmail.compose';

// gmail.readonly lets us READ messages — needed for email-reply tracking (Edge reads
// replies to the outreach threads it started). Like compose, this is a Google
// *restricted* scope (verification + CASA before prod). The privacy guardrail is in
// our code: readThread() is only ever called with threadIds Edge itself created.
export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

// The full set we now request at consent time. Calendar scopes first (unchanged),
// Gmail scopes appended — existing users who granted fewer must re-consent.
export const GOOGLE_SCOPES: string[] = [...CALENDAR_SCOPES, GMAIL_COMPOSE_SCOPE, GMAIL_READONLY_SCOPE];

// --- Multi-account token routing ---------------------------------------------
// A user has ONE primary Google account (calendar_tokens — calendar + gmail scopes)
// and may link a SECOND account dedicated to Gmail (gmail_tokens). These accessors are
// the single routing point so callers don't hard-code which table to read.

import { calendarQueries, gmailTokenQueries } from './db';

export type GoogleAccountSource = 'calendar' | 'gmail';

export interface ResolvedGoogleToken {
  access_token: string;
  refresh_token: string | null;
  expiry: string | null;
  scope: string | null;
  email: string | null;
  /** Which table the token came from — refresh write-back must target the same one. */
  source: GoogleAccountSource;
}

/** The primary (calendar) account's tokens, or undefined if not connected. */
export function getCalendarTokens(userId: number): ResolvedGoogleToken | undefined {
  const row = calendarQueries.get(userId);
  if (!row) return undefined;
  return { access_token: row.access_token, refresh_token: row.refresh_token, expiry: row.expiry, scope: row.scope, email: null, source: 'calendar' };
}

/**
 * Gmail account tokens. If a dedicated Gmail account is linked, returns it; otherwise
 * FALLS BACK to the calendar account (existing users draft email via their single grant,
 * which carries gmail.compose). Undefined only if neither account exists.
 */
export function getGmailTokens(userId: number): ResolvedGoogleToken | undefined {
  const g = gmailTokenQueries.get(userId);
  if (g) return { access_token: g.access_token, refresh_token: g.refresh_token, expiry: g.expiry, scope: g.scope, email: g.email, source: 'gmail' };
  return getCalendarTokens(userId);
}

/** Upsert the dedicated Gmail account's tokens (account_type='gmail' equivalent). */
export function saveGmailTokens(
  userId: number,
  tokens: { access_token: string; refresh_token?: string | null; expiry?: string | null; scope?: string | null },
  email?: string | null,
): void {
  gmailTokenQueries.upsert(userId, tokens.access_token, tokens.refresh_token ?? null, tokens.expiry ?? null, tokens.scope ?? null, email ?? null);
}

/** Disconnect ONLY the dedicated Gmail account (leaves the calendar account intact). */
export function disconnectGmailAccount(userId: number): void {
  gmailTokenQueries.delete(userId);
}

/** True if the user has linked a SEPARATE Gmail account (vs. only the calendar grant). */
export function hasLinkedGmailAccount(userId: number): boolean {
  return gmailTokenQueries.get(userId) !== undefined;
}

/**
 * Persist a refreshed access token back to whichever account it came from. Used by the
 * Gmail client's token-refresh listener so a refresh on the gmail account doesn't
 * accidentally overwrite the calendar account's row (and vice versa).
 */
export function persistRefreshedToken(
  userId: number,
  source: GoogleAccountSource,
  t: { access_token: string; refresh_token?: string | null; expiry?: string | null; scope?: string | null },
): void {
  if (source === 'gmail') {
    gmailTokenQueries.upsert(userId, t.access_token, t.refresh_token ?? null, t.expiry ?? null, t.scope ?? null);
  } else {
    calendarQueries.upsert(userId, t.access_token, t.refresh_token ?? '', t.expiry ?? '', t.scope);
  }
}

// --- Granted-scope reasoning -------------------------------------------------
// Google returns the granted scopes as a space-delimited string on the token
// response (`tokens.scope`). We persist it so we can detect re-consent needs
// without a round-trip to Google.

export function parseScopes(scope?: string | null): string[] {
  return (scope || '').split(/\s+/).filter(Boolean);
}

export function hasScope(scope: string | null | undefined, wanted: string): boolean {
  return parseScopes(scope).includes(wanted);
}

// True once the user has granted Gmail compose/draft access.
export function hasGmailScope(scope?: string | null): boolean {
  return hasScope(scope, GMAIL_COMPOSE_SCOPE);
}

// True once the user has granted Gmail read access (for reply tracking).
export function hasGmailReadScope(scope?: string | null): boolean {
  return hasScope(scope, GMAIL_READONLY_SCOPE);
}

// Which of the scopes we now require are NOT yet granted by this user. An existing
// calendar-only user returns [GMAIL_COMPOSE_SCOPE] → prompt re-auth.
export function missingRequiredScopes(scope?: string | null): string[] {
  const granted = new Set(parseScopes(scope));
  return GOOGLE_SCOPES.filter((s) => !granted.has(s));
}

// T4-1 — proactive token health check. Called from the 6am health digest before the
// 7am call. Makes a lightweight calendarList request; if it throws a 401 or invalid_grant,
// increments the auth-failure counter in calendar_tokens (sets reconnect_required after 3+).
// On success: clears the failure counter (token refresh worked). Returns { ok, needsReconnect }.
export async function checkCalendarTokenHealth(userId: number): Promise<{ ok: boolean; needsReconnect: boolean }> {
  // Avoid importing calendar.ts (circular) — dynamically require only what we need.
  // If google-auth-ts can't reach the OAuth client, degrade gracefully.
  try {
    const { calendarQueries } = await import('./db');
    const tokenRow = calendarQueries.get(userId);
    if (!tokenRow) return { ok: false, needsReconnect: false };

    const { google } = await import('googleapis');
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI,
    );
    oauth2Client.setCredentials({
      access_token: tokenRow.access_token,
      refresh_token: tokenRow.refresh_token ?? undefined,
      expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined,
    });

    // Lightweight probe: list one calendar to verify auth works.
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    await calendar.calendarList.list({ maxResults: 1 });

    // Success — clear any prior auth failures.
    calendarQueries.clearAuthFailures(userId);
    return { ok: true, needsReconnect: false };
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err).toLowerCase();
    const isAuthError = msg.includes('invalid_grant') || msg.includes('401') || msg.includes('unauthorized') || msg.includes('token has been expired');
    if (isAuthError) {
      const { calendarQueries } = await import('./db');
      calendarQueries.recordAuthFailure(userId);
      const needsReconnect = calendarQueries.needsReconnect(userId);
      return { ok: false, needsReconnect };
    }
    // Non-auth error (network, quota): don't blame the token.
    return { ok: false, needsReconnect: false };
  }
}
