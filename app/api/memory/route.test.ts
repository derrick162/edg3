/**
 * Security tests for GET /api/memory.
 *
 * Key invariants:
 * - Unauthenticated → 401 (auth gate)
 * - Returns memories + facts scoped to authenticated user ONLY
 * - Cross-user: user A cannot see user B's memories or facts
 * - Memory content is returned decrypted (encryption is transparent to callers)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  session: null as { id: number; email: string; name: string } | null,
  // user_id → memories mapping
  memoriesByUser: {} as Record<number, Array<{ id: number; user_id: number; type: string; content: string; metadata: null; created_at: string }>>,
  factsByUser: {} as Record<number, Array<{ id: number; user_id: number; category: string; entity: string | null; statement: string; learned_at: string; confidence: string; source_briefing_id: null }>>,
}));

vi.mock('@/lib/auth', () => ({
  getSession: async () => h.session,
}));

vi.mock('@/lib/db', () => ({
  memoryQueries: {
    getRecent: (userId: number, _limit?: number) => h.memoriesByUser[userId] ?? [],
  },
  factQueries: {
    getAll: (userId: number) => h.factsByUser[userId] ?? [],
  },
}));

// ── helpers ───────────────────────────────────────────────────────────────────

function makeMemory(userId: number, content: string) {
  return { id: 1, user_id: userId, type: 'transcript', content, metadata: null, created_at: '2026-06-18T10:00:00Z' };
}

function makeFact(userId: number, statement: string) {
  return { id: 1, user_id: userId, category: 'goal', entity: null, statement, learned_at: '2026-06-18T10:00:00Z', confidence: 'high', source_briefing_id: null };
}

// ── auth gate ─────────────────────────────────────────────────────────────────

describe('GET /api/memory — auth gate', () => {
  beforeEach(() => { h.session = null; h.memoriesByUser = {}; h.factsByUser = {}; });

  it('returns 401 when not authenticated', async () => {
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });
});

// ── user scoping (no cross-user leakage) ─────────────────────────────────────
//
// Every memory and fact query is scoped to user.id. Verify that user A cannot
// receive user B's data even if both are valid sessions.

describe('GET /api/memory — user scoping', () => {
  beforeEach(() => {
    h.memoriesByUser = {
      7: [makeMemory(7, 'User 7 secret goal: buy a ranch')],
      99: [makeMemory(99, 'User 99 confidential: launch next week')],
    };
    h.factsByUser = {
      7: [makeFact(7, 'User 7 wants to weigh 135 lbs')],
      99: [makeFact(99, 'User 99 meets with CEO on Fridays')],
    };
  });

  it('returns only user 7 memories when user 7 is logged in', async () => {
    h.session = { id: 7, email: 'u7@test.com', name: 'User7' };
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.memories).toHaveLength(1);
    expect(body.memories[0].content).toContain('User 7 secret goal');
    // Must NOT contain user 99's data
    expect(JSON.stringify(body)).not.toContain('User 99');
    expect(JSON.stringify(body)).not.toContain('launch next week');
  });

  it('returns only user 99 memories when user 99 is logged in', async () => {
    h.session = { id: 99, email: 'u99@test.com', name: 'User99' };
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.memories).toHaveLength(1);
    expect(body.memories[0].content).toContain('User 99 confidential');
    // Must NOT contain user 7's data
    expect(JSON.stringify(body)).not.toContain('User 7 secret goal');
    expect(JSON.stringify(body)).not.toContain('135 lbs');
  });

  it('returns user 7 facts, not user 99 facts', async () => {
    h.session = { id: 7, email: 'u7@test.com', name: 'User7' };
    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();
    expect(body.facts).toHaveLength(1);
    expect(body.facts[0].statement).toContain('135 lbs');
    expect(JSON.stringify(body.facts)).not.toContain('CEO on Fridays');
  });

  it('returns empty arrays (not cross-user data) when user has no memories', async () => {
    h.session = { id: 42, email: 'new@test.com', name: 'NewUser' };
    // userId 42 has no entries — should return [] not bleed from other users
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.memories).toEqual([]);
    expect(body.facts).toEqual([]);
  });
});

// ── content shape ─────────────────────────────────────────────────────────────

describe('GET /api/memory — response shape', () => {
  beforeEach(() => {
    h.session = { id: 7, email: 'u7@test.com', name: 'User7' };
    h.memoriesByUser = { 7: [makeMemory(7, 'I prefer focused mornings')] };
    h.factsByUser = { 7: [makeFact(7, 'goal: launch by September')] };
  });

  it('returns memories and facts arrays', async () => {
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.memories)).toBe(true);
    expect(Array.isArray(body.facts)).toBe(true);
  });

  it('memory content is returned decrypted (mock returns plaintext, verifying round-trip)', async () => {
    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();
    // The mock returns plaintext (since db is mocked); this verifies the route
    // returns whatever memoryQueries.getRecent gives it (no double-encryption)
    expect(body.memories[0].content).toBe('I prefer focused mornings');
  });
});
