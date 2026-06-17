'use client';

// "Here's what I just learned about you" — shown after first calendar/email connection,
// before the first briefing call. Turns an empty dashboard into a delight moment.

export interface ActivationCardProps {
  /** Short, warm fact strings from Core — e.g. "You're negotiating with CIBC about debt" */
  facts: string[];
  /** First name for the greeting */
  name?: string;
  /** Called when user dismisses */
  onDismiss?: () => void;
}

export function ActivationCard({ facts, name, onDismiss }: ActivationCardProps) {
  if (facts.length === 0) return null;

  return (
    <div
      className="glass-card p-5"
      style={{
        borderColor: 'var(--edg-accent-20)',
        background: 'var(--edg-accent-04)',
        animation: 'score-rise 0.5s ease both',
        position: 'relative',
      }}
    >
      {/* Dismiss */}
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="absolute top-4 right-4 text-xs transition-opacity hover:opacity-80"
          style={{ color: 'var(--text-faint)' }}
          aria-label="Dismiss"
        >
          ✕
        </button>
      )}

      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <span
          className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-base"
          style={{
            background: 'var(--edg-accent-15)',
            border: '1px solid var(--edg-accent-20)',
            boxShadow: 'var(--shadow-btn-glow)',
            animation: 'pop-in 0.45s ease both',
          }}
        >
          ✦
        </span>
        <div>
          <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--text-accent)' }}>
            ✦ HERE&apos;S WHAT I ALREADY KNOW ABOUT YOU
          </p>
          <p className="text-sm font-bold leading-snug" style={{ color: 'var(--text-strong)' }}>
            {name ? `${name}, Edg3 is already on your side.` : 'Edg3 is already on your side.'}
          </p>
        </div>
      </div>

      {/* Fact list */}
      <ul className="space-y-2 mb-4 pl-1">
        {facts.map((fact, i) => (
          <li
            key={i}
            className="flex items-start gap-2.5 text-sm leading-relaxed"
            style={{
              color: 'var(--text-body)',
              animation: `score-rise 0.4s ${0.08 * i}s ease both`,
            }}
          >
            <span
              className="flex-shrink-0 mt-0.5 text-xs font-bold"
              style={{ color: 'var(--text-accent)' }}
            >
              ·
            </span>
            {fact}
          </li>
        ))}
      </ul>

      {/* Footer */}
      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-faint)' }}>
        Edg3 learns more with every morning briefing — your first call will make this even sharper.
      </p>
    </div>
  );
}
