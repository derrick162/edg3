'use client';

import React from 'react';

export interface TimeAllocationBucket {
  label: string;
  hours: number;
  pct: number;
  weeklyAvg: number;
}

export interface TimeAllocationVizProps {
  buckets: TimeAllocationBucket[];
  periodWeeks: number;
  biggestMisalignment?: string | null;
  /** Max buckets to show (default 5) */
  maxBuckets?: number;
  className?: string;
}

const BUCKET_COLORS = [
  'var(--edg-indigo)',
  'var(--edg-accent)',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
];

const SYSTEM_BUCKETS = new Set(['meetings', 'routine', 'other']);

function bucketColor(label: string, index: number): string {
  return BUCKET_COLORS[index % BUCKET_COLORS.length];
}

function truncateLabel(label: string, max = 22): string {
  return label.length > max ? label.slice(0, max - 1) + '…' : label;
}

export function TimeAllocationViz({
  buckets,
  periodWeeks,
  biggestMisalignment,
  maxBuckets = 5,
  className = '',
}: TimeAllocationVizProps) {
  if (!buckets || buckets.length === 0) return null;

  const visible = buckets.slice(0, maxBuckets);
  const maxPct = Math.max(...visible.map(b => b.pct));

  return (
    <div className={className}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
          Where time went
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
          past {periodWeeks}w
        </span>
      </div>

      {/* Bar rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visible.map((bucket, i) => {
          const color = bucketColor(bucket.label, i);
          const barWidth = maxPct > 0 ? (bucket.pct / maxPct) * 100 : 0;
          const isPriority = !SYSTEM_BUCKETS.has(bucket.label);

          return (
            <div key={bucket.label}>
              {/* Label + weekly avg */}
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{
                  fontSize: 11,
                  fontWeight: isPriority ? 600 : 400,
                  color: isPriority ? 'var(--text-body)' : 'var(--text-muted)',
                  maxWidth: '70%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {truncateLabel(bucket.label)}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-faint)', flexShrink: 0 }}>
                  {bucket.weeklyAvg}h/wk
                </span>
              </div>

              {/* Track + fill */}
              <div style={{
                height: 5,
                borderRadius: 99,
                background: 'var(--edg-fill-06)',
                overflow: 'hidden',
              }}>
                <div
                  style={{
                    height: '100%',
                    width: `${barWidth}%`,
                    borderRadius: 99,
                    background: color,
                    opacity: isPriority ? 1 : 0.55,
                    transition: 'width 0.6s ease',
                  }}
                />
              </div>

              {/* Percentage label */}
              <div style={{ fontSize: 10, color: color, marginTop: 2, opacity: isPriority ? 0.9 : 0.6 }}>
                {bucket.pct}%
              </div>
            </div>
          );
        })}
      </div>

      {/* Misalignment callout */}
      {biggestMisalignment && (
        <div style={{
          marginTop: 'var(--space-3)',
          paddingTop: 'var(--space-3)',
          borderTop: '1px solid var(--edg-hairline)',
          display: 'flex',
          gap: 6,
          alignItems: 'flex-start',
        }}>
          <span style={{ fontSize: 12, flexShrink: 0, marginTop: 1 }}>⚠</span>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {biggestMisalignment}
          </p>
        </div>
      )}
    </div>
  );
}
