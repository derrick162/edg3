'use client';

import { useState } from 'react';

export interface FocusScoreCardProps {
  score: number;
  tier: 'high' | 'medium' | 'low';
  headline: string;
  breakdown?: {
    recovery: number;      // 0–40
    schedule: number;      // 0–35
    followThrough: number; // 0–25
  };
}

const TIER: Record<FocusScoreCardProps['tier'], { color: string; label: string }> = {
  high:   { color: 'var(--edg-green)',  label: 'High Focus' },
  medium: { color: 'var(--edg-indigo)', label: 'Medium Focus' },
  low:    { color: 'var(--edg-warn)',   label: 'Low Focus' },
};

function BreakdownBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 rounded-full overflow-hidden" style={{ height: 6, background: 'var(--edg-fill-04)' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="text-xs tabular-nums w-10 text-right" style={{ color: 'var(--text-faint)' }}>
        {value}/{max}
      </span>
    </div>
  );
}

export function FocusScoreCard({ score, tier, headline, breakdown }: FocusScoreCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { color, label } = TIER[tier];

  return (
    <div className="glass-card p-5">
      <p className="label-caps mb-4">Focus Score</p>

      <div className="flex items-end gap-4 mb-3">
        <span
          className="leading-none font-bold"
          style={{ fontSize: 48, color }}
        >
          {score}
        </span>
        <div className="pb-1.5">
          <p className="text-sm font-semibold" style={{ color }}>{label}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{headline}</p>
        </div>
      </div>

      {breakdown && (
        <>
          <button
            className="flex items-center gap-1 w-full mt-3 pt-3"
            style={{ borderTop: '1px solid var(--card-border)', color: 'var(--text-faint)' }}
            onClick={() => setExpanded(e => !e)}
            aria-expanded={expanded}
          >
            <span className="text-xs flex-1 text-left" style={{ color: 'var(--text-faint)', letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: 10, fontWeight: 600 }}>Breakdown</span>
            <span style={{ fontSize: 10 }}>{expanded ? '▲' : '▼'}</span>
          </button>

          {expanded && (
            <div className="space-y-2.5 mt-3">
              <div>
                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Recovery</p>
                <BreakdownBar value={breakdown.recovery} max={40} color={color} />
              </div>
              <div>
                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Schedule</p>
                <BreakdownBar value={breakdown.schedule} max={35} color={color} />
              </div>
              <div>
                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Follow-through</p>
                <BreakdownBar value={breakdown.followThrough} max={25} color={color} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function FocusScoreCardSkeleton() {
  return (
    <div className="glass-card p-5">
      <div className="h-3 w-20 rounded mb-4" style={{ background: 'var(--edg-fill-04)', animation: 'pulse 1.5s ease-in-out infinite' }} />
      <div className="flex items-end gap-4 mb-3">
        <div className="w-14 h-12 rounded" style={{ background: 'var(--edg-fill-04)', animation: 'pulse 1.5s ease-in-out infinite' }} />
        <div className="pb-1.5 space-y-1.5 flex-1">
          <div className="h-3 w-24 rounded" style={{ background: 'var(--edg-fill-04)', animation: 'pulse 1.5s ease-in-out infinite' }} />
          <div className="h-3 w-40 rounded" style={{ background: 'var(--edg-fill-04)', animation: 'pulse 1.5s ease-in-out infinite' }} />
        </div>
      </div>
    </div>
  );
}
