/* Edg3 UI Kit — Landing screen (marketing). Recreated from app/page.tsx */
const { Button, Badge, Logo, Card, Orb } = window.Edg3DesignSystem_b79f44;

const FEATURES = [
  { icon: '📞', title: 'Calls You Every Morning', desc: "Edg3 initiates the call at your chosen time. You don't open an app — it comes to you." },
  { icon: '🧠', title: 'Knows Your Whole Story', desc: "Built on your goals, calendar, weekly priorities, and everything you've discussed before." },
  { icon: '⚡', title: 'Calls Out Misalignment', desc: "If your calendar doesn't match your stated priority #1 — Edg3 will say it." },
  { icon: '📅', title: 'Calendar Intelligence', desc: "Connects to Google Calendar to find what's blocking you and what time to protect." },
  { icon: '🔁', title: 'Memory That Accumulates', desc: '"You\u2019ve mentioned moving to Hong Kong 8 times in 30 days." Edg3 tracks patterns you miss.' },
  { icon: '🎯', title: 'One Daily Focus', desc: 'Ends every call with one question: "What\u2019s the most important thing before tomorrow?"' },
];

const AUDIENCE = ['Founders', 'Solo Operators', 'Investors', 'Creators', 'Independent Professionals', 'People Rebuilding'];

function LandingScreen({ onSignup, onLogin }) {
  return (
    <div style={{ position: 'relative', minHeight: '100%', background: 'var(--surface-page)', overflow: 'hidden' }}>
      <Orb variant={1} />
      <Orb variant={2} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        {/* Nav */}
        <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 32px', maxWidth: 1152, margin: '0 auto' }}>
          <Logo size={24} eyebrow />
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Button variant="secondary" size="sm" onClick={onLogin}>Log in</Button>
            <Button variant="primary" size="sm" onClick={onSignup}>Get started</Button>
          </div>
        </nav>

        {/* Hero */}
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '72px 32px 56px', textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 999, marginBottom: 32, fontSize: 14, fontWeight: 500, background: 'var(--edg-accent-08)', border: '1px solid var(--edg-accent-20)', color: 'var(--text-accent)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--edg-indigo-bright)' }}></span>
            AI Chief of Staff · Proactive · Daily
          </div>
          <h1 style={{ fontSize: 60, fontWeight: 900, letterSpacing: '-0.02em', lineHeight: 1.05, margin: '0 0 24px', color: 'var(--text-strong)' }}>
            Most people have a calendar.<br /><span className="logo-text">You have Edge.</span>
          </h1>
          <p style={{ fontSize: 20, color: 'var(--text-muted)', maxWidth: 640, margin: '0 auto 40px', lineHeight: 1.5 }}>
            A 3-minute AI briefing that tells you exactly what deserves your attention today.
            Not a productivity app. A strategic advisor.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
            <Button variant="primary" size="lg" onClick={onSignup}>Meet your Chief of Staff →</Button>
            <Button variant="secondary" size="lg" onClick={onLogin}>Already a member</Button>
          </div>
        </div>

        {/* Feature grid */}
        <div style={{ maxWidth: 1024, margin: '0 auto', padding: '0 32px 64px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24, marginBottom: 56 }}>
            {FEATURES.map((f) => (
              <Card key={f.title} hover padding={24}>
                <div style={{ fontSize: 30, marginBottom: 16 }}>{f.icon}</div>
                <h3 style={{ fontWeight: 700, fontSize: 16, margin: '0 0 8px', color: 'var(--text-strong)' }}>{f.title}</h3>
                <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0, color: 'var(--text-muted)' }}>{f.desc}</p>
              </Card>
            ))}
          </div>

          <Card padding={32} style={{ textAlign: 'center', marginBottom: 24 }}>
            <p style={{ fontSize: 18, fontWeight: 600, margin: '0 0 4px', color: 'var(--text-strong)' }}>Elite Daily Guidance Engine</p>
            <p style={{ fontSize: 14, margin: 0, color: 'var(--text-muted)' }}>Built for founders, operators, and ambitious humans who refuse to drift.</p>
          </Card>

          <Card padding={32} style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', margin: '0 0 16px', color: 'var(--edg-indigo)' }}>BUILT FOR</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
              {AUDIENCE.map((t) => <Badge key={t} variant="info">{t}</Badge>)}
            </div>
          </Card>
        </div>

        <div style={{ maxWidth: 1024, margin: '0 auto', padding: '32px', textAlign: 'center', borderTop: '1px solid var(--edg-hairline-soft)' }}>
          <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>© 2026 Edg3 · Elite Daily Guidance Engine · Terms of Service · Privacy Policy</p>
        </div>
      </div>
    </div>
  );
}

window.LandingScreen = LandingScreen;
