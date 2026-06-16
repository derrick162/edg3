'use client';

import { useState } from 'react';
import type { CalendarFit, ScoreResult, ScoreTopFix } from './CalendarFitCard';

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
  if (s >= 85) return "You're aligned — keep the momentum.";
  if (s >= 65) return 'Good shape. A couple of things to tighten.';
  if (s >= 35) return 'Room to improve — see what to shift.';
  return 'Day needs attention. Edge can help fix it.';
}

function scoreCardBorder(s: number): string {
  if (s >= 85) return 'rgba(34,197,94,0.20)';
  if (s >= 65) return 'rgba(99,102,241,0.20)';
  if (s >= 35) return 'rgba(245,158,11,0.15)';
  return 'rgba(239,68,68,0.18)';
}

function scoreCardBg(s: number): string {
  if (s >= 85) return 'rgba(34,197,94,0.03)';
  if (s >= 65) return 'transparent';
  if (s >= 35) return 'rgba(245,158,11,0.025)';
  return 'rgba(239,68,68,0.03)';
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

// ── Score panel (reused for Focus + Energy) ───────────────────────────────────

function ScorePanel({
  icon, label, caption, score, drivers, topFix, calibrating, calibratingNote,
}: {
  icon: string;
  label: string;
  caption: string;
  score: number;
  drivers: string[];
  topFix: ScoreTopFix | null;
  calibrating?: boolean;
  calibratingNote?: string;
}) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--edg-fill-04)', border: '1px solid var(--edg-hairline)' }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{icon} {label}</span>
        {calibrating
          ? <span className="text-xs font-medium" style={{ color: 'var(--text-faint)' }}>calibrating…</span>
          : <span className="text-sm font-black tabular-nums" style={{ color: scoreColor(score) }}>{score}</span>
        }
      </div>
      <div className="h-1 rounded-full overflow-hidden mb-2" style={{ background: 'var(--gauge-bg)' }}>
        {calibrating
          ? <div className="h-full rounded-full" style={{ width: '40%', background: 'var(--gauge-mid)', opacity: 0.4, animation: 'gauge-pulse 2s ease-in-out infinite' }} />
          : <div className="h-full rounded-full transition-all duration-700" style={{ width: `${score}%`, background: scoreColor(score) }} />
        }
      </div>
      <p className="text-xs mb-2 leading-relaxed" style={{ color: 'var(--text-faint)' }}>{caption}</p>
      {calibrating && calibratingNote
        ? <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{calibratingNote}</p>
        : (
          <>
            {drivers.length > 0 && (
              <ul className="space-y-1 mb-2">
                {drivers.map((d, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span className="flex-shrink-0 mt-0.5 font-bold" style={{ color: scoreColor(score) }}>·</span>
                    {d}
                  </li>
                ))}
              </ul>
            )}
            {topFix && (
              <p className="text-xs px-2 py-1.5 rounded-lg" style={{ color: 'var(--text-accent)', background: 'var(--edg-accent-08)', border: '1px solid var(--edg-accent-20)' }}>
                ✦ {topFix.description}
              </p>
            )}
          </>
        )
      }
    </div>
  );
}

// ── Clarity panel ─────────────────────────────────────────────────────────────
// Drivers come in two flavors:
//   "Connect Gmail (+20)"  → motivating CTA chip (contains "+N")
//   "12 calls — deepening" → achievement statement (green ✓ bullet)

