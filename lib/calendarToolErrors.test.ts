import { describe, it, expect } from 'vitest';
import { friendlyError } from './calendarToolErrors';

// R32 — Edge once false-confirmed a booking Google never created. Every failure string must make
// it impossible for the model to read the failure as a success.
describe('friendlyError (R32 — no false confirmations)', () => {
  const cases: Array<[string, unknown]> = [
    ['no calendar connected', new Error('No calendar connected')],
    ['permission/403',        new Error('insufficientPermissions: 403')],
    ['not found/404',         new Error('notFound 404')],
    ['rate limit/429',        new Error('rateLimitExceeded 429')],
    ['timeout',               new Error('ETIMEDOUT')],
    ['generic',               new Error('something unexpected')],
  ];

  for (const [label, err] of cases) {
    it(`${label} → explicit not-done signal (never readable as success)`, () => {
      const msg = friendlyError(err);
      // Leads with ERROR so the activity-log FAILURE_RE classifies it as a failure.
      expect(msg.startsWith('ERROR')).toBe(true);
      // States the action did not happen.
      expect(msg).toMatch(/did NOT go through/);
      // Explicitly forbids confirming it as done.
      expect(msg.toLowerCase()).toMatch(/do not (say it's done|tell the user it's done)/);
      // Never contains a bare success word that could be misread.
      expect(msg).not.toMatch(/\b(Done|Booked|Locked in|Created it)\b/);
    });
  }
});
