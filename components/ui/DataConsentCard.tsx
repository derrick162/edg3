'use client';

import { useState } from 'react';

export type DataConsent = 'privacy' | 'improve';

// ── DataConsentScreen ─────────────────────────────────────────────────────────

export function DataConsentScreen({
  onContinue,
}: {
  onContinue: (consent: DataConsent) => void;
}) {
  const [selected, setSelected] = useState<DataConsent>('privacy');

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-strong)' }}>
          You control your data.
        </h2>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Edg3 stores your calls, facts, and priorities to work — that&apos;s what makes memory and
          briefings possible. What you choose below is about how your data is used beyond that.
        </p>
      </div>

      <div className="space-y-3">
        {/* Privacy Mode card */}
        <button
          type="button"
          onClick={() => setSelected('privacy')}
          className="w-full text-left rounded-xl p-4 transition-all"
          style={{
            background: selected === 'privacy' ? 'var(--edg-accent-08)' : 'var(--edg-fill-04)',
            border: selected === 'privacy'
              ? '2px solid var(--edg-accent-25)'
              : '2px solid var(--edg-hairline)',
          }}
          aria-pressed={selected === 'privacy'}
        >
          <div className="flex items-start gap-3">
            <span
              className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm mt-0.5"
              style={{
                background: selected === 'privacy' ? 'var(--edg-accent-15)' : 'var(--edg-fill-subtle)',
                color: selected === 'privacy' ? 'var(--text-accent)' : 'var(--text-faint)',
              }}
            >
              🔒
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>
                  Privacy Mode
                </p>
                {selected === 'privacy' && (
                  <span
                    className="text-xs rounded-full px-2 py-0.5 font-medium"
                    style={{
                      background: 'var(--edg-accent-15)',
                      color: 'var(--text-accent)',
                      border: '1px solid var(--edg-accent-25)',
                    }}
                  >
                    Selected
                  </span>
                )}
              </div>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                Your data powers only your experience. Never used for training, never shared.
                Encrypted and exportable anytime.
              </p>
            </div>
            <div
              className="flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5"
              style={{
                borderColor: selected === 'privacy' ? 'var(--edg-indigo)' : 'var(--edg-hairline)',
                background: selected === 'privacy' ? 'var(--edg-indigo)' : 'transparent',
              }}
            >
              {selected === 'privacy' && (
                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                  <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          </div>
        </button>

        {/* Help improve Edg3 card */}
        <button
          type="button"
          onClick={() => setSelected('improve')}
          className="w-full text-left rounded-xl p-4 transition-all"
          style={{
            background: selected === 'improve' ? 'var(--edg-fill-subtle)' : 'var(--edg-fill-04)',
            border: selected === 'improve'
              ? '2px solid var(--edg-border-10)'
              : '2px solid var(--edg-hairline)',
          }}
          aria-pressed={selected === 'improve'}
        >
          <div className="flex items-start gap-3">
            <span
              className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm mt-0.5"
              style={{
                background: 'var(--edg-fill-subtle)',
                color: 'var(--text-faint)',
              }}
            >
              ✦
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-strong)' }}>
                Help improve Edg3
              </p>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                Your calls and transcripts may be used to improve Edg3&apos;s features and AI.
                You can change this anytime.
              </p>
            </div>
            <div
              className="flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5"
              style={{
                borderColor: selected === 'improve' ? 'var(--edg-indigo)' : 'var(--edg-hairline)',
                background: selected === 'improve' ? 'var(--edg-indigo)' : 'transparent',
              }}
            >
              {selected === 'improve' && (
                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                  <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          </div>
        </button>
      </div>

      <button
        className="btn-primary w-full"
        onClick={() => onContinue(selected)}
      >
        Continue →
      </button>

      <p className="text-xs text-center" style={{ color: 'var(--text-faint)' }}>
        You can always change this in Settings.
      </p>
    </div>
  );
}

// ── DataConsentToggle (Settings panel) ───────────────────────────────────────

export function DataConsentToggle({
  value,
  onChange,
  saving,
}: {
  value: DataConsent;
  onChange: (next: DataConsent) => void;
  saving?: boolean;
}) {
  const isImprove = value === 'improve';

  return (
    <div
      className="rounded-xl p-4"
      style={{ background: 'var(--edg-fill-04)', border: '1px solid var(--edg-hairline)' }}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--text-strong)' }}>
            Help improve Edg3
          </p>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            {isImprove
              ? 'Your calls and transcripts may be used to improve Edg3. Turn off to enable Privacy Mode.'
              : 'Privacy Mode is on — your data is never used for training or shared with third parties.'}
          </p>
        </div>
        {/* Toggle */}
        <button
          type="button"
          role="switch"
          aria-checked={isImprove}
          disabled={saving}
          onClick={() => onChange(isImprove ? 'privacy' : 'improve')}
          className="flex-shrink-0 relative w-11 h-6 rounded-full transition-colors"
          style={{
            background: isImprove ? 'var(--edg-indigo)' : 'var(--edg-fill-subtle)',
            border: `1px solid ${isImprove ? 'var(--edg-indigo)' : 'var(--edg-border-10)'}`,
            opacity: saving ? 0.6 : 1,
          }}
          aria-label={isImprove ? 'Disable — switch to Privacy Mode' : 'Enable — share data to help improve Edg3'}
        >
          <span
            className="absolute h-5 w-5 rounded-full transition-transform"
            style={{
              top: '50%',
              left: '2px',
              background: '#fff',
              transform: isImprove ? 'translateY(-50%) translateX(18px)' : 'translateY(-50%) translateX(0)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            }}
          />
        </button>
      </div>
      {isImprove && (
        <p className="text-xs mt-3 pt-3 leading-relaxed" style={{ color: 'var(--text-faint)', borderTop: '1px solid var(--edg-hairline)' }}>
          Your calls, transcripts, and edits may be used to evaluate, train, and improve Edg3&apos;s
          features and AI models.
        </p>
      )}
    </div>
  );
}