function ClarityPanel({ score }: { score: ScoreResult }) {
  const achievements = score.drivers.filter(d => !/\(\+\d+\)/.test(d));
  const nudges       = score.drivers.filter(d => /\(\+\d+\)/.test(d));

  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--edg-fill-04)', border: '1px solid var(--edg-hairline)' }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>🔮 Clarity Score</span>
        <span className="text-sm font-black tabular-nums" style={{ color: scoreColor(score.score) }}>{score.score}</span>
      </div>
      <div className="h-1 rounded-full overflow-hidden mb-2" style={{ background: 'var(--gauge-bg)' }}>
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${score.score}%`, background: scoreColor(score.score) }} />
      </div>
      <p className="text-xs mb-3 leading-relaxed" style={{ color: 'var(--text-faint)' }}>
        How clear a picture Edge has of you — connected sources + accumulated context
      </p>
      {achievements.length > 0 && (
        <ul className="space-y-1 mb-3">
          {achievements.map((d, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              <span className="flex-shrink-0 mt-0.5 font-bold" style={{ color: 'var(--edg-success)' }}>✓</span>
              {d}
            </li>
          ))}
        </ul>
      )}
      {nudges.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {nudges.map((d, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium"
              style={{ background: 'var(--edg-accent-08)', border: '1px solid var(--edg-accent-20)', color: 'var(--text-accent)' }}>
              {d} →
            </span>
          ))}
        </div>
      )}
      {score.topFix && (
        <p className="text-xs px-2 py-1.5 rounded-lg" style={{ color: 'var(--text-accent)', background: 'var(--edg-accent-08)', border: '1px solid var(--edg-accent-20)' }}>
          ✦ {score.topFix.description}
        </p>
      )}
    </div>
  );
}

// ── Momentum panel ────────────────────────────────────────────────────────────

function MomentumPanel({ score }: { score: ScoreResult }) {
  const isCalibrating = score.calibrating === true;

  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--edg-fill-04)', border: '1px solid var(--edg-hairline)' }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>⚡ Momentum Score</span>
        {isCalibrating
          ? <span className="text-xs font-medium" style={{ color: 'var(--text-faint)' }}>day 1</span>
          : <span className="text-sm font-black tabular-nums" style={{ color: scoreColor(score.score) }}>{score.score}</span>
        }
      </div>
      <div className="h-1 rounded-full overflow-hidden mb-2" style={{ background: 'var(--gauge-bg)' }}>
        {isCalibrating
          ? <div className="h-full rounded-full" style={{ width: '5%', background: 'var(--gauge-mid)', opacity: 0.4, animation: 'gauge-pulse 2s ease-in-out infinite' }} />
          : <div className="h-full rounded-full transition-all duration-700" style={{ width: `${score.score}%`, background: scoreColor(score.score) }} />
        }
      </div>
      <p className="text-xs mb-2 leading-relaxed" style={{ color: 'var(--text-faint)' }}>
        How consistently you show up — calls + engagement over the last 7–14 days
      </p>
      {isCalibrating ? (
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
          You&apos;re on day 1 — Edge will track your consistency from here. Come back tomorrow to see it grow.
        </p>
      ) : (
        score.drivers.length > 0 && (
          <ul className="space-y-1">
            {score.drivers.map((d, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                <span className="flex-shrink-0 mt-0.5 font-bold" style={{ color: scoreColor(score.score) }}>·</span>
                {d}
              </li>
            ))}
          </ul>
        )
      )}
    </div>
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
  const s     = edgeScore!;

  return (
    <div
      className="glass-card p-5"
      style={{
        borderColor: scoreCardBorder(s),
        background: scoreCardBg(s),
        animation: 'score-rise 0.45s ease both',
      }}
    >
      <div className="flex items-center gap-5">
        {/* Arc gauge */}
        <div className="flex-shrink-0">
          <ArcGauge score={s} color={color} glow={glow} />
        </div>

        {/* Right panel */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold mb-1 uppercase tracking-wide" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>Today</p>
          <p className="text-sm font-bold mb-2 leading-snug" style={{ color: 'var(--text-strong)' }}>
            {scoreSummary(s)}
          </p>

          {/* Breakdown toggle */}
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-xs mb-2 transition-opacity hover:opacity-80"
            style={{ color: 'var(--text-accent)' }}
          >
            {expanded ? '▲ Hide how this is calculated' : '▼ How is this calculated?'}
          </button>

          {expanded && (
            <div className="space-y-3 mt-1">
              {/* ── Focus ── */}
              <ScorePanel
                icon="🎯"
                label="Focus Score"
                caption="% of your working hours booked toward your focus areas"
                score={fit.focusScore.score}
                drivers={fit.focusScore.drivers}
                topFix={fit.focusScore.topFix}
              />

              {/* ── Energy ── */}
              <ScorePanel
                icon="⚡"
                label="Energy Score"
                caption="How energized you are — a blend of your sleep + recovery this week"
                score={fit.energyScore.score}
                drivers={fit.energyScore.drivers}
                topFix={fit.energyScore.topFix}
                calibrating={calibrating && (calibratingHalf === 'energy' || calibratingHalf === 'both')}
                calibratingNote="Connect Whoop so Edge can score your energy from real sleep + recovery data."
              />

              {/* ── Clarity (optional — Core populates when ready) ── */}
              {fit.clarityScore && (
                <ClarityPanel score={fit.clarityScore} />
              )}

              {/* ── Momentum (optional — Core populates when ready) ── */}
              {fit.momentumScore && (
                <MomentumPanel score={fit.momentumScore} />
              )}

              {/* Inputs footnote */}
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-faint)' }}>
                Focus ← calendar + focus areas · Energy ← Whoop sleep + recovery · Clarity ← connected sources + call history · Momentum ← daily call + engagement streak
              </p>

              {/* Improve my day CTA */}
              {onRequestFix && (
                <button
                  onClick={onRequestFix}
                  className="w-full text-xs py-2 rounded-lg transition-all font-medium"
                  style={{
                    background: 'var(--edg-accent-08)',
                    border: '1px solid var(--edg-accent-20)',
                    color: 'var(--text-accent)',
                  }}
                >
                  ✦ Improve my day →
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
