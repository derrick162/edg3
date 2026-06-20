import Link from 'next/link';

export default function SecurityPage() {
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
          {/* Hero */}
          <div>
            <h1 className="text-4xl font-black mb-3">Your data is protected</h1>
            <p className="text-lg leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              We built Edge to handle sensitive personal and professional information. Here&apos;s exactly how we protect it.
            </p>
          </div>

          {/* Section 1 — Encryption */}
          <section className="glass-card p-8 space-y-4">
            <div className="flex items-center gap-3 mb-1">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-accent)' }}>
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
              <h2 className="text-lg font-bold" style={{ color: 'var(--text-accent)' }}>Encryption at rest and in transit</h2>
            </div>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
              Everything stored in Edg3 — your preferences, call notes, calendar context, and health data — is encrypted using AES-256-GCM before it touches the database. The same key is never stored alongside the data it protects.
            </p>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
              All data in transit uses TLS 1.3. OAuth tokens from Google and Whoop are short-lived, scoped to only what Edge needs, and refreshed automatically. We never store your Google or Whoop password.
            </p>
          </section>

          {/* Section 2 — Gmail */}
          <section className="glass-card p-8 space-y-4">
            <div className="flex items-center gap-3 mb-1">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-accent)' }}>
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              <h2 className="text-lg font-bold" style={{ color: 'var(--text-accent)' }}>Gmail access — drafts only</h2>
            </div>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
              When you connect Gmail, Edge can check whether key contacts have replied to your outreach — and draft follow-up emails on your behalf. That&apos;s the full scope.
            </p>
            <ul className="space-y-2">
              {[
                'Edge reads subject lines only to detect replies. Email body content is never read or stored.',
                'Emails Edge drafts go to your Gmail Drafts — you review and send them yourself.',
                'Edge never sends email autonomously.',
                'You can disconnect Gmail at any time from the dashboard.',
              ].map((point) => (
                <li key={point} className="flex items-start gap-2.5">
                  <span className="flex-shrink-0 mt-1 w-1.5 h-1.5 rounded-full" style={{ background: 'var(--text-accent)' }} />
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>{point}</p>
                </li>
              ))}
            </ul>
          </section>

          {/* Section 3 — Health data */}
          <section className="glass-card p-8 space-y-4">
            <div className="flex items-center gap-3 mb-1">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-accent)' }}>
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
              <h2 className="text-lg font-bold" style={{ color: 'var(--text-accent)' }}>Health data (Whoop)</h2>
            </div>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
              Connecting Whoop lets Edge factor your recovery, sleep, and strain into your morning briefing — so it can suggest lighter days when you need them. Here&apos;s how we handle that data:
            </p>
            <ul className="space-y-2">
              {[
                'Recovery, sleep, and strain scores are fetched at briefing time and used to generate your briefing. They are not stored beyond a short retention window.',
                'Health data is encrypted at rest using the same AES-256-GCM standard as all other data.',
                'Your Whoop credentials are never stored — only short-lived OAuth tokens that expire automatically.',
                'You can disconnect Whoop from the dashboard at any time, which immediately revokes Edge\'s access.',
              ].map((point) => (
                <li key={point} className="flex items-start gap-2.5">
                  <span className="flex-shrink-0 mt-1 w-1.5 h-1.5 rounded-full" style={{ background: 'var(--text-accent)' }} />
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>{point}</p>
                </li>
              ))}
            </ul>
          </section>

          {/* Section 4 — You control everything */}
          <section className="glass-card p-8 space-y-5">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-accent)' }}>You control everything</h2>
            <div className="space-y-3">
              {[
                { label: 'View what Edge knows', desc: 'The Memory tab in your dashboard shows every preference, goal, and fact Edge has stored about you.' },
                { label: 'Correct or delete it', desc: 'Tell Edge anything is wrong mid-call and it updates immediately. Account deletion removes all data permanently.' },
                { label: 'Disconnect any integration', desc: 'Google Calendar, Gmail, and Whoop can each be disconnected from the dashboard in one click, revoking access immediately.' },
              ].map(({ label, desc }) => (
                <div key={label} className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5"
                    style={{ background: 'var(--edg-accent-15)' }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-accent)' }}>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
                    <span className="font-semibold" style={{ color: 'var(--text-strong)' }}>{label}</span>
                    {' '}— {desc}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Bottom CTA row */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Link href="/privacy" className="btn-secondary inline-block px-6 py-2.5 text-sm">
              Read our full privacy policy →
            </Link>
            <Link href="/signup" className="btn-primary inline-block px-6 py-2.5 text-sm">
              Get started
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
