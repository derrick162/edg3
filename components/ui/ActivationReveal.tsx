'use client';

import { useEffect, useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DerivedPriority {
  text: string;
  rationale: string;
  evidenceTags: string[];
}

export interface DerivedProposal {
  priorities: DerivedPriority[];
  summaryLine: string;
  dataSnapshot?: {
    calendarEventCount: number;
    calendarDaysSpanned: number;
    emailThreadCount: number;
    factsCount: number;
    openLoopsCount: number;
  };
}

// ── Loading messages ──────────────────────────────────────────────────────────

const SCAN_MESSAGES = [
  'Reading your last few months…',
  'Scanning event patterns…',
  'Finding what gets the most of your time…',
  'Identifying recurring commitments…',
  'Weighing what you spend energy on…',
  'Connecting the threads…',
  'Almost there…',
];

// ── ActivationLoading ─────────────────────────────────────────────────────────

export function ActivationLoading({ dataLine }: { dataLine?: string }) {
  const [msgIdx, setMsgIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setMsgIdx(i => (i + 1) % SCAN_MESSAGES.length);
        setVisible(true);
      }, 200);
    }, 1800);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      {/* Animated orb ring */}
      <div className="relative mb-8">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{
            background: 'var(--edg-accent-08)',
            border: '1.5px solid var(--edg-accent-20)',
            boxShadow: '0 0 40px var(--edg-accent-08)',
          }}
        >
          <span className="text-2xl">✦</span>
        </div>
        {/* Spinning ring */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            border: '1.5px solid transparent',
            borderTopColor: 'var(--edg-indigo)',
            borderRightColor: 'var(--edg-accent-25)',
            animation: 'spin 1.4s linear infinite',
          }}
        />
        {/* Outer pulse ring */}
        <div
          className="absolute rounded-full"
          style={{
            inset: '-6px',
            border: '1px solid var(--edg-accent-15)',
            animation: 'pulse 2s ease-in-out infinite',
          }}
        />
      </div>

      <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-strong)' }}>
        Edge is learning about you
      </h2>

      {/* Cycling message */}
      <p
        className="text-sm mb-3 transition-opacity duration-200"
        style={{
          color: 'var(--text-accent)',
          opacity: visible ? 1 : 0,
          minHeight: '1.5em',
        }}
      >
        {SCAN_MESSAGES[msgIdx]}
      </p>

      {dataLine && (
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
          {dataLine}
        </p>
      )}
    </div>
  );
}

// ── Priority reveal item ──────────────────────────────────────────────────────

