'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo, Badge } from '@/components/ui';

export default function LandingPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

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
        <nav className="flex items-center justify-between px-8 py-6 max-w-6xl mx-auto">
          <Logo size={22} eyebrow />
          <div className="flex items-center gap-4">
            <Link href="/login" className="btn-secondary text-sm py-2 px-5">Log in</Link>
            <Link href="/signup" className="btn-primary text-sm py-2 px-5">Get started</Link>
          </div>
        </nav>

        {/* Hero */}
        <div className="max-w-4xl mx-auto px-8 pt-20 pb-16 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-8 text-sm font-medium"
               style={{ background: 'var(--edg-accent-08)', border: '1px solid var(--edg-accent-15)', color: 'var(--text-accent)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--edg-indigo-bright)', display: 'inline-block' }} className="animate-pulse" />
            AI Chief of Staff · Proactive · Daily
          </div>

          <h1 className="text-6xl font-black tracking-tight mb-6 leading-tight">
            <span style={{ color: 'var(--text-strong)' }}>Most people have a calendar.</span>
            <br />
            <span className="logo-text">You have Edge.</span>
          </h1>

          <p className="text-xl mb-10 max-w-2xl mx-auto" style={{ color: 'var(--text-muted)' }}>
            A 3-minute AI briefing that tells you exactly what deserves your attention today.
            Not a productivity app. A strategic advisor.
          </p>

          <div className="flex items-center justify-center gap-4 flex-wrap">
            <Link href="/signup" className="btn-primary text-base py-3 px-8">
              Meet your Chief of Staff →
            </Link>
            <Link href="/login" className="btn-secondary text-base py-3 px-8">
              Already a member
            </Link>
          </div>
        </div>

        {/* Feature grid */}
        <div className="max-w-5xl mx-auto px-8 pb-24">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
            {[
              {
                icon: '📞',
                title: 'Calls You Every Morning',
                desc: 'Edg3 initiates the call at your chosen time. You don\'t have to open an app. It comes to you.',
              },
              {
                icon: '🧠',
                title: 'Knows Your Whole Story',
                desc: 'Built on your goals, calendar, weekly priorities, and everything you\'ve discussed before.',
              },
              {
                icon: '⚡',
                title: 'Calls Out Misalignment',
                desc: 'If you said building your startup is priority #1 but your calendar says otherwise — Edg3 will say it.',
              },
              {
                icon: '📅',
                title: 'Calendar Intelligence',
                desc: 'Connects to Google Calendar to identify what\'s blocking you and what time blocks to protect.',
              },
              {
                icon: '🔁',
                title: 'Memory That Accumulates',
                desc: '"You\'ve mentioned moving to Hong Kong 8 times in the last 30 days." Edg3 tracks patterns you miss.',
              },
              {
                icon: '🎯',
                title: 'One Daily Focus',
                desc: 'Ends every call with one question: "What\'s the most important thing I should know before tomorrow?"',
              },
            ].map((f, i) => (
              <div key={i} className="glass-card glass-card-hover p-6">
                <div className="text-3xl mb-4">{f.icon}</div>
                <h3 className="font-bold text-base mb-2" style={{ color: 'var(--text-strong)' }}>{f.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>{f.desc}</p>
              </div>
            ))}
          </div>

          {/* Tagline */}
          <div className="glass-card p-8 text-center mb-6">
            <p className="text-lg font-semibold mb-1" style={{ color: 'var(--text-strong)' }}>Elite Daily Guidance Engine</p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Built for founders, operators, and ambitious humans who refuse to drift.</p>
          </div>

          {/* Who it's for */}
          <div className="glass-card p-8 text-center">
            <p className="text-sm font-semibold mb-4" style={{ color: 'var(--edg-indigo)' }}>BUILT FOR</p>
            <div className="flex flex-wrap justify-center gap-3">
              {['Founders', 'Solo Operators', 'Investors', 'Creators', 'Independent Professionals', 'People Rebuilding'].map(t => (
                <Badge key={t} variant="info">{t}</Badge>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="max-w-5xl mx-auto px-8 py-8 text-center" style={{ borderTop: '1px solid var(--edg-hairline)' }}>
          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
            © 2026 Edg3 · Elite Daily Guidance Engine ·{' '}
            <Link href="/terms" style={{ color: 'var(--edg-indigo)' }}>Terms of Service</Link>
            {' · '}
            <Link href="/privacy" style={{ color: 'var(--edg-indigo)' }}>Privacy Policy</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
