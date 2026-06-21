'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { FocusScoreCard, FocusScoreCardSkeleton } from '@/components/ui';

// ── Types ────────────────────────────────────────────────────────────────────

interface ScoreData {
  focusScore: {
    score: number;
    drivers: string[];
    alignedHours?: number;
    totalWorkingHours?: number;
    calibrating?: boolean;
  };
  edgeScore: number;
  momentum?: { streakDays?: number };
}

function scoreTier(s: number): 'high' | 'medium' | 'low' {
  return s >= 67 ? 'high' : s >= 34 ? 'medium' : 'low';
}

// ── Live score hero (authenticated users only) ────────────────────────────

function LiveScoreHero() {
  const [data, setData] = useState<ScoreData | null>(null);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/scores')
      .then(r => {
        if (r.status === 401) { setAuthed(false); setLoading(false); return null; }
        setAuthed(true);
        return r.json();
      })
      .then(d => { if (d) setData(d); })
      .catch(() => setAuthed(false))
      .finally(() => setLoading(false));
  }, []);

  if (authed === false || (!loading && !data)) return null;

  const score = data?.focusScore?.score ?? 0;
  const tier = scoreTier(score);
  const headline = data?.focusScore?.drivers?.[0] ?? 'Calculating your Focus Score…';
  const alignedH = data?.focusScore?.alignedHours;
  const totalH = data?.focusScore?.totalWorkingHours;
  const streakDays = (data as Record<string, unknown> | null)?.streakDays as number | undefined;

  return (
    <div className="glass-card p-6 mb-10" style={{ border: '1px solid var(--edg-accent-20)' }}>
      <div className="flex items-center justify-between mb-4">
        <p className="label-caps">Your Focus Score</p>
        <Link href="/dashboard" className="text-xs" style={{ color: 'var(--text-accent)' }}>
          Open dashboard →
        </Link>
      </div>

      {loading ? (
        <FocusScoreCardSkeleton />
      ) : data ? (
        <>
          <FocusScoreCard score={score} tier={tier} headline={headline} />

          {/* Hours detail */}
          {alignedH !== undefined && totalH !== undefined && (
            <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
              {alignedH.toFixed(1)}h of {totalH}h working hours focused on your priorities this week
            </p>
          )}

          {/* Breakdown weights (static — shows component weights, not dynamic sub-scores) */}
          <div className="mt-4 pt-4 space-y-2" style={{ borderTop: '1px solid var(--edg-hairline)' }}>
            <p className="label-caps mb-2">Score breakdown</p>
            {[
              { label: 'Recovery', weight: 40, color: 'var(--edg-green)' },
              { label: 'Schedule', weight: 35, color: 'var(--edg-indigo)' },
              { label: 'Follow-through', weight: 25, color: 'var(--edg-warn)' },
            ].map(({ label, weight, color }) => (
              <div key={label} className="flex items-center gap-3">
                <span className="text-xs w-28 shrink-0" style={{ color: 'var(--text-muted)' }}>{label}</span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--edg-fill-04)' }}>
                  <div className="h-full rounded-full" style={{ width: `${weight}%`, background: color, opacity: 0.7 }} />
                </div>
                <span className="text-xs w-8 text-right shrink-0 tabular-nums" style={{ color: 'var(--text-faint)' }}>{weight}%</span>
              </div>
            ))}
          </div>

          {/* Streak footer */}
          {streakDays !== undefined && streakDays >= 1 && (
            <p className="text-xs mt-4 pt-3" style={{ borderTop: '1px solid var(--edg-hairline)', color: 'var(--text-faint)' }}>
              {streakDays >= 2
                ? <><span style={{ color: 'var(--edg-warning)' }}>🔥 {streakDays}-day streak</span> — keep showing up</>
                : <>First call done — momentum starts here</>
              }
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ScorePage() {
  return (
    <div className="min-h-screen relative" style={{ background: 'var(--background)' }}>
      <div className="orb orb-1" />
      <div className="orb orb-2" />

      <div className="relative z-10 max-w-3xl mx-auto px-8 py-16">
        {/* Nav */}
        <div className="flex items-center justify-between mb-16">
          <Link href="/">
            <span className="logo-text text-2xl">EDG3</span>
          </Link>
          <Link href="/signup" className="btn-primary text-sm py-2 px-5">Get started</Link>
        </div>

        <div className="space-y-10">
          {/* Live score hero — only shown when authenticated */}
          <LiveScoreHero />

          {/* Hero */}
          <div>
            <h1 className="text-4xl font-black mb-3">The Edg3 Score</h1>
            <p className="text-lg leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              A single number that tells you if you&apos;re spending your time on what actually matters.
            </p>
          </div>

          {/* Section 1 — What it is */}
          <section className="glass-card p-8 space-y-6">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-accent)' }}>What it measures</h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
              Most productivity apps measure output — tasks completed, emails sent. The Edg3 Score measures <em>alignment</em>: the gap between what you say your priorities are and how your time is actually spent. It rises every time you engage with Edge and falls when life pulls you off course.
            </p>
            <div className="space-y-4">
              {[
                {
                  icon: (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013 10.93a19.79 19.79 0 01-3.07-8.67A2 2 0 011.91 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.9v2z" />
                    </svg>
                  ),
                  label: 'Momentum',
                  desc: 'Your daily call streak. Consistency compounds.',
                },
                {
                  icon: (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <circle cx="12" cy="12" r="3" />
                      <line x1="12" y1="2" x2="12" y2="5" />
                      <line x1="12" y1="19" x2="12" y2="22" />
                      <line x1="2" y1="12" x2="5" y2="12" />
                      <line x1="19" y1="12" x2="22" y2="12" />
                    </svg>
                  ),
                  label: 'Focus',
                  desc: 'Calendar hours invested in your top 3 priorities this week.',
                },
                {
                  icon: (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                    </svg>
                  ),
                  label: 'Memory depth',
                  desc: 'How well Edge knows you. More context = sharper briefings.',
                },
                {
                  icon: (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0110 0v4" />
                    </svg>
                  ),
                  label: 'Trust',
                  desc: 'Data freshness. Edge needs live signals to give live advice.',
                },
              ].map(({ icon, label, desc }) => (
                <div key={label} className="flex items-start gap-3">
                  <span className="mt-0.5 flex-shrink-0" style={{ color: 'var(--text-accent)' }}>
                    {icon}
                  </span>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
                    <span className="font-semibold" style={{ color: 'var(--text-strong)' }}>{label}</span>
                    {' '}— {desc}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Section 2 — Why it matters */}
          <section className="glass-card p-8 space-y-6">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-accent)' }}>Why it matters</h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
              High performers don&apos;t fail because they&apos;re lazy. They fail because their calendar doesn&apos;t match their goals. The Edg3 Score makes that gap visible — so you can fix it before it becomes a problem.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
              <div className="rounded-xl p-4 space-y-2" style={{ background: 'var(--edg-accent-06)', border: '1px solid var(--edg-accent-15)' }}>
                <p className="text-xs font-semibold label-caps" style={{ color: 'var(--text-accent)' }}>What you said mattered</p>
                {['Fundraising', 'Product roadmap', 'Team health'].map((p, i) => (
                  <div key={p} className="flex items-center gap-2">
                    <span className="text-xs font-bold w-4 text-center" style={{ color: 'var(--text-accent)' }}>{i + 1}</span>
                    <span className="text-sm" style={{ color: 'var(--text-body)' }}>{p}</span>
                  </div>
                ))}
              </div>
              <div className="rounded-xl p-4 space-y-2" style={{ background: 'var(--edg-fill-04)', border: '1px solid var(--edg-hairline)' }}>
                <p className="text-xs font-semibold label-caps" style={{ color: 'var(--text-faint)' }}>What your week actually looked like</p>
                {[
                  { label: 'Admin & email', pct: 55, color: 'var(--edg-warning)' },
                  { label: 'Team syncs', pct: 30, color: 'var(--edg-accent-60)' },
                  { label: 'Fundraising', pct: 15, color: 'var(--gauge-peak)' },
                ].map(({ label, pct, color }) => (
                  <div key={label} className="space-y-0.5">
                    <div className="flex justify-between">
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</span>
                      <span className="text-xs" style={{ color: 'var(--text-faint)' }}>{pct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full" style={{ background: 'var(--edg-fill-04)' }}>
                      <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: color }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Section 3 — How to improve */}
          <section className="glass-card p-8 space-y-5">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-accent)' }}>How to improve your score</h2>
            <ol className="space-y-4">
              {[
                'Take your morning call every day. Each call improves Momentum and adds memory.',
                'Let Edge block time for your top priority this week.',
                'Connect your calendar and Gmail so Edge has real data to work with.',
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{ background: 'var(--edg-accent-15)', color: 'var(--text-accent)' }}>
                    {i + 1}
                  </span>
                  <p className="text-sm leading-relaxed pt-0.5" style={{ color: 'var(--text-body)' }}>{step}</p>
                </li>
              ))}
            </ol>
          </section>

          {/* Bottom CTA */}
          <div className="text-center pt-4">
            <Link href="/signup" className="btn-primary inline-block px-8 py-3 text-base">
              Start building your score
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
