/**
 * C12 — same-morning memory continuity. A call whose memory hasn't landed yet (still 'calling', or
 * completed <15min ago with facts not extracted) is surfaced as a MINUTES AGO block for the next
 * call. Real in-memory DB; Vapi fetch mocked. Fully guarded — always degrades to ''.
 */
import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';

process.env.DB_PATH = ':memory:';

const { getDb, briefingQueries } = await import('./db');
const {
  findRecentUnprocessedBriefing,
  buildContinuityBlock,
  getRecentCallContinuityBlock,
} = await import('./recentCallContinuity');

afterAll(() => { delete process.env.DB_PATH; });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.VAPI_API_KEY; });

beforeEach(() => {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  for (const t of ['briefings', 'users']) { try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore */ } }
  db.pragma('foreign_keys = ON');
  db.prepare("INSERT INTO users (id, email, name, password_hash, onboarding_complete) VALUES (1, 'd@e.com', 'Derrick', 'x', 1)").run();
});

// Seed a briefing and return its id. Transcript stored via the query layer (encrypted at rest).
function seedBriefing(opts: { status?: string; transcript?: string; vapiCallId?: string; ageMin?: number; factsOk?: boolean } = {}): number {
  const info = briefingQueries.create(1, '[Open call] hi', new Date().toISOString()) as { lastInsertRowid: number };
  const id = Number(info.lastInsertRowid);
  briefingQueries.update(id, {
    status: opts.status ?? 'completed',
    ...(opts.transcript ? { transcript: opts.transcript } : {}),
    ...(opts.vapiCallId ? { vapi_call_id: opts.vapiCallId } : {}),
  });
  if (opts.factsOk) briefingQueries.updateLearningStatus(id, { facts_ok: true });
  if (opts.ageMin) getDb().prepare("UPDATE briefings SET created_at = datetime('now', ?) WHERE id = ?").run(`-${opts.ageMin} minutes`, id);
  return id;
}

describe('buildContinuityBlock', () => {
  it('wraps the transcript tail in a MINUTES AGO block', () => {
    const block = buildContinuityBlock('User: please record my trading plan\nAI: got it');
    expect(block).toContain('MINUTES AGO');
    expect(block).toContain('please record my trading plan');
    expect(block).toMatch(/cut off/i); // drop-acknowledgment guidance present
  });
  it('returns empty string for an empty transcript', () => {
    expect(buildContinuityBlock('')).toBe('');
    expect(buildContinuityBlock('   ')).toBe('');
  });
});

describe('findRecentUnprocessedBriefing', () => {
  it("returns a call still in 'calling' (webhook not done)", () => {
    const id = seedBriefing({ status: 'calling' });
    expect(findRecentUnprocessedBriefing(1)?.id).toBe(id);
  });
  it('returns a recent completed call whose facts have NOT been extracted', () => {
    const id = seedBriefing({ status: 'completed', transcript: 'x' });
    expect(findRecentUnprocessedBriefing(1)?.id).toBe(id);
  });
  it('skips a completed call once facts ARE extracted (normal memory covers it)', () => {
    seedBriefing({ status: 'completed', transcript: 'x', factsOk: true });
    expect(findRecentUnprocessedBriefing(1)).toBeNull();
  });
  it('skips a call older than the 15-minute window', () => {
    seedBriefing({ status: 'calling', ageMin: 30 });
    expect(findRecentUnprocessedBriefing(1)).toBeNull();
  });
  it('excludes the current call (excludeBriefingId)', () => {
    const id = seedBriefing({ status: 'calling' });
    expect(findRecentUnprocessedBriefing(1, id)).toBeNull();
  });
});

describe('getRecentCallContinuityBlock', () => {
  it('injects the block from a stored transcript (no Vapi fetch)', async () => {
    seedBriefing({ status: 'completed', transcript: 'User: record my trading plan — long SOXL' });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const block = await getRecentCallContinuityBlock(1);
    expect(block).toContain('MINUTES AGO');
    expect(block).toContain('long SOXL');
    expect(fetchSpy).not.toHaveBeenCalled(); // stored transcript used directly
  });

  it("fetches from the Vapi API when a 'calling' row has no stored transcript", async () => {
    seedBriefing({ status: 'calling', vapiCallId: 'call_abc' });
    process.env.VAPI_API_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ transcript: 'User: I said please remember this' }) })));
    const block = await getRecentCallContinuityBlock(1);
    expect(block).toContain('please remember this');
  });

  it('returns empty string when there is no recent unprocessed call', async () => {
    seedBriefing({ status: 'completed', transcript: 'x', factsOk: true });
    expect(await getRecentCallContinuityBlock(1)).toBe('');
  });

  it('degrades to empty string when the Vapi fetch fails (call proceeds)', async () => {
    seedBriefing({ status: 'calling', vapiCallId: 'call_abc' });
    process.env.VAPI_API_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    expect(await getRecentCallContinuityBlock(1)).toBe('');
  });
});
