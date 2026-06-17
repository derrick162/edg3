'use client';

import React from 'react';

export type RecoveryTier = 'high' | 'medium' | 'low';

export interface RecoveryHistoryPoint {
  /** 0–100 recovery score for that day */
  score: number;
  /** ISO date string, e.g. "2026-06-11" */
  date: string;
}

export interface RecoveryCardProps {
  /** 0–100 Whoop sleep score (the new hero). Optional — shown when available. */
  sleepScore?: number;
  /** 0–100 recovery score from Whoop */
  recoveryScore: number;
  /** Pre-computed tier (for recovery) — caller derives from recovery score */
  tier: RecoveryTier;
  /** Hours slept, e.g. 7.5 */
  sleepHours?: number;
  /** Day strain score from Whoop (0–21 scale) */
  strain?: number;
  /** Up to 14 days of history for sparkline — newest last */
  history?: RecoveryHistoryPoint[];
  className?: string;
}

// ── Color maps ────────────────────────────────────────────────────────────────

const TIER_COLOR: Record<RecoveryTier, string> = {
  high:   'var(--whoop-high)',
  medium: 'var(--whoop-medium)',
  low:    'var(--whoop-low)',
};

const TIER_TINT: Record<RecoveryTier, string> = {
  high:   'var(--whoop-high-tint)',
  medium: 'var(--whoop-medium-tint)',
  low:    'var(--whoop-low-tint)',
};

const TIER_BORDER: Record<RecoveryTier, string> = {
  high:   'var(--whoop-high-border)',
  medium: 'var(--whoop-medium-border)',
  low:    'var(--whoop-low-border)',
};

const TIER_SPARK: Record<RecoveryTier, string> = {
  high:   'var(--whoop-spark-high)',
  medium: 'var(--whoop-spark-medium)',
  low:    'var(--whoop-spark-low)',
};

const TIER_LABEL: Record<RecoveryTier, string> = {
  high:   'High',
  medium: 'Moderate',
  low:    'Low',
};

// Sleep score tier: ≥75 = green, ≥50 = yellow, <50 = red (Derrick's rule)
function sleepTier(score: number): RecoveryTier {
  if (score >= 75) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ history, tier }: { history: RecoveryHistoryPoint[]; tier: RecoveryTier }) {
  const W = 200;
  const H = 36;
  const PAD = 2;

  if (history.length < 2) return null;

  const pts = history.slice(-14);
  const xs = pts.map((_, i) => PAD + (i / (pts.length - 1)) * (W - PAD * 2));
  const ys = pts.map(p => PAD + (1 - p.score / 100) * (H - PAD * 2));

  const polyline = xs.map((x, i) => `${x},${ys[i]}`).join(' ');
  const areaPath =
    `M${xs[0]},${H} ` +
    xs.map((x, i) => `L${x},${ys[i]}`).join(' ') +
    ` L${xs[xs.length - 1]},${H} Z`;

  const lastX = xs[xs.length - 1];
  const lastY = ys[ys.length - 1];
  const color = TIER_SPARK[tier];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2}
        stroke="var(--whoop-spark-track)" strokeWidth="1" strokeDasharray="2 3" />
      <path d={areaPath} fill={color} opacity="0.12" />
      <polyline points={polyline} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={3} fill={color} />
      <circle cx={lastX} cy={lastY} r={5} fill={color} opacity={0.25} />
    </svg>
  );
}

