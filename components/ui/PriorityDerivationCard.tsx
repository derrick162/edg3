'use client';

export interface DerivedPriorityItem {
  text: string;
  rationale: string;
  evidenceTags: string[];
}

export interface DerivedProposal {
  priorities: DerivedPriorityItem[];
  summaryLine: string;
  dataSnapshot?: {
    calendarEventCount: number;
    calendarDaysSpanned: number;
    emailThreadCount: number;
    factsCount: number;
    openLoopsCount: number;
  };
}

interface PriorityDerivationCardProps {
  proposal: DerivedProposal;
  onAccept: () => void;
  onTweak: () => void;
  onDismiss: () => void;
  accepting?: boolean;
}

const RANK_LABELS = ['Primary', 'Secondary', 'Supporting'];

export function PriorityDerivationCard({
  proposal,
  onAccept,
  onTweak,
  onDismiss,
  accepting = false,
}: PriorityDerivationCardProps) {
  const snap = proposal.dataSnapshot;
  const dataLine = snap
    ? [
        snap.calendarEventCount > 0 && `${snap.calendarEventCount} events`,
        snap.emailThreadCount > 0 && `${snap.emailThreadCount} emails`,
        snap.factsCount > 0 && `${snap.factsCount} facts`,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <div
      className="glass-card overflow-hidden"
      style={{
        border: '1px solid var(--edg-accent-20)',
        boxShadow: '0 0 0 1px var(--edg-accent-08) inset',
      }}
    >
      {/* Header */}
      <div
        className="px-4 pt-4 pb-3"
        style={{ borderBottom: '1px solid var(--edg-accent-08)' }}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-bold tracking-wide uppercase mb-0.5" style={{ color: 'var(--text-accent)', letterSpacing: '0.06em' }}>
              ✦ Edg3&apos;s read
            </p>
            <p className="text-sm font-semibold leading-snug" style={{ color: 'var(--text-strong)' }}>
              Here&apos;s what I think matters
            </p>
          </div>
          <button
            onClick={onDismiss}
            aria-label="Dismiss"
            className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded transition-opacity opacity-40 hover:opacity-80"
            style={{ color: 'var(--text-faint)' }}
          >
            ✕
          </button>
        </div>
        {proposal.summaryLine && (
          <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            {proposal.summaryLine}
          </p>
        )}
      </div>

      {/* Priority list */}
      <ol className="px-4 py-3 space-y-4">
        {proposal.priorities.map((p, i) => (
          <li key={i} className="flex gap-3">
            {/* Rank indicator */}
            <div
              className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5 text-xs font-bold"
              style={{
                background: i === 0 ? 'var(--edg-accent-15)' : 'var(--edg-fill-04)',
                color: i === 0 ? 'var(--text-accent)' : 'var(--text-faint)',
              }}
            >
              {i + 1}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug" style={{ color: 'var(--text-strong)' }}>
                {p.text}
              </p>
              {p.rationale && (
                <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {p.rationale}
                </p>
              )}
              {p.evidenceTags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {p.evidenceTags.slice(0, 4).map((tag, j) => (
                    <span
                      key={j}
                      className="rounded-full px-2 py-0.5"
                      style={{
                        background: 'var(--edg-fill-04)',
                        color: 'var(--text-faint)',
                        fontSize: '10px',
                        border: '1px solid var(--edg-hairline)',
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>

      {/* Footer — data provenance + actions */}
      <div
        className="px-4 pb-4 pt-1"
        style={{ borderTop: '1px solid var(--edg-fill-04)' }}
      >
        {dataLine && (
          <p className="text-xs mb-3" style={{ color: 'var(--text-faint)', fontSize: '10px' }}>
            Based on {dataLine} from the last 90 days
          </p>
        )}
        <div className="flex gap-2">
          <button
            onClick={onAccept}
            disabled={accepting}
            className="btn-primary text-xs py-2 px-4 flex-1"
            style={{ minHeight: 36 }}
          >
            {accepting ? 'Setting…' : 'Set as my priorities'}
          </button>
          <button
            onClick={onTweak}
            className="text-xs py-2 px-3 rounded-lg font-medium transition-colors"
            style={{
              background: 'var(--edg-fill-04)',
              color: 'var(--text-muted)',
              border: '1px solid var(--edg-hairline)',
              minHeight: 36,
            }}
          >
            Tweak
          </button>
        </div>
      </div>
    </div>
  );
}

export function PriorityDerivationLoadingCard() {
  return (
    <div className="glass-card p-4 animate-pulse" style={{ border: '1px solid var(--edg-accent-08)' }}>
      <div className="flex items-center gap-2 mb-3">
        <div className="h-3 rounded-full w-16" style={{ background: 'var(--edg-accent-08)' }} />
        <div className="h-3 rounded w-28" style={{ background: 'var(--edg-fill-04)' }} />
      </div>
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex gap-3">
            <div className="w-5 h-5 rounded-full flex-shrink-0" style={{ background: 'var(--edg-fill-04)' }} />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 rounded w-3/4" style={{ background: 'var(--edg-fill-04)' }} />
              <div className="h-3 rounded w-full" style={{ background: 'var(--edg-fill-04)' }} />
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs mt-3" style={{ color: 'var(--text-faint)' }}>
        Edg3 is reading your patterns…
      </p>
    </div>
  );
}
