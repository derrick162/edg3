'use client';

import { useState } from 'react';

// ── Types (contract with Core — matches lib/calendarPlan.ts output) ───────────

export type PlanChangeOp = 'create' | 'move' | 'delete' | 'recolor';

export interface PlanChange {
  op: PlanChangeOp;
  title: string;
  detail: string;        // e.g. "9–11 AM → 2–4 PM" or "blue → focus (indigo)"
  reason: string;        // one-line why: "matches your 9–11 peak"
}

export interface CalendarPlan {
  changes: PlanChange[];
  scoreBefore: number;   // 0–100 Edge Score before applying
  scoreAfter: number;    // 0–100 projected Edge Score after
  summary: string;       // one-line e.g. "3 moves + 1 block to align your morning"
  planId: string;        // opaque id for the confirm/undo call
}

export interface DayPlanCardProps {
  plan: CalendarPlan | null;
  loading?: boolean;
  /** Called when user confirms the plan. Receives planId. */
  onConfirm: (planId: string) => Promise<void>;
  /** Called when user dismisses without confirming */
  onDismiss?: () => void;
  /** Score has been applied — parent sets this after onConfirm resolves */
  applied?: boolean;
  /** Score after application (may differ from plan.scoreAfter once real) */
  appliedScore?: number;
  /** Plain-English summary lines from the confirm response (Darren wires; fallback shown when absent) */
  changeLines?: string[];
  /** Called when user clicks "Undo reshape" */
  onUndo?: () => Promise<void>;
  /** True while undo is in-flight */
  undoing?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const OP_ICONS: Record<PlanChangeOp, string> = {
  create:  '＋',
  move:    '◆',
  delete:  '◆',
  recolor: '◆',
};

const OP_COLORS: Record<PlanChangeOp, string> = {
  create:  'var(--edg-success)',
  move:    'var(--edg-indigo)',
  delete:  'var(--text-muted)',
  recolor: 'var(--edg-indigo)',
};

function scoreDeltaColor(delta: number): string {
  if (delta >= 10) return 'var(--gauge-peak)';
  if (delta >= 5)  return 'var(--gauge-high)';
  return 'var(--gauge-mid)';
}

// ── DayPlanCard ───────────────────────────────────────────────────────────────

export function DayPlanCard({
  plan,
  loading = false,
  onConfirm,
  onDismiss,
  applied = false,
  appliedScore,
  changeLines,
  onUndo,
  undoing = false,
}: DayPlanCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function handleConfirm() {
    if (!plan) return;
    setConfirming(true);
    await onConfirm(plan.planId);
    setConfirming(false);
  }

  // ── Loading
  if (loading) {
    return (
      <div className="glass-card p-5" style={{ borderColor: 'var(--plan-border)' }}>
        <div className="flex items-center gap-2 mb-4">
          <span className="w-4 h-4 border-2 spinner animate-spin inline-block" />
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Edg3 is building your plan…</span>
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 rounded-lg animate-pulse" style={{ background: 'var(--edg-fill-04)' }} />
          ))}
        </div>
      </div>
    );
  }

  // ── No plan
  if (!plan) {
    return (
      <div className="glass-card p-5" style={{ borderColor: 'var(--plan-border)' }}>
        <div className="flex items-start gap-3.5">
          <div
            className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: 'var(--edg-accent-08)', border: '1px solid var(--edg-accent-15)' }}
          >
            <span style={{ color: 'var(--text-accent)', fontSize: 14 }}>✦</span>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-accent)' }}>
              EDGE ASSESSMENT
            </p>
            <p className="text-sm font-bold leading-snug mb-0.5" style={{ color: 'var(--text-strong)' }}>
              Your day looks well-aligned.
            </p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Nothing needs reshaping right now. Edg3 will flag changes as your calendar fills in.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const delta = plan.scoreAfter - plan.scoreBefore;

  // ── Applied / Day Reshaped toast
  // NO standalone EDGE SCORE here — there is ONE Edge Score (the headline EdgeScoreCard,
  // which refetches after apply). A second number here read as a competing score.
  if (applied) {
    const lines = changeLines?.length
      ? changeLines.slice(0, 3)
      : ['Calendar reshaped to match your priorities'];

    return (
      <div
        className="glass-card p-5"
        style={{
          borderColor: 'var(--plan-success-border)',
          background: 'var(--plan-success-bg)',
          animation: 'score-rise 0.4s ease both',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 mb-3">
          <span
            className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm"
            style={{
              background: 'var(--plan-success-tint)',
              border: '1.5px solid var(--plan-success-border)',
              boxShadow: 'var(--plan-success-glow)',
              color: 'var(--edg-success)',
            }}
          >
            ✓
          </span>
          <div>
            <p className="text-sm font-bold leading-snug" style={{ color: 'var(--text-strong)' }}>
              Day reshaped{delta > 0 && (
                <span className="ml-1.5 font-semibold" style={{ color: 'var(--edg-success)' }}>
                  — Edg3 Score +{delta}
                </span>
              )}
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
              Changes are in your Google Calendar
            </p>
          </div>
        </div>

        {/* Change lines */}
        <ul className="space-y-1 mb-4 pl-1">
          {lines.map((l, i) => (
            <li key={i} className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              <span className="flex-shrink-0 mt-px" style={{ color: 'var(--text-faint)' }}>•</span>
              {l}
            </li>
          ))}
        </ul>

        {/* Undo CTA + countdown bar */}
        {onUndo && (
          <div>
            <button
              onClick={onUndo}
              disabled={undoing}
              className="btn-secondary w-full text-sm py-2"
            >
              {undoing ? 'Undoing…' : 'Undo reshape'}
            </button>
            <div
              className="mt-2 h-0.5 rounded-full overflow-hidden"
              style={{ background: 'var(--edg-fill-04)' }}
              aria-hidden="true"
            >
              <div
                className="toast-countdown-bar h-full rounded-full"
                style={{
                  background: 'var(--plan-success-border)',
                  animation: 'toast-countdown 30s linear forwards',
                }}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Plan computed but nothing to change (ticket 3): show the aligned assessment, NOT a
  // full proposal panel with a "Make it happen" CTA — a big button that does nothing is confusing.
  if (plan.changes.length === 0) {
    return (
      <div className="glass-card p-5" style={{ borderColor: 'var(--plan-border)' }}>
        <div className="flex items-start gap-3.5">
          <div
            className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: 'var(--edg-accent-08)', border: '1px solid var(--edg-accent-15)' }}
          >
            <span style={{ color: 'var(--text-accent)', fontSize: 14 }}>✦</span>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-accent)' }}>
              EDGE ASSESSMENT
            </p>
            <p className="text-sm font-bold leading-snug mb-0.5" style={{ color: 'var(--text-strong)' }}>
              Your day is already aligned.
            </p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {plan.summary?.trim()
                ? plan.summary
                : 'Nothing worth reshaping right now — your time already lines up with what matters.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Proposed plan
  return (
    <div
      className="glass-card p-5"
      style={{
        borderColor: 'var(--plan-border)',
        background: 'var(--plan-bg)',
        animation: 'score-rise 0.5s 0.2s ease both',
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--text-accent)' }}>
            ✦ EDGE ASSESSMENT
          </p>
          <p className="text-sm font-bold leading-snug" style={{ color: 'var(--text-strong)' }}>
            {plan.summary}
          </p>
        </div>
        {onDismiss && (
          <button onClick={onDismiss} className="text-xs flex-shrink-0 mt-0.5" style={{ color: 'var(--text-faint)' }}>
            ✕
          </button>
        )}
      </div>

      <p className="text-xs mt-1 mb-3" style={{ color: 'var(--text-faint)' }}>
        Preview — nothing changes until you confirm.
      </p>

      {/* Score delta preview */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'var(--edg-fill-04)', border: '1px solid var(--edg-hairline)' }}>
          <span className="text-sm font-black tabular-nums" style={{ color: 'var(--text-faint)' }}>
            {plan.scoreBefore}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>→</span>
          <span
            className="text-sm font-black tabular-nums"
            style={{ color: scoreDeltaColor(delta) }}
          >
            {plan.scoreAfter}
          </span>
          <span className="text-xs font-semibold" style={{ color: scoreDeltaColor(delta) }}>
            +{delta}
          </span>
        </div>
        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>Edg3 Score</span>
      </div>

      {/* Change list */}
      <div className="space-y-1.5 mb-4">
        {(expanded ? plan.changes : plan.changes.slice(0, 3)).map((c, i) => (
          <div
            key={i}
            className="flex items-start gap-2.5 px-3 py-2 rounded-lg"
            style={{ background: 'var(--edg-fill-04)', border: '1px solid var(--edg-hairline)' }}
          >
            <span
              className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center text-xs font-black mt-0.5"
              style={{ background: `${OP_COLORS[c.op]}18`, color: OP_COLORS[c.op] }}
            >
              {OP_ICONS[c.op]}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold leading-snug" style={{ color: 'var(--text-strong)' }}>
                {c.title}
                {c.detail && (
                  <span className="font-normal ml-1.5" style={{ color: 'var(--text-faint)' }}>
                    {c.detail}
                  </span>
                )}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>{c.reason}</p>
            </div>
          </div>
        ))}
        {plan.changes.length > 3 && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-xs w-full text-center py-1 transition-opacity hover:opacity-80"
            style={{ color: 'var(--text-accent)' }}
          >
            {expanded ? '▲ Show less' : `▼ ${plan.changes.length - 3} more change${plan.changes.length - 3 !== 1 ? 's' : ''}`}
          </button>
        )}
      </div>

      {/* CTA */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleConfirm}
          disabled={confirming}
          className="btn-primary flex-1 text-sm py-2.5"
          style={{ boxShadow: confirming ? 'none' : 'var(--shadow-btn-glow)' }}
        >
          {confirming ? 'Applying…' : '✓ Make it happen'}
        </button>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="btn-secondary text-sm py-2.5 px-4 flex-shrink-0"
          >
            Not now
          </button>
        )}
      </div>
    </div>
  );
}
