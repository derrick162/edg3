import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GOOGLE_SCOPES, CALENDAR_SCOPES } from './google-auth';

// Mocks for the I/O boundaries the Gmail primitive depends on.
const h = vi.hoisted(() => {
  const draftsCreate = vi.fn(async () => ({ data: { id: 'draft_123', message: { id: 'msg_456', threadId: 'thread_789' } } }));
  const draftsDelete = vi.fn(async () => ({}));
  const messagesSend = vi.fn(); // must NEVER be called — draft-only guarantee
  const threadsGet = vi.fn(async () => ({ data: { messages: [] } }));
  const threadsList = vi.fn(async () => ({ data: { threads: [] } }));
  const dbGet = vi.fn<() => unknown>(() => undefined);
  return {
    draftsCreate,
    draftsDelete,
    messagesSend,
    threadsGet,
    threadsList,
    calGet: vi.fn(),
    upsert: vi.fn(),
    countSince: vi.fn(() => 0),
    logDraft: vi.fn(),
    auditRecord: vi.fn(),
    oauthClient: { setCredentials: vi.fn(), on: vi.fn() },
    dbGet,
  };
});

vi.mock('./calendar', () => ({ getOAuthClient: () => h.oauthClient }));
vi.mock('./db', () => ({
  getDb: () => ({
    prepare: (_sql: string) => ({ get: h.dbGet }),
  }),
  calendarQueries: { get: h.calGet, upsert: h.upsert },
  gmailQueries: { countSince: h.countSince, logDraft: h.logDraft },
  auditLogQueries: { record: h.auditRecord },
}));
vi.mock('googleapis', () => ({
  google: {
    gmail: () => ({
      users: {
        drafts: { create: h.draftsCreate, delete: h.draftsDelete },
        messages: { send: h.messagesSend },
        threads: { get: h.threadsGet, list: h.threadsList },
      },
    }),
  },
}));

import { createDraft, deleteDraft, userHasGmailScope, readThread, getRecentEmailSignal, getEmailSignalSubjects, GmailScopeError, GmailRateLimitError } from './gmail';

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

// ── readThread ────────────────────────────────────────────────────────────────

describe('readThread (reply tracking)', () => {
  it('throws GmailScopeError when no Google account is connected', async () => {
    h.calGet.mockReturnValue(undefined);
    await expect(readThread(1, 'thread_123')).rejects.toBeInstanceOf(GmailScopeError);
    expect(h.threadsGet).not.toHaveBeenCalled();
  });

  it('throws GmailScopeError when the user lacks gmail.readonly scope', async () => {
    h.calGet.mockReturnValue(CAL_ONLY);
    await expect(readThread(1, 'thread_123')).rejects.toBeInstanceOf(GmailScopeError);
    expect(h.threadsGet).not.toHaveBeenCalled();
  });

  it('returns empty array for a thread with no messages', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
h.threadsGet.mockResolvedValue({ data: { messages: [] } } as any);
    const result = await readThread(1, 'thread_123');
    expect(result).toEqual([]);
  });

  it('maps message headers to ThreadMessage fields', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    h.threadsGet.mockResolvedValue({
      data: {
        messages: [{
          id: 'msg_1',
          snippet: 'Sounds great!',
          labelIds: ['INBOX'],
          payload: {
            mimeType: 'text/plain',
            headers: [
              { name: 'From', value: 'friend@example.com' },
              { name: 'Date', value: 'Mon, 10 Jun 2026 09:00:00 +0000' },
            ],
            body: {
              data: Buffer.from('Sounds great!', 'utf8').toString('base64'),
            },
          },
        }],
      },
    } as any);
    const result = await readThread(1, 'thread_123');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('msg_1');
    expect(result[0].from).toBe('friend@example.com');
    expect(result[0].date).toBe('Mon, 10 Jun 2026 09:00:00 +0000');
    expect(result[0].fromMe).toBe(false); // SENT label not present
    expect(result[0].text).toBe('Sounds great!');
  });

  it('sets fromMe=true for messages with the SENT label', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    h.threadsGet.mockResolvedValue({
      data: {
        messages: [{
          id: 'msg_outbound',
          snippet: 'Hi there',
          labelIds: ['SENT'],
          payload: {
            mimeType: 'text/plain',
            headers: [
              { name: 'From', value: 'me@example.com' },
              { name: 'Date', value: 'Mon, 10 Jun 2026 08:00:00 +0000' },
            ],
            body: { data: Buffer.from('Hi there', 'utf8').toString('base64') },
          },
        }],
      },
    } as any);
    const [msg] = await readThread(1, 'thread_123');
    expect(msg.fromMe).toBe(true);
  });

  it('falls back to Gmail snippet when the payload has no body data', async () => {
    // Snippet fallback fires when extractPlainText returns '' — i.e. the payload
    // has no body.data and no parts with body.data.
    h.calGet.mockReturnValue(WITH_GMAIL);
    h.threadsGet.mockResolvedValue({
      data: {
        messages: [{
          id: 'msg_no_body',
          snippet: 'Fallback snippet',
          labelIds: [],
          payload: {
            mimeType: 'text/plain',
            headers: [],
            body: {}, // no data field
          },
        }],
      },
    } as any);
    const [msg] = await readThread(1, 'thread_123');
    expect(msg.text).toBe('Fallback snippet');
  });

  it('calls threads.get with the correct threadId', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    await readThread(1, 'thread_abc');
    expect(h.threadsGet).toHaveBeenCalledWith({ userId: 'me', id: 'thread_abc', format: 'full' });
  });
});

