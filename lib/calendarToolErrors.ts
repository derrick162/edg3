// R32 — calendar-tool failure messaging (Core-owned tool behavior). Extracted to lib/ so the
// "every failure is an explicit, unmissable not-done signal" guarantee is unit-testable.
//
// Trust-critical: Edge once said "Done. Locked in 90 minutes…" for an event Google never created.
// Every string a failed mutation returns to the model MUST make it impossible to read the failure
// as a success — lead with "ERROR" and an explicit "did NOT go through / do not say it's done".

export function friendlyError(err: unknown): string {
  const msg = String(err);
  if (msg.includes('No calendar connected')) return "ERROR — that did NOT go through: I can't access your calendar right now (it may need reconnecting in the dashboard). Do not tell the user it's done.";
  if (msg.includes('insufficientPermissions') || msg.includes('403')) return "ERROR — that did NOT go through: I don't have permission to make that change (read-only calendar or organized by someone else). Do not say it's done. Want me to draft a message to the organizer instead?";
  if (msg.includes('notFound') || msg.includes('404')) return "ERROR — that did NOT go through: I couldn't find that event to modify it. Do not say it's done.";
  if (msg.includes('rateLimitExceeded') || msg.includes('429')) return "ERROR — that did NOT go through: Google Calendar is temporarily rate-limiting requests. Do not say it's done — tell the user it didn't save and offer to try again in a moment.";
  if (msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('ECONNRESET') || msg.includes('ECONNREFUSED')) return "ERROR — that did NOT go through: the request timed out and nothing was saved. Do not say it's done — tell the user it didn't go through and offer to retry.";
  return "ERROR — that did NOT go through: something went wrong on my end and nothing was saved. Do not say it's done — tell the user honestly and offer to try again.";
}
