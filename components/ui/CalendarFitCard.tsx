'use client';

import { useState } from 'react';

// ── Types (contract with Core — matches ScoreResult in lib/focusProgress.ts) ─

export interface ScoreTopFix {
  description: string;   // plain-English action: "Move deep-work block to your 9–11 peak"
  op?: 'create' | 'move' | 'delete' | 'recolor';
}

export interface ScoreResult {
  score: number;         // 1–10
  drivers: string[];     // 2–4 plain-English reasons
  topFix: ScoreTopFix | null;
}

export interface CalendarFit {
  focusScore: ScoreResult;
  energyScore: ScoreResult;
  /** How much memory + context Edge has of the user. Optional until Core ships it. */
  intelligenceScore?: ScoreResult;
  computedAt: string;
}

export interface CalendarFitCardProps {
  fit: CalendarFit | null;        // null = loading
  sparse?: boolean;               // true = < 3 focus areas or < 5 events — show gentle prompt
  loading?: boolean;
  calibrating?: boolean;          // energy score still learning (< 10 calls)
  callsCompleted?: number;
  onRequestFix?: (type: 'focus' | 'energy') => void;
}

// Internal shape used by ScoreGauge
interface CalendarScore {
  score: number;
  drivers: string[];
  topFix: ScoreTopFix | null;
  loading?: boolean;
  calibrating?: boolean;
  callsCompleted?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// score is 0–100 (a plain percentage)
function gaugeColor(score: number): string {
  if (score >= 85) return 'var(--gauge-peak)';
  if (score >= 65) return 'var(--gauge-high)';
  if (score >= 35) return 'var(--gauge-mid)';
  return 'var(--gauge-low)';
}

function gaugeGlow(score: number): string {
  if (score >= 85) return 'var(--gauge-glow-peak)';
  if (score >= 65) return 'var(--gauge-glow-high)';
  return 'var(--gauge-glow-low)';
}

function scoreLabel(score: number): string {
  if (score >= 85) return 'excellent';
  if (score >= 65) return 'good';
  if (score >= 35) return 'fair';
  return 'low';
}

// ── Score Gauge ───────────────────────────────────────────────────────────────

function ScoreGauge({
  label,
  icon,
  data,
  type,
  expanded,
  onToggle,
  onRequestFix,
}: {
  label: string;
  icon: string;
  data: CalendarScore | null;
  type: 'focus' | 'energy';
  expanded: boolean;
  onToggle: () => void;
  onRequestFix?: () => void;
}) {
  if (!data || data.loading) {
    return (
      <div className="flex items-center gap-3 py-1">
        <span className="text-base">{icon}</span>
        <div className="flex-1">
          <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{label}</p>
          <div className="h-1.5 rounded-full mt-1.5" style={{ background: 'var(--gauge-bg)', width: '100%' }}>
            <div className="h-full rounded-full animate-pulse" style={{ background: 'var(--edg-hairline)', width: '40%' }} />
          </div>
        </div>
        <span className="text-lg font-black tabular-nums" style={{ color: 'var(--text-faint)', minWidth: 28, textAlign: 'right' }}>—</span>
      </div>
    );
  }

  const { score, drivers, topFix, calibrating, callsCompleted } = data;
  const color = gaugeColor(score);
  const glow = gaugeGlow(score);
  const pct = score; // score is already 0–100

  return (
    <div>
      {/* Gauge row — always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 py-1 text-left transition-opacity hover:opacity-80"
        aria-expanded={expanded}
      >
        <span className="text-base flex-shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
            {label}
            <span className="ml-1.5 font-normal" style={{ color: 'var(--text-faint)' }}>
              {scoreLabel(score)}
            </span>
          </p>
          {/* Bar */}
          <div
            className="h-1.5 rounded-full overflow-hidden"
            style={{ background: 'var(--gauge-bg)' }}
          >
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${pct}%`,
                background: color,
                boxShadow: glow,
              }}
            />
          </div>
        </div>
        <span
          className="text-lg font-black tabular-nums flex-shrink-0"
          style={{ color, minWidth: 36, textAlign: 'right', textShadow: glow }}
        >
          {score}%
        </span>
        <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-faint)' }}>
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {/* Expanded: drivers + top fix */}
      {expanded && (
        <div className="mt-2 pl-7 space-y-2">
          {calibrating && (
            <p className="text-xs px-2 py-1 rounded" style={{ background: 'var(--edg-accent-08)', color: 'var(--text-accent)' }}>
              Edge is learning your energy — call {callsCompleted ?? 0} of 10
            </p>
          )}
          {/* Drivers */}
          <div className="flex flex-col gap-1">
            {drivers.map((d, i) => (
              <div
                key={i}
                className="text-xs px-2 py-1 rounded"
                style={{ background: 'var(--gauge-driver-bg)', color: 'var(--text-muted)' }}
              >
                {d}
              </div>
            ))}
          </div>
          {/* Top fix */}
          {topFix && (
            <div
              className="flex items-start gap-2 px-2 py-2 rounded-lg"
              style={{ background: 'var(--edg-accent-08)', border: '1px solid var(--edg-accent-20)' }}
            >
              <span className="text-xs flex-1" style={{ color: 'var(--text-accent)', lineHeight: 1.5 }}>
                ✦ {topFix.description}
                {topFix.op && (
                  <span className="ml-1.5 opacity-50 font-mono text-xs">[{topFix.op}]</span>
                )}
              </span>
              {onRequestFix && (
                <button
                  onClick={e => { e.stopPropagation(); onRequestFix(); }}
                  className="flex-shrink-0 text-xs px-2 py-0.5 rounded font-semibold"
                  style={{ background: 'var(--edg-accent-20)', color: 'var(--text-accent)', border: '1px solid var(--edg-accent-25)' }}
                >
                  Fix it
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── CalendarFitCard ───────────────────────────────────────────────────────────

export function CalendarFitCard({
  fit,
  sparse = false,
  loading = false,
  calibrating = false,
  callsCompleted,
  onRequestFix,
}: CalendarFitCardProps) {
  const [expandedFocus, setExpandedFocus] = useState(false);
  const [expandedEnergy, setExpandedEnergy] = useState(false);

  const combinedAvg = fit
    ? Math.round((fit.focusScore.score + fit.energyScore.score) / 2) // 0–100
    : null;

  const focusData: CalendarScore | null = fit
    ? { ...fit.focusScore, calibrating: false }
    : loading ? { score: 0, drivers: [], topFix: null, loading: true } : null;

  const energyData: CalendarScore | null = fit
    ? { ...fit.energyScore, calibrating, callsCompleted }
    : loading ? { score: 0, drivers: [], topFix: null, loading: true } : null;

  return (
    <div className="glass-card p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
            Calendar fit today
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
            {sparse
              ? 'Add focus areas and events to see your score.'
              : combinedAvg === null
              ? 'Scores appear after your first morning briefing.'
              : combinedAvg >= 85 ? 'Your schedule is working for you.'
              : combinedAvg >= 50 ? 'Room to improve — tap a score to see why.'
              : 'Schedule needs attention — tap a score to fix it.'}
          </p>
        </div>
        {combinedAvg !== null && !sparse && (
          <div
            className="text-2xl font-black tabular-nums"
            style={{ color: gaugeColor(combinedAvg), textShadow: gaugeGlow(combinedAvg) }}
          >
            {combinedAvg}
            <span className="text-xs font-normal ml-0.5" style={{ color: 'var(--text-faint)' }}>%</span>
          </div>
        )}
      </div>

      {/* Sparse / empty state */}
      {sparse ? (
        <div
          className="text-xs px-3 py-2 rounded-lg"
          style={{ background: 'var(--edg-accent-08)', color: 'var(--text-muted)', border: '1px solid var(--edg-accent-20)' }}
        >
          ✦ Set your 3 focus areas and connect your calendar — Edge will start scoring your schedule.
        </div>
      ) : (
        <div className="space-y-3">
          <ScoreGauge
            label="Focus"
            icon="🎯"
            data={focusData}
            type="focus"
            expanded={expandedFocus}
            onToggle={() => setExpandedFocus(v => !v)}
            onRequestFix={onRequestFix ? () => onRequestFix('focus') : undefined}
          />
          <div style={{ height: 1, background: 'var(--edg-hairline)' }} />
          <ScoreGauge
            label="Energy"
            icon="⚡"
            data={energyData}
            type="energy"
            expanded={expandedEnergy}
            onToggle={() => setExpandedEnergy(v => !v)}
            onRequestFix={onRequestFix ? () => onRequestFix('energy') : undefined}
          />
        </div>
      )}
    </div>
  );
}