function SparklinePlaceholder() {
  return (
    <div style={{ height: 36, borderRadius: 4, background: 'var(--whoop-spark-track)',
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
        History loads after 2+ days connected
      </span>
    </div>
  );
}

// ── RecoveryCard ──────────────────────────────────────────────────────────────

export function RecoveryCard({
  sleepScore,
  recoveryScore,
  tier,
  sleepHours,
  strain,
  history,
  className = '',
}: RecoveryCardProps) {
  const hasSleepScore = sleepScore !== undefined;
  const sTier = hasSleepScore ? sleepTier(sleepScore!) : null;
  const heroColor = sTier ? TIER_COLOR[sTier] : TIER_COLOR[tier];
  const heroTint  = sTier ? TIER_TINT[sTier]  : TIER_TINT[tier];
  const heroBorder = sTier ? TIER_BORDER[sTier] : TIER_BORDER[tier];
  const hasHistory = history && history.length >= 2;

  return (
    <div
      className={className}
      style={{
        background: heroTint,
        border: `1px solid ${heroBorder}`,
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-4) var(--space-5)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Left accent bar — follows hero (sleep score) color */}
      <div style={{
        position: 'absolute', top: 0, bottom: 0, left: 0, width: 3,
        background: heroColor, borderRadius: '3px 0 0 3px',
      }} />

      {hasSleepScore ? (
        <>
          {/* ── Sleep score HERO ── */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
            <span style={{
              fontSize: 36, fontWeight: 900, letterSpacing: '-0.03em',
              lineHeight: 1, color: heroColor, fontFamily: 'var(--font-sans)',
            }}>
              {sleepScore}
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-muted)', marginLeft: 2 }}>%</span>
            </span>
            <div style={{ paddingBottom: 2 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: heroColor, marginBottom: 1 }}>
                {sTier === 'high' ? 'Great' : sTier === 'medium' ? 'OK' : 'Poor'} Sleep
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                  background: heroColor, boxShadow: `0 0 5px ${heroColor}`, flexShrink: 0,
                }} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Sleep Score · Today</span>
              </div>
            </div>
          </div>

          {/* ── Recovery SECONDARY ── */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            padding: '6px 10px', borderRadius: 8, marginBottom: 'var(--space-3)',
            background: 'var(--edg-fill-04)', border: '1px solid var(--edg-hairline)',
          }}>
            <span style={{
              fontSize: 16, fontWeight: 800, letterSpacing: '-0.02em',
              color: TIER_COLOR[tier], fontFamily: 'var(--font-sans)',
            }}>
              {recoveryScore}%
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>
              {TIER_LABEL[tier]} Recovery
            </span>
          </div>
        </>
      ) : (
        /* ── No sleep score — recovery is hero (original layout) ── */
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
          <span style={{
            fontSize: 36, fontWeight: 900, letterSpacing: '-0.03em',
            lineHeight: 1, color: heroColor, fontFamily: 'var(--font-sans)',
          }}>
            {recoveryScore}
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-muted)', marginLeft: 2 }}>%</span>
          </span>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: heroColor, marginBottom: 2 }}>
              {TIER_LABEL[tier]} Recovery
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                background: heroColor, boxShadow: `0 0 5px ${heroColor}`, flexShrink: 0,
              }} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Today</span>
            </div>
          </div>
        </div>
      )}

      {/* Stats row — sleep duration + strain */}
      {(sleepHours !== undefined || strain !== undefined) && (
        <div style={{ display: 'flex', gap: 'var(--space-5)', marginBottom: 'var(--space-3)' }}>
          {sleepHours !== undefined && (
            <div>
              <p style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 1,
                textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sleep</p>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-body)' }}>
                {Math.floor(sleepHours)}h{Math.round((sleepHours % 1) * 60).toString().padStart(2, '0')}m
              </p>
            </div>
          )}
          {strain !== undefined && (
            <div>
              <p style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 1,
                textTransform: 'uppercase', letterSpacing: '0.06em' }}>Strain</p>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-body)' }}>
                {strain.toFixed(1)}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 14-day sparkline (recovery history) */}
      <div>
        <p style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 6,
          textTransform: 'uppercase', letterSpacing: '0.06em' }}>14-day trend</p>
        {hasHistory
          ? <Sparkline history={history!} tier={tier} />
          : <SparklinePlaceholder />
        }
      </div>
    </div>
  );
}
