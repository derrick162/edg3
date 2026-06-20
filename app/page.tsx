'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/ui';

// ── Inline SVG icons (Lucide-style, 20px, 1.5 stroke) ─────────────────────
function IconTarget() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
    </svg>
  );
}
function IconUsers() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function IconZap() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}
function IconCheckCircle() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}
function IconPhone() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.06 6.06l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
function IconBrain() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-1.66" /><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-1.66" />
    </svg>
  );
}

// ── Mock calendar SVG — chaotic week → focused week ────────────────────────
function CalendarVisual() {
  const accent = 'var(--edg-indigo)';
  const accentFade = 'rgba(99,102,241,0.18)';
  const red = 'rgba(239,68,68,0.55)';
  const muted = 'rgba(255,255,255,0.06)';
  const border = 'rgba(255,255,255,0.07)';

  return (
    <div
      className="mx-auto mt-10 rounded-2xl overflow-hidden"
      style={{
        maxWidth: 620,
        border: '1px solid var(--edg-accent-20)',
        background: 'var(--surface-card)',
        boxShadow: '0 0 48px rgba(99,102,241,0.10)',
      }}
    >
      <div className="grid grid-cols-2 divide-x" style={{ borderColor: border }}>
        {/* BEFORE — chaotic */}
        <div className="p-4 md:p-6">
          <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: red }}>Before</p>
          <div className="space-y-1.5">
            {[
              { label: 'Sync with team', w: '90%', c: red },
              { label: 'Budget review', w: '60%', c: red },
              { label: '1:1 check-in', w: '45%', c: muted },
              { label: '1:1 check-in', w: '45%', c: muted },
              { label: 'Strategy deck', w: '75%', c: red },
              { label: 'Investor call', w: '80%', c: red },
              { label: 'Deep work???', w: '40%', c: muted },
            ].map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                <div
                  className="rounded text-xs px-2 py-1 truncate"
                  style={{ width: b.w, background: b.c, color: 'rgba(255,255,255,0.7)', fontSize: 10, minWidth: 0 }}
                >{b.label}</div>
              </div>
            ))}
          </div>
        </div>
        {/* AFTER — focused */}
        <div className="p-4 md:p-6">
          <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: accent }}>After Edg3</p>
          <div className="space-y-1.5">
            {[
              { label: '⚡ Deep work block', w: '90%', c: accentFade, strong: true },
              { label: 'Strategy deck', w: '75%', c: accentFade, strong: false },
              { label: '→ Investor call', w: '80%', c: accentFade, strong: false },
              { label: '↓ Syncs batched', w: '65%', c: 'rgba(99,102,241,0.10)', strong: false },
              { label: '⚡ Focus block', w: '70%', c: accentFade, strong: true },
              { label: 'Budget review', w: '55%', c: 'rgba(99,102,241,0.10)', strong: false },
              { label: '✓ Evening clear', w: '50%', c: 'var(--edg-success-ring)', strong: false },
            ].map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                <div
                  className="rounded text-xs px-2 py-1 truncate"
                  style={{
                    width: b.w, background: b.c,
                    color: b.strong ? 'var(--text-accent)' : 'rgba(255,255,255,0.6)',
                    fontSize: 10, border: b.strong ? '1px solid var(--edg-accent-20)' : 'none', minWidth: 0,
                  }}
                >{b.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Waveform visual for call section ──────────────────────────────────────
function WaveformVisual() {
  const bars = [4, 8, 14, 20, 28, 22, 16, 28, 34, 28, 20, 32, 36, 28, 22, 34, 38, 30, 22, 16, 24, 30, 20, 14, 10, 6];
  return (
    <div
      className="mx-auto mt-10 rounded-2xl px-6 py-8 flex flex-col items-center gap-5"
      style={{
        maxWidth: 480,
        border: '1px solid var(--edg-accent-20)',
        background: 'var(--surface-card)',
        boxShadow: '0 0 40px rgba(99,102,241,0.10)',
      }}
    >
      {/* Phone + label */}
      <div className="flex items-center gap-3">
        <div
          className="rounded-full flex items-center justify-center"
          style={{ width: 44, height: 44, background: 'var(--edg-accent-15)', color: 'var(--text-accent)' }}
        >
          <IconPhone />
        </div>
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>Edg3 · Morning briefing</p>
          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Mon–Fri · 3–5 min · your time</p>
        </div>
        <div className="ml-auto">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full" style={{ background: 'var(--edg-success-ring)', color: 'rgba(134,239,172,0.9)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(134,239,172,0.9)', display: 'inline-block' }} className="animate-pulse" />
            Live
          </span>
        </div>
      </div>
      {/* Waveform */}
      <div className="flex items-end gap-1" style={{ height: 44 }}>
        {bars.map((h, i) => (
          <div
            key={i}
            className="rounded-full"
            style={{
              width: 4,
              height: h,
              background: i < 14 ? `rgba(99,102,241,${0.3 + (h / 38) * 0.5})` : 'rgba(255,255,255,0.12)',
            }}
          />
        ))}
      </div>
      {/* Transcript snippet */}
      <div className="w-full space-y-2">
        <div className="flex gap-2">
          <span className="text-xs font-semibold shrink-0" style={{ color: 'var(--text-faint)' }}>Edg3</span>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            Your Edg3 Score is 74 today. Focus is solid — but your deep-work block is sandwiched. Want me to move those meetings?
          </p>
        </div>
        <div className="flex gap-2 justify-end">
          <p className="text-xs leading-relaxed text-right" style={{ color: 'var(--text-body)' }}>Yes, move them.</p>
          <span className="text-xs font-semibold shrink-0" style={{ color: 'var(--text-faint)' }}>You</span>
        </div>
        <div className="flex gap-2">
          <span className="text-xs font-semibold shrink-0" style={{ color: 'var(--text-faint)' }}>Edg3</span>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>Done. Deep work is protected 9–11. Have a great one.</p>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
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
        {/* Nav */}
        <nav className="flex items-center justify-between px-4 md:px-10 py-6 max-w-6xl mx-auto">
          <Logo size={22} eyebrow />
          <div className="flex items-center gap-4">
            <Link href="/login" className="btn-secondary text-sm py-2 px-5">Log in</Link>
            <Link href="/signup" className="btn-primary text-sm py-2 px-5">Get started</Link>
          </div>
        </nav>

        {/* ── Hero ── */}
        <section className="max-w-4xl mx-auto px-4 md:px-8 pt-16 pb-20 text-center">
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
            Edg3 learns how you work, organizes your calendar around what matters most, and reshapes your day — every morning, in 3 minutes.
          </p>

          {/* Waitlist form */}
          <div className="flex flex-col items-center gap-3">
            {submitted ? (
              <div className="glass-card px-8 py-5 text-center" style={{ borderColor: 'var(--edg-accent-20)' }}>
                <p className="font-semibold mb-1" style={{ color: 'var(--text-strong)' }}>You&apos;re on the list.</p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>We&apos;ll reach out personally. No spam, no drip campaigns, no nonsense.</p>
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
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn-primary text-base py-2.5 px-7 whitespace-nowrap"
                  >
                    {submitting ? 'Joining…' : 'Join the waitlist'}
                  </button>
                </div>
                {waitlistError && (
                  <p className="text-sm text-center" style={{ color: 'var(--edg-danger)' }}>{waitlistError}</p>
                )}
              </form>
            )}
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              Free to start. No credit card. Early access limited.
            </p>
          </div>
        </section>

        {/* ── Social proof strip ── */}
        <section className="max-w-4xl mx-auto px-4 md:px-8 pb-20">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                quote: 'I used to spend Sunday nights rebuilding my week. Now I do it in three minutes on Monday morning.',
                name: 'Marcus T.',
                title: 'Founder & CEO',
              },
              {
                quote: 'It knows which meetings I can skip and which priorities are slipping. No other tool has ever done that.',
                name: 'Priya N.',
                title: 'VP of Product',
              },
              {
                quote: 'My calendar finally reflects what I actually care about. It took one week.',
                name: 'James L.',
                title: 'Managing Partner',
              },
            ].map(item => (
              <div
                key={item.name}
                className="rounded-2xl p-5 flex flex-col gap-3"
                style={{
                  background: 'var(--surface-card)',
                  border: '1px solid var(--edg-hairline)',
                }}
              >
                <p className="text-sm leading-relaxed flex-1" style={{ color: 'var(--text-muted)' }}>
                  &ldquo;{item.quote}&rdquo;
                </p>
                <div>
                  <p className="text-xs font-semibold" style={{ color: 'var(--text-body)' }}>{item.name}</p>
                  <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{item.title}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Problem ── */}
        <section className="max-w-5xl mx-auto px-4 md:px-8 py-24">
          <h2 className="text-3xl md:text-4xl font-black tracking-tight mb-4 text-center" style={{ color: 'var(--text-strong)' }}>
            Your calendar is full.<br />The right things aren&apos;t getting done.
          </h2>
          <p className="text-lg text-center" style={{ color: 'var(--text-muted)' }}>
            You&apos;re busy — but busy isn&apos;t the same as progressing.
          </p>
          <CalendarVisual />
        </section>

        {/* ── Solution: 3-column explainer ── */}
        <section className="max-w-5xl mx-auto px-6 md:px-8 py-24">
          <h2 className="text-3xl md:text-4xl font-black tracking-tight mb-12 text-center" style={{ color: 'var(--text-strong)' }}>
            Edg3 fixes your week in 3 minutes every morning.
          </h2>
          <p className="text-base mb-12 text-center" style={{ color: 'var(--text-muted)' }}>
            One call. Your calendar reshaped. Your priorities protected.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: <IconTarget />,
                num: '01',
                title: 'He already knows your priorities.',
                desc: 'Edg3 analyzes your calendar history, call memory, and inbox to tell you what matters most today — you don\'t have to figure it out. Just confirm or tweak.',
              },
              {
                icon: <IconCalendar />,
                num: '02',
                title: 'He reshapes your calendar around them.',
                desc: 'Mismatched meetings get moved. Focus blocks get protected. High-demand work lands in your highest-energy windows. One "yes" and it\'s done.',
              },
              {
                icon: <IconBrain />,
                num: '03',
                title: 'He gets smarter every day.',
                desc: 'Every call, every confirmed plan, every Whoop recovery score teaches Edg3 how you work. The longer you use it, the better it gets at running the day you need.',
              },
            ].map(item => (
              <div key={item.num} className="glass-card glass-card-hover p-7">
                <div className="flex items-center gap-3 mb-4">
                  <div style={{ color: 'var(--text-accent)' }}>{item.icon}</div>
                  <p className="text-xs font-black tracking-widest" style={{ color: 'var(--edg-indigo)' }}>{item.num}</p>
                </div>
                <h3 className="font-bold text-base mb-3" style={{ color: 'var(--text-strong)' }}>{item.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>{item.desc}</p>
              </div>
            ))}
          </div>
          <WaveformVisual />
        </section>

        {/* ── Edg3 Score ── */}
        <section className="max-w-5xl mx-auto px-4 md:px-8 py-24">
          <h2 className="text-3xl font-black tracking-tight mb-4 text-center" style={{ color: 'var(--text-strong)' }}>
            One number. Your daily readout.
          </h2>
          <p className="text-base mb-10 max-w-2xl mx-auto text-center" style={{ color: 'var(--text-muted)' }}>
            Your Edg3 Score tells you how set up you are for a focused, energized, sustainable day — before it starts.
          </p>

          {/* Product preview — inline Edg3 Score card */}
          <div
            className="glass-card mx-auto"
            style={{
              maxWidth: 420,
              borderColor: 'var(--edg-accent-20)',
              padding: '28px 28px 24px',
              boxShadow: '0 0 40px rgba(99,102,241,0.10)',
            }}
          >
            {/* Header row */}
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-faint)', letterSpacing: '0.08em' }}>Edg3 Score</p>
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
                  <path d="M 10 54 A 40 40 0 0 1 90 54" fill="none" stroke="var(--gauge-bg)" strokeWidth="8" strokeLinecap="round" />
                  <path d="M 10 54 A 40 40 0 0 1 90 54" fill="none" stroke="var(--gauge-high)" strokeWidth="8" strokeLinecap="round" strokeDasharray="125.6" strokeDashoffset="32.7" />
                </svg>
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, textAlign: 'center', lineHeight: 1 }}>
                  <span style={{ fontSize: 28, fontWeight: 900, color: 'var(--gauge-high)', letterSpacing: '-0.03em' }}>74</span>
                </div>
              </div>

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
              <span style={{ color: 'var(--text-accent)', fontWeight: 600 }}>Edg3: </span>
              <span style={{ color: 'var(--text-muted)' }}>
                Focus is solid — but your 9 AM deep-work block is sandwiched between two meetings. Want me to move them?
              </span>
            </div>
          </div>

          <p className="text-sm mt-6 text-center" style={{ color: 'var(--text-faint)' }}>
            The score isn&apos;t just a number. It&apos;s a diagnosis. And Edg3 can raise it.
          </p>
        </section>

        {/* ── How it works ── */}
        <section className="max-w-5xl mx-auto px-4 md:px-8 py-24">
          <h2 className="text-3xl font-black tracking-tight mb-4 text-center" style={{ color: 'var(--text-strong)' }}>
            Three things. Every morning.
          </h2>
          <p className="text-base mb-8 text-center" style={{ color: 'var(--text-muted)' }}>
            No dashboard to open. No app to check. Just a call.
          </p>
          <div className="max-w-2xl mx-auto">
            {[
              {
                icon: <IconPhone />,
                step: '01',
                heading: 'Edg3 calls you.',
                text: 'At your chosen time, Monday through Friday. No snoozing, no rescheduling — it just happens. The call is 3–5 minutes.',
              },
              {
                icon: <IconZap />,
                step: '02',
                heading: 'He opens with the diagnosis.',
                text: '"Your Edg3 Score is 62 — focus is solid, but energy is low and your deep-work block is buried. Here\'s what I\'d change."',
              },
              {
                icon: <IconCalendar />,
                step: '03',
                heading: 'You say yes. It\'s done.',
                text: 'Edg3 reshapes your calendar, books the blocks, moves what needs moving — while you\'re still on the call. You hang up lighter.',
              },
            ].map((item, idx, arr) => (
              <div key={item.step} className="flex gap-6">
                {/* Connector column */}
                <div className="flex flex-col items-center" style={{ width: 48, flexShrink: 0 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                    background: 'var(--edg-accent-15)', border: '1px solid var(--edg-accent-20)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--text-accent)',
                  }}>{item.icon}</div>
                  {idx < arr.length - 1 && (
                    <div style={{ width: 1, flex: 1, minHeight: 32, background: 'var(--edg-accent-15)', margin: '6px 0' }} />
                  )}
                </div>
                {/* Content */}
                <div className={idx < arr.length - 1 ? 'pb-6' : 'pb-0'}>
                  <p className="text-xs font-black tracking-widest mb-1" style={{ color: 'var(--edg-indigo)' }}>{item.step}</p>
                  <p className="text-base font-bold mb-1.5" style={{ color: 'var(--text-strong)' }}>{item.heading}</p>
                  <p className="text-base leading-relaxed" style={{ color: 'var(--text-body)' }}>{item.text}</p>
                </div>
              </div>
            ))}
            <p className="text-base font-semibold text-center mt-10" style={{ color: 'var(--text-muted)' }}>
              That&apos;s it. Repeat daily.
            </p>
          </div>
        </section>

        {/* ── Memory section ── */}
        <section className="max-w-5xl mx-auto px-4 md:px-8 py-24">
          <div className="glass-card p-8 md:p-14" style={{ borderColor: 'var(--edg-accent-20)' }}>
            <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-6 leading-tight" style={{ color: 'var(--text-strong)' }}>
              Most AI forgets you.<br />Edg3 remembers.
            </h2>
            <p className="text-base mb-2" style={{ color: 'var(--text-muted)' }}>Every call adds to your picture.</p>
            <p className="text-base mb-2" style={{ color: 'var(--text-muted)' }}>Day 14 feels nothing like day one.</p>
            <p className="text-base font-semibold mb-10" style={{ color: 'var(--text-body)' }}>
              You&apos;re not training a chatbot. You&apos;re building an operating partner.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Your goals, as they evolve', icon: <IconTarget /> },
                { label: 'The people in your orbit',   icon: <IconUsers /> },
                { label: 'Your energy & patterns',     icon: <IconZap /> },
                { label: 'Commitments you\'ve made',   icon: <IconCheckCircle /> },
              ].map(item => (
                <div key={item.label} className="rounded-xl px-4 py-5 flex flex-col gap-3" style={{ background: 'var(--edg-accent-08)', border: '1px solid var(--edg-accent-15)' }}>
                  <div style={{ color: 'var(--text-accent)' }}>{item.icon}</div>
                  <p className="text-sm font-semibold leading-snug" style={{ color: 'var(--text-body)' }}>{item.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Features ── */}
        <section className="max-w-5xl mx-auto px-4 md:px-8 py-24">
          <h2 className="text-3xl font-black tracking-tight mb-4 text-center" style={{ color: 'var(--text-strong)' }}>
            Everything you need.<br />Nothing you don&apos;t.
          </h2>
          <p className="text-base mb-12 text-center" style={{ color: 'var(--text-muted)' }}>
            No bloated dashboard. No complex setup. Everything runs through a 3-minute call.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              { label: 'Daily focus areas', desc: 'Edg3 reads your calendar, calls, and inbox every morning — and surfaces the 3 things that actually move the needle today. No manual input.' },
              { label: 'Morning voice call', desc: 'Edg3 calls you. Not the other way around. 3–5 minutes, Mon–Fri, and your day is reshaped before you open your laptop.' },
              { label: 'Live calendar management', desc: 'Say "move my 2 PM" on the call and it moves. Create blocks, reschedule meetings, clean up duplicates — all via voice.' },
              { label: 'Edg3 Score', desc: 'One number — Focus, Energy, Clarity, Momentum — that tells you exactly how well your day is set up before it starts.' },
              { label: 'Open Loops', desc: 'Said "I\'ll follow up on that"? Edg3 heard it. Every commitment you\'ve made is tracked and surfaced before it slips.' },
              { label: 'Whoop integration', desc: 'Recovery at 34%? Edg3 automatically protects your morning and shifts the heavy cognitive work. No manual entry ever.' },
              { label: 'Gmail integration', desc: 'Edg3 flags threads that need a reply today — without reading your emails. Subject lines only. Signal without surveillance.' },
              { label: 'Activity log with undo', desc: 'Every calendar change Edg3 makes is logged. Didn\'t like it? One tap to undo, no questions asked.' },
            ].map((feat, i) => (
              <div key={i} className="flex items-start gap-3.5 px-4 py-4 rounded-xl" style={{ background: 'var(--edg-fill-04)', border: '1px solid var(--edg-hairline)' }}>
                <span style={{ color: 'var(--edg-indigo)', fontSize: 16, flexShrink: 0, marginTop: 1 }}>✦</span>
                <div>
                  <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--text-strong)' }}>{feat.label}</p>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>{feat.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Final CTA ── */}
        <section className="max-w-3xl mx-auto px-4 md:px-8 py-24 text-center">
          <div className="glass-card p-6 md:p-10 lg:p-14" style={{ borderColor: 'var(--edg-accent-20)' }}>
            <h2 className="text-3xl font-black tracking-tight mb-4" style={{ color: 'var(--text-strong)' }}>
              Early access is limited. Get on the list.
            </h2>
            <p className="text-base mb-8" style={{ color: 'var(--text-muted)' }}>
              We&apos;re opening Edg3 to a small group of beta users before public launch. If you&apos;re a founder, exec, or high-performer who&apos;s serious about focus and energy — we want to hear from you.
            </p>
            {submitted ? (
              <div style={{ color: 'var(--text-muted)' }} className="text-sm">You&apos;re on the list — we&apos;ll be in touch soon.</div>
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
