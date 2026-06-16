'use client';

import { useState, useEffect } from 'react';

// ── Types (contract with Core — matches open_loops table) ─────────────────────

export type OpenLoopType = 'commitment_made' | 'awaiting_you' | 'deadline';
export type OpenLoopSource = 'email' | 'call' | 'calendar';
export type OpenLoopStatus = 'open' | 'done' | 'dismissed';

export interface OpenLoop {
  id: string;
  description: string;
  type: OpenLoopType;
  source: OpenLoopSource;
  due_date?: string | null;   // ISO date string
  status: OpenLoopStatus;
  created_at: string;
}

export interface OpenLoopsSectionProps {
  loops: OpenLoop[];
  onResolve: (id: string) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
}

// ── Bucket config ─────────────────────────────────────────────────────────────

const BUCKETS: { type: OpenLoopType; label: string; icon: string }[] = [
  { type: 'commitment_made', label: "You said you'd…",   icon: '↗' },
  { type: 'awaiting_you',    label: 'Waiting on you',    icon: '⏳' },
  { type: 'deadline',        label: 'Coming up',         icon: '📅' },
];

const SOURCE_LABEL: Record<OpenLoopSource, string> = {
  email:    'email',
  call:     'call',
  calendar: 'calendar',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDue(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff < 0)  return `${Math.abs(diff)}d overdue`;
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff < 7)  return `in ${diff} days`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function dueUrgency(dateStr: string): 'overdue' | 'soon' | 'ok' {
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff < 0)  return 'overdue';
  if (diff <= 2) return 'soon';
  return 'ok';
}

// ── Animated row ──────────────────────────────────────────────────────────────

