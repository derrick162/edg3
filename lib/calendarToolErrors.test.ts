import { describe, it, expect } from 'vitest';
import { friendlyError, isAlreadyGoneError } from './calendarToolErrors';

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

// C1/C4 — a 404/410 on DELETE means the event is already gone, which is success for a delete.
// isAlreadyGoneError must catch the shapes googleapis throws (numeric code, string code,
// response.status, or message text) and must NOT fire on unrelated errors.
describe('isAlreadyGoneError (C1/C4 — already-deleted detection)', () => {
  const gone: Array<[string, unknown]> = [
    ['numeric code 404',          { code: 404, message: 'Not Found' }],
    ['numeric code 410',          { code: 410, message: 'Resource has been deleted' }],
    ['string code "404"',         { code: '404' }],
    ['response.status 404',       { response: { status: 404 } }],
    ['response.status 410',       { response: { status: 410 } }],
    ['message notFound',          new Error('notFound: the event does not exist')],
    ['message Resource deleted',  new Error('Resource has been deleted')],
    ['message 410 Gone',          new Error('Request failed with status code 410')],
  ];
  for (const [label, err] of gone) {
    it(`${label} → already gone`, () => expect(isAlreadyGoneError(err)).toBe(true));
  }

  const notGone: Array<[string, unknown]> = [
    ['403 permission',  { code: 403, message: 'insufficientPermissions' }],
    ['429 rate limit',  { code: 429, message: 'rateLimitExceeded' }],
    ['500 server',      { code: 500, message: 'Backend Error' }],
    ['timeout',         new Error('ETIMEDOUT')],
    ['generic',         new Error('something unexpected')],
    ['null',            null],
    ['undefined',       undefined],
  ];
  for (const [label, err] of notGone) {
    it(`${label} → NOT already gone`, () => expect(isAlreadyGoneError(err)).toBe(false));
  }
});
