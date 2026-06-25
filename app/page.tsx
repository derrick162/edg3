'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/ui';

// ── Inline SVG icons ──────────────────────────────────────────────────────────
function IconPhone() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.06 6.06l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
function IconBrain() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-1.66" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-1.66" />
    </svg>
  );
}
function IconZap() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}
function IconArrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

// ── Memory moat visual — compound growth arc ──────────────────────────────────
function MemoryGrowthVisual() {
  const weeks = ['Wk 1', 'Wk 2', 'Wk 4', 'Wk 8', 'Wk 12'];
  const dots = [
    { label: 'Your schedule', icon: '📅' },
    { label: 'Your goals', icon: '🎯' },
    { label: 'Your energy patterns', icon: '⚡' },
    { label: 'Your relationships', icon: '👤' },
    { label: 'Your commitments', icon: '✓' },
  ];
  return (
    <div className="mx-auto mt-8 glass-card p-6 md:p-8" style={{ maxWidth: 560, borderColor: 'var(--edg-accent-20)' }}>
      {/* Growth arc */}
      <p className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--text-faint)' }}>Edge&apos;s picture of you, over time</p>
      <div className="flex items-end gap-3 mb-6" style={{ height: 72 }}>
        {[18, 30, 46, 60, 72].map((h, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
            <div
              className="w-full rounded-t-lg"
              style={{
                height: h,
                background: `linear-gradient(to top, var(--edg-indigo), var(--edg-accent-60))`,
                opacity: 0.4 + i * 0.12,
              }}
            />
            <span className="text-[9px]" style={{ color: 'var(--text-faint)' }}>{weeks[i]}</span>
          </div>
        ))}
      </div>
      {/* What it knows */}
      <div className="grid grid-cols-1 gap-1.5">
        {dots.map((d, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <span className="text-sm" style={{ flexShrink: 0 }}>{d.icon}</span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{d.label}</span>
            <div className="flex-1 flex gap-0.5">
              {Array.from({ length: 5 }, (_, j) => (
                <div
                  key={j}
                  className="flex-1 rounded-full"
                  style={{
                    height: 4,
                    background: j <= i ? 'var(--edg-indigo)' : 'var(--edg-fill-04)',
                    opacity: j <= i ? (0.4 + j * 0.15) : 1,
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function HomePage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [waitlistError, setWaitlistError] = useState('');

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(data => {
        if (data.id) {
          router.push(data.onboarding_complete ? '/dashboard' : '/onboarding');
        } else {
          setChecking(false);
        }
      })
      .catch(() => setChecking(false));
  }, [router]);

  async function handleWaitlist(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    setWaitlistError('');
    try {
      const res = await fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      if (res.status === 429) {
        setWaitlistError('Too many attempts — please wait a few minutes and try again.');
      } else if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setWaitlistError(data.error || 'Something went wrong. Please try again.');
      } else {
        setSubmitted(true);
      }
    } catch {
      setWaitlistError('Unable to connect. Please check your connection and try again.');
    }
    setSubmitting(false);
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--surface-page)' }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid var(--edg-indigo)', borderTopColor: 'transparent' }} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen relative overflow-hidden" style={{ background: 'var(--surface-page)' }}>
      <div className="orb orb-1" />
      <div className="orb orb-2" />

      <div className="relative z-10">
        {/* ── Nav ── */}
        <nav className="flex items-center justify-between px-4 md:px-10 py-6 max-w-6xl mx-auto">
          <Logo size={22} eyebrow />
          <div className="flex items-center gap-4">
            <Link href="/login" className="btn-secondary text-sm py-2 px-5">Log in</Link>
            <Link href="/signup" className="btn-primary text-sm py-2 px-5">Get started</Link>
          </div>
        </nav>

        {/* ── Hero — memory moat ── */}
        <section className="max-w-4xl mx-auto px-4 md:px-8 pt-16 pb-24 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-8 text-sm font-medium"
               style={{ background: 'var(--edg-accent-08)', border: '1px solid var(--edg-accent-15)', color: 'var(--text-accent)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--edg-indigo-bright)', display: 'inline-block' }} className="animate-pulse" />
            Early access — limited spots
          </div>

          <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight mb-6 leading-tight">
            <span style={{ color: 'var(--text-strong)' }}>The more you use Edge,</span>
            <br />
            <span className="logo-text">the more irreplaceable it becomes.</span>
          </h1>

          <p className="text-xl mb-4 max-w-2xl mx-auto leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            Edge knows your calendar, your goals, your relationships, and how you&apos;re feeling — and gets sharper every morning call.
          </p>
          <p className="text-base mb-10 max-w-xl mx-auto" style={{ color: 'var(--text-faint)' }}>
            Most AI tools are as good as day one. Edg3 compounds.
          </p>

          {/* Waitlist form */}
          <div className="flex flex-col items-center gap-3">
            {submitted ? (
              <div className="glass-card px-8 py-5 text-center" style={{ borderColor: 'var(--edg-accent-20)' }}>
                <p className="font-semibold mb-1" style={{ color: 'var(--text-strong)' }}>You&apos;re on the list.</p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>We&apos;ll reach out personally. No spam, no drip campaigns.</p>
              </div>
            ) : (
              <form onSubmit={handleWaitlist} className="flex flex-col gap-3 w-full max-w-md">
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="email"
                    value={email}
                    onChange={e => { setEmail(e.target.value); setWaitlistError(''); }}
                    placeholder="your@email.com"
                    required
                    className="input flex-1 text-base"
                    style={{ paddingTop: '0.625rem', paddingBottom: '0.625rem' }}
                  />
                  <button type="submit" disabled={submitting} className="btn-primary text-base py-2.5 px-7 whitespace-nowrap">
                    {submitting ? 'Joining…' : 'Join the waitlist'}
                  </button>
                </div>
                {waitlistError && (
                  <p className="text-sm text-center" style={{ color: 'var(--edg-danger)' }}>{waitlistError}</p>
                )}
              </form>
            )}
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              Free to start · No credit card · Early access limited
            </p>
          </div>
        </section>

        {/* ── Three pillars ── */}
        <section className="max-w-5xl mx-auto px-4 md:px-8 py-24">
          <h2 className="text-3xl md:text-4xl font-black tracking-tight mb-4 text-center" style={{ color: 'var(--text-strong)' }}>
            One tool. Three things that compound.
          </h2>
          <p className="text-base mb-12 text-center max-w-2xl mx-auto" style={{ color: 'var(--text-muted)' }}>
            Focus, memory, and energy reinforce each other. Every day Edg3 works, all three get stronger.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: <IconPhone />,
                color: 'var(--edg-indigo)',
                tint: 'var(--edg-accent-08)',
                border: 'var(--edg-accent-20)',
                label: 'Focus',
                headline: 'Start every day knowing exactly what matters.',
                body: 'Edg3 calls you Monday through Friday. In 3 minutes, you hear what\'s on your plate, what to shift, and what to protect — then it\'s done. No app to open. No dashboard to maintain.',
                link: null,
              },
              {
                icon: <IconBrain />,
                color: 'var(--edg-success)',
                tint: 'rgba(16,185,129,0.06)',
                border: 'rgba(16,185,129,0.18)',
                label: 'Memory',
                headline: 'Every call compounds — Edge learns who you are.',
                body: 'Goals, commitments, relationships, patterns — Edge captures it all. By week 4, it knows you well enough to brief you without you saying a word. By week 12, it knows things you\'ve forgotten.',
                link: '/memory',
              },
              {
                icon: <IconZap />,
                color: 'var(--edg-warning)',
                tint: 'rgba(245,158,11,0.06)',
                border: 'rgba(245,158,11,0.18)',
                label: 'Energy',
                headline: 'Your performance data, in plain English.',
                body: 'Connect Whoop and Edge knows your recovery before you do. Low day? It protects your morning and pushes the heavy work. High day? It front-loads what matters most. Gratitude calls keep burnout out.',
                link: null,
              },
            ].map(p => (
              <div key={p.label} className="glass-card p-7 flex flex-col" style={{ borderColor: p.border }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-5 flex-shrink-0"
                     style={{ background: p.tint, color: p.color, border: `1px solid ${p.border}` }}>
                  {p.icon}
                </div>
                <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: p.color }}>{p.label}</p>
                <h3 className="text-base font-bold mb-3 leading-snug" style={{ color: 'var(--text-strong)' }}>{p.headline}</h3>
                <p className="text-sm leading-relaxed flex-1" style={{ color: 'var(--text-muted)' }}>{p.body}</p>
                {p.link && (
                  <Link href={p.link} className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: p.color }}>
                    Learn more <IconArrow />
                  </Link>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── Memory moat visual ── */}
        <section className="max-w-5xl mx-auto px-4 md:px-8 pb-24">
          <div className="text-center mb-2">
            <h2 className="text-3xl font-black tracking-tight mb-4" style={{ color: 'var(--text-strong)' }}>
              Most AI forgets you.<br />Edg3 remembers.
            </h2>
            <p className="text-base max-w-xl mx-auto" style={{ color: 'var(--text-muted)' }}>
              You&apos;re not training a chatbot. You&apos;re building an operating partner that gets better every week.
            </p>
          </div>
          <MemoryGrowthVisual />
        </section>

        {/* ── How it works ── */}
        <section className="max-w-5xl mx-auto px-4 md:px-8 py-24">
          <h2 className="text-3xl font-black tracking-tight mb-4 text-center" style={{ color: 'var(--text-strong)' }}>
            How it works
          </h2>
          <p className="text-base mb-12 text-center" style={{ color: 'var(--text-muted)' }}>
            Three steps. Every morning. The loop that makes Edg3 irreplaceable.
          </p>
          <div className="max-w-2xl mx-auto">
            {[
              {
                num: '01',
                icon: <IconPhone />,
                heading: 'Edge calls you.',
                body: 'At your time, Monday through Friday. The call opens with what matters today — your priorities, your energy, anything that moved on your calendar overnight.',
              },
              {
                num: '02',
                icon: <IconBrain />,
                heading: 'Memory builds.',
                body: 'Every conversation adds to what Edge knows: goals you\'ve stated, commitments you\'ve made, people you\'ve mentioned, patterns in how you work. Nothing gets lost.',
              },
              {
                num: '03',
                icon: <IconZap />,
                heading: 'The next call gets better.',
                body: 'Edge opens tomorrow knowing more than it did today. No briefing to fill out, no context to re-explain. It just knows — and the briefing gets sharper every week.',
              },
            ].map((step, idx, arr) => (
              <div key={step.num} className="flex gap-6">
                <div className="flex flex-col items-center" style={{ width: 52, flexShrink: 0 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                    background: 'var(--edg-accent-15)', border: '1px solid var(--edg-accent-20)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--text-accent)',
                  }}>
                    {step.icon}
                  </div>
                  {idx < arr.length - 1 && (
                    <div style={{ width: 1, flex: 1, minHeight: 32, background: 'var(--edg-accent-15)', margin: '8px 0' }} />
                  )}
                </div>
                <div className={idx < arr.length - 1 ? 'pb-8' : 'pb-0'}>
                  <p className="text-xs font-black tracking-widest mb-1" style={{ color: 'var(--edg-indigo)' }}>{step.num}</p>
                  <p className="text-lg font-bold mb-2" style={{ color: 'var(--text-strong)' }}>{step.heading}</p>
                  <p className="text-base leading-relaxed" style={{ color: 'var(--text-body)' }}>{step.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Social proof placeholder ── */}
        <section className="max-w-5xl mx-auto px-4 md:px-8 py-24">
          <h2 className="text-2xl font-black tracking-tight mb-8 text-center" style={{ color: 'var(--text-strong)' }}>
            Early users
          </h2>
          {/* Placeholder: replace with real testimonials when available */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { initials: 'MT', name: 'Marcus T.', title: 'Founder & CEO' },
              { initials: 'PN', name: 'Priya N.', title: 'VP of Product' },
              { initials: 'JL', name: 'James L.', title: 'Managing Partner' },
            ].map(u => (
              <div key={u.name} className="rounded-2xl p-5 flex flex-col gap-4"
                   style={{ background: 'var(--surface-card)', border: '1px solid var(--edg-hairline)' }}>
                {/* Quote placeholder — replace with real quote */}
                <div className="flex-1 rounded-lg px-3 py-5 flex items-center justify-center"
                     style={{ background: 'var(--edg-fill-04)', minHeight: 72 }}>
                  <p className="text-xs text-center" style={{ color: 'var(--text-faint)' }}>Testimonial coming soon</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                       style={{ background: 'var(--edg-accent-15)', color: 'var(--text-accent)' }}>
                    {u.initials}
                  </div>
                  <div>
                    <p className="text-xs font-semibold" style={{ color: 'var(--text-body)' }}>{u.name}</p>
                    <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{u.title}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Final CTA ── */}
        <section className="max-w-3xl mx-auto px-4 md:px-8 py-24 text-center">
          <div className="glass-card p-8 md:p-12" style={{ borderColor: 'var(--edg-accent-20)' }}>
            <h2 className="text-3xl font-black tracking-tight mb-3" style={{ color: 'var(--text-strong)' }}>
              Start compounding.
            </h2>
            <p className="text-base mb-8" style={{ color: 'var(--text-muted)' }}>
              Early access is limited. If you&apos;re serious about focus, energy, and not burning out — we want to hear from you.
            </p>
            {submitted ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>You&apos;re on the list — we&apos;ll be in touch soon.</p>
            ) : (
              <>
                <form onSubmit={handleWaitlist} className="flex flex-col items-center gap-3">
                  <div className="flex flex-col sm:flex-row gap-3 justify-center w-full">
                    <input
                      type="email"
                      value={email}
                      onChange={e => { setEmail(e.target.value); setWaitlistError(''); }}
                      placeholder="your@email.com"
                      required
                      className="input flex-1 max-w-xs text-base"
                      style={{ paddingTop: '0.625rem', paddingBottom: '0.625rem' }}
                    />
                    <button type="submit" disabled={submitting} className="btn-primary text-base py-2.5 px-7 whitespace-nowrap">
                      {submitting ? 'Joining…' : 'Join waitlist'}
                    </button>
                  </div>
                  {waitlistError && (
                    <p className="text-sm" style={{ color: 'var(--edg-danger)' }}>{waitlistError}</p>
                  )}
                </form>
                <p className="text-xs mt-4" style={{ color: 'var(--text-faint)' }}>
                  We&apos;ll reach out personally. No spam. No drip campaigns.
                </p>
              </>
            )}
          </div>
        </section>

        {/* ── Footer ── */}
        <footer className="max-w-5xl mx-auto px-4 md:px-8 py-8 text-center" style={{ borderTop: '1px solid var(--edg-hairline)' }}>
          <p className="text-xs mb-2" style={{ color: 'var(--text-faint)' }}>
            Your data is encrypted at rest and never sold · Disconnect anytime
          </p>
          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
            Questions? hello@edg3.ai
            {' · '}
            <Link href="/terms" style={{ color: 'var(--edg-indigo)' }}>Terms</Link>
            {' · '}
            <Link href="/privacy" style={{ color: 'var(--edg-indigo)' }}>Privacy</Link>
          </p>
          <p className="text-xs mt-3" style={{ color: 'var(--text-faint)' }}>
            Delta Edg3 LLC · 95 Wall Street, Apt #2112, New York, NY 10005
          </p>
        </footer>
      </div>
    </div>
  );
}
