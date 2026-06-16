'use client';

import React from 'react';

export type RecoveryTier = 'high' | 'medium' | 'low';

export interface RecoveryHistoryPoint {
  /** 0–100 recovery score for that day */
  score: number;
  /** ISO date string, e.g. "2026-06-11" */
  date: string;
}

export type WhoopFlag = 'OVERREACHING' | 'SLEEP_DEBT' | 'HIGH_STRAIN_STREAK' | 'RECOVERY_DECLINING_3D' | 'RECOVERY_LOW_STREAK';

export interface RecoveryCardProps {
  /** 0–100 recovery score from Whoop */
  recoveryScore: number;
  /** Pre-computed tier — caller derives from score */
  tier: RecoveryTier;
  /** Hours slept, e.g. 7.5 */
  sleepHours?: number;
  /** 0–100 sleep performance score (Whoop performancePct). ≥75=green, ≥50=yellow, <50=red */
  sleepScore?: number;
  /** Pre-computed sleep tier — caller derives from sleepScore */
  sleepTier?: RecoveryTier;
  /** Day strain score from Whoop (0–21 scale) */
  strain?: number;
  /** Up to 14 days of history for sparkline — newest last */
  history?: RecoveryHistoryPoint[];
  /**
   * Points above (positive) or below (negative) your 30-day baseline.
   * Shown when |deviation| ≥ 5. e.g. -18 → "18 pts below your norm".
   */
  deviationPts?: number | null;
  /** Active Whoop intelligence flags — shown as calm chips */
  flags?: WhoopFlag[];
  /** Edge's suggested action for today based on recovery context */
  recoveryAction?: string | null;
  className?: string;
}

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

/** Minimal inline SVG sparkline — 14-day recovery history. */
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
      {/* Baseline grid */}
      <line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2}
        stroke="var(--whoop-spark-track)" strokeWidth="1" strokeDasharray="2 3" />

      {/* Area fill */}
      <path d={areaPath} fill={color} opacity="0.12" />

      {/* Line */}
      <polyline
        points={polyline}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* End-cap dot (today) */}
      <circle cx={lastX} cy={lastY} r={3} fill={color} />
      <circle cx={lastX} cy={lastY} r={5} fill={color} opacity={0.25} />
    </svg>
  );
}

/** Placeholder shown before history data is available. */
function SparklinePlaceholder() {
  return (
    <div
      style={{
        height: 36,
        borderRadius: 4,
        background: 'var(--whoop-spark-track)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
        History loads after 2+ days connected
      </span>
    </div>
  );
}

const FLAG_CONFIG: Record<WhoopFlag, { label: string; color: string; bg: string }> = {
  OVERREACHING:           { label: 'Overreaching',     color: 'var(--edg-danger)',  bg: 'rgba(239,68,68,0.08)'  },
  SLEEP_DEBT:             { label: 'Sleep debt',        color: 'var(--edg-warning)', bg: 'rgba(245,158,11,0.08)' },
  HIGH_STRAIN_STREAK:     { label: 'High load streak',  color: 'var(--edg-warning)', bg: 'rgba(245,158,11,0.08)' },
  RECOVERY_DECLINING_3D:  { label: '3-day slide',       color: 'var(--edg-warning)', bg: 'rgba(245,158,11,0.08)' },
  RECOVERY_LOW_STREAK:    { label: 'Low 3 days',        color: 'var(--edg-danger)',  bg: 'rgba(239,68,68,0.08)'  },
};

// OVERREACHING subsumes the two flags that make it up — show only the combined label
function dedupFlags(flags: WhoopFlag[]): WhoopFlag[] {
  if (flags.includes('OVERREACHING')) {
    return flags.filter(f => f !== 'HIGH_STRAIN_STREAK' && f !== 'RECOVERY_DECLINING_3D');
  }
  return flags;
}

export function RecoveryCard({
  recoveryScore,
  tier,
  sleepScore,
  sleepTier,
  sleepHours,
  strain,
  history,
  deviationPts,
  flags,
  recoveryAction,
  className = '',
}: RecoveryCardProps) {
  // Sleep score is the hero when available; recovery is secondary.
  const hasSleep   = sleepScore !== undefined && sleepTier !== undefined;
  const heroTier   = hasSleep ? sleepTier! : tier;
  const heroColor  = TIER_COLOR[heroTier];
  const hasHistory = history && history.length >= 2;

  const SLEEP_LABEL: Record<RecoveryTier, string> = {
    high:   'Great',
    medium: 'OK',
    low:    'Poor',
  };

  return (
    <div
      className={className}
      style={{
        background: TIER_TINT[heroTier],
        border: `1px solid ${TIER_BORDER[heroTier]}`,
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-4) var(--space-5)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Left accent bar — follows hero color */}
      <div style={{
        position: 'absolute', top: 0, bottom: 0, left: 0, width: 3,
        background: heroColor, borderRadius: '3px 0 0 3px',
      }} />

      {hasSleep ? (
        <>
          {/* ── Sleep Score HERO ── */}
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
                {SLEEP_LABEL[sleepTier!]} Sleep
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
              <p style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 1, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sleep</p>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-body)' }}>
                {Math.floor(sleepHours)}h{Math.round((sleepHours % 1) * 60).toString().padStart(2, '0')}m
              </p>
            </div>
          )}
          {strain !== undefined && (
            <div>
              <p style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 1, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Strain</p>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-body)' }}>
                {strain.toFixed(1)}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 14-day sparkline (recovery history) */}
      <div>
        <p style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          14-day trend
        </p>
        {hasHistory
          ? <Sparkline history={history!} tier={tier} />
          : <SparklinePlaceholder />
        }
      </div>

      {/* ── Whoop Intelligence ── */}
      {(deviationPts != null || (flags && flags.length > 0) || recoveryAction) && (
        <div style={{ marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--edg-hairline)' }}>
          {/* Deviation from baseline */}
          {deviationPts != null && Math.abs(deviationPts) >= 5 && (
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
              {deviationPts < 0
                ? `↓ ${Math.abs(deviationPts)} pts below your norm`
                : `↑ ${deviationPts} pts above your norm`}
            </p>
          )}

          {/* Flag chips — calm, not alarmist */}
          {flags && flags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: recoveryAction ? 8 : 0 }}>
              {dedupFlags(flags).map(flag => {
                const cfg = FLAG_CONFIG[flag];
                return (
                  <span
                    key={flag}
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: '2px 7px',
                      borderRadius: 99,
                      color: cfg.color,
                      background: cfg.bg,
                      border: `1px solid ${cfg.color}33`,
                    }}
                  >
                    {cfg.label}
                  </span>
                );
              })}
            </div>
          )}

          {/* Recovery action suggestion */}
          {recoveryAction && (
            <p style={{ fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.5, marginTop: 4 }}>
              <span style={{ color: 'var(--text-accent)', fontWeight: 600 }}>Today: </span>
              {recoveryAction}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
