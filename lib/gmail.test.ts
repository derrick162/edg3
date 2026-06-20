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
    gmailGet: vi.fn<() => unknown>(() => undefined), // no separate Gmail account linked by default
    gmailUpsert: vi.fn(),
    gmailDelete: vi.fn(),
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
  gmailTokenQueries: { get: h.gmailGet, upsert: h.gmailUpsert, delete: h.gmailDelete },
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

import { deleteDraft, readThread, getRecentEmailSignal, getEmailSignalSubjects, searchEmailsBySubject, truncateAtSentenceBoundary, GmailScopeError } from './gmail';

const WITH_GMAIL = { access_token: 'a', refresh_token: 'r', expiry: null, scope: GOOGLE_SCOPES.join(' ') };
const CAL_ONLY = { access_token: 'a', refresh_token: 'r', expiry: null, scope: CALENDAR_SCOPES.join(' ') };

beforeEach(() => {
  vi.clearAllMocks();
  h.countSince.mockReturnValue(0);
  h.dbGet.mockReturnValue(undefined); // default: no email-signal cache row (clearAllMocks doesn't reset return values)
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

  // R12 Part B — a zero-thread fetch is a no-op; it must NOT write an Activity-tab receipt.
  it('writes NO audit entry when no threads are returned (R12 case 3)', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    h.dbGet.mockReturnValue(undefined);                       // no cache → live fetch
    h.threadsList.mockResolvedValue({ data: { threads: [] } } as any);

    const result = await getRecentEmailSignal(1, { days: 7 });
    expect(result.items).toEqual([]);
    expect(h.auditRecord).not.toHaveBeenCalled();
  });

  // ── R12 — 24h cache gate ──────────────────────────────────────────────────────
  it('R12 case 1: a second call within 24h returns the cached result — no Gmail call, no new audit', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    h.dbGet.mockReturnValue({
      created_at: new Date(Date.now() - 60_000).toISOString(), // 1 min ago
      snapshot_after: JSON.stringify({ subjects: ['Invoice due', 'Sarah re: deck'] }),
    });

    const result = await getRecentEmailSignal(1);
    expect(result.scopeMissing).toBe(false);
    expect(result.items.map(i => i.subject)).toEqual(['Invoice due', 'Sarah re: deck']);
    expect(h.threadsList).not.toHaveBeenCalled();  // no Gmail API call
    expect(h.auditRecord).not.toHaveBeenCalled();  // no duplicate receipt
  });

  it('R12 case 2: a call after 24h makes a fresh Gmail fetch + writes a new audit entry', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    h.dbGet.mockReturnValue({
      created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25h ago → stale
      snapshot_after: JSON.stringify({ subjects: ['old'] }),
    });
    h.threadsList.mockResolvedValue({ data: { threads: [{ id: 'th_1', snippet: 's' }] } } as any);
    h.threadsGet.mockResolvedValue({ data: { messages: [{ id: 'm1', labelIds: ['INBOX'], payload: { headers: [
      { name: 'From', value: 'a@example.com' }, { name: 'Subject', value: 'Fresh thread' }, { name: 'Date', value: 'Mon, 20 Jun 2026' },
    ] } }] } } as any);

    const result = await getRecentEmailSignal(1);
    expect(h.threadsList).toHaveBeenCalled();
    expect(result.items[0].subject).toBe('Fresh thread');
    expect(h.auditRecord).toHaveBeenCalledOnce();
  });

  it('R12 case 4: a non-empty live result writes an audit entry as before', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    h.dbGet.mockReturnValue(undefined); // no cache → live fetch
    h.threadsList.mockResolvedValue({ data: { threads: [{ id: 'th_1', snippet: 's' }] } } as any);
    h.threadsGet.mockResolvedValue({ data: { messages: [{ id: 'm1', labelIds: ['INBOX'], payload: { headers: [
      { name: 'From', value: 'a@example.com' }, { name: 'Subject', value: 'Hello' }, { name: 'Date', value: 'Mon' },
    ] } }] } } as any);

    await getRecentEmailSignal(1);
    expect(h.auditRecord).toHaveBeenCalledOnce();
  });

  it('R12: the briefing path ({ fullBodies: true }) bypasses the cache — always fetches fresh', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    // A fresh cache row exists, but fullBodies must ignore it (needs live bodies for extraction).
    h.dbGet.mockReturnValue({
      created_at: new Date(Date.now() - 60_000).toISOString(),
      snapshot_after: JSON.stringify({ subjects: ['cached subject'] }),
    });
    h.threadsList.mockResolvedValue({ data: { threads: [{ id: 'th_1', snippet: 's' }] } } as any);
    h.threadsGet.mockResolvedValue({ data: { messages: [{ id: 'm1', labelIds: ['INBOX'], payload: {
      mimeType: 'text/plain',
      headers: [{ name: 'From', value: 'a@example.com' }, { name: 'Subject', value: 'Live thread' }, { name: 'Date', value: 'Mon' }],
      body: { data: Buffer.from('the full body', 'utf8').toString('base64') },
    } }] } } as any);

    const result = await getRecentEmailSignal(1, { fullBodies: true });
    expect(h.threadsList).toHaveBeenCalled();           // did NOT use the cache
    expect(result.items[0].subject).toBe('Live thread');
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

  it('query excludes Promotions, Social, and Forums categories', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    h.threadsList.mockResolvedValue({ data: { threads: [] } } as any);
    await getRecentEmailSignal(1, { days: 7 });
    const call = (h.threadsList.mock.calls as any[][])[0]?.[0];
    expect(call?.q).toContain('-category:promotions');
    expect(call?.q).toContain('-category:social');
    expect(call?.q).toContain('-category:forums');
    expect(call?.q).toContain('newer_than:7d');
  });

  it('label safety-net drops threads tagged CATEGORY_PROMOTIONS, CATEGORY_SOCIAL, or CATEGORY_FORUMS', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    h.threadsList.mockResolvedValue({
      data: {
        threads: [
          { id: 'promo_thread', snippet: 'Sale 50% off' },
          { id: 'social_thread', snippet: 'Someone liked your post' },
          { id: 'forums_thread', snippet: 'New reply in thread' },
          { id: 'primary_thread', snippet: 'Meeting tomorrow' },
        ],
      },
    } as any);
    h.threadsGet
      .mockResolvedValueOnce({
        data: { messages: [{ id: 'm1', labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'], payload: { headers: [] } }] },
      } as any)
      .mockResolvedValueOnce({
        data: { messages: [{ id: 'm2', labelIds: ['INBOX', 'CATEGORY_SOCIAL'], payload: { headers: [] } }] },
      } as any)
      .mockResolvedValueOnce({
        data: { messages: [{ id: 'm3', labelIds: ['INBOX', 'CATEGORY_FORUMS'], payload: { headers: [] } }] },
      } as any)
      .mockResolvedValueOnce({
        data: { messages: [{ id: 'm4', labelIds: ['INBOX', 'UNREAD'], payload: { headers: [
          { name: 'From', value: 'contact@example.com' },
          { name: 'Subject', value: 'Meeting tomorrow' },
          { name: 'Date', value: 'Mon, 14 Jun 2026' },
        ] } }] },
      } as any);

    const result = await getRecentEmailSignal(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].threadId).toBe('primary_thread');
    expect(result.items[0].subject).toBe('Meeting tomorrow');
  });

  // ── fullBodies (R9 — full inbound body for fact extraction) ───────────────────
  it('fullBodies:true attaches the inbound body text via readThread', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    h.threadsList.mockResolvedValue({
      data: { threads: [{ id: 'th_body', snippet: 'snippet only' }] },
    } as any);
    h.threadsGet
      // call 1 — metadata for the signal item
      .mockResolvedValueOnce({
        data: { messages: [{ id: 'm1', labelIds: ['INBOX'], payload: { headers: [
          { name: 'From', value: 'colleague@example.com' },
          { name: 'Subject', value: 'Project update' },
          { name: 'Date', value: 'Mon, 14 Jun 2026' },
        ] } }] },
      } as any)
      // call 2 — readThread full-format fetch for the body
      .mockResolvedValueOnce({
        data: { messages: [{ id: 'm1', snippet: 's', labelIds: ['INBOX'], payload: {
          mimeType: 'text/plain',
          headers: [{ name: 'From', value: 'colleague@example.com' }, { name: 'Date', value: 'Mon, 14 Jun 2026' }],
          body: { data: Buffer.from('The launch slipped to Friday.', 'utf8').toString('base64') },
        } }] },
      } as any);

    const result = await getRecentEmailSignal(1, { fullBodies: true });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].body).toBe('The launch slipped to Friday.');
    expect(h.threadsGet).toHaveBeenCalledWith({ userId: 'me', id: 'th_body', format: 'full' });
  });

  it('default (no fullBodies) leaves body undefined and issues no full-body fetch', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    h.threadsList.mockResolvedValue({
      data: { threads: [{ id: 'th_nb', snippet: 's' }] },
    } as any);
    h.threadsGet.mockResolvedValue({
      data: { messages: [{ id: 'm1', labelIds: ['INBOX'], payload: { headers: [
        { name: 'From', value: 'a@example.com' },
        { name: 'Subject', value: 'Hi' },
        { name: 'Date', value: 'Mon, 14 Jun 2026' },
      ] } }] },
    } as any);

    const result = await getRecentEmailSignal(1);
    expect(result.items[0].body).toBeUndefined();
    expect(h.threadsGet).toHaveBeenCalledTimes(1); // metadata only, no readThread
    expect(h.threadsGet).toHaveBeenCalledWith(expect.objectContaining({ format: 'metadata' }));
  });

  it('fullBodies:true skips likely-spam threads — no readThread/body fetch for them', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    h.threadsList.mockResolvedValue({
      data: { threads: [{ id: 'th_spam', snippet: 'deal' }] },
    } as any);
    h.threadsGet.mockResolvedValueOnce({
      data: { messages: [{ id: 'm1', labelIds: ['INBOX'], payload: { headers: [
        { name: 'From', value: 'noreply@marketing.example.com' },
        { name: 'Subject', value: 'Weekly update' },
        { name: 'Date', value: 'Mon, 14 Jun 2026' },
      ] } }] },
    } as any);

    const result = await getRecentEmailSignal(1, { fullBodies: true });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].body).toBeUndefined();        // spam never gets a body
    expect(h.threadsGet).toHaveBeenCalledTimes(1);        // metadata only — readThread skipped
  });
});

