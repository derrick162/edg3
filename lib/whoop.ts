// WHOOP data fetch primitive — Security owns this.
// Handles OAuth, encrypted token storage, refresh, and rate-limit-aware caching.
// Core consumes the three public fetch functions in lib/briefing.ts.
//
// Graceful degradation: all public fetch functions return null when
// WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET are unset, or on any failure. Never throws.
//
// Endpoints verified against developer.whoop.com (v2 API, June 2026):
//   Auth:   https://api.prod.whoop.com/oauth/oauth2/auth
//   Token:  https://api.prod.whoop.com/oauth/oauth2/token
//   API:    https://api.prod.whoop.com/developer/v2/{recovery,activity/sleep,cycle}

import { randomBytes } from 'crypto';
import { whoopQueries } from './db';
import { prevDay } from './time';

const AUTH_URL  = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const API_BASE  = 'https://api.prod.whoop.com/developer/v2';

export const WHOOP_SCOPES = [
  'read:recovery',
  'read:sleep',
  'read:cycles',
  'read:workout',
  'read:profile',
  'offline',
] as const;

// --- Private helpers ---------------------------------------------------------

function clientConfigured(): boolean {
  return !!(process.env.WHOOP_CLIENT_ID && process.env.WHOOP_CLIENT_SECRET);
}

function getRedirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://www.edg3.ai';
  return `${base}/api/whoop/callback`;
}

// --- OAuth surface (used by routes) -----------------------------------------

export function getAuthUrl(userId: number): string {
  const params = new URLSearchParams({
    client_id:     process.env.WHOOP_CLIENT_ID!,
    redirect_uri:  getRedirectUri(),
    response_type: 'code',
    scope:         WHOOP_SCOPES.join(' '),
    // WHOOP rejects state < 8 chars (invalid_state). Pad with random; userId stays parseInt-recoverable in the callback.
    state:         `${userId}-${randomBytes(8).toString('hex')}`,
  });
  return `${AUTH_URL}?${params}`;
}

interface TokenResponse {
  access_token:  string;
  refresh_token: string;
  expires_in:    number; // seconds
  token_type:    string;
  scope:         string;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  getRedirectUri(),
      client_id:     process.env.WHOOP_CLIENT_ID!,
      client_secret: process.env.WHOOP_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) throw new Error(`Whoop token exchange failed: ${res.status}`);
  return res.json() as Promise<TokenResponse>;
}

// --- Token management --------------------------------------------------------

async function refreshAccessToken(
  userId: number,
  refreshToken: string,
): Promise<string | null> {
  try {
    const res = await fetch(TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
        client_id:     process.env.WHOOP_CLIENT_ID!,
        client_secret: process.env.WHOOP_CLIENT_SECRET!,
      }),
    });
    if (!res.ok) return null;
    const data: TokenResponse = await res.json();
    const expiresAt = Date.now() + data.expires_in * 1000;
    whoopQueries.upsert(userId, data.access_token, data.refresh_token, expiresAt, data.scope);
    return data.access_token;
  } catch {
    return null;
  }
}

// Returns a valid access token (refreshing if within 5 min of expiry), or null.
async function getAccessToken(userId: number): Promise<string | null> {
  if (!clientConfigured()) return null;
  const stored = whoopQueries.get(userId);
  if (!stored) return null;

  if (Date.now() < stored.expires_at - 5 * 60 * 1000) {
    return stored.access_token;
  }
  return refreshAccessToken(userId, stored.refresh_token);
}

// --- In-memory cache (1-hour TTL — one briefing pull per day) ---------------

interface CacheEntry<T> { data: T; fetchedAt: number }
const recoveryCache    = new Map<number, CacheEntry<WhoopRecovery | null>>();
const sleepCache       = new Map<number, CacheEntry<WhoopSleep | null>>();
const strainCache      = new Map<number, CacheEntry<WhoopStrain | null>>();
// History caches — keyed by userId; assumes default days=14 per PM spec.
const recoveryHistCache = new Map<number, CacheEntry<WhoopRecoveryDay[]>>();
const sleepHistCache    = new Map<number, CacheEntry<WhoopSleepDay[]>>();
const strainHistCache   = new Map<number, CacheEntry<WhoopStrainDay[]>>();
const CACHE_TTL_MS     = 60 * 60 * 1000;

