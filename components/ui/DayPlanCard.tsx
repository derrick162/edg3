'use client';

import { useState, useEffect, useRef } from 'react';

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
  diagnoses?: string[];  // 1–3 concrete problem sentences (why this plan is needed)
  wellAligned?: boolean; // true when no actions needed — card shows score + positive state
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
  /** 1–3 concrete diagnoses explaining why the plan is needed */
  diagnoses?: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const OP_ICONS: Record<PlanChangeOp, string> = {
  create:  '＋',
  move:    '↗',
  delete:  '✕',
  recolor: '●',
};

const OP_COLORS: Record<PlanChangeOp, string> = {
  create:  'var(--edg-success)',
  move:    'var(--edg-indigo)',
  delete:  'var(--edg-danger)',
  recolor: 'var(--rec-medium)',
};

function scoreDeltaColor(delta: number): string {
  if (delta >= 10) return 'var(--gauge-peak)';
  if (delta >= 5)  return 'var(--gauge-high)';
  return 'var(--gauge-mid)';
}

// ── DayPlanCard ───────────────────────────────────────────────────────────────

function useScoreTicker(target: number, trigger: string | undefined): number {
  const [displayed, setDisplayed] = useState(target);
  const rafRef = useRef<number>(0);
  useEffect(() => {
    setDisplayed(prev => {
      const start = prev;
      const end = target;
      if (start === end) return end;
      const duration = 700;
      const t0 = performance.now();
      function tick(now: number) {
        const p = Math.min(1, (now - t0) / duration);
        const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        setDisplayed(Math.round(start + (end - start) * eased));
        if (p < 1) rafRef.current = requestAnimationFrame(tick);
      }
      rafRef.current = requestAnimationFrame(tick);
      return start;
    });
    return () => cancelAnimationFrame(rafRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);
  return displayed;
}

export function DayPlanCard({
  plan,
  loading = false,
  onConfirm,
  onDismiss,
  applied = false,
  appliedScore,
  diagnoses,
}: DayPlanCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const animatedAfter = useScoreTicker(plan?.scoreAfter ?? 0, plan?.planId);

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
          <span className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin inline-block" />
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Edge is building your plan…</span>
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 rounded-lg animate-pulse" style={{ background: 'var(--edg-fill-04)' }} />
          ))}
        </div>
      </div>
    );
  }

  // ── No plan — well-aligned greeting
  if (!plan) {
    return (
      <div
        className="glass-card p-5"
        style={{ borderColor: 'var(--plan-border)', animation: 'score-rise 0.4s ease both' }}
      >
        <div className="flex items-center gap-3">
          <span
            className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-base"
            style={{
              background: 'var(--edg-accent-08)',
              border: '1.5px solid var(--edg-accent-20)',
            }}
          >
            ✦
          </span>
          <div>
            <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--text-accent)' }}>
              EDGE ASSESSMENT
            </p>
            <p className="text-sm font-bold leading-snug" style={{ color: 'var(--text-strong)' }}>
              Your day looks well-aligned.
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              No reshaping needed — Edge is watching.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const delta = plan.scoreAfter - plan.scoreBefore;
  const finalScore = applied ? (appliedScore ?? plan.scoreAfter) : plan.scoreAfter;

  // ── Well-aligned / on-track state
  if (plan.wellAligned && !applied) {
    return (
      <div className="glass-card p-5" style={{ borderColor: 'var(--plan-border)' }}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--edg-success)' }}>✦ ON TRACK</p>
            <p className="text-sm font-bold leading-snug" style={{ color: 'var(--text-strong)' }}>
              {plan.summary}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
              Edge will flag it if something shifts.
            </p>
          </div>
          <div className="flex-shrink-0 text-right">
            <p className="text-3xl font-black tabular-nums leading-none" style={{ color: scoreDeltaColor(12) }}>
              {plan.scoreBefore}
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>EDGE SCORE</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Applied / celebration state
  if (applied) {
    return (
      <div
        className="glass-card p-5"
        style={{
          borderColor: 'var(--plan-success-border)',
          background: 'var(--plan-success-bg)',
          animation: 'score-rise 0.4s ease both',
        }}
      >
        <div className="flex items-center gap-3 mb-3">
          <span
            className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg"
            style={{
              background: 'rgba(34,197,94,0.15)',
              border: '1.5px solid var(--plan-success-border)',
              boxShadow: '0 0 14px rgba(34,197,94,0.20)',
              animation: 'pop-in 0.45s ease both',
            }}
          >
            ✓
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold leading-snug" style={{ color: 'var(--text-strong)' }}>
              Your day just got better
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {plan.changes.length} change{plan.changes.length !== 1 ? 's' : ''} applied to your calendar
            </p>
          </div>
          <div className="flex-shrink-0 text-right">
            <p
              className="text-2xl font-black tabular-nums leading-none"
              style={{ color: scoreDeltaColor(delta) }}
            >
              {finalScore}
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>EDGE SCORE</p>
          </div>
        </div>
        {delta > 0 && (
          <div
            className="text-xs px-3 py-1.5 rounded-lg text-center font-semibold"
            style={{
              background: 'rgba(34,197,94,0.08)',
              color: scoreDeltaColor(delta),
              border: '1px solid rgba(34,197,94,0.22)',
            }}
          >
            +{delta} points{delta >= 15 ? ' 🚀' : delta >= 10 ? ' — big improvement' : ' — solid gain'}
          </div>
        )}
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
            ✦ HERE&apos;S WHAT&apos;S OFF TODAY
          </p>
          <p className="text-sm font-bold leading-snug" style={{ color: 'var(--text-strong)' }}>
            {plan.summary}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
            Nothing changes until you confirm.
          </p>
        </div>
        {onDismiss && (
          <button onClick={onDismiss} className="text-xs flex-shrink-0 mt-0.5" style={{ color: 'var(--text-faint)' }}>
            ✕
          </button>
        )}
      </div>

      {/* Diagnoses — insight bullets, not error flags */}
      {diagnoses && diagnoses.length > 0 && (
        <div className="mt-3 mb-1 space-y-1.5">
          {diagnoses.map((d, i) => (
            <div
              key={i}
              className="flex items-start gap-2.5 px-3 py-2 rounded-lg"
              style={{ background: 'var(--edg-accent-04)', border: '1px solid var(--edg-accent-08)' }}
            >
              <span className="flex-shrink-0 text-xs mt-0.5" style={{ color: 'var(--text-accent)', opacity: 0.7 }}>◆</span>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>{d}</p>
            </div>
          ))}
        </div>
      )}

      {/* Score delta — animated reveal */}
      <div className="flex items-center gap-3 mb-4 mt-3">
        <div
          className="flex items-center gap-2.5 px-3 py-2 rounded-xl"
          style={{ background: 'var(--edg-fill-04)', border: '1px solid var(--edg-hairline)' }}
        >
          <span className="text-lg font-black tabular-nums leading-none" style={{ color: 'var(--text-faint)' }}>
            {plan.scoreBefore}
          </span>
          <span className="text-sm" style={{ color: 'var(--text-faint)' }}>→</span>
          <span
            className="text-2xl font-black tabular-nums leading-none"
            style={{ color: scoreDeltaColor(delta) }}
          >
            {animatedAfter}
          </span>
          <span
            className="text-xs font-bold px-1.5 py-0.5 rounded-md"
            style={{ background: `${scoreDeltaColor(delta)}18`, color: scoreDeltaColor(delta) }}
          >
            +{delta}
          </span>
        </div>
        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>Edge Score</span>
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
