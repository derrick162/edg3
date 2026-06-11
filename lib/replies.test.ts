import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist mock factories so vi.mock() closures can reference them ──────────────
const h = vi.hoisted(() => {
  return {
    listOpen: vi.fn(() => [] as unknown[]),
    markSeen: vi.fn(),
    setStatus: vi.fn(),
    notifCreate: vi.fn(),
    readThread: vi.fn(async () => [] as unknown[]),
  };
});

vi.mock('./db', () => ({
  watchedThreadQueries: {
    listOpen: h.listOpen,
    markSeen: h.markSeen,
    setStatus: h.setStatus,
  },
  notificationQueries: {
    create: h.notifCreate,
  },
}));

vi.mock('./gmail', () => ({
  readThread: h.readThread,
  GmailScopeError: class GmailScopeError extends Error {
    readonly code = 'gmail_scope_missing';
    constructor(msg?: string) { super(msg ?? 'scope missing'); }
  },
}));

// Stub out the Anthropic SDK so understandReply uses the deterministic fallback.
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: vi.fn(async () => { throw new Error('no sdk in tests'); }) }; },
}));

import { checkOutreachReplies } from './replies';

// Minimal WatchedThread shape
function thread(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    user_id: 7,
    thread_id: 'thread_abc',
    recipient: 'Alice',
    context: 'when she can come by',
    event_title: 'Plumbing',
    event_date: '2026-06-10',
    last_seen_message_id: null,
    status: 'open',
    created_at: Date.now(),
    ...overrides,
  };
}

