'use client';

// ── Types (match /api/day-plan response) ──────────────────────────────────────

export interface PlanChange {
  op: 'create' | 'move' | 'delete' | 'recolor';
  title: string;
  detail: string;
  reason: string;
}

// Op icons — calm, exec-brief style
const OP_ICONS: Record<PlanChange['op'], string> = {
  create: '◆',
  move:   '→',
  delete: '✕',
  recolor: '◈',
};

// ── ActivationHeroCard (Screen 5) ─────────────────────────────────────────────

export function ActivationHeroCard({
  changes,
  scoreBefore,
  scoreAfter,
  onApply,
  onSkip,
  applying,
  applied,
}: {
  changes: PlanChange[];
  scoreBefore?: number | null;
  scoreAfter?: number | null;
  onApply: () => void;
  onSkip: () => void;
  applying: boolean;
  applied: boolean;
}) {
  // Show max 3 changes in onboarding context
  const displayChanges = changes.slice(0, 3);
  const score = applied ? (scoreAfter ?? scoreBefore) : (scoreBefore ?? null);

  return (
    <div className="space-y-5">
      {/* Header (Screen 5 copy) */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span style={{ color: 'var(--text-accent)', fontSize: 13 }}>✦</span>
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-accent)', letterSpacing: '0.08em' }}
          >
            First move
          </span>
        </div>
        <h2 className="text-xl font-bold leading-snug" style={{ color: 'var(--text-strong)' }}>
          {applied ? 'Done.' : "Here's what I'd change today."}
        </h2>
        {!applied && (
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Based on your priorities and what&apos;s on your calendar.
          </p>
        )}
        {applied && (
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Those changes are in your Google Calendar.
          </p>
        )}
      </div>

      {/* Plan change cards */}
      {!applied && (
        <div className="space-y-2.5">
          {displayChanges.map((change, i) => (
            <div
              key={i}
              className="rounded-xl p-4"
              style={{
                background: i === 0 ? 'var(--edg-accent-08)' : 'var(--edg-fill-04)',
                border: `1px solid ${i === 0 ? 'var(--edg-accent-20)' : 'var(--edg-hairline)'}`,
              }}
            >
              <div className="flex items-start gap-3">
                <span
                  className="flex-shrink-0 text-xs mt-0.5 font-bold w-5 text-center"
                  style={{ color: 'var(--text-accent)' }}
                >
                  {OP_ICONS[change.op]}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold leading-snug mb-1" style={{ color: 'var(--text-strong)' }}>
                    {change.title}
                  </p>
                  <p className="text-xs leading-relaxed mb-1" style={{ color: 'var(--text-muted)' }}>
                    {change.reason}
                  </p>
                  <p className="text-xs font-medium" style={{ color: 'var(--text-accent)' }}>
                    {change.detail}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edge Score reveal — post-apply; treat as reward, not a stat */}
      {applied && score != null && (
        <div
          className="rounded-xl p-5 flex flex-col items-center text-center"
          style={{
            background: 'var(--edg-accent-08)',
            border: '1px solid var(--edg-accent-20)',
            boxShadow: '0 0 40px var(--edg-accent-08)',
            animation: 'score-rise 0.5s ease both',
          }}
        >
          <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-accent)', letterSpacing: '0.08em' }}>
            Your Edg3 Score
          </p>
          {/* Large score — the first time they see their number */}
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-bold mb-3"
            style={{
              background: 'var(--edg-accent-15)',
              border: '2px solid var(--edg-accent-25)',
              color: 'var(--text-strong)',
              boxShadow: '0 0 32px var(--edg-accent-08)',
            }}
          >
            {score}
          </div>
          {scoreBefore != null && scoreAfter != null && scoreAfter > scoreBefore && (
            <div
              className="text-xs rounded-full px-2.5 py-1 mb-2"
              style={{
                background: 'var(--edg-success-tint)',
                border: '1px solid var(--edg-success-border)',
                color: 'var(--edg-success)',
              }}
            >
              ↑ +{scoreAfter - scoreBefore} from today&apos;s changes
            </div>
          )}
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-faint)', maxWidth: 240 }}>
            How well your calendar aligns with your priorities. You&apos;ll see this every morning.
          </p>
        </div>
      )}

      {/* Footer copy */}
      {!applied && (
        <p className="text-xs text-center" style={{ color: 'var(--text-faint)' }}>
          Every change is logged. One tap undoes it all.
        </p>
      )}

      {/* CTAs */}
      <div className="flex flex-col gap-2">
        {!applied ? (
          <>
            <button className="btn-primary w-full" onClick={onApply} disabled={applying}>
              {applying ? 'Making it happen…' : 'Make it happen →'}
            </button>
            <button
              className="w-full text-sm py-2 text-center transition-opacity hover:opacity-80"
              style={{ color: 'var(--text-faint)' }}
              onClick={onSkip}
            >
              Skip for now
            </button>
          </>
        ) : (
          <button className="btn-primary w-full" onClick={onSkip}>
            Set up my morning call →
          </button>
        )}
      </div>
    </div>
  );
}

// ── ActivationHeroAligned (Screen 5b) ─────────────────────────────────────────

export function ActivationHeroAligned({
  score,
  onContinue,
}: {
  score?: number | null;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span style={{ color: 'var(--edg-success)', fontSize: 13 }}>✓</span>
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--edg-success)', letterSpacing: '0.08em' }}
          >
            Already aligned
          </span>
        </div>
        <h2 className="text-xl font-bold leading-snug" style={{ color: 'var(--text-strong)' }}>
          Your calendar looks good.
        </h2>
        <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Your top priorities already have protected time this week. Edg3 didn&apos;t need to change
          much.
        </p>
      </div>

      {score != null && (
        <div
          className="rounded-xl p-5 flex flex-col items-center text-center"
          style={{
            background: 'var(--edg-accent-08)',
            border: '1px solid var(--edg-accent-20)',
            animation: 'score-rise 0.5s ease both',
          }}
        >
          <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-accent)', letterSpacing: '0.08em' }}>
            Your Edg3 Score
          </p>
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-bold mb-3"
            style={{
              background: 'var(--edg-accent-15)',
              border: '2px solid var(--edg-accent-25)',
              color: 'var(--text-strong)',
              boxShadow: '0 0 32px var(--edg-accent-08)',
            }}
          >
            {score}
          </div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-faint)', maxWidth: 240 }}>
            Edg3 will keep watching. If something shifts, you&apos;ll hear about it on your morning
            call.
          </p>
        </div>
      )}

      <button className="btn-primary w-full" onClick={onContinue}>
        Set up my morning call →
      </button>
    </div>
  );
}
