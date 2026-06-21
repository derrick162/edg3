'use client';

import { useState } from 'react';

// ── Types (contract with Core — matches /api/meeting-prep output) ─────────────

export interface MeetingThread {
  subject: string;
  snippet: string;    // last message preview
  date: string;       // ISO date string
  unread?: boolean;
}

export interface MeetingFact {
  entity: string;     // e.g. "Sarah Chen"
  statement: string;  // e.g. "VP of Product at Acme, met at SF conference"
}

export interface MeetingPrepContext {
  eventId: string;
  title: string;
  startTime: string;    // ISO datetime
  durationMin: number;
  attendees: string[];  // display names
  location?: string;
  threads: MeetingThread[];
  facts: MeetingFact[];
  edgeSuggestion?: string; // one-line Edge observation, e.g. "Last email from Sarah was 3 weeks ago — she mentioned budget concerns"
}

export interface MeetingPrepCardProps {
  context: MeetingPrepContext;
  /** Called when user dismisses the card */
  onDismiss?: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const diff = Math.round((d.setHours(0,0,0,0) - today.setHours(0,0,0,0)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function threadAge(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.round((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7)  return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.round(diffDays / 7)}w ago`;
  return `${Math.round(diffDays / 30)}mo ago`;
}

// ── MeetingPrepCard ───────────────────────────────────────────────────────────

export function MeetingPrepCard({ context, onDismiss }: MeetingPrepCardProps) {
  const [expanded, setExpanded] = useState(false);

  const startLabel = `${formatDate(context.startTime)} at ${formatTime(context.startTime)}`;
  const hasContext = context.threads.length > 0 || context.facts.length > 0;

  return (
    <div
      className="glass-card p-5"
      style={{
        borderColor: 'var(--edg-accent-20)',
        animation: 'score-rise 0.4s ease both',
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--text-accent)' }}>
            ✦ MEETING PREP
          </p>
          <h3
            className="text-sm font-bold leading-snug truncate"
            style={{ color: 'var(--text-strong)' }}
            title={context.title}
          >
            {context.title}
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
            {startLabel}
            {context.durationMin && ` · ${context.durationMin} min`}
            {context.attendees.length > 0 && ` · ${context.attendees.slice(0, 2).join(', ')}${context.attendees.length > 2 ? ` +${context.attendees.length - 2}` : ''}`}
          </p>
          {context.location && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
              📍 {context.location}
            </p>
          )}
        </div>
        {onDismiss && (
          <button onClick={onDismiss} className="flex-shrink-0 text-xs transition-opacity hover:opacity-70" style={{ color: 'var(--text-faint)' }} aria-label="Dismiss meeting prep">
            <span aria-hidden="true">✕</span>
          </button>
        )}
      </div>

      {/* Edge's one-liner insight */}
      {context.edgeSuggestion && (
        <div
          className="rounded-xl px-3 py-2.5 mb-3 flex items-start gap-2"
          style={{ background: 'var(--edg-accent-08)', border: '1px solid var(--edg-accent-20)' }}
        >
          <span className="text-xs flex-shrink-0 mt-0.5" style={{ color: 'var(--text-accent)' }}>✦</span>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            {context.edgeSuggestion}
          </p>
        </div>
      )}

      {/* No-context state */}
      {!hasContext && (
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
          No email threads or notes found for this meeting. You&apos;re going in fresh.
        </p>
      )}

      {hasContext && (
        <>
          {/* Compact preview (collapsed) */}
          {!expanded && (
            <div className="space-y-1.5 mb-3">
              {context.facts.slice(0, 2).map((f, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-xs flex-shrink-0 mt-0.5 font-bold" style={{ color: 'var(--text-faint)' }}>·</span>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    <span className="font-semibold" style={{ color: 'var(--text-strong)' }}>{f.entity}:</span>{' '}
                    {f.statement}
                  </p>
                </div>
              ))}
              {context.threads.length > 0 && (
                <div className="flex items-start gap-2">
                  <span className="text-xs flex-shrink-0 mt-0.5" style={{ color: 'var(--text-faint)' }}>✉</span>
                  <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                    {context.threads.length} email thread{context.threads.length !== 1 ? 's' : ''} — last {threadAge(context.threads[0].date)}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Expanded full context */}
          {expanded && (
            <div id="meeting-prep-context" className="space-y-4 mb-3" style={{ animation: 'score-rise 0.25s ease both' }}>
              {/* Facts */}
              {context.facts.length > 0 && (
                <div>
                  <p className="label-caps mb-2">What Edg3 knows</p>
                  <div className="space-y-2">
                    {context.facts.map((f, i) => (
                      <div
                        key={i}
                        className="rounded-lg px-3 py-2"
                        style={{ background: 'var(--edg-fill-04)', border: '1px solid var(--edg-hairline)' }}
                      >
                        <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--text-strong)' }}>
                          {f.entity}
                        </p>
                        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                          {f.statement}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Email threads */}
              {context.threads.length > 0 && (
                <div>
                  <p className="label-caps mb-2">Recent threads</p>
                  <div className="space-y-1.5">
                    {context.threads.map((t, i) => (
                      <div
                        key={i}
                        className="rounded-lg px-3 py-2"
                        style={{ background: 'var(--edg-fill-04)', border: '1px solid var(--edg-hairline)' }}
                      >
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-strong)' }}>
                            {t.unread && (
                              <span
                                className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 mb-0.5"
                                style={{ background: 'var(--edg-indigo)' }}
                              />
                            )}
                            {t.subject}
                          </p>
                          <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-faint)' }}>
                            {threadAge(t.date)}
                          </span>
                        </div>
                        <p className="text-xs leading-relaxed line-clamp-2" style={{ color: 'var(--text-faint)' }}>
                          {t.snippet}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Expand toggle */}
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-xs w-full text-center transition-opacity hover:opacity-80"
            style={{ color: 'var(--text-accent)' }}
            aria-expanded={expanded}
            aria-controls="meeting-prep-context"
          >
            {expanded
              ? '▲ Show less'
              : `▼ See full context (${context.facts.length} notes${context.threads.length > 0 ? ` · ${context.threads.length} threads` : ''})`
            }
          </button>
        </>
      )}
    </div>
  );
}