// ── getRecentEmailSignal ──────────────────────────────────────────────────────

describe('getRecentEmailSignal (email prioritization signal)', () => {
  it('returns scopeMissing:true when no Google account is connected', async () => {
    h.calGet.mockReturnValue(undefined);
    const result = await getRecentEmailSignal(1);
    expect(result.scopeMissing).toBe(true);
    expect(result.items).toEqual([]);
    expect(h.threadsList).not.toHaveBeenCalled();
  });

  it('returns scopeMissing:true when user lacks gmail.readonly', async () => {
    h.calGet.mockReturnValue(CAL_ONLY);
    const result = await getRecentEmailSignal(1);
    expect(result.scopeMissing).toBe(true);
    expect(h.threadsList).not.toHaveBeenCalled();
  });

  it('returns empty items when inbox has no threads', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    h.threadsList.mockResolvedValue({ data: { threads: [] } } as any);
    const result = await getRecentEmailSignal(1);
    expect(result.scopeMissing).toBe(false);
    expect(result.items).toEqual([]);
  });

  it('maps thread list + metadata to EmailSignalItem fields', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    h.threadsList.mockResolvedValue({
      data: { threads: [{ id: 'th_1', snippet: 'Foreclosure notice...' }] },
    } as any);
    h.threadsGet.mockResolvedValue({
      data: {
        messages: [
          {
            id: 'msg_1',
            labelIds: ['INBOX', 'UNREAD', 'IMPORTANT'],
            payload: {
              headers: [
                { name: 'From', value: 'bank@example.com' },
                { name: 'Subject', value: 'Foreclosure Notice' },
                { name: 'Date', value: 'Mon, 14 Jun 2026 09:00:00 +0000' },
              ],
            },
          },
        ],
      },
    } as any);

    const result = await getRecentEmailSignal(1, { days: 7, max: 5 });
    expect(result.scopeMissing).toBe(false);
    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.threadId).toBe('th_1');
    expect(item.sender).toBe('bank@example.com');
    expect(item.subject).toBe('Foreclosure Notice');
    expect(item.snippet).toBe('Foreclosure notice...');   // from list response, no body fetch
    expect(item.date).toBe('Mon, 14 Jun 2026 09:00:00 +0000');
    expect(item.isUnread).toBe(true);
    expect(item.isImportant).toBe(true);
  });

  it('uses thread list snippet (not body content) for the snippet field', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    // List response has snippet; threadsGet response has none on the messages
    h.threadsList.mockResolvedValue({
      data: { threads: [{ id: 'th_2', snippet: 'List-sourced snippet' }] },
    } as any);
    h.threadsGet.mockResolvedValue({
      data: { messages: [{ id: 'msg_2', labelIds: [], payload: { headers: [] } }] },
    } as any);

    const [item] = (await getRecentEmailSignal(1)).items;
    expect(item.snippet).toBe('List-sourced snippet');
    // Confirm threads.get was called with metadata format only (no full body)
    expect(h.threadsGet).toHaveBeenCalledWith(expect.objectContaining({
      format: 'metadata',
      metadataHeaders: expect.arrayContaining(['From', 'Subject', 'Date']),
    }));
  });

  it('skips failed thread fetches and returns partial results', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    h.threadsList.mockResolvedValue({
      data: {
        threads: [
          { id: 'th_ok', snippet: 'Good one' },
          { id: 'th_fail', snippet: 'Will fail' },
        ],
      },
    } as any);
    h.threadsGet
      .mockResolvedValueOnce({
        data: { messages: [{ id: 'm1', labelIds: [], payload: { headers: [
          { name: 'From', value: 'ok@example.com' },
          { name: 'Subject', value: 'OK Thread' },
          { name: 'Date', value: 'Mon, 14 Jun 2026' },
        ] } }] },
      } as any)
      .mockRejectedValueOnce(new Error('Network timeout'));

    const result = await getRecentEmailSignal(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].threadId).toBe('th_ok');
  });

  it('records an audit entry: threadCount in argsJson, subjects encrypted in snapshotAfter, never in argsJson', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    h.threadsList.mockResolvedValue({
      data: { threads: [{ id: 'th_1', snippet: 'Test snippet' }] },
    } as any);
    h.threadsGet.mockResolvedValue({
      data: {
        messages: [{
          id: 'm1', labelIds: [], payload: {
            headers: [{ name: 'Subject', value: 'Important update' }],
          },
        }],
      },
    } as any);

    await getRecentEmailSignal(1, { days: 7 });
    expect(h.auditRecord).toHaveBeenCalledOnce();
    const entry = h.auditRecord.mock.calls[0][0] as Record<string, unknown>;
    expect(entry.action).toBe('email_signal_fetch');
    const args = JSON.parse(entry.argsJson as string) as Record<string, unknown>;
    expect(args.days).toBe(7);
    expect(args.threadCount).toBe(1);
    // argsJson must NEVER contain email content
    expect(entry.argsJson).not.toContain('snippet');
    expect(entry.argsJson).not.toContain('subject');
    expect(entry.argsJson).not.toContain('Important');
    // Subjects stored in snapshotAfter (encrypted — or plaintext in test env without DATA_ENCRYPTION_KEY)
    expect(entry.snapshotAfter).toBeTruthy();
    const snap = JSON.parse(entry.snapshotAfter as string) as { subjects: string[] };
    expect(snap.subjects).toContain('Important update');
  });

  it('sets snapshotAfter to null when no threads are returned', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    h.threadsList.mockResolvedValue({ data: { threads: [] } } as any);

    await getRecentEmailSignal(1, { days: 7 });
    const entry = h.auditRecord.mock.calls[0][0] as Record<string, unknown>;
    expect(entry.snapshotAfter).toBeNull();
  });

  it('caps max threads at EMAIL_SIGNAL_CAP (50) regardless of opts.max', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    h.threadsList.mockResolvedValue({ data: { threads: [] } } as any);
    await getRecentEmailSignal(1, { max: 999 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = (h.threadsList.mock.calls as any[][])[0]?.[0];
    expect(call?.maxResults).toBeLessThanOrEqual(50);
  });

  it('fetches inbox only (labelIds: INBOX)', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    h.threadsList.mockResolvedValue({ data: { threads: [] } } as any);
    await getRecentEmailSignal(1);
    expect(h.threadsList).toHaveBeenCalledWith(expect.objectContaining({
      labelIds: ['INBOX'],
    }));
  });
});

