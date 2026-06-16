'use client';

import { useState } from 'react';

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

const BUCKETS: { type: OpenLoopType; label: string; icon: string; emptyNote: string }[] = [
  {
    type: 'commitment_made',
    label: 'You said you\'d…',
    icon: '↗',
    emptyNote: 'Nothing promised yet.',
  },
  {
    type: 'awaiting_you',
    label: 'Waiting on you',
    icon: '⏳',
    emptyNote: 'No one\'s waiting on you right now.',
  },
  {
    type: 'deadline',
    label: 'Coming up',
    icon: '📅',
    emptyNote: 'No deadlines on Edge\'s radar.',
  },
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
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff < 7) return `in ${diff} days`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function dueUrgency(dateStr: string): 'overdue' | 'soon' | 'ok' {
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return 'overdue';
  if (diff <= 2) return 'soon';
  return 'ok';
}

// ── Loop item row ─────────────────────────────────────────────────────────────

function LoopRow({
  loop,
  onResolve,
  onDismiss,
}: {
  loop: OpenLoop;
  onResolve: () => void;
  onDismiss: () => void;
}) {
  const [acting, setActing] = useState<'resolve' | 'dismiss' | null>(null);

  async function handle(action: 'resolve' | 'dismiss') {
    setActing(action);
    if (action === 'resolve') await onResolve();
    else await onDismiss();
  }

  const urgency = loop.due_date ? dueUrgency(loop.due_date) : 'ok';

  return (
    <div
      className="flex items-start gap-3 py-3"
      style={{ borderTop: '1px solid var(--edg-hairline)' }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-body)' }}>
          {loop.description}
        </p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {/* Source badge */}
          <span
            className="text-xs px-1.5 py-0.5 rounded"
            style={{ background: 'var(--edg-fill-04)', color: 'var(--text-faint)', border: '1px solid var(--edg-hairline)' }}
          >
            {SOURCE_LABEL[loop.source]}
          </span>
          {/* Due date */}
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
        <button
          onClick={() => handle('resolve')}
          disabled={acting !== null}
          className="text-xs px-2 py-1 rounded-md font-medium transition-opacity"
          style={{
            background: 'var(--edg-accent-08)',
            color: 'var(--text-accent)',
            border: '1px solid var(--edg-accent-20)',
            opacity: acting ? 0.5 : 1,
          }}
        >
          {acting === 'resolve' ? '…' : '✓ Done'}
        </button>
        <button
          onClick={() => handle('dismiss')}
          disabled={acting !== null}
          className="text-xs px-2 py-1 rounded-md transition-opacity"
          style={{ color: 'var(--text-faint)', opacity: acting ? 0.5 : 1 }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

// ── OpenLoopsSection ──────────────────────────────────────────────────────────

export function OpenLoopsSection({ loops, onResolve, onDismiss }: OpenLoopsSectionProps) {
  const [localLoops, setLocalLoops] = useState(loops);

  // Sync if parent refreshes
  const [lastLoops, setLastLoops] = useState(loops);
  if (loops !== lastLoops) { setLastLoops(loops); setLocalLoops(loops); }

  function remove(id: string) {
    setLocalLoops(prev => prev.filter(l => l.id !== id));
  }

  const openLoops = localLoops.filter(l => l.status === 'open');
  const totalOpen = openLoops.length;

  // All clear
  if (totalOpen === 0) {
    return (
      <div className="glass-card p-5" style={{ borderColor: 'var(--edg-accent-20)' }}>
        <div className="flex items-center gap-3">
          <span
            className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm"
            style={{ background: 'var(--edg-accent-08)', border: '1px solid var(--edg-accent-20)' }}
          >
            ✦
          </span>
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>
              You&apos;re clear.
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
              No open threads or commitments Edge is tracking.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--text-accent)' }}>
            ✦ OPEN LOOPS
          </p>
          <h3 className="text-sm font-bold leading-snug" style={{ color: 'var(--text-strong)' }}>
            Edge is keeping track of these for you.
          </h3>
        </div>
        <span
          className="flex-shrink-0 text-xs px-2 py-1 rounded-full font-semibold"
          style={{ background: 'var(--edg-accent-08)', color: 'var(--text-accent)', border: '1px solid var(--edg-accent-20)' }}
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
              {/* Bucket label */}
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-xs" aria-hidden="true">{bucket.icon}</span>
                <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {bucket.label}
                </p>
              </div>
              {/* Items */}
              <div>
                {items.map(loop => (
                  <LoopRow
                    key={loop.id}
                    loop={loop}
                    onResolve={async () => { remove(loop.id); await onResolve(loop.id); }}
                    onDismiss={async () => { remove(loop.id); await onDismiss(loop.id); }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <p className="text-xs mt-4" style={{ color: 'var(--text-faint)' }}>
        Edge picks these up from your calls and email — resolve or dismiss anything that&apos;s no longer relevant.
      </p>
    </div>
  );
}
