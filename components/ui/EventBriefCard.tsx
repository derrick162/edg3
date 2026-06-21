'use client';

import { useState } from 'react';

export interface EventBriefCardProps {
  eventTitle: string;
  eventTime: string;               // ISO datetime
  briefText: string | null;        // null until fetched
  loading?: boolean;
  onBrief: () => void;
}

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export function EventBriefCard({ eventTitle, eventTime, briefText, loading = false, onBrief }: EventBriefCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="glass-card overflow-hidden"
      style={{ borderColor: expanded ? 'var(--edg-accent-20)' : undefined }}
    >
      <button
        className="flex items-center gap-3 w-full px-4 py-3 text-left"
        onClick={() => {
          if (!briefText && !loading) onBrief();
          setExpanded(e => !e);
        }}
        aria-expanded={expanded}
        aria-controls="event-brief-body"
      >
        <span aria-hidden="true" className="text-lg leading-none">📋</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-strong)' }}>{eventTitle}</p>
          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{fmt(eventTime)}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!briefText && !loading && (
            <span className="text-xs px-2 py-0.5 rounded font-semibold"
              style={{ background: 'var(--edg-accent-10)', color: 'var(--text-accent)' }}>
              Brief me
            </span>
          )}
          <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && (
        <div
          id="event-brief-body"
          className="px-4 pb-4 pt-1"
          style={{ borderTop: '1px solid var(--edg-accent-08)', background: 'var(--edg-accent-06)' }}
        >
          {loading ? (
            <EventBriefSkeleton />
          ) : briefText ? (
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>{briefText}</p>
          ) : (
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              Nothing to brief on — no attendees or emails found.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function EventBriefSkeleton() {
  return (
    <div className="space-y-2 py-1" aria-label="Loading brief…">
      <div className="h-3 rounded w-full" style={{ background: 'var(--edg-fill-04)', animation: 'pulse 1.5s ease-in-out infinite' }} />
      <div className="h-3 rounded w-4/5" style={{ background: 'var(--edg-fill-04)', animation: 'pulse 1.5s ease-in-out infinite' }} />
    </div>
  );
}
