'use client';

import { useState } from 'react';
import type { CalendarFit } from './CalendarFitCard';

// Re-export the type so consumers can import from here too
export type { CalendarFit };

export interface EdgeScoreCardProps {
  fit: CalendarFit | null;
  loading?: boolean;
  sparse?: boolean;         // true = no focus areas or no calendar connected
  calibrating?: boolean;    // energy score still learning (< 10 calls)
  calibratingHalf?: 'focus' | 'energy' | 'both';  // which half is still calibrating
  onRequestFix?: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(s: number): string {
  if (s >= 85) return 'var(--gauge-peak)';
  if (s >= 65) return 'var(--gauge-high)';
  if (s >= 35) return 'var(--gauge-mid)';
  return 'var(--gauge-low)';
}

function scoreGlow(s: number): string {
  if (s >= 85) return 'var(--gauge-glow-peak)';
  if (s >= 65) return 'var(--gauge-glow-high)';
  return 'var(--gauge-glow-low)';
}

function scoreSummary(s: number): string {
  if (s >= 85) return 'Your day is aligned.';
  if (s >= 65) return 'Good shape — a few things to tighten.';
  if (s >= 35) return 'Room to improve — tap to see why.';
  return 'Day needs attention — tap to fix it.';
}

// ── Calibrating arc (dashed pulse, no score label) ────────────────────────────

function CalibratingArc() {
  return (
    <svg width={128} height={128} viewBox="0 0 128 128" aria-hidden>
      <path
        d="M 14.7 96 A 52 52 0 1 1 113.3 96"
        fill="none"
        stroke="var(--gauge-bg)"
        strokeWidth={8}
        strokeLinecap="round"
      />
      <path
        d="M 14.7 96 A 52 52 0 1 1 113.3 96"
        fill="none"
        stroke="var(--gauge-mid)"
        strokeWidth={8}
        strokeLinecap="round"
        strokeDasharray="20 12"
        style={{ opacity: 0.5, animation: 'gauge-pulse 2s ease-in-out infinite' }}
      />
      <text
        x={64} y={60}
        textAnchor="middle" dominantBaseline="middle"
        fontSize={20} fontWeight={700}
        fill="var(--text-faint)"
        style={{ fontFamily: 'inherit' }}
      >
        ···
      </text>
      <text
        x={64} y={84}
        textAnchor="middle"
        fontSize={10} fontWeight={600}
        fill="var(--text-faint)"
        style={{ fontFamily: 'inherit' }}
      >
        CALIBRATING
      </text>
    </svg>
  );
}

// ── SVG arc gauge ─────────────────────────────────────────────────────────────

function ArcGauge({ score, color, glow }: { score: number; color: string; glow: string }) {
  const r = 52;
  const cx = 64;
  const cy = 64;
  // 240° sweep (from 150° to 390°/30°)
  const startAngle = 150;
  const sweepDeg = 240;
  const pct = Math.min(100, Math.max(0, score));
  const fillDeg = (pct / 100) * sweepDeg;

  function polar(cx: number, cy: number, r: number, deg: number) {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function arcPath(startDeg: number, endDeg: number) {
    const s = polar(cx, cy, r, startDeg);
    const e = polar(cx, cy, r, endDeg);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
  }

  const trackPath = arcPath(startAngle, startAngle + sweepDeg);
  const fillPath  = fillDeg > 0 ? arcPath(startAngle, startAngle + fillDeg) : null;

  return (
    <svg width={128} height={128} viewBox="0 0 128 128" aria-hidden>
      {/* Track */}
      <path d={trackPath} fill="none" stroke="var(--gauge-bg)" strokeWidth={8} strokeLinecap="round" />
      {/* Fill */}
      {fillPath && (
        <path
          d={fillPath}
          fill="none"
          stroke={color}
          strokeWidth={8}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(${glow})`, transition: 'stroke-dasharray 0.7s ease' }}
        />
      )}
      {/* Score label */}
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={28}
        fontWeight={900}
        fill={color}
        style={{ fontFamily: 'inherit', letterSpacing: '-0.03em' }}
      >
        {score}
      </text>
      <text
        x={cx}
        y={cy + 20}
        textAnchor="middle"
        fontSize={10}
        fontWeight={600}
        fill="var(--text-faint)"
        style={{ fontFamily: 'inherit' }}
      >
        EDGE SCORE
      </text>
    </svg>
  );
}

// ── EdgeScoreCard ─────────────────────────────────────────────────────────────

export function EdgeScoreCard({
  fit,
  loading = false,
  sparse = false,
  calibrating = false,
  calibratingHalf,
  onRequestFix,
}: EdgeScoreCardProps) {
  const [expanded, setExpanded] = useState(false);

  // When energy half is calibrating, only average the focus score
  const edgeScore = fit
    ? calibrating && calibratingHalf !== 'focus'
      ? fit.focusScore.score  // energy still learning — show focus score only
      : Math.round((fit.focusScore.score + fit.energyScore.score) / 2)
    : null;

  // ── Loading
  if (loading) {
    return (
      <div className="glass-card p-5">
        <div className="flex items-center gap-3">
          <div className="w-32 h-32 rounded-full animate-pulse flex-shrink-0" style={{ background: 'var(--gauge-bg)' }} />
          <div className="flex-1 space-y-2">
            <div className="h-3 rounded animate-pulse" style={{ background: 'var(--edg-hairline)', width: '60%' }} />
            <div className="h-2 rounded animate-pulse" style={{ background: 'var(--edg-hairline)', width: '80%' }} />
            <div className="h-2 rounded animate-pulse" style={{ background: 'var(--edg-hairline)', width: '50%' }} />
          </div>
        </div>
      </div>
    );
  }

  // ── Sparse / no data
  if (sparse || !fit) {
    return (
      <div className="glass-card p-5">
        <div className="flex items-center gap-4">
          <div
            className="w-32 h-32 rounded-full flex-shrink-0 flex flex-col items-center justify-center"
            style={{ background: 'var(--gauge-bg)', border: '4px solid var(--edg-hairline)' }}
          >
            <span className="text-2xl font-black" style={{ color: 'var(--text-faint)' }}>—</span>
            <span className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>EDGE SCORE</span>
          </div>
          <div>
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-strong)' }}>
              {sparse ? 'Connect your calendar to get scored' : 'Scores appear after your first morning briefing.'}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Edge scores how well your day is set up against your focus areas and energy.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Fully calibrating — nothing to score yet
  if (calibrating && calibratingHalf === 'both') {
    return (
      <div className="glass-card p-5">
        <div className="flex items-center gap-5">
          <div className="flex-shrink-0"><CalibratingArc /></div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Today</p>
            <p className="text-sm font-bold mb-1 leading-snug" style={{ color: 'var(--text-strong)' }}>
              Learning your patterns
            </p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Your Edge Score will appear after a few morning briefings — Edge is building your baseline.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const color = scoreColor(edgeScore!);
  const glow  = scoreGlow(edgeScore!);

  return (
    <div className="glass-card p-5">
      <div className="flex items-center gap-5">
        {/* Arc gauge */}
        <div className="flex-shrink-0">
          <ArcGauge score={edgeScore!} color={color} glow={glow} />
        </div>

        {/* Right panel */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Today</p>
          <p className="text-sm font-bold mb-2 leading-snug" style={{ color: 'var(--text-strong)' }}>
            {scoreSummary(edgeScore!)}
          </p>

          {/* Sub-scores (collapsed by default) */}
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-xs mb-2 transition-opacity hover:opacity-80"
            style={{ color: 'var(--text-accent)' }}
          >
            {expanded ? '▲ Hide breakdown' : '▼ See breakdown'}
          </button>

          {expanded && (
            <div className="space-y-2">
              {/* Focus sub-score */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>🎯 Focus</span>
                  <span className="text-xs font-bold tabular-nums" style={{ color: scoreColor(fit.focusScore.score) }}>
                    {fit.focusScore.score}%
                  </span>
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--gauge-bg)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${fit.focusScore.score}%`, background: scoreColor(fit.focusScore.score) }}
                  />
                </div>
                {fit.focusScore.topFix && (
                  <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                    ✦ {fit.focusScore.topFix.description}
                  </p>
                )}
              </div>

              {/* Energy sub-score — may be calibrating */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>⚡ Energy</span>
                  {calibrating && (calibratingHalf === 'energy' || calibratingHalf === 'both') ? (
                    <span className="text-xs font-medium" style={{ color: 'var(--text-faint)' }}>calibrating…</span>
                  ) : (
                    <span className="text-xs font-bold tabular-nums" style={{ color: scoreColor(fit.energyScore.score) }}>
                      {fit.energyScore.score}%
                    </span>
                  )}
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--gauge-bg)' }}>
                  {calibrating && (calibratingHalf === 'energy' || calibratingHalf === 'both') ? (
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: '40%',
                        background: 'var(--gauge-mid)',
                        opacity: 0.4,
                        animation: 'gauge-pulse 2s ease-in-out infinite',
                      }}
                    />
                  ) : (
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${fit.energyScore.score}%`, background: scoreColor(fit.energyScore.score) }}
                    />
                  )}
                </div>
                {calibrating && (calibratingHalf === 'energy' || calibratingHalf === 'both') ? (
                  <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                    Edge learns your energy after a few calls — check back tomorrow.
                  </p>
                ) : fit.energyScore.topFix ? (
                  <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                    ✦ {fit.energyScore.topFix.description}
                  </p>
                ) : null}
              </div>

              {/* Fix it CTA */}
              {onRequestFix && (
                <button
                  onClick={onRequestFix}
                  className="text-xs px-3 py-1.5 rounded-lg mt-1 transition-all"
                  style={{
                    background: 'var(--edg-accent-08)',
                    border: '1px solid var(--edg-accent-20)',
                    color: 'var(--text-accent)',
                  }}
                >
                  Fix it →
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