// Minimal ThreadMessage shape
function msg(overrides: Record<string, unknown> = {}) {
  return { id: 'msg_1', from: 'alice@example.com', date: 'Wed, 10 Jun 2026', fromMe: false, text: 'I can come Thursday 2pm.', ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkOutreachReplies', () => {
  it('returns [] immediately when the user has no watched threads', async () => {
    h.listOpen.mockReturnValue([]);
    const result = await checkOutreachReplies(7);
    expect(result).toEqual([]);
    expect(h.readThread).not.toHaveBeenCalled();
  });

  it('degrades to [] when readThread throws GmailScopeError (no read scope yet)', async () => {
    h.listOpen.mockReturnValue([thread()]);
    const { GmailScopeError } = await import('./gmail');
    h.readThread.mockRejectedValue(new (GmailScopeError as any)('scope missing'));
    const result = await checkOutreachReplies(7);
    expect(result).toEqual([]);
    expect(h.notifCreate).not.toHaveBeenCalled();
  });

  it('degrades to [] on any unexpected error from readThread', async () => {
    h.listOpen.mockReturnValue([thread()]);
    h.readThread.mockRejectedValue(new Error('network failure'));
    const result = await checkOutreachReplies(7);
    expect(result).toEqual([]);
  });

  it('advances last_seen but returns no update when all messages are already seen', async () => {
    const seenMsg = msg({ id: 'msg_seen' });
    h.listOpen.mockReturnValue([thread({ last_seen_message_id: 'msg_seen' })]);
    h.readThread.mockResolvedValue([seenMsg]);

    const result = await checkOutreachReplies(7);

    expect(result).toEqual([]);
    // markSeen is still called to keep the pointer current
    expect(h.markSeen).toHaveBeenCalledWith(1, 'msg_seen');
    expect(h.notifCreate).not.toHaveBeenCalled();
  });

  it('returns [] and does not call markSeen when the thread is empty', async () => {
    h.listOpen.mockReturnValue([thread()]);
    h.readThread.mockResolvedValue([]);
    const result = await checkOutreachReplies(7);
    expect(result).toEqual([]);
    expect(h.markSeen).not.toHaveBeenCalled();
  });

  it('surfaces a new inbound reply, creates a notification, and advances last_seen', async () => {
    const inbound = msg({ id: 'msg_new', fromMe: false, text: 'Thursday 2pm works for me.' });
    h.listOpen.mockReturnValue([thread({ last_seen_message_id: null })]);
    h.readThread.mockResolvedValue([inbound]);

    const result = await checkOutreachReplies(7);

    expect(result).toHaveLength(1);
    expect(result[0].recipient).toBe('Alice');
    expect(result[0].eventTitle).toBe('Plumbing');
    // understandReply uses the deterministic fallback (Anthropic SDK is stubbed to throw)
    expect(result[0].summary).toBeTruthy();
    expect(result[0].suggestedAction).toBeTruthy();

    expect(h.notifCreate).toHaveBeenCalledTimes(1);
    expect(h.notifCreate.mock.calls[0][0]).toBe(7); // userId
    expect(h.notifCreate.mock.calls[0][1]).toBe('reply'); // type

    expect(h.markSeen).toHaveBeenCalledWith(1, 'msg_new');
  });

  it('skips messages the user sent themselves (fromMe = true)', async () => {
    const outbound = msg({ id: 'msg_out', fromMe: true, text: 'Hi Alice, are you free?' });
    const inbound  = msg({ id: 'msg_in',  fromMe: false, text: 'Yes, Thursday 2pm.' });
    h.listOpen.mockReturnValue([thread()]);
    h.readThread.mockResolvedValue([outbound, inbound]);

    const result = await checkOutreachReplies(7);

    // Only the inbound message triggers an update
    expect(result).toHaveLength(1);
    expect(h.notifCreate).toHaveBeenCalledTimes(1);
    expect(h.markSeen).toHaveBeenCalledWith(1, 'msg_in');
  });

  it('deduplicates using last_seen: only processes messages after the pointer', async () => {
    const old1  = msg({ id: 'msg_1', text: 'Old reply 1.' });
    const old2  = msg({ id: 'msg_2', text: 'Old reply 2.' });
    const fresh = msg({ id: 'msg_3', text: 'Fresh reply.' });
    // last_seen points at msg_2 — only msg_3 is "fresh"
    h.listOpen.mockReturnValue([thread({ last_seen_message_id: 'msg_2' })]);
    h.readThread.mockResolvedValue([old1, old2, fresh]);

    const result = await checkOutreachReplies(7);

    expect(result).toHaveLength(1);
    expect(h.notifCreate).toHaveBeenCalledTimes(1);
    expect(h.markSeen).toHaveBeenCalledWith(1, 'msg_3');
  });

  it('does NOT replay the whole thread when last_seen_message_id is no longer present — re-anchors to newest, no duplicate notification', async () => {
    // Regression: a lost marker (message deleted/trimmed, or id changed) used to make findIndex
    // return -1, so slice(-1 + 1) replayed from the start and re-notified every old reply.
    const old1 = msg({ id: 'msg_a', text: 'Old reply 1.' });
    const old2 = msg({ id: 'msg_b', text: 'Old reply 2.' });
    h.listOpen.mockReturnValue([thread({ last_seen_message_id: 'no_longer_here' })]);
    h.readThread.mockResolvedValue([old1, old2]);

    const result = await checkOutreachReplies(7);

    expect(result).toEqual([]);
    expect(h.notifCreate).not.toHaveBeenCalled();          // <-- the bug: would have fired for old replies
    expect(h.markSeen).toHaveBeenCalledWith(1, 'msg_b');   // re-anchored to newest
  });

  it('processes multiple open threads independently', async () => {
    h.listOpen.mockReturnValue([
      thread({ id: 1, thread_id: 'thread_a', recipient: 'Alice' }),
      thread({ id: 2, thread_id: 'thread_b', recipient: 'Bob' }),
    ]);
    h.readThread
      .mockResolvedValueOnce([msg({ id: 'a1' })])
      .mockResolvedValueOnce([msg({ id: 'b1' })]);

    const result = await checkOutreachReplies(7);

    expect(result).toHaveLength(2);
    expect(h.notifCreate).toHaveBeenCalledTimes(2);
    expect(h.markSeen).toHaveBeenCalledTimes(2);
  });
});
