/**
 * Tests for lib/whoop.ts — Whoop OAuth primitive.
 * Covers: auth URL generation, code exchange, token refresh, fetch functions,
 * caching, and graceful degradation when client is not configured.
 *
 * Uses unique user IDs per test group to avoid in-memory cache collisions.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';

// ── global fetch mock ────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── hoisted DB mock ──────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  whoopGet:    vi.fn<() => unknown>(() => undefined),
  whoopUpsert: vi.fn(),
  whoopDelete: vi.fn(),
}));

vi.mock('./db', () => ({
  whoopQueries: {
    get:    h.whoopGet,
    upsert: h.whoopUpsert,
    delete: h.whoopDelete,
  },
}));

// ── imports ──────────────────────────────────────────────────────────────────

import {
  getAuthUrl,
  exchangeCode,
  getLatestRecovery,
  getLastSleep,
  getRecentStrain,
  getRecoveryHistory,
  getSleepHistory,
  getStrainHistory,
  hasWhoopConnected,
  whoopFreshnessNote,
  formatWhoopHistoryForCall,
  WHOOP_SCOPES,
} from './whoop';

// ── fixtures ─────────────────────────────────────────────────────────────────

const VALID_TOKEN = {
  id:            1,
  user_id:       1,
  access_token:  'access_tok',
  refresh_token: 'refresh_tok',
  expires_at:    Date.now() + 3_600_000, // 1h from now (valid)
  scope:         'read:recovery read:sleep read:cycles',
  updated_at:    '2026-06-13T00:00:00',
};

const EXPIRED_TOKEN = { ...VALID_TOKEN, expires_at: Date.now() - 60_000 };

// ── env setup ────────────────────────────────────────────────────────────────

beforeAll(() => {
  process.env.WHOOP_CLIENT_ID     = 'test_client_id';
  process.env.WHOOP_CLIENT_SECRET = 'test_client_secret';
  process.env.NEXT_PUBLIC_APP_URL = 'https://www.edg3.ai';
});

afterAll(() => {
  delete process.env.WHOOP_CLIENT_ID;
  delete process.env.WHOOP_CLIENT_SECRET;
  delete process.env.NEXT_PUBLIC_APP_URL;
});

// ── global beforeEach ────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  // Restore hoisted mock defaults after resetAllMocks clears implementations.
  h.whoopGet.mockReturnValue(VALID_TOKEN);
  h.whoopUpsert.mockReturnValue(undefined);
  h.whoopDelete.mockReturnValue(undefined);
  // Default fetch: fail (tests opt-in to success).
  mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
});

// ── 1. getAuthUrl ─────────────────────────────────────────────────────────────

describe('getAuthUrl', () => {
  it('contains all required scopes in the URL', () => {
    const url = getAuthUrl(42);
    for (const scope of WHOOP_SCOPES) {
      expect(decodeURIComponent(url)).toContain(scope);
    }
  });

  it('embeds userId as the state parameter', () => {
    const url = getAuthUrl(99);
    expect(url).toContain('state=99');
  });

  it('uses the correct redirect_uri', () => {
    const url = getAuthUrl(1);
    expect(decodeURIComponent(url)).toContain('https://www.edg3.ai/api/whoop/callback');
  });
});

// ── 2. exchangeCode ───────────────────────────────────────────────────────────

describe('exchangeCode', () => {
  it('throws when Whoop returns a non-OK status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) });
    await expect(exchangeCode('bad_code')).rejects.toThrow('Whoop token exchange failed: 400');
  });

  it('returns token data on success', async () => {
    const tokenData = {
      access_token:  'at_123',
      refresh_token: 'rt_456',
      expires_in:    3600,
      token_type:    'Bearer',
      scope:         'read:recovery',
    };
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => tokenData });
    const result = await exchangeCode('good_code');
    expect(result).toEqual(tokenData);
  });
});

// ── 3. hasWhoopConnected ──────────────────────────────────────────────────────

describe('hasWhoopConnected', () => {
  it('returns false when WHOOP_CLIENT_ID is not set', () => {
    const prev = process.env.WHOOP_CLIENT_ID;
    delete process.env.WHOOP_CLIENT_ID;
    expect(hasWhoopConnected(1)).toBe(false);
    process.env.WHOOP_CLIENT_ID = prev;
  });

  it('returns false when no tokens are stored for the user', () => {
    h.whoopGet.mockReturnValue(undefined);
    expect(hasWhoopConnected(2)).toBe(false);
  });

  it('returns true when a token row exists', () => {
    h.whoopGet.mockReturnValue(VALID_TOKEN);
    expect(hasWhoopConnected(3)).toBe(true);
  });
});

// ── 4. getLatestRecovery ──────────────────────────────────────────────────────

describe('getLatestRecovery', () => {
  it('returns null when client is not configured', async () => {
    const prev = process.env.WHOOP_CLIENT_ID;
    delete process.env.WHOOP_CLIENT_ID;
    expect(await getLatestRecovery(200)).toBeNull();
    process.env.WHOOP_CLIENT_ID = prev;
  });

  it('returns null when no tokens are stored (userId=201)', async () => {
    h.whoopGet.mockReturnValue(undefined);
    expect(await getLatestRecovery(201)).toBeNull();
  });

  it('returns structured recovery data on success (userId=202)', async () => {
    h.whoopGet.mockReturnValue(VALID_TOKEN);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        records: [{
          score_state: 'SCORED',
          score: { recovery_score: 83.4, hrv_rmssd_milli: 42.7, resting_heart_rate: 56 },
        }],
      }),
    });
    const result = await getLatestRecovery(202);
    expect(result).toEqual({ recoveryScore: 83, hrv: 43, restingHeartRate: 56 });
  });

  it('returns null when score_state is not SCORED (userId=203)', async () => {
    h.whoopGet.mockReturnValue(VALID_TOKEN);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        records: [{ score_state: 'PENDING_SCORE', score: {} }],
      }),
    });
    expect(await getLatestRecovery(203)).toBeNull();
  });

  it('uses cache on second call — fetch called only once (userId=204)', async () => {
    h.whoopGet.mockReturnValue(VALID_TOKEN);
    const apiResponse = {
      ok: true,
      json: async () => ({
        records: [{
          score_state: 'SCORED',
          score: { recovery_score: 70, hrv_rmssd_milli: 30, resting_heart_rate: 60 },
        }],
      }),
    };
    mockFetch.mockResolvedValue(apiResponse);
    await getLatestRecovery(204);
    await getLatestRecovery(204);
    // fetch is called once for the token (GET /recovery); second call hits cache.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns null when the API returns an empty records array (userId=206)', async () => {
    h.whoopGet.mockReturnValue(VALID_TOKEN);
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ records: [] }) });
    expect(await getLatestRecovery(206)).toBeNull();
  });

  it('refreshes an expired token before fetching (userId=207)', async () => {
    h.whoopGet.mockReturnValue(EXPIRED_TOKEN);

    const refreshResponse = {
      ok: true,
      json: async () => ({
        access_token:  'new_at',
        refresh_token: 'new_rt',
        expires_in:    3600,
        token_type:    'Bearer',
        scope:         'read:recovery',
      }),
    };
    const dataResponse = {
      ok: true,
      json: async () => ({
        records: [{
          score_state: 'SCORED',
          score: { recovery_score: 75, hrv_rmssd_milli: 35, resting_heart_rate: 58 },
        }],
      }),
    };

    mockFetch
      .mockResolvedValueOnce(refreshResponse) // first call = POST to token endpoint
      .mockResolvedValueOnce(dataResponse);   // second call = GET /recovery

    const result = await getLatestRecovery(207);
    expect(result).not.toBeNull();
    // Token store must have been updated with new tokens.
    expect(h.whoopUpsert).toHaveBeenCalledWith(207, 'new_at', 'new_rt', expect.any(Number), 'read:recovery');
  });
});

// ── 5. getLastSleep ──────────────────────────────────────────────────────────

describe('getLastSleep', () => {
  it('skips nap records and returns the most recent main sleep (userId=210)', async () => {
    h.whoopGet.mockReturnValue(VALID_TOKEN);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        records: [
          { nap: true,  score_state: 'SCORED', score: { stage_summary: { total_in_bed_time_milli: 3_600_000 }, sleep_performance_percentage: 50, sleep_efficiency_percentage: 60 } },
          { nap: false, score_state: 'SCORED', score: { stage_summary: { total_in_bed_time_milli: 28_800_000 }, sleep_performance_percentage: 88, sleep_efficiency_percentage: 91 } },
        ],
      }),
    });
    const result = await getLastSleep(210);
    expect(result).toEqual({ durationMs: 28_800_000, performancePct: 88, efficiencyPct: 91 });
  });

  it('returns null when all records are naps (userId=211)', async () => {
    h.whoopGet.mockReturnValue(VALID_TOKEN);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        records: [
          { nap: true, score_state: 'SCORED', score: { stage_summary: { total_in_bed_time_milli: 3_600_000 }, sleep_performance_percentage: 50, sleep_efficiency_percentage: 60 } },
        ],
      }),
    });
    expect(await getLastSleep(211)).toBeNull();
  });

  it('returns null when no tokens stored (userId=212)', async () => {
    h.whoopGet.mockReturnValue(undefined);
    expect(await getLastSleep(212)).toBeNull();
  });
});

// ── 6. getRecentStrain ───────────────────────────────────────────────────────

describe('getRecentStrain', () => {
  it('returns structured strain data on success (userId=215)', async () => {
    h.whoopGet.mockReturnValue(VALID_TOKEN);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        records: [{
          score_state: 'SCORED',
          score: { strain: 14.567, average_heart_rate: 78 },
        }],
      }),
    });
    const result = await getRecentStrain(215);
    expect(result).toEqual({ strain: 14.6, avgHeartRate: 78 });
  });

  it('returns null when score_state is PENDING_SCORE (userId=216)', async () => {
    h.whoopGet.mockReturnValue(VALID_TOKEN);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ records: [{ score_state: 'PENDING_SCORE', score: {} }] }),
    });
    expect(await getRecentStrain(216)).toBeNull();
  });

  it('returns null when API call fails (userId=217)', async () => {
    h.whoopGet.mockReturnValue(VALID_TOKEN);
    // mockFetch defaults to { ok: false } from beforeEach.
    expect(await getRecentStrain(217)).toBeNull();
  });
});

// ── 7. getRecoveryHistory ─────────────────────────────────────────────────────

// Helpers: make a recovery record with a created_at date.
function makeRecoveryRecord(date: string, score: number, state = 'SCORED') {
  return { created_at: `${date}T06:00:00.000Z`, score_state: state, score: { recovery_score: score, hrv_rmssd_milli: 40, resting_heart_rate: 58 } };
}

describe('getRecoveryHistory', () => {
  it('returns [] when client is not configured (userId=300)', async () => {
    const prev = process.env.WHOOP_CLIENT_ID;
    delete process.env.WHOOP_CLIENT_ID;
    expect(await getRecoveryHistory(300)).toEqual([]);
    process.env.WHOOP_CLIENT_ID = prev;
  });

  it('returns [] when no tokens stored (userId=301)', async () => {
    h.whoopGet.mockReturnValue(undefined);
    expect(await getRecoveryHistory(301)).toEqual([]);
  });

  it('returns mapped history oldest-first, filtering PENDING_SCORE (userId=302)', async () => {
    h.whoopGet.mockReturnValue(VALID_TOKEN);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        records: [
          makeRecoveryRecord('2026-06-13', 80),             // newest — API order
          makeRecoveryRecord('2026-06-12', 45, 'PENDING_SCORE'), // filtered out
          makeRecoveryRecord('2026-06-11', 65),
        ],
      }),
    });
    const result = await getRecoveryHistory(302);
    // Oldest first; PENDING_SCORE excluded.
    expect(result).toEqual([
      { date: '2026-06-11', recoveryScore: 65 },
      { date: '2026-06-13', recoveryScore: 80 },
    ]);
  });

  it('paginates via next_token (userId=303)', async () => {
    h.whoopGet.mockReturnValue(VALID_TOKEN);
    // Page 1 returns next_token; page 2 ends pagination.
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          records: [makeRecoveryRecord('2026-06-13', 80)],
          next_token: 'page2',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          records: [makeRecoveryRecord('2026-06-12', 70)],
        }),
      });
    const result = await getRecoveryHistory(303);
    expect(result).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // nextToken forwarded in the second request URL.
    expect(mockFetch.mock.calls[1][0]).toContain('nextToken=page2');
  });

  it('uses cache on second call — fetch called only once (userId=304)', async () => {
    h.whoopGet.mockReturnValue(VALID_TOKEN);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ records: [makeRecoveryRecord('2026-06-13', 77)] }),
    });
    await getRecoveryHistory(304);
    await getRecoveryHistory(304);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns [] on API failure (userId=305)', async () => {
    h.whoopGet.mockReturnValue(VALID_TOKEN);
    // mockFetch defaults to { ok: false } from beforeEach.
    expect(await getRecoveryHistory(305)).toEqual([]);
  });
});

// ── 8. getSleepHistory ────────────────────────────────────────────────────────

function makeSleepRecord(date: string, durationMs: number, nap = false, state = 'SCORED') {
  return {
    start: `${date}T22:00:00.000Z`,
    nap,
    score_state: state,
    score: { stage_summary: { total_in_bed_time_milli: durationMs }, sleep_performance_percentage: 85, sleep_efficiency_percentage: 90 },
  };
}

describe('getSleepHistory', () => {
  it('returns mapped sleep history, filtering naps (userId=310)', async () => {
    h.whoopGet.mockReturnValue(VALID_TOKEN);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        records: [
          makeSleepRecord('2026-06-13', 28_800_000),        // main sleep
          makeSleepRecord('2026-06-13', 3_600_000, true),   // nap — filtered
          makeSleepRecord('2026-06-12', 25_200_000),
        ],
      }),
    });
    const result = await getSleepHistory(310);
    expect(result).toEqual([
      { date: '2026-06-12', durationMs: 25_200_000 },
      { date: '2026-06-13', durationMs: 28_800_000 },
    ]);
  });

  it('returns [] when all records are naps (userId=311)', async () => {
    h.whoopGet.mockReturnValue(VALID_TOKEN);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        records: [makeSleepRecord('2026-06-13', 3_600_000, true)],
      }),
    });
    expect(await getSleepHistory(311)).toEqual([]);
  });

  it('returns [] on API failure (userId=312)', async () => {
    h.whoopGet.mockReturnValue(VALID_TOKEN);
    expect(await getSleepHistory(312)).toEqual([]);
  });
});

// ── 9. getStrainHistory ───────────────────────────────────────────────────────

function makeStrainRecord(date: string, strain: number, state = 'SCORED') {
  return { start: `${date}T00:00:00.000Z`, score_state: state, score: { strain, average_heart_rate: 75 } };
}

describe('getStrainHistory', () => {
  it('returns mapped strain history oldest-first (userId=315)', async () => {
    h.whoopGet.mockReturnValue(VALID_TOKEN);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        records: [
          makeStrainRecord('2026-06-13', 16.3),
          makeStrainRecord('2026-06-12', 8.55),
        ],
      }),
    });
    const result = await getStrainHistory(315);
    expect(result).toEqual([
      { date: '2026-06-12', strain: 8.6 },
      { date: '2026-06-13', strain: 16.3 },
    ]);
  });

  it('filters out PENDING_SCORE records (userId=316)', async () => {
    h.whoopGet.mockReturnValue(VALID_TOKEN);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        records: [
          makeStrainRecord('2026-06-13', 14.0, 'PENDING_SCORE'),
          makeStrainRecord('2026-06-12', 12.0),
        ],
      }),
    });
    const result = await getStrainHistory(316);
    expect(result).toEqual([{ date: '2026-06-12', strain: 12.0 }]);
  });

  it('returns [] on empty records (userId=317)', async () => {
    h.whoopGet.mockReturnValue(VALID_TOKEN);
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ records: [] }) });
    expect(await getStrainHistory(317)).toEqual([]);
  });
});

describe('whoopFreshnessNote', () => {
  it('returns empty when recovery is today and sleep is last night', () => {
    // sleep starts the evening before → yesterday is fresh for a morning call
    expect(whoopFreshnessNote('2026-06-14', '2026-06-13', '2026-06-14')).toBe('');
  });

  it('flags stale recovery when it is from a previous day', () => {
    const note = whoopFreshnessNote('2026-06-12', '2026-06-13', '2026-06-14');
    expect(note).toContain('recovery is from 2026-06-12');
    expect(note).toContain("today's hasn't synced");
  });

  it('flags stale sleep when older than the night before', () => {
    const note = whoopFreshnessNote('2026-06-14', '2026-06-11', '2026-06-14');
    expect(note).toContain('sleep is from 2026-06-11');
  });

  it('never claims stale when dates are unknown', () => {
    expect(whoopFreshnessNote(undefined, undefined, '2026-06-14')).toBe('');
  });
});

describe('formatWhoopHistoryForCall', () => {
  it('returns empty string when there is no history', () => {
    expect(formatWhoopHistoryForCall([], [], [])).toBe('');
  });

  it('lists recovery by day with an average', () => {
    const rec = [
      { date: '2026-06-12', recoveryScore: 50 },
      { date: '2026-06-13', recoveryScore: 60 },
      { date: '2026-06-14', recoveryScore: 70 },
    ];
    const out = formatWhoopHistoryForCall(rec, [], []);
    expect(out).toContain('LAST 7 DAYS');
    expect(out).toContain('50%, 60%, 70%');
    expect(out).toContain('avg 60%');
  });

  it('averages sleep duration in spoken hours/minutes', () => {
    const slp = [
      { date: '2026-06-13', durationMs: 7 * 3600000 },        // 7h
      { date: '2026-06-14', durationMs: 8 * 3600000 },        // 8h → avg 7h30m
    ];
    expect(formatWhoopHistoryForCall([], slp, [])).toContain('sleep averaged 7 hours 30 minutes');
  });

  it('uses only the most recent 7 days', () => {
    const rec = Array.from({ length: 10 }, (_, i) => ({ date: `2026-06-0${i}`, recoveryScore: i * 10 }));
    const out = formatWhoopHistoryForCall(rec, [], []);
    // newest 7 = scores 30..90; oldest two (0,10,20) dropped → first shown is 30%
    expect(out).toContain('30%, 40%, 50%, 60%, 70%, 80%, 90%');
  });
});
