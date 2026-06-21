'use client';

import { useEffect, useState } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

// Matches the shape returned by GET /api/notifications/history
interface HistoryNotif {
  type: string;
  title: string;
  body: string;
  sentAt: string; // ISO timestamp
}

export interface NotificationHistoryPanelProps {
  /** Whether to start collapsed (default: true). */
  defaultCollapsed?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function typeIcon(type: string): string {
  switch (type) {
    case 'low_recovery': return '⚡';
    case 'priority_gap': return '📋';
    case 'celebration':  return '🎉';
    default:             return '🔔';
  }
}

function fmtAge(iso: string): string {
  const diffS = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffS < 60)    return 'just now';
  if (diffS < 3600)  return `${Math.floor(diffS / 60)}m ago`;
  if (diffS < 86400) return `${Math.floor(diffS / 3600)}h ago`;
  return `${Math.floor(diffS / 86400)}d ago`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NotificationHistoryPanel({ defaultCollapsed = true }: NotificationHistoryPanelProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [notifs, setNotifs] = useState<HistoryNotif[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/notifications/history')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.notifications) setNotifs(d.notifications); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="glass-card overflow-hidden">
      {/* Header toggle */}
      <button
        className="flex items-center justify-between w-full px-4 py-3"
        onClick={() => setCollapsed(c => !c)}
        aria-expanded={!collapsed}
        aria-controls="notif-history-list"
      >
        <span className="label-caps">Recent alerts</span>
        <div className="flex items-center gap-2">
          {notifs.length > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded tabular-nums"
              style={{ background: 'var(--edg-fill-04)', color: 'var(--text-faint)' }}>
              {notifs.length}
            </span>
          )}
          <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>{collapsed ? '▼' : '▲'}</span>
        </div>
      </button>

      {/* List */}
      {!collapsed && (
        <div id="notif-history-list" style={{ borderTop: '1px solid var(--edg-hairline)' }}>
          {loading ? (
            <NotifHistorySkeleton />
          ) : notifs.length === 0 ? (
            <p className="px-4 py-5 text-xs text-center" style={{ color: 'var(--text-faint)' }}>
              No recent alerts — Edge will notify you when something needs attention.
            </p>
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--edg-hairline)' }}>
              {notifs.map((n, i) => (
                <li key={i} className="flex items-start gap-3 px-4 py-3">
                  <span className="text-base leading-none mt-0.5 flex-shrink-0" aria-hidden="true">
                    {typeIcon(n.type)}
                  </span>
                  <div className="flex-1 min-w-0">
                    {n.title && (
                      <p className="text-xs font-semibold leading-snug mb-0.5" style={{ color: 'var(--text-strong)' }}>
                        {n.title}
                      </p>
                    )}
                    {n.body && (
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                        {n.body}
                      </p>
                    )}
                  </div>
                  <span className="text-xs shrink-0 mt-0.5" style={{ color: 'var(--text-faint)' }}>
                    {fmtAge(n.sentAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function NotifHistorySkeleton() {
  return (
    <div className="px-4 py-3 space-y-3" aria-label="Loading alerts…">
      {[80, 60, 70].map(w => (
        <div key={w} className="flex items-center gap-3">
          <div className="w-5 h-5 rounded" style={{ background: 'var(--edg-fill-04)', animation: 'pulse 1.5s ease-in-out infinite', flexShrink: 0 }} />
          <div className="h-3 rounded flex-1" style={{ maxWidth: `${w}%`, background: 'var(--edg-fill-04)', animation: 'pulse 1.5s ease-in-out infinite' }} />
        </div>
      ))}
    </div>
  );
}