// ── truncateAtSentenceBoundary (R9 — clean body truncation) ───────────────────

describe('truncateAtSentenceBoundary', () => {
  it('returns text unchanged when under the cap', () => {
    expect(truncateAtSentenceBoundary('Short body.', 2000)).toBe('Short body.');
  });

  it('cuts at the last period before the cap (no mid-sentence fragment)', () => {
    const text = 'First sentence. Second sentence. ' + 'x'.repeat(50);
    const out = truncateAtSentenceBoundary(text, 33); // cap lands inside the trailing run
    expect(out).toBe('First sentence. Second sentence.');
  });

  it('cuts at the last newline when that is the closest boundary', () => {
    const text = 'Line one\nLine two\n' + 'y'.repeat(50);
    const out = truncateAtSentenceBoundary(text, 18);
    expect(out).toBe('Line one\nLine two');
  });

  it('falls back to a hard cut when no boundary exists in the window', () => {
    const text = 'z'.repeat(100); // no period or newline at all
    const out = truncateAtSentenceBoundary(text, 40);
    expect(out).toHaveLength(40);
    expect(out).toBe('z'.repeat(40));
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

// ── searchEmailsBySubject (R13 T3 — targeted subject search for briefEvent) ────
describe('searchEmailsBySubject', () => {
  it('returns scopeMissing when no Google account / no gmail.readonly', async () => {
    h.calGet.mockReturnValue(undefined);
    expect((await searchEmailsBySubject(1, 'investor')).scopeMissing).toBe(true);
    h.calGet.mockReturnValue(CAL_ONLY); // calendar grant without gmail.readonly
    expect((await searchEmailsBySubject(1, 'investor')).scopeMissing).toBe(true);
    expect(h.threadsList).not.toHaveBeenCalled();
  });

  it('returns matching items (snippet only) and writes NO audit entry', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    h.threadsList.mockResolvedValue({ data: { threads: [{ id: 'th_1', snippet: 'Re: the investor meeting' }] } } as any);
    h.threadsGet.mockResolvedValue({ data: { messages: [{ id: 'm1', labelIds: ['INBOX', 'UNREAD'], payload: { headers: [
      { name: 'From', value: 'vc@example.com' }, { name: 'Subject', value: 'Investor meeting Tues' }, { name: 'Date', value: 'Mon, 20 Jun 2026' },
    ] } }] } } as any);

    const result = await searchEmailsBySubject(1, 'investor');
    expect(result.scopeMissing).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ subject: 'Investor meeting Tues', sender: 'vc@example.com', snippet: 'Re: the investor meeting', isUnread: true });
    expect(result.items[0].body).toBeUndefined();      // snippet-only, no body fetch
    expect(h.auditRecord).not.toHaveBeenCalled();      // targeted search → no Activity receipt
  });

  it('returns empty items when the search matches nothing', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    h.threadsList.mockResolvedValue({ data: { threads: [] } } as any);
    const result = await searchEmailsBySubject(1, 'nonexistent');
    expect(result.items).toEqual([]);
    expect(result.scopeMissing).toBe(false);
  });

  it('builds a subject: query with the days window and caps maxResults', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    h.threadsList.mockResolvedValue({ data: { threads: [] } } as any);
    await searchEmailsBySubject(1, 'quarterly review', { days: 7, max: 5 });
    const call = (h.threadsList.mock.calls as any[][])[0]?.[0];
    expect(call.q).toBe('subject:(quarterly review) newer_than:7d');
    expect(call.maxResults).toBe(5);
  });

  it('sanitizes query metacharacters so an event title cannot break the Gmail query', async () => {
    h.calGet.mockReturnValue(WITH_GMAIL);
    h.threadsList.mockResolvedValue({ data: { threads: [] } } as any);
    await searchEmailsBySubject(1, 'Sync (Q3) "kickoff"');
    const call = (h.threadsList.mock.calls as any[][])[0]?.[0];
    expect(call.q).toBe('subject:(Sync Q3 kickoff) newer_than:30d');
  });
});
