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
