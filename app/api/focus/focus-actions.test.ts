/**
 * Today's Focus — per-item complete / dismiss route behavior.
 * Real in-memory DB for daily_focus; auth, rate-limit, and the LLM/Google deps are mocked.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

process.env.DB_PATH = ':memory:';

vi.mock('@/lib/db', async () => await import('../../../lib/db'));
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ id: 1, email: 'd@e.com', name: 'Derrick' })) }));
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: () => ({ allowed: true }), rateLimitResponse: () => new Response('rl', { status: 429 }) }));
vi.mock('@/lib/calendar', () => ({ getCalendarEvents: vi.fn(async () => null) }));
vi.mock('@/lib/whoop', () => ({ getLatestRecovery: vi.fn(async () => null) }));
vi.mock('@/lib/gmail', () => ({ getRecentEmailSignal: vi.fn(async () => null) }));
vi.mock('@/lib/focusRecommendation', () => ({ recommendFocusAreas: vi.fn(async () => ({ areas: [], basedOn: [], generatedAt: '', date: '' })) }));

const { getDb, dailyFocusQueries } = await import('../../../lib/db');
const { recommendFocusAreas } = await import('@/lib/focusRecommendation');
const { POST: completePOST } = await import('./complete/route');
const { POST: dismissPOST } = await import('./dismiss/route');
const { NextRequest } = await import('next/server');

afterAll(() => { delete process.env.DB_PATH; });

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date());
const AREAS = [
  { title: 'Area A', rationale: 'ra', confidence: 'high' as const, anchor: 'runway' },
  { title: 'Area B', rationale: 'rb', confidence: 'medium' as const, anchor: 'health' },
  { title: 'Area C', rationale: 'rc', confidence: 'low' as const, anchor: 'standalone' },
];

function req(body: unknown) {
  return new NextRequest('http://localhost/api/focus', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

function seed(areas = AREAS) {
  dailyFocusQueries.upsert(1, TODAY, JSON.stringify(areas), new Date().toISOString());
  dailyFocusQueries.confirm(1, TODAY);
}

beforeEach(() => {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  for (const t of ['daily_focus', 'users']) { try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore */ } }
  db.pragma('foreign_keys = ON');
  db.prepare("INSERT INTO users (id, email, name, password_hash, onboarding_complete, timezone) VALUES (1, 'd@e.com', 'Derrick', 'x', 1, 'UTC')").run();
  vi.mocked(recommendFocusAreas).mockClear();
});

describe('dailyFocusQueries.updateAreas', () => {
  it('overwrites focus_areas (round-trips) without resetting confirmed', () => {
    seed();
    const next = [{ ...AREAS[0], completed: true }, AREAS[1], AREAS[2]];
    dailyFocusQueries.updateAreas(1, TODAY, next);
    const row = dailyFocusQueries.getToday(1, TODAY)!;
    expect(row.confirmed).toBe(1); // updateAreas must NOT reset confirmed (unlike upsert)
    expect(JSON.parse(row.focus_areas)[0].completed).toBe(true);
    expect(JSON.parse(row.focus_areas)).toHaveLength(3);
  });
});

describe('POST /api/focus/complete', () => {
  it('sets completed:true on the matching item, leaves others unchanged', async () => {
    seed();
    const res = await completePOST(req({ title: 'Area B' }));
    const data = await res.json();
    expect(data.ok).toBe(true);
    const byTitle = Object.fromEntries(data.areas.map((a: { title: string; completed?: boolean }) => [a.title, a.completed]));
    expect(byTitle['Area B']).toBe(true);
    expect(byTitle['Area A']).toBeUndefined();
    expect(byTitle['Area C']).toBeUndefined();
    // Persisted.
    expect(JSON.parse(dailyFocusQueries.getToday(1, TODAY)!.focus_areas).find((a: { title: string }) => a.title === 'Area B').completed).toBe(true);
  });

  it('accepts the legacy idOrTitle param', async () => {
    seed();
    const res = await completePOST(req({ idOrTitle: 'Area A' }));
    const data = await res.json();
    expect(data.areas.find((a: { title: string }) => a.title === 'Area A').completed).toBe(true);
  });
});

describe('POST /api/focus/dismiss', () => {
  it('removes the item, generates a replacement, returns the updated 3-item list', async () => {
    seed();
    vi.mocked(recommendFocusAreas).mockResolvedValueOnce({
      areas: [{ title: 'Fresh Focus', rationale: 'rf', confidence: 'high', anchor: 'runway' }],
      basedOn: [], generatedAt: '', date: TODAY,
    });
    const res = await dismissPOST(req({ title: 'Area A' }));
    const data = await res.json();
    expect(data.ok).toBe(true);
    const titles = data.areas.map((a: { title: string }) => a.title);
    expect(titles).not.toContain('Area A');
    expect(titles).toContain('Fresh Focus');
    expect(data.areas).toHaveLength(3);
    // Dismissed title recorded so future recs avoid it.
    expect(dailyFocusQueries.getRecentDismissed(1, 7)).toContain('Area A');
  });

  it('gracefully returns a 2-item list when no replacement is found', async () => {
    seed();
    vi.mocked(recommendFocusAreas).mockResolvedValueOnce({ areas: [], basedOn: [], generatedAt: '', date: TODAY });
    const res = await dismissPOST(req({ title: 'Area A' }));
    const data = await res.json();
    expect(data.areas).toHaveLength(2);
    expect(data.areas.map((a: { title: string }) => a.title)).toEqual(['Area B', 'Area C']);
  });

  it('does not append a replacement that duplicates a remaining item', async () => {
    seed();
    vi.mocked(recommendFocusAreas).mockResolvedValueOnce({
      areas: [{ title: 'Area B', rationale: 'dup', confidence: 'high', anchor: 'health' }],
      basedOn: [], generatedAt: '', date: TODAY,
    });
    const res = await dismissPOST(req({ title: 'Area A' }));
    const data = await res.json();
    expect(data.areas).toHaveLength(2); // dup skipped
  });
});
