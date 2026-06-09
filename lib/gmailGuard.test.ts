import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GOOGLE_SCOPES, CALENDAR_SCOPES } from './google-auth';

const h = vi.hoisted(() => ({
  calGet: vi.fn(),
  countSince: vi.fn(() => 0),
  logDraft: vi.fn(),
}));

vi.mock('./db', () => ({
  calendarQueries: { get: h.calGet },
  gmailQueries: { countSince: h.countSince, logDraft: h.logDraft },
}));

import {
  assertCanDraft,
  recordDraftCreated,
  userHasGmailScope,
  GmailScopeError,
  GmailRateLimitError,
} from './gmailGuard';

const WITH_GMAIL = { scope: GOOGLE_SCOPES.join(' ') };
const CAL_ONLY = { scope: CALENDAR_SCOPES.join(' ') };

beforeEach(() => {
  vi.clearAllMocks();
  h.countSince.mockReturnValue(0);
});

describe('assertCanDraft', () => {
  it('throws GmailScopeError when no Google account is connected', async () => {
    h.calGet.mockReturnValue(undefined);
    await expect(assertCanDraft(1)).rejects.toBeInstanceOf(GmailScopeError);
  });

  it('throws GmailScopeError when only calendar scope is granted (existing user)', async () => {
    h.calGet.mockReturnValue(CAL_ONLY);
    await expect(assertCanDraft(1)).rejects.toBeInstanceOf(GmailScopeError);
  });

  it('throws GmailRateLimitError at the hourly cap', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    h.countSince.mockReturnValue(20); // default GMAIL_DRAFTS_PER_HOUR
    await expect(assertCanDraft(1)).rejects.toBeInstanceOf(GmailRateLimitError);
  });

  it('resolves when the user has Gmail scope and is under the cap', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    h.countSince.mockReturnValue(5);
    await expect(assertCanDraft(1)).resolves.toBeUndefined();
    // counts within the last hour
    expect(h.countSince).toHaveBeenCalledWith(1, expect.any(Number));
    const since = (h.countSince.mock.calls as any[])[0][1] as number;
    expect(Date.now() - since).toBeGreaterThanOrEqual(60 * 60 * 1000 - 1000);
  });
});

describe('recordDraftCreated', () => {
  it('writes the audit row (recipient/subject encrypted in the query layer)', () => {
    recordDraftCreated(7, 'friend@example.com', 'Lunch', 'draft_123');
    expect(h.logDraft).toHaveBeenCalledWith(7, 'friend@example.com', 'Lunch', 'draft_123');
  });

  it('tolerates a null/empty subject', () => {
    recordDraftCreated(7, 'a@b.com', undefined as unknown as string, 'd1');
    expect(h.logDraft).toHaveBeenCalledWith(7, 'a@b.com', '', 'd1');
  });
});

describe('userHasGmailScope', () => {
  it('reflects the stored grant', () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    expect(userHasGmailScope(1)).toBe(true);
    h.calGet.mockReturnValue(CAL_ONLY);
    expect(userHasGmailScope(1)).toBe(false);
    h.calGet.mockReturnValue(undefined);
    expect(userHasGmailScope(1)).toBe(false);
  });
});