function LoopRow({
  loop,
  onResolve,
  onDismiss,
  index,
}: {
  loop: OpenLoop;
  onResolve: () => void;
  onDismiss: () => void;
  index: number;
}) {
  const [acting, setActing] = useState<'resolve' | 'dismiss' | null>(null);
  const [resolved, setResolved] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Staggered entrance
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 40 + index * 50);
    return () => clearTimeout(t);
  }, [index]);

  async function handle(action: 'resolve' | 'dismiss') {
    setActing(action);
    if (action === 'resolve') {
      setResolved(true);
      // Brief flash before removing
      setTimeout(() => onResolve(), 600);
    } else {
      setTimeout(() => onDismiss(), 300);
    }
  }

  const urgency = loop.due_date ? dueUrgency(loop.due_date) : 'ok';
  const exiting = acting !== null;

  return (
    <div
      className="flex items-start gap-3 py-3"
      style={{
        borderTop: '1px solid var(--edg-hairline)',
        opacity: !mounted ? 0 : exiting && !resolved ? 0.3 : 1,
        transform: !mounted ? 'translateX(-6px)' : resolved ? 'translateX(4px)' : 'translateX(0)',
        transition: 'opacity 0.25s ease, transform 0.25s ease',
      }}
    >
      {/* Resolved checkmark flash */}
      {resolved && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ animation: 'pop-in 0.3s ease both' }}
        />
      )}

      <div className="flex-1 min-w-0">
        <p
          className="text-xs leading-relaxed"
          style={{
            color: resolved ? 'var(--text-faint)' : 'var(--text-body)',
            textDecoration: resolved ? 'line-through' : 'none',
            transition: 'color 0.2s, text-decoration 0.2s',
          }}
        >
          {loop.description}
        </p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span
            className="text-xs px-1.5 py-0.5 rounded"
            style={{ background: 'var(--edg-fill-04)', color: 'var(--text-faint)', border: '1px solid var(--edg-hairline)' }}
          >
            {SOURCE_LABEL[loop.source]}
          </span>
          {loop.due_date && (
            <span
              className="text-xs font-medium"
              style={{
                color: urgency === 'overdue' ? 'var(--edg-danger)' :
                       urgency === 'soon'    ? 'var(--edg-warning)' :
                                               'var(--text-faint)',
              }}
            >
              {formatDue(loop.due_date)}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
        {resolved ? (
          <span className="text-xs font-semibold px-2 py-1" style={{ color: 'var(--edg-success)' }}>
            ✓ Done
          </span>
        ) : (
          <>
            <button
              onClick={() => handle('resolve')}
              disabled={acting !== null}
              className="text-xs px-2.5 py-1.5 rounded-md font-medium transition-all active:scale-95"
              style={{
                background: 'var(--edg-accent-08)',
                color: 'var(--text-accent)',
                border: '1px solid var(--edg-accent-20)',
                opacity: acting ? 0.4 : 1,
                minHeight: 32,
              }}
            >
              {acting === 'resolve' ? '…' : '✓ Done'}
            </button>
            <button
              onClick={() => handle('dismiss')}
              disabled={acting !== null}
              className="text-xs px-2.5 py-1.5 rounded-md transition-opacity active:scale-95"
              style={{ color: 'var(--text-faint)', opacity: acting ? 0.4 : 1, minHeight: 32 }}
            >
              Dismiss
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── All-clear empty state ─────────────────────────────────────────────────────

function AllClear() {
  return (
    <div
      className="glass-card p-6 text-center"
      style={{ borderColor: 'var(--edg-success-border)', animation: 'score-rise 0.4s ease both' }}
    >
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center text-xl mx-auto mb-3"
        style={{
          background: 'var(--edg-success-tint)',
          border: '1.5px solid var(--edg-success-border)',
          boxShadow: '0 0 20px rgba(16,185,129,0.12)',
          animation: 'pop-in 0.4s ease both',
        }}
      >
        ✓
      </div>
      <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-strong)' }}>
        You&apos;re all caught up.
      </p>
      <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
        No open threads, commitments, or deadlines Edge is tracking right now.
      </p>
    </div>
  );
}

// ── OpenLoopsSection ──────────────────────────────────────────────────────────

export function OpenLoopsSection({ loops, onResolve, onDismiss }: OpenLoopsSectionProps) {
  const [localLoops, setLocalLoops] = useState(loops);

  // Sync if parent refreshes
  const [lastLoops, setLastLoops] = useState(loops);
  if (loops !== lastLoops) {
    setLastLoops(loops);
    setLocalLoops(loops);
  }

  function remove(id: string) {
    // Slight delay so exit animation plays
    setTimeout(() => setLocalLoops(prev => prev.filter(l => l.id !== id)), 650);
  }

  const openLoops = localLoops.filter(l => l.status === 'open');
  const totalOpen = openLoops.length;

  if (totalOpen === 0) return <AllClear />;

  return (
    <div className="glass-card p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--text-accent)' }}>
            ✦ OPEN LOOPS
          </p>
          <h3 className="text-sm font-bold leading-snug" style={{ color: 'var(--text-strong)' }}>
            Edge has got these tracked for you.
          </h3>
        </div>
        <span
          className="flex-shrink-0 text-xs px-2 py-1 rounded-full font-semibold tabular-nums"
          style={{
            background: 'var(--edg-accent-08)',
            color: 'var(--text-accent)',
            border: '1px solid var(--edg-accent-20)',
          }}
        >
          {totalOpen}
        </span>
      </div>

      {/* Buckets */}
      <div className="space-y-5">
        {BUCKETS.map(bucket => {
          const items = openLoops.filter(l => l.type === bucket.type);
          if (items.length === 0) return null;
          return (
            <div key={bucket.type}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-xs" aria-hidden="true">{bucket.icon}</span>
                <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {bucket.label}
                </p>
              </div>
              <div className="relative">
                {items.map((loop, i) => (
                  <LoopRow
                    key={loop.id}
                    loop={loop}
                    index={i}
                    onResolve={async () => {
                      remove(loop.id);
                      await onResolve(loop.id);
                    }}
                    onDismiss={async () => {
                      remove(loop.id);
                      await onDismiss(loop.id);
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <p className="text-xs mt-4 pt-3" style={{ color: 'var(--text-faint)', borderTop: '1px solid var(--edg-hairline)' }}>
        Edge picks these up from your calls and email. Dismiss anything that&apos;s no longer relevant.
      </p>
    </div>
  );
}