function fromCache<T>(cache: Map<number, CacheEntry<T>>, userId: number): T | undefined {
  const entry = cache.get(userId);
  if (!entry) return undefined;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) { cache.delete(userId); return undefined; }
  return entry.data;
}

function setCache<T>(cache: Map<number, CacheEntry<T>>, userId: number, data: T): void {
  cache.set(userId, { data, fetchedAt: Date.now() });
}

// --- Raw API types -----------------------------------------------------------

interface WhoopRecoveryRecord {
  created_at?: string; // ISO 8601 — when the score was computed (morning after sleep)
  score_state: string;
  score: { recovery_score: number; hrv_rmssd_milli: number; resting_heart_rate: number };
}

interface WhoopSleepRecord {
  start?: string; // ISO 8601 — when the sleep session began
  nap: boolean;
  score_state: string;
  score: {
    stage_summary: { total_in_bed_time_milli: number };
    sleep_performance_percentage: number;
    sleep_efficiency_percentage: number;
  };
}

interface WhoopCycleRecord {
  start?: string; // ISO 8601 — when the physiological cycle began (~ midnight local)
  score_state: string;
  score: { strain: number; average_heart_rate: number };
}

interface WhoopListResponse<T> { records: T[]; next_token?: string }

// --- API call helper ---------------------------------------------------------

