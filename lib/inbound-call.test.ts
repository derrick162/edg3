/**
 * R18 — inbound call rate limit + audit (real in-memory better-sqlite3).
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

const ORIGINAL_DB_PATH = process.env.DB_PATH;
process.env.DB_PATH = ':memory:';

const { getDb, inboundCallQueries, auditLogQueries, USER_SCOPED_DELETE_ORDER } = await import('./db');
const { checkInboundCallRateLimit } = await import('./rateLimit');

afterAll(() => {
  if (ORIGINAL_DB_PATH === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = ORIGINAL_DB_PATH;
});

beforeEach(() => {
  const db = getDb();
  db.prepare('DELETE FROM inbound_call_attempts').run();
  db.prepare("DELETE FROM audit_log WHERE action = 'inbound_call_attempt'").run();
});

const PHONE = '+15551230000';

describe('checkInboundCallRateLimit', () => {
  it('allows the first 5 calls within 24h, blocks the 6th', () => {
    for (let i = 1; i <= 5; i++) {
      const r = checkInboundCallRateLimit(PHONE);
      expect(r.allowed).toBe(true);
    }
    const sixth = checkInboundCallRateLimit(PHONE);
    expect(sixth.allowed).toBe(false);
    expect(sixth.reason).toBe('rate_limit');
  });

  it('does not record a row when the call is blocked (only allowed calls count)', () => {
    for (let i = 0; i < 6; i++) checkInboundCallRateLimit(PHONE);
    const count = inboundCallQueries.countSince(PHONE, 0);
    expect(count).toBe(5); // 5 recorded (allowed), the 6th (blocked) was NOT recorded
  });

  it('ignores attempts older than the 24h window (resets)', () => {
    const old = Date.now() - 25 * 60 * 60 * 1000;
    for (let i = 0; i < 5; i++) inboundCallQueries.record(PHONE, null, old); // 5 stale attempts
    // Window count excludes them → a fresh call is allowed.
    expect(checkInboundCallRateLimit(PHONE).allowed).toBe(true);
  });

  it('is per-phone — one number being capped does not block another', () => {
    for (let i = 0; i < 5; i++) checkInboundCallRateLimit(PHONE);
    expect(checkInboundCallRateLimit(PHONE).allowed).toBe(false);
    expect(checkInboundCallRateLimit('+15559990000').allowed).toBe(true);
  });

  it('stores the userId on the recorded attempt when known', () => {
    checkInboundCallRateLimit(PHONE, 42);
    const row = getDb().prepare('SELECT user_id FROM inbound_call_attempts WHERE phone_number = ?').get(PHONE) as { user_id: number | null };
    expect(row.user_id).toBe(42);
  });
});

describe('auditLogQueries.logInboundCallAttempt', () => {
  it('writes action/user_id/args for a KNOWN user', () => {
    auditLogQueries.logInboundCallAttempt({ phoneNumber: PHONE, userId: 7, outcome: 'allowed', vapiCallId: 'call_abc' });
    const row = getDb().prepare("SELECT user_id, action, args_json, ok FROM audit_log WHERE action = 'inbound_call_attempt'").get() as { user_id: number; action: string; args_json: string; ok: number };
    expect(row.action).toBe('inbound_call_attempt');
    expect(row.user_id).toBe(7);
    expect(row.ok).toBe(1);
    const args = JSON.parse(row.args_json);
    expect(args).toMatchObject({ phoneNumber: PHONE, outcome: 'allowed', vapiCallId: 'call_abc' });
  });

  it('logs an UNKNOWN caller with sentinel user_id 0 and ok=0', () => {
    auditLogQueries.logInboundCallAttempt({ phoneNumber: PHONE, userId: null, outcome: 'unknown_caller' });
    const row = getDb().prepare("SELECT user_id, ok, args_json FROM audit_log WHERE action = 'inbound_call_attempt'").get() as { user_id: number; ok: number; args_json: string };
    expect(row.user_id).toBe(0);
    expect(row.ok).toBe(0);
    expect(JSON.parse(row.args_json).outcome).toBe('unknown_caller');
  });

  it('logs a rate_limited outcome with ok=0', () => {
    auditLogQueries.logInboundCallAttempt({ phoneNumber: PHONE, userId: null, outcome: 'rate_limited' });
    const row = getDb().prepare("SELECT ok FROM audit_log WHERE action = 'inbound_call_attempt'").get() as { ok: number };
    expect(row.ok).toBe(0);
  });
});

describe('account-deletion registration', () => {
  it('inbound_call_attempts is in USER_SCOPED_DELETE_ORDER (drift guard)', () => {
    expect(USER_SCOPED_DELETE_ORDER).toContain('inbound_call_attempts');
  });
});
