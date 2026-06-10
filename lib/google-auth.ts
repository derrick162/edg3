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
