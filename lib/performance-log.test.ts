/**
 * S5 — performance_log + health-digest target check. Verifies the perf log records/aggregates and
 * that runHealthDigest flips to DEGRADED when a benchmarked job exceeds its target in the last 24h.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

process.env.DB_PATH = ':memory:';

const { getDb, performanceLogQueries, healthLogQueries } = await import('./db');
const { runHealthDigest } = await import('./scheduler');

afterAll(() => { delete process.env.DB_PATH; });

beforeEach(() => {
  const db = getDb();
  for (const t of ['performance_log', 'health_log']) { try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore */ } }
});

describe('performanceLogQueries', () => {
  it('records runs and returns the max duration per job since a cutoff', () => {
    const now = Date.now();
    performanceLogQueries.record('briefing_generation', 1200, now);
    performanceLogQueries.record('briefing_generation', 4200, now);
    performanceLogQueries.record('memory_retrieval', 120, now);
    const maxes = performanceLogQueries.recentMaxByJob(now - 1000);
    const byJob = Object.fromEntries(maxes.map(m => [m.job, m.max_ms]));
    expect(byJob.briefing_generation).toBe(4200);
    expect(byJob.memory_retrieval).toBe(120);
  });

  it('excludes rows older than the cutoff', () => {
    const now = Date.now();
    performanceLogQueries.record('fact_extraction', 9000, now - 48 * 3600 * 1000); // 2 days ago
    expect(performanceLogQueries.recentMaxByJob(now - 24 * 3600 * 1000)).toHaveLength(0);
  });
});

describe('runHealthDigest perf-target integration', () => {
  // No users/tokens seeded → the calendar-token check loop is empty and all other checks read 0
  // from the in-memory DB, so the digest status reflects only the perf path.
  it('flips DEGRADED when a job exceeded its target in the last 24h', async () => {
    performanceLogQueries.record('briefing_generation', 8000, Date.now()); // target 3000 → breach
    await runHealthDigest();
    const latest = healthLogQueries.getLatest();
    expect(latest?.status).toBe('degraded');
    expect(latest?.summary).toContain('briefing_generation slow');
  });

  it('stays OK when all jobs are within target', async () => {
    performanceLogQueries.record('briefing_generation', 1500, Date.now()); // within 3000
    performanceLogQueries.record('memory_retrieval', 200, Date.now());     // within 500
    await runHealthDigest();
    expect(healthLogQueries.getLatest()?.status).toBe('ok');
  });
});