async function whoopGet<T>(
  userId: number,
  path: string,
  params?: Record<string, string>,
): Promise<T | null> {
  const token = await getAccessToken(userId);
  if (!token) return null;
  const url = new URL(`${API_BASE}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json() as Promise<T>;
}

// Paginator — follows next_token until all records are fetched or maxRecords hit.
async function whoopGetAll<T>(
  userId: number,
  path: string,
  params: Record<string, string>,
  maxRecords = 50,
): Promise<T[]> {
  const all: T[] = [];
  let nextToken: string | undefined;

  do {
    const p = nextToken ? { ...params, nextToken } : params;
    const page = await whoopGet<WhoopListResponse<T>>(userId, path, p);
    if (!page?.records?.length) break;
    all.push(...page.records);
    nextToken = page.next_token;
  } while (nextToken && all.length < maxRecords);

  return all;
}

// --- Public types (for Core to consume) -------------------------------------

export interface WhoopRecovery {
  recoveryScore:    number; // 0–100
  hrv:              number; // RMSSD in ms (rounded)
  restingHeartRate: number; // bpm
  date?:            string; // YYYY-MM-DD the score was computed (morning after sleep)
}

export interface WhoopSleep {
  durationMs:     number; // total in-bed time
  performancePct: number; // 0–100
  efficiencyPct:  number; // 0–100
  date?:          string; // YYYY-MM-DD the sleep session began (evening before a morning wake)
}

export interface WhoopStrain {
  strain:         number; // 0–21 (1 decimal)
  avgHeartRate:   number; // bpm
}

// History shapes — clean minimal arrays for Core's trend analysis.
export interface WhoopRecoveryDay { date: string; recoveryScore: number } // date: YYYY-MM-DD
export interface WhoopSleepDay    { date: string; durationMs:    number }
export interface WhoopStrainDay   { date: string; strain:        number }

// --- Public fetch functions --------------------------------------------------

export async function getLatestRecovery(userId: number): Promise<WhoopRecovery | null> {
  if (!clientConfigured()) return null;
  const cached = fromCache(recoveryCache, userId);
  if (cached !== undefined) return cached;

  try {
    const data = await whoopGet<WhoopListResponse<WhoopRecoveryRecord>>(
      userId, '/recovery', { limit: '10' },
    );
    // Find the most recent SCORED record — WHOOP often has a pending/unscored record on
    // top, so limit:1 would return null even when scored data exists just below it.
    const rec = data?.records?.find(r => r.score_state === 'SCORED');
    if (!rec) return null; // don't cache "no data" — it may sync within the hour
    const result: WhoopRecovery = {
      recoveryScore:    Math.round(rec.score.recovery_score),
      hrv:              Math.round(rec.score.hrv_rmssd_milli),
      restingHeartRate: rec.score.resting_heart_rate,
      date:             rec.created_at?.slice(0, 10),
    };
    setCache(recoveryCache, userId, result);
    return result;
  } catch {
    return null; // transient failure — don't cache it
  }
}

export async function getLastSleep(userId: number): Promise<WhoopSleep | null> {
  if (!clientConfigured()) return null;
  const cached = fromCache(sleepCache, userId);
  if (cached !== undefined) return cached;

  try {
    const data = await whoopGet<WhoopListResponse<WhoopSleepRecord>>(
      userId, '/activity/sleep', { limit: '10' },
    );
    // Skip naps — find the most recent SCORED main sleep session.
    const rec = data?.records?.find(r => !r.nap && r.score_state === 'SCORED');
    if (!rec) return null; // don't cache "no data" — it may sync within the hour
    const result: WhoopSleep = {
      durationMs:     rec.score.stage_summary.total_in_bed_time_milli,
      performancePct: Math.round(rec.score.sleep_performance_percentage),
      efficiencyPct:  Math.round(rec.score.sleep_efficiency_percentage),
      date:           rec.start?.slice(0, 10),
    };
    setCache(sleepCache, userId, result);
    return result;
  } catch {
    return null; // transient failure — don't cache it
  }
}

export async function getRecentStrain(userId: number): Promise<WhoopStrain | null> {
  if (!clientConfigured()) return null;
  const cached = fromCache(strainCache, userId);
  if (cached !== undefined) return cached;

  try {
    const data = await whoopGet<WhoopListResponse<WhoopCycleRecord>>(
      userId, '/cycle', { limit: '10' },
    );
    // Most recent SCORED cycle — see getLatestRecovery note on the limit:1 pitfall.
    const rec = data?.records?.find(r => r.score_state === 'SCORED');
    if (!rec) return null; // don't cache "no data"
    const result: WhoopStrain = {
      strain:       Math.round(rec.score.strain * 10) / 10,
      avgHeartRate: rec.score.average_heart_rate,
    };
    setCache(strainCache, userId, result);
    return result;
  } catch {
    return null; // transient failure — don't cache it
  }
}

/**
 * Human note when WHOOP readings aren't current, for the morning briefing / live call.
 * Recovery is computed each morning, so "fresh" = dated today. Sleep starts the evening
 * before a morning wake, so "fresh" = dated today or yesterday. Returns '' when both are
 * current (or their dates are unknown — never claim stale without a date).
 *
 * @param recoveryDate WhoopRecovery.date (YYYY-MM-DD) or undefined
 * @param sleepDate    WhoopSleep.date (YYYY-MM-DD) or undefined
 * @param today        today's date in the user's timezone (YYYY-MM-DD)
 */
export function whoopFreshnessNote(
  recoveryDate: string | undefined,
  sleepDate: string | undefined,
  today: string,
): string {
  const stale: string[] = [];
  if (recoveryDate && recoveryDate < today) stale.push(`recovery is from ${recoveryDate} (today's hasn't synced yet)`);
  if (sleepDate && sleepDate < prevDay(today)) stale.push(`sleep is from ${sleepDate}`);
  if (!stale.length) return '';
  return `DATA FRESHNESS: these are the most recent readings, not today's — ${stale.join('; ')}. Tell the user this is their latest available reading from that date; do NOT present it as today's.`;
}

/**
 * Compact "last 7 days" WHOOP summary for a live call, so Edge can answer
 * "how's my recovery/sleep been this week" instead of only knowing today.
 * History arrays are oldest→newest; we take the most recent 7. Returns '' when
 * there's no history. Spoken-friendly (no abbreviations the voice engine mangles).
 */
export function formatWhoopHistoryForCall(
  recovery: WhoopRecoveryDay[],
  sleep: WhoopSleepDay[],
  strain: WhoopStrainDay[],
): string {
  const parts: string[] = [];
  if (recovery.length) {
    const days = recovery.slice(-7);
    const list = days.map(d => `${d.recoveryScore}%`).join(', ');
    const avg = Math.round(days.reduce((s, d) => s + d.recoveryScore, 0) / days.length);
    parts.push(`recovery by day (oldest to newest): ${list} (avg ${avg}%)`);
  }
  if (sleep.length) {
    const days = sleep.slice(-7);
    const avgMs = days.reduce((s, d) => s + d.durationMs, 0) / days.length;
    const h = Math.floor(avgMs / 3600000);
    const m = Math.round((avgMs % 3600000) / 60000);
    parts.push(`sleep averaged ${h} hours ${m} minutes`);
  }
  if (strain.length) {
    const days = strain.slice(-7);
    const avg = days.reduce((s, d) => s + d.strain, 0) / days.length;
    parts.push(`strain averaged ${avg.toFixed(1)}`);
  }
  return parts.length ? `LAST 7 DAYS — ${parts.join('; ')}` : '';
}

// True if the user has connected their Whoop account.
export function hasWhoopConnected(userId: number): boolean {
  if (!clientConfigured()) return false;
  try {
    return !!whoopQueries.get(userId);
  } catch {
    return false;
  }
}

// --- History fetch functions (for Core's trend analysis) --------------------
// All return [] on any failure — never throw.
// Degrade to [] when Whoop credentials are not configured.
// Sorted oldest → newest for easy charting.

export async function getRecoveryHistory(
  userId: number,
  days = 14,
): Promise<WhoopRecoveryDay[]> {
  if (!clientConfigured()) return [];
  const cached = fromCache(recoveryHistCache, userId);
  if (cached !== undefined) return cached;

  try {
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const records = await whoopGetAll<WhoopRecoveryRecord>(
      userId, '/recovery', { start, limit: '25' },
    );
    const result: WhoopRecoveryDay[] = records
      .filter(r => r.score_state === 'SCORED' && !!r.created_at)
      .map(r => ({ date: r.created_at!.slice(0, 10), recoveryScore: Math.round(r.score.recovery_score) }))
      .reverse(); // API returns newest-first; we want oldest-first
    setCache(recoveryHistCache, userId, result);
    return result;
  } catch {
    return [];
  }
}

export async function getSleepHistory(
  userId: number,
  days = 14,
): Promise<WhoopSleepDay[]> {
  if (!clientConfigured()) return [];
  const cached = fromCache(sleepHistCache, userId);
  if (cached !== undefined) return cached;

  try {
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const records = await whoopGetAll<WhoopSleepRecord>(
      userId, '/activity/sleep', { start, limit: '25' },
    );
    const result: WhoopSleepDay[] = records
      .filter(r => !r.nap && r.score_state === 'SCORED' && !!r.start)
      .map(r => ({ date: r.start!.slice(0, 10), durationMs: r.score.stage_summary.total_in_bed_time_milli }))
      .reverse();
    setCache(sleepHistCache, userId, result);
    return result;
  } catch {
    return [];
  }
}

export async function getStrainHistory(
  userId: number,
  days = 14,
): Promise<WhoopStrainDay[]> {
  if (!clientConfigured()) return [];
  const cached = fromCache(strainHistCache, userId);
  if (cached !== undefined) return cached;

  try {
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const records = await whoopGetAll<WhoopCycleRecord>(
      userId, '/cycle', { start, limit: '25' },
    );
    const result: WhoopStrainDay[] = records
      .filter(r => r.score_state === 'SCORED' && !!r.start)
      .map(r => ({ date: r.start!.slice(0, 10), strain: Math.round(r.score.strain * 10) / 10 }))
      .reverse();
    setCache(strainHistCache, userId, result);
    return result;
  } catch {
    return [];
  }
}
