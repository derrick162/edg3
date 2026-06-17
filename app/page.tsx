'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/ui';

export default function LandingPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
    try {
      await fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    } catch {}
    setSubmitted(true);
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
        {/* Nav */}
        <nav className="flex items-center justify-between px-4 md:px-10 py-6 max-w-6xl mx-auto">
          <Logo size={22} eyebrow />
          <div className="flex items-center gap-4">
            <Link href="/login" className="btn-secondary text-sm py-2 px-5">Log in</Link>
            <Link href="/signup" className="btn-primary text-sm py-2 px-5">Get started</Link>
          </div>
        </nav>

        {/* ── Hero ── */}
        <section className="max-w-4xl mx-auto px-4 md:px-8 pt-16 pb-14 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-8 text-sm font-medium"
               style={{ background: 'var(--edg-accent-08)', border: '1px solid var(--edg-accent-15)', color: 'var(--text-accent)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--edg-indigo-bright)', display: 'inline-block' }} className="animate-pulse" />
            Early access — limited spots
          </div>

          <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight mb-6 leading-tight">
            <span style={{ color: 'var(--text-strong)' }}>Your AI chief of staff for</span>
            <br />
            <span className="logo-text">focus and energy.</span>
          </h1>

          <p className="text-xl mb-10 max-w-2xl mx-auto" style={{ color: 'var(--text-muted)' }}>
            Edge learns how you work, organizes your calendar around what matters most, and reshapes your day — every morning, in 5 minutes.
          </p>

          {/* Waitlist form */}
          <div className="flex flex-col items-center gap-3">
            {submitted ? (
              <div className="glass-card px-8 py-5 text-center" style={{ borderColor: 'var(--edg-accent-20)' }}>
                <p className="font-semibold mb-1" style={{ color: 'var(--text-strong)' }}>You&apos;re on the list.</p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>We&apos;ll reach out personally. No spam, no drip campaigns, no nonsense.</p>
              </div>
            ) : (
              <form onSubmit={handleWaitlist} className="flex flex-col sm:flex-row gap-3 w-full max-w-md">
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  className="input flex-1 text-base"
                  style={{ paddingTop: '0.625rem', paddingBottom: '0.625rem' }}
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary text-base py-3 px-7 whitespace-nowrap"
                >
                  {submitting ? 'Joining…' : 'Join the waitlist'}
                </button>
              </form>
            )}
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              Free to start. No credit card. Early access limited.
            </p>
          </div>
        </section>

        {/* ── Problem ── */}
        <section className="max-w-3xl mx-auto px-4 md:px-8 py-14 text-center">
          <h2 className="text-3xl md:text-4xl font-black tracking-tight mb-6" style={{ color: 'var(--text-strong)' }}>
            Your calendar is full.<br />The right things aren&apos;t getting done.
          </h2>
          <p className="text-lg leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            You know what matters. You just can&apos;t seem to get to it.
          </p>
          <p className="text-lg leading-relaxed mt-4" style={{ color: 'var(--text-muted)' }}>
            Between the meetings that could&apos;ve been emails, the reactive days where priorities get buried, and the vague feeling that you&apos;re busy but not progressing — most high-performers are running their week on autopilot.
          </p>
          <p className="text-lg mt-4 font-semibold" style={{ color: 'var(--text-body)' }}>
            And the harder you push, the worse it gets.
          </p>
        </section>

        {/* ── Solution: 3-column explainer ── */}
        <section className="max-w-5xl mx-auto px-4 md:px-8 py-14">
          <h2 className="text-3xl md:text-4xl font-black tracking-tight mb-12 text-center" style={{ color: 'var(--text-strong)' }}>
            Edge fixes your week in 5 minutes every morning.
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                num: '01',
                title: 'He already knows your priorities.',
                desc: 'Edge analyzes your calendar history, call memory, and inbox to tell you what matters most today — you don\'t have to figure it out. Just confirm or tweak.',
              },
              {
                num: '02',
                title: 'He reshapes your calendar around them.',
                desc: 'Mismatched meetings get moved. Focus blocks get protected. High-demand work lands in your highest-energy windows. One "yes" and it\'s done.',
              },
              {
                num: '03',
                title: 'He gets smarter every day.',
                desc: 'Every call, every confirmed plan, every Whoop recovery score teaches Edge how you work. The longer you use it, the better it gets at running the day you need.',
              },
            ].map(item => (
              <div key={item.num} className="glass-card glass-card-hover p-7">
                <p className="text-xs font-black mb-3 tracking-widest" style={{ color: 'var(--edg-indigo)' }}>{item.num}</p>
                <h3 className="font-bold text-base mb-3" style={{ color: 'var(--text-strong)' }}>{item.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Edge Score ── */}
        <section className="max-w-4xl mx-auto px-4 md:px-8 py-14">
          <h2 className="text-3xl font-black tracking-tight mb-4 text-center" style={{ color: 'var(--text-strong)' }}>
            One number. Your daily readout.
          </h2>
          <p className="text-base mb-10 max-w-2xl mx-auto text-center" style={{ color: 'var(--text-muted)' }}>
            Your Edge Score tells you how set up you are for a focused, energized, sustainable day — before it starts.
          </p>

          {/* Product preview — inline Edge Score card */}
          <div
            className="glass-card mx-auto"
            style={{
              maxWidth: 420, width: '100%',
              borderColor: 'var(--edg-accent-20)',
              padding: '28px 28px 24px',
              boxShadow: '0 0 40px rgba(99,102,241,0.10)',
            }}
          >
            {/* Header row */}
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-faint)', letterSpacing: '0.08em' }}>Edge Score</p>
                <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Wednesday — your day ahead</p>
              </div>
              {/* Sparkline */}
              <svg width="56" height="22" viewBox="0 0 56 22" fill="none" aria-hidden="true">
                <polyline
                  points="0,16 9,18 18,12 27,14 36,8 45,10 56,4"
                  stroke="var(--gauge-high)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  fill="none"
                />
                <circle cx="56" cy="4" r="2.5" fill="var(--gauge-high)" />
              </svg>
            </div>

            {/* Arc gauge + score */}
            <div className="flex items-center gap-6 mb-5">
              <div style={{ position: 'relative', flexShrink: 0, width: 100, height: 60 }}>
                <svg width="100" height="60" viewBox="0 0 100 60" aria-hidden="true">
                  {/* Track */}
                  <path
                    d="M 10 54 A 40 40 0 0 1 90 54"
                    fill="none"
                    stroke="var(--gauge-bg)"
                    strokeWidth="8"
                    strokeLinecap="round"
                  />
                  {/* Fill — 74% of arc */}
                  <path
                    d="M 10 54 A 40 40 0 0 1 90 54"
                    fill="none"
                    stroke="var(--gauge-high)"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray="125.6"
                    strokeDashoffset="32.7"
                  />
                </svg>
                {/* Score number */}
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  textAlign: 'center', lineHeight: 1,
                }}>
                  <span style={{ fontSize: 28, fontWeight: 900, color: 'var(--gauge-high)', letterSpacing: '-0.03em' }}>74</span>
                </div>
              </div>

              {/* Component bars */}
              <div className="flex-1 space-y-2">
                {[
                  { label: 'Focus',    pct: 68, color: 'var(--gauge-high)' },
                  { label: 'Energy',   pct: 80, color: 'var(--gauge-peak)' },
                  { label: 'Clarity',  pct: 72, color: 'var(--gauge-high)' },
                  { label: 'Momentum', pct: 75, color: 'var(--gauge-high)' },
                ].map(({ label, pct, color }) => (
                  <div key={label}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{label}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>{pct}</span>
                    </div>
                    <div style={{ height: 5, borderRadius: 3, background: 'var(--gauge-bg)', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: color }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Diagnosis chip */}
            <div
              className="rounded-xl px-3 py-2.5 text-xs leading-snug"
              style={{ background: 'var(--edg-accent-08)', border: '1px solid var(--edg-accent-15)' }}
            >
              <span style={{ color: 'var(--text-accent)', fontWeight: 600 }}>Edge: </span>
              <span style={{ color: 'var(--text-muted)' }}>
                Focus is solid — but your 9 AM deep-work block is sandwiched between two meetings. Want me to move them?
              </span>
            </div>
          </div>

          <p className="text-sm mt-6 text-center" style={{ color: 'var(--text-faint)' }}>
            The score isn&apos;t just a number. It&apos;s a diagnosis. And Edge can raise it.
          </p>
        </section>

        {/* ── How it works ── */}
        <section className="max-w-3xl mx-auto px-4 md:px-8 py-14 text-center">
          <h2 className="text-3xl font-black tracking-tight mb-12" style={{ color: 'var(--text-strong)' }}>
            Three things. Every morning.
          </h2>
          <div className="flex flex-col gap-6 text-left">
            {[
              { step: '1', text: 'Edge calls you. At your chosen time, Monday through Friday. The call is 3–5 minutes.' },
              { step: '2', text: 'He opens with your Edge Score and the diagnosis. "Focus is a 7, Energy\'s a 4 — here\'s why, and here\'s what I\'d change."' },
              { step: '3', text: 'You say yes. Edge reshapes your calendar, books the blocks, moves what needs moving. You hang up feeling lighter.' },
            ].map(item => (
              <div key={item.step} className="flex items-start gap-5">
                <div style={{
                  width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                  background: 'var(--edg-accent-15)', border: '1px solid var(--edg-accent-20)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 900, color: 'var(--text-accent)',
                }}>{item.step}</div>
                <p className="text-base leading-relaxed pt-1" style={{ color: 'var(--text-body)' }}>{item.text}</p>
              </div>
            ))}
            <p className="text-base font-semibold text-center mt-2" style={{ color: 'var(--text-muted)' }}>
              That&apos;s it. Repeat daily.
            </p>
          </div>
        </section>

        {/* ── Burnout / ADHD section ── */}
        <section className="max-w-4xl mx-auto px-4 md:px-8 py-14">
          <div className="glass-card p-8 md:p-12">
            <h2 className="text-3xl font-black tracking-tight mb-6" style={{ color: 'var(--text-strong)' }}>
              Built for the people most at risk of burning out.
            </h2>
            <p className="text-base leading-relaxed mb-4" style={{ color: 'var(--text-muted)' }}>
              The ICP for most productivity tools is someone who has their life together and just wants it to be slightly more organized.
            </p>
            <p className="text-base leading-relaxed mb-4" style={{ color: 'var(--text-muted)' }}>
              Edge is built for the other kind: the person who&apos;s doing too much, carrying too much, and knows something needs to change before it does damage.
            </p>
            <p className="text-base leading-relaxed mb-8" style={{ color: 'var(--text-muted)' }}>
              We believe sustainable performance is the only kind worth building. Edge protects your energy the same way it protects your focus — not by doing less, but by doing the right things at the right time.
            </p>
            <div className="glass-card p-6" style={{ borderColor: 'var(--edg-accent-20)', background: 'var(--edg-accent-08)' }}>
              <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-accent)' }}>Especially for people with ADHD.</p>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                Edge acts as external executive function — prioritization, time-blindness, decision fatigue, energy regulation. The &ldquo;I&apos;ll handle the calendar, you just say yes&rdquo; design removes the friction that kills ADHD follow-through. If traditional productivity tools have never stuck, this is different.
              </p>
            </div>
          </div>
        </section>

        {/* ── Features ── */}
        <section className="max-w-5xl mx-auto px-4 md:px-8 py-14">
          <h2 className="text-xl font-black tracking-tight mb-8 text-center" style={{ color: 'var(--text-strong)' }}>
            Everything you need. Nothing you don&apos;t.
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              'AI-recommended daily focus areas — based on your calendar history, calls, and inbox',
              'Morning voice call — 3–5 min, Monday–Friday, your schedule',
              'Live calendar management — create, move, delete, color-code via conversation',
              'Edge Score — Focus / Energy / Clarity / Momentum, updated daily',
              'Open Loops — surfaces commitments you\'ve mentioned but haven\'t closed',
              'Whoop integration — automatic energy tracking via recovery + sleep scores',
              'Gmail integration — urgent thread detection, reply tracking, inbox triage signal',
              'Activity log — every change Edge makes, with one-tap undo',
            ].map((feat, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3 rounded-xl" style={{ background: 'var(--edg-fill-04)' }}>
                <span style={{ color: 'var(--edg-indigo)', fontSize: 14, flexShrink: 0, marginTop: 2 }}>✦</span>
                <p className="text-sm leading-relaxed min-w-0" style={{ color: 'var(--text-body)' }}>{feat}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Final CTA ── */}
        <section className="max-w-3xl mx-auto px-4 md:px-8 py-14 text-center">
          <div className="glass-card p-6 md:p-10 lg:p-14" style={{ borderColor: 'var(--edg-accent-20)' }}>
            <h2 className="text-3xl font-black tracking-tight mb-4" style={{ color: 'var(--text-strong)' }}>
              Early access is limited. Get on the list.
            </h2>
            <p className="text-base mb-8" style={{ color: 'var(--text-muted)' }}>
              We&apos;re opening Edge to a small group of beta users before public launch. If you&apos;re a founder, exec, or high-performer who&apos;s serious about focus and energy — we want to hear from you.
            </p>
            {submitted ? (
              <div style={{ color: 'var(--text-muted)' }} className="text-sm">You&apos;re on the list — we&apos;ll be in touch soon.</div>
            ) : (
              <>
                <form onSubmit={handleWaitlist} className="flex flex-col sm:flex-row gap-3 justify-center">
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    required
                    className="input flex-1 max-w-xs text-base"
                    style={{ paddingTop: '0.625rem', paddingBottom: '0.625rem' }}
                  />
                  <button type="submit" disabled={submitting} className="btn-primary text-base py-3 px-7 whitespace-nowrap">
                    {submitting ? 'Joining…' : 'Join waitlist'}
                  </button>
                </form>
                <p className="text-xs mt-4" style={{ color: 'var(--text-faint)' }}>
                  We&apos;ll reach out personally. No spam, no drip campaigns, no nonsense.
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