// ── getEmailSignalSubjects ────────────────────────────────────────────────────

describe('getEmailSignalSubjects', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns subjects from a valid email_signal_fetch audit entry', () => {
    const payload = JSON.stringify({ subjects: ['Invoice due', 'Meeting tomorrow'] });
    h.dbGet.mockReturnValue({ snapshot_after: payload });
    const result = getEmailSignalSubjects(1, 42);
    expect(result).toEqual(['Invoice due', 'Meeting tomorrow']);
  });

  it('returns null when the audit entry does not exist (wrong user or ID)', () => {
    h.dbGet.mockReturnValue(undefined);
    expect(getEmailSignalSubjects(1, 999)).toBeNull();
  });

  it('returns null when snapshot_after is null (no threads were reviewed)', () => {
    h.dbGet.mockReturnValue({ snapshot_after: null });
    expect(getEmailSignalSubjects(1, 10)).toBeNull();
  });

  it('returns null when snapshot_after is malformed JSON', () => {
    h.dbGet.mockReturnValue({ snapshot_after: 'not-valid-json' });
    expect(getEmailSignalSubjects(1, 10)).toBeNull();
  });

  it('returns null when subjects field is missing from the parsed object', () => {
    h.dbGet.mockReturnValue({ snapshot_after: JSON.stringify({ other: 'data' }) });
    expect(getEmailSignalSubjects(1, 10)).toBeNull();
  });

  it('filters out non-string entries in the subjects array', () => {
    const payload = JSON.stringify({ subjects: ['Good subject', 42, null, 'Another'] });
    h.dbGet.mockReturnValue({ snapshot_after: payload });
    const result = getEmailSignalSubjects(1, 10);
    expect(result).toEqual(['Good subject', 'Another']);
  });

  it('passes userId and auditId to the DB query (user-scoped, no cross-user)', () => {
    h.dbGet.mockReturnValue(undefined);
    getEmailSignalSubjects(7, 123);
    // h.dbGet is called by prepare(...).get(id, userId)
    expect(h.dbGet).toHaveBeenCalledWith(123, 7);
  });
});