function RevealItem({
  priority,
  rank,
  delay,
}: {
  priority: DerivedPriority;
  rank: number;
  delay: number;
}) {
  const [entered, setEntered] = useState(false);
  const [chipsIn, setChipsIn] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setEntered(true), delay);
    const t2 = setTimeout(() => setChipsIn(true), delay + 280);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [delay]);

  const isTop = rank === 1;

  return (
    <div
      style={{
        opacity: entered ? 1 : 0,
        transform: entered ? 'translateY(0)' : 'translateY(12px)',
        transition: 'opacity 0.4s ease, transform 0.4s ease',
      }}
    >
      <div
        className="rounded-xl p-4"
        style={{
          background: isTop ? 'var(--edg-accent-08)' : 'var(--edg-fill-04)',
          border: `1px solid ${isTop ? 'var(--edg-accent-20)' : 'var(--edg-hairline)'}`,
        }}
      >
        <div className="flex items-start gap-3">
          {/* Rank circle */}
          <div
            className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mt-0.5"
            style={{
              background: isTop ? 'var(--edg-indigo)' : 'var(--edg-accent-15)',
              color: isTop ? '#fff' : 'var(--text-accent)',
            }}
          >
            {rank}
          </div>

          <div className="flex-1 min-w-0">
            {/* Priority text */}
            <p className="text-sm font-semibold leading-snug mb-1.5" style={{ color: 'var(--text-strong)' }}>
              {priority.text}
            </p>

            {/* Rationale */}
            <p className="text-xs leading-relaxed mb-2" style={{ color: 'var(--text-muted)' }}>
              {priority.rationale}
            </p>

            {/* Evidence chips */}
            {priority.evidenceTags.length > 0 && (
              <div
                className="flex flex-wrap gap-1.5"
                style={{
                  opacity: chipsIn ? 1 : 0,
                  transition: 'opacity 0.3s ease',
                }}
              >
                {priority.evidenceTags.map((tag, i) => (
                  <span
                    key={i}
                    className="text-xs rounded-full px-2 py-0.5"
                    style={{
                      background: 'var(--edg-accent-08)',
                      border: '1px solid var(--edg-accent-15)',
                      color: 'var(--text-accent)',
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ActivationReveal ──────────────────────────────────────────────────────────

export function ActivationReveal({
  proposal,
  onAccept,
  onTweak,
  accepting,
}: {
  proposal: DerivedProposal;
  onAccept: () => void;
  onTweak: () => void;
  accepting: boolean;
}) {
  const [headerIn, setHeaderIn] = useState(false);
  const [ctaIn, setCtaIn] = useState(false);

  const staggerBase = 180;
  const itemDelay = (i: number) => staggerBase + i * 320;
  const lastDelay = itemDelay(proposal.priorities.length - 1) + 400;

  useEffect(() => {
    const t1 = setTimeout(() => setHeaderIn(true), 60);
    const t2 = setTimeout(() => setCtaIn(true), lastDelay + 200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [lastDelay]);

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
    <div className="space-y-4">
      {/* Header */}
      <div
        style={{
          opacity: headerIn ? 1 : 0,
          transform: headerIn ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 0.4s ease, transform 0.4s ease',
        }}
      >
        <div className="flex items-center gap-2 mb-1">
          <span style={{ color: 'var(--text-accent)', fontSize: 13 }}>✦</span>
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-accent)', letterSpacing: '0.08em' }}
          >
            Edge&apos;s read
          </span>
        </div>
        <h2 className="text-xl font-bold leading-snug" style={{ color: 'var(--text-strong)' }}>
          Here&apos;s what I already learned about you
        </h2>
        {proposal.summaryLine && (
          <p className="text-sm mt-1 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            {proposal.summaryLine}
          </p>
        )}
      </div>

      {/* Priority items — staggered reveal */}
      <div className="space-y-3">
        {proposal.priorities.map((p, i) => (
          <RevealItem key={i} priority={p} rank={i + 1} delay={itemDelay(i)} />
        ))}
      </div>

      {/* Data provenance */}
      {dataLine && (
        <p
          className="text-xs text-center"
          style={{
            color: 'var(--text-faint)',
            opacity: ctaIn ? 1 : 0,
            transition: 'opacity 0.3s ease',
          }}
        >
          Based on {dataLine}
        </p>
      )}

      {/* CTAs */}
      <div
        className="flex flex-col gap-2 pt-1"
        style={{
          opacity: ctaIn ? 1 : 0,
          transform: ctaIn ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 0.4s ease, transform 0.4s ease',
        }}
      >
        <button
          className="btn-primary w-full"
          onClick={onAccept}
          disabled={accepting}
        >
          {accepting ? 'Saving…' : 'These look right — accept'}
        </button>
        <button
          className="w-full text-sm py-2.5 text-center transition-opacity hover:opacity-80"
          style={{ color: 'var(--text-muted)' }}
          onClick={onTweak}
        >
          Tweak them →
        </button>
      </div>
    </div>
  );
}

// ── ActivationReveal (reduced-motion) ─────────────────────────────────────────
// The CSS prefers-reduced-motion rule in globals.css collapses all transitions
// to 0.01ms, so the staggered delays still fire but snap instantly. No extra
// component needed — the same JSX works for both modes.
