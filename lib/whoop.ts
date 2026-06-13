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

import { whoopQueries } from './db';

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
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://edg3.ai';
  return `${base}/api/whoop/callback`;
}

// --- OAuth surface (used by routes) -----------------------------------------

export function getAuthUrl(userId: number): string {
  const params = new URLSearchParams({
    client_id:     process.env.WHOOP_CLIENT_ID!,
    redirect_uri:  getRedirectUri(),
    response_type: 'code',
    scope:         WHOOP_SCOPES.join(' '),
    state:         String(userId),
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
const recoveryCache = new Map<number, CacheEntry<WhoopRecovery | null>>();
const sleepCache    = new Map<number, CacheEntry<WhoopSleep | null>>();
const strainCache   = new Map<number, CacheEntry<WhoopStrain | null>>();
const CACHE_TTL_MS  = 60 * 60 * 1000;

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
  score_state: string;
  score: { recovery_score: number; hrv_rmssd_milli: number; resting_heart_rate: number };
}

interface WhoopSleepRecord {
  nap: boolean;
  score_state: string;
  score: {
    stage_summary: { total_in_bed_time_milli: number };
    sleep_performance_percentage: number;
    sleep_efficiency_percentage: number;
  };
}

interface WhoopCycleRecord {
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

// --- Public types (for Core to consume) -------------------------------------

export interface WhoopRecovery {
  recoveryScore:    number; // 0–100
  hrv:              number; // RMSSD in ms (rounded)
  restingHeartRate: number; // bpm
}

export interface WhoopSleep {
  durationMs:     number; // total in-bed time
  performancePct: number; // 0–100
  efficiencyPct:  number; // 0–100
}

export interface WhoopStrain {
  strain:         number; // 0–21 (1 decimal)
  avgHeartRate:   number; // bpm
}

// --- Public fetch functions --------------------------------------------------

export async function getLatestRecovery(userId: number): Promise<WhoopRecovery | null> {
  if (!clientConfigured()) return null;
  const cached = fromCache(recoveryCache, userId);
  if (cached !== undefined) return cached;

  try {
    const data = await whoopGet<WhoopListResponse<WhoopRecoveryRecord>>(
      userId, '/recovery', { limit: '1' },
    );
    const rec = data?.records?.[0];
    if (!rec || rec.score_state !== 'SCORED') { setCache(recoveryCache, userId, null); return null; }
    const result: WhoopRecovery = {
      recoveryScore:    Math.round(rec.score.recovery_score),
      hrv:              Math.round(rec.score.hrv_rmssd_milli),
      restingHeartRate: rec.score.resting_heart_rate,
    };
    setCache(recoveryCache, userId, result);
    return result;
  } catch {
    setCache(recoveryCache, userId, null);
    return null;
  }
}

export async function getLastSleep(userId: number): Promise<WhoopSleep | null> {
  if (!clientConfigured()) return null;
  const cached = fromCache(sleepCache, userId);
  if (cached !== undefined) return cached;

  try {
    const data = await whoopGet<WhoopListResponse<WhoopSleepRecord>>(
      userId, '/activity/sleep', { limit: '5' },
    );
    // Skip naps — find the most recent main sleep session.
    const rec = data?.records?.find(r => !r.nap && r.score_state === 'SCORED');
    if (!rec) { setCache(sleepCache, userId, null); return null; }
    const result: WhoopSleep = {
      durationMs:     rec.score.stage_summary.total_in_bed_time_milli,
      performancePct: Math.round(rec.score.sleep_performance_percentage),
      efficiencyPct:  Math.round(rec.score.sleep_efficiency_percentage),
    };
    setCache(sleepCache, userId, result);
    return result;
  } catch {
    setCache(sleepCache, userId, null);
    return null;
  }
}

export async function getRecentStrain(userId: number): Promise<WhoopStrain | null> {
  if (!clientConfigured()) return null;
  const cached = fromCache(strainCache, userId);
  if (cached !== undefined) return cached;

  try {
    const data = await whoopGet<WhoopListResponse<WhoopCycleRecord>>(
      userId, '/cycle', { limit: '1' },
    );
    const rec = data?.records?.[0];
    if (!rec || rec.score_state !== 'SCORED') { setCache(strainCache, userId, null); return null; }
    const result: WhoopStrain = {
      strain:       Math.round(rec.score.strain * 10) / 10,
      avgHeartRate: rec.score.average_heart_rate,
    };
    setCache(strainCache, userId, result);
    return result;
  } catch {
    setCache(strainCache, userId, null);
    return null;
  }
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
