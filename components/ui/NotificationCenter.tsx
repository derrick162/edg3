'use client';

import { useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Notification types understood by this component. 'general' = legacy fallback. */
export type NotifType =
  | 'celebration'    // milestone / area complete — positive moment
  | 'energy_prompt'  // "how's your energy?" one-tap inline
  | 'drift_nudge'    // focus area neglected — offer to block time
  | 'edge_action'    // Edge took an action — show + undo
  | 'general';       // legacy / untyped

export interface NotifAction {
  label: string;
  /** variant controls button style */
  variant: 'primary' | 'secondary' | 'danger';
  onClick: () => void;
}

export interface NotifEnergyOption {
  level: 'green' | 'yellow' | 'red';
  emoji: string;
  label: string;
}

export interface Notification {
  id: number;
  type?: NotifType;
  title: string | null;
  body: string | null;
  read: boolean;
  createdAt: number;   // unix ms
  /** Type-specific extras */
  actions?: NotifAction[];
  /** For energy_prompt — triggers energy set */
  onSetEnergy?: (level: 'green' | 'yellow' | 'red') => void;
  /** For edge_action — undo callback */
  onUndo?: () => void;
}

export interface NotificationCenterProps {
  notifications: Notification[];
  loading?: boolean;
  onDismiss?: (id: number) => void;
  /** Called when user sets energy from an energy_prompt notification */
  onSetEnergy?: (level: 'green' | 'yellow' | 'red') => void;
  /** Called to undo an edge_action */
  onUndo?: (id: number) => void;
  /** Generic action handler */
  onAction?: (notifId: number, actionLabel: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ENERGY_OPTIONS: NotifEnergyOption[] = [
  { level: 'green',  emoji: '🟢', label: 'High' },
  { level: 'yellow', emoji: '🟡', label: 'Med'  },
  { level: 'red',    emoji: '🔴', label: 'Low'  },
];

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const now = Date.now();
  const diffH = (now - ms) / 3600000;
  if (diffH < 1)   return 'just now';
  if (diffH < 24)  return `${Math.floor(diffH)}h ago`;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function typeIcon(type: NotifType | undefined): string {
  switch (type) {
    case 'celebration':  return '🎉';
    case 'energy_prompt': return '⚡';
    case 'drift_nudge':  return '⏰';
    case 'edge_action':  return '✦';
    default:             return '•';
  }
}

function typeBg(type: NotifType | undefined, read: boolean): string {
  if (read) return 'transparent';
  switch (type) {
    case 'celebration':  return 'var(--notif-celebrate-bg)';
    case 'energy_prompt': return 'var(--notif-energy-bg)';
    case 'drift_nudge':  return 'var(--notif-nudge-bg)';
    case 'edge_action':  return 'var(--notif-action-bg)';
    default:             return 'var(--edg-accent-04)';
  }
}

function typeBorder(type: NotifType | undefined, read: boolean): string {
  if (read) return 'transparent';
  switch (type) {
    case 'celebration':  return 'var(--notif-celebrate-border)';
    case 'energy_prompt': return 'var(--notif-energy-border)';
    case 'drift_nudge':  return 'var(--notif-nudge-border)';
    case 'edge_action':  return 'var(--edg-accent-20)';
    default:             return 'transparent';
  }
}

// Energy level → active style
const ENERGY_ACTIVE: Record<string, { bg: string; border: string; color: string }> = {
  green:  { bg: 'rgba(34,197,94,0.15)',   border: 'rgba(34,197,94,0.40)',   color: 'var(--whoop-high)' },
  yellow: { bg: 'rgba(245,158,11,0.15)',  border: 'rgba(245,158,11,0.40)',  color: 'var(--whoop-medium)' },
  red:    { bg: 'rgba(239,68,68,0.15)',   border: 'rgba(239,68,68,0.40)',   color: 'var(--whoop-low)' },
};

// ── Single notification row ───────────────────────────────────────────────────

function NotifRow({
  n,
  onSetEnergy,
  onUndo,
  onDismiss,
}: {
  n: Notification;
  onSetEnergy?: (level: 'green' | 'yellow' | 'red') => void;
  onUndo?: () => void;
  onDismiss?: () => void;
}) {
  const type = n.type ?? 'general';
  const icon = typeIcon(type);
  const isCelebration = type === 'celebration';
  const [selectedEnergy, setSelectedEnergy] = useState<'green' | 'yellow' | 'red' | null>(null);

  function handleSetEnergy(level: 'green' | 'yellow' | 'red') {
    setSelectedEnergy(level);
    onSetEnergy?.(level);
  }

  return (
    <div
      className="rounded-xl p-3 transition-all"
      style={{
        background: typeBg(type, n.read),
        border: `1px solid ${typeBorder(type, n.read)}`,
        opacity: n.read && type === 'general' ? 0.55 : 1,
        animation: isCelebration && !n.read ? 'score-rise 0.4s ease both' : undefined,
        boxShadow: isCelebration && !n.read ? '0 0 20px rgba(99,102,241,0.12)' : undefined,
      }}
    >
      <div className="flex items-start gap-2.5">
        {/* Icon */}
        <span
          className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm"
          style={{
            background: n.read ? 'var(--edg-fill-04)' : typeBg(type, false),
            boxShadow: isCelebration && !n.read ? '0 0 12px rgba(99,102,241,0.30)' : undefined,
            animation: isCelebration && !n.read ? 'pop-in 0.45s ease both' : undefined,
          }}
        >
          {icon}
        </span>

        <div className="flex-1 min-w-0">
          {/* Title */}
          {n.title && (
            <p className="text-xs font-semibold leading-snug mb-0.5" style={{ color: 'var(--text-strong)' }}>
              {n.title}
            </p>
          )}
          {/* Body */}
          {n.body && (
            <p className="text-xs leading-relaxed mb-2" style={{ color: 'var(--text-muted)' }}>
              {n.body}
            </p>
          )}

          {/* Energy one-tap — shows confirmation after selection */}
          {type === 'energy_prompt' && onSetEnergy && (
            selectedEnergy ? (
              <p className="text-xs font-medium mb-1" style={{ color: ENERGY_ACTIVE[selectedEnergy].color }}>
                {selectedEnergy === 'green' ? '🟢' : selectedEnergy === 'yellow' ? '🟡' : '🔴'} Logged — Edg3 has you.
              </p>
            ) : (
              <div className="flex items-center gap-1.5 mb-1">
                {ENERGY_OPTIONS.map(opt => (
                  <button
                    key={opt.level}
                    onClick={() => handleSetEnergy(opt.level)}
                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full transition-all hover:opacity-90"
                    style={{
                      background: 'var(--edg-fill-04)',
                      border: '1px solid var(--edg-hairline)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {opt.emoji} {opt.label}
                  </button>
                ))}
              </div>
            )
          )}

          {/* Edge action — undo */}
          {type === 'edge_action' && onUndo && (
            <button
              onClick={onUndo}
              className="text-xs px-2.5 py-1 rounded-full transition-all hover:opacity-90"
              style={{
                background: 'var(--edg-fill-04)',
                border: '1px solid var(--edg-hairline)',
                color: 'var(--text-muted)',
              }}
            >
              ↩ Undo
            </button>
          )}

          {/* Generic CTA actions */}
          {n.actions && n.actions.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              {n.actions.map((a, i) => (
                <button
                  key={i}
                  onClick={a.onClick}
                  className="text-xs px-2.5 py-1 rounded-full transition-all hover:opacity-90"
                  style={
                    a.variant === 'primary'
                      ? { background: 'var(--edg-accent-15)', border: '1px solid var(--edg-accent-20)', color: 'var(--text-accent)' }
                      : a.variant === 'danger'
                      ? { background: 'var(--edg-fill-04)', border: '1px solid var(--edg-danger-border)', color: 'var(--edg-danger)' }
                      : { background: 'var(--edg-fill-04)', border: '1px solid var(--edg-hairline)', color: 'var(--text-muted)' }
                  }
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}

          {/* Timestamp */}
          <p className="text-xs mt-1.5" style={{ color: 'var(--text-faint)' }}>
            {fmtTime(n.createdAt)}
          </p>
        </div>

        {/* Dismiss */}
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="flex-shrink-0 text-xs opacity-0 hover:opacity-100 transition-opacity mt-0.5"
            style={{ color: 'var(--text-faint)' }}
            title="Dismiss"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

// ── NotificationCenter ────────────────────────────────────────────────────────

export function NotificationCenter({
  notifications,
  loading = false,
  onDismiss,
  onSetEnergy,
  onUndo,
}: NotificationCenterProps) {
  const unread = notifications.filter(n => !n.read).length;

  if (loading) {
    return (
      <div className="p-3">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-bold" style={{ color: 'var(--text-strong)' }}>From Edg3</span>
        </div>
        <div className="space-y-2">
          {[1, 2].map(i => (
            <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: 'var(--edg-fill-04)' }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-bold" style={{ color: 'var(--text-strong)' }}>From Edg3</span>
        {unread > 0 && (
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: 'var(--edg-accent-15)', color: 'var(--text-accent)', border: '1px solid var(--edg-accent-20)' }}
          >
            {unread} new
          </span>
        )}
      </div>

      {/* Empty state */}
      {notifications.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-xl mb-2">✦</p>
          <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Edg3 is on it</p>
          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
            Celebrations, nudges, and one-tap actions will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map(n => (
            <NotifRow
              key={n.id}
              n={n}
              onSetEnergy={n.type === 'energy_prompt' ? (onSetEnergy ?? n.onSetEnergy) : undefined}
              onUndo={n.type === 'edge_action' ? (onUndo ? () => onUndo(n.id) : n.onUndo) : undefined}
              onDismiss={onDismiss ? () => onDismiss(n.id) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Bell button (the trigger, for convenience) ────────────────────────────────

export function NotificationBell({
  unreadCount,
  onClick,
}: {
  unreadCount: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title="Notifications"
      aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
      style={{
        position: 'relative',
        width: 40,
        height: 40,
        borderRadius: 9999,
        background: 'var(--edg-fill-hover)',
        border: '1px solid var(--edg-border-10)',
        fontSize: 18,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      🔔
      {unreadCount > 0 && (
        <span
          style={{
            position: 'absolute',
            top: -4,
            right: -4,
            minWidth: 18,
            height: 18,
            padding: '0 5px',
            borderRadius: 9999,
            background: 'var(--edg-danger)',
            color: '#fff',
            fontSize: 11,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {unreadCount}
        </span>
      )}
    </button>
  );
}
