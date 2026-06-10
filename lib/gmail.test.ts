import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GOOGLE_SCOPES, CALENDAR_SCOPES } from './google-auth';

// Mocks for the I/O boundaries the Gmail primitive depends on.
const h = vi.hoisted(() => {
  const draftsCreate = vi.fn(async () => ({ data: { id: 'draft_123', message: { id: 'msg_456', threadId: 'thread_789' } } }));
  const draftsDelete = vi.fn(async () => ({}));
  const messagesSend = vi.fn(); // must NEVER be called — draft-only guarantee
  return {
    draftsCreate,
    draftsDelete,
    messagesSend,
    calGet: vi.fn(),
    upsert: vi.fn(),
    countSince: vi.fn(() => 0),
    logDraft: vi.fn(),
    oauthClient: { setCredentials: vi.fn(), on: vi.fn() },
  };
});

vi.mock('./calendar', () => ({ getOAuthClient: () => h.oauthClient }));
vi.mock('./db', () => ({
  calendarQueries: { get: h.calGet, upsert: h.upsert },
  gmailQueries: { countSince: h.countSince, logDraft: h.logDraft },
}));
vi.mock('googleapis', () => ({
  google: {
    gmail: () => ({
      users: {
        drafts: { create: h.draftsCreate, delete: h.draftsDelete },
        messages: { send: h.messagesSend },
      },
    }),
  },
}));

import { createDraft, deleteDraft, userHasGmailScope, GmailScopeError, GmailRateLimitError } from './gmail';

const WITH_GMAIL = { access_token: 'a', refresh_token: 'r', expiry: null, scope: GOOGLE_SCOPES.join(' ') };
const CAL_ONLY = { access_token: 'a', refresh_token: 'r', expiry: null, scope: CALENDAR_SCOPES.join(' ') };
const validInput = { to: 'friend@example.com', subject: 'Lunch', body: 'Want to grab lunch?' };

beforeEach(() => {
  vi.clearAllMocks();
  h.countSince.mockReturnValue(0);
});

describe('createDraft guardrails', () => {
  it('refuses (GmailScopeError) when no Google account is connected', async () => {
    h.calGet.mockReturnValue(undefined);
    await expect(createDraft(1, validInput)).rejects.toBeInstanceOf(GmailScopeError);
    expect(h.draftsCreate).not.toHaveBeenCalled();
  });

  it('refuses (GmailScopeError) when the user granted calendar but not Gmail', async () => {
    h.calGet.mockReturnValue(CAL_ONLY);
    await expect(createDraft(1, validInput)).rejects.toBeInstanceOf(GmailScopeError);
    expect(h.draftsCreate).not.toHaveBeenCalled();
  });

  it('enforces the per-user hourly rate limit', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    h.countSince.mockReturnValue(20); // default cap
    await expect(createDraft(1, validInput)).rejects.toBeInstanceOf(GmailRateLimitError);
    expect(h.draftsCreate).not.toHaveBeenCalled();
  });

  it('requires a recipient', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    await expect(createDraft(1, { ...validInput, to: '  ' })).rejects.toThrow(/recipient/);
  });

  it('creates a DRAFT (never sends) and audit-logs it', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    const res = await createDraft(1, validInput);

    expect(res).toEqual({ draftId: 'draft_123', messageId: 'msg_456', threadId: 'thread_789' });
    expect(h.draftsCreate).toHaveBeenCalledTimes(1);
    expect(h.messagesSend).not.toHaveBeenCalled(); // ← the whole point
    expect(h.logDraft).toHaveBeenCalledWith(1, 'friend@example.com', 'Lunch', 'draft_123');
  });

  it('encodes the message as base64url that decodes to a valid MIME draft', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    await createDraft(1, validInput);

    const raw = (h.draftsCreate.mock.calls as any[])[0][0].requestBody.message.raw as string;
    expect(raw).not.toMatch(/[+/=]/); // base64url, not standard base64
    const mime = Buffer.from(raw, 'base64url').toString('utf8');
    expect(mime).toContain('To: friend@example.com');
    expect(mime).toContain('Subject: Lunch');
    const body = mime.split('\r\n\r\n')[1];
    expect(Buffer.from(body, 'base64').toString('utf8')).toBe('Want to grab lunch?');
  });
});

describe('deleteDraft (undo inverse op)', () => {
  it('deletes the draft by id and never sends', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    await deleteDraft(1, 'draft_123');
    expect(h.draftsDelete).toHaveBeenCalledWith({ userId: 'me', id: 'draft_123' });
    expect(h.messagesSend).not.toHaveBeenCalled();
  });

  it('throws GmailScopeError when no account is connected', async () => {
    h.calGet.mockReturnValue(undefined);
    await expect(deleteDraft(1, 'draft_123')).rejects.toBeInstanceOf(GmailScopeError);
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
