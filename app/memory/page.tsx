import Link from 'next/link';

export default function MemoryPage() {
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
            <h1 className="text-4xl font-black mb-3">Memory that compounds</h1>
            <p className="text-lg leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Edge remembers what you care about — and gets sharper every single call.
            </p>
          </div>

          {/* Section 1 — The problem */}
          <section className="glass-card p-8 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-accent)' }}>The problem with AI assistants</h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
              Every conversation with a typical AI assistant starts from scratch. You repeat yourself. You re-explain your goals, your team, your constraints. By the time the assistant understands your situation, the conversation is over.
            </p>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
              Edge is different. It listens across every call and builds a model of you — your goals, your people, your patterns. The tenth call is dramatically more useful than the first.
            </p>
          </section>

          {/* Section 2 — What Edge learns */}
          <section className="glass-card p-8 space-y-6">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-accent)' }}>What Edge learns about you</h2>
            <div className="space-y-4">
              {[
                {
                  icon: '🎯',
                  label: 'Goals',
                  desc: 'Your top priorities and what progress looks like. Edge tracks what you committed to and follows up when you haven\'t mentioned it.',
                },
                {
                  icon: '📂',
                  label: 'Projects',
                  desc: 'Active initiatives, their status, and who else is involved. Edge can brief you on a project\'s state without you having to summarize it again.',
                },
                {
                  icon: '👤',
                  label: 'People',
                  desc: 'Key contacts — colleagues, clients, partners. Edge remembers context about relationships so you don\'t repeat yourself.',
                },
                {
                  icon: '⚡',
                  label: 'Preferences',
                  desc: 'How you work best. When your energy peaks. Which tasks drain you. Edge factors these in when suggesting how to structure your day.',
                },
                {
                  icon: '📅',
                  label: 'Patterns',
                  desc: 'What your Mondays look like. When you tend to over-schedule. Where your time disappears. Edge surfaces patterns you can\'t see yourself.',
                },
              ].map(({ icon, label, desc }) => (
                <div key={label} className="flex items-start gap-4">
                  <span className="text-xl flex-shrink-0 mt-0.5">{icon}</span>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
                    <span className="font-semibold" style={{ color: 'var(--text-strong)' }}>{label}</span>
                    {' '}— {desc}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Section 3 — How it grows */}
          <section className="glass-card p-8 space-y-5">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-accent)' }}>How memory grows</h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
              Every call, Edge extracts what&apos;s new — a project that launched, a relationship that changed, a goal that shifted. It stores it, associates it with what it already knows, and uses it to make the next briefing more specific to where you actually are.
            </p>
            <div className="space-y-3">
              {[
                { week: 'Week 1', desc: 'Edge learns your top priorities and who you work with.' },
                { week: 'Week 2', desc: 'Edge starts connecting patterns — your calendar vs your goals.' },
                { week: 'Week 4', desc: 'Edge knows your rhythm. Briefings reference your history by name.' },
                { week: 'Month 3+', desc: 'Edge has enough context to anticipate what you haven\'t thought to mention.' },
              ].map(({ week, desc }) => (
                <div key={week} className="flex items-start gap-3">
                  <span className="flex-shrink-0 text-xs font-bold pt-0.5 min-w-[52px]" style={{ color: 'var(--text-accent)' }}>{week}</span>
                  <p className="text-sm" style={{ color: 'var(--text-body)' }}>{desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Section 4 — Privacy anchor */}
          <section className="glass-card p-6 space-y-2" style={{ borderColor: 'var(--edg-hairline)' }}>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>Your data stays yours.</p>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Everything Edge learns is stored encrypted and tied to your account. You can view what Edge knows, correct it, or delete it any time.{' '}
              <Link href="/privacy" className="underline" style={{ color: 'var(--text-accent)' }}>Read our full privacy policy →</Link>
            </p>
          </section>

          {/* Bottom CTA */}
          <div className="text-center pt-4">
            <Link href="/signup" className="btn-primary inline-block px-8 py-3 text-base">
              Build your Edge memory
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
