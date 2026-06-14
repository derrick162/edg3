/* Edg3 UI Kit — Onboarding (4-step wizard). Recreated from app/onboarding/page.tsx */
const OB = window.Edg3DesignSystem_b79f44;

const OB_STEPS = ['Profile', 'Calendar', 'Priorities', 'Call Time'];

function StepIndicator({ current }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 32 }}>
      {OB_STEPS.map((label, i) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700,
            background: i < current ? 'var(--edg-indigo)' : i === current ? 'var(--edg-accent-20)' : 'var(--edg-fill-subtle)',
            border: i === current ? '2px solid var(--edg-indigo)' : '2px solid transparent',
            color: i <= current ? 'var(--text-strong)' : 'var(--text-faint)',
          }}>
            {i < current ? '✓' : i + 1}
          </div>
          <span style={{ fontSize: 12, color: i === current ? 'var(--text-strong)' : 'var(--text-faint)' }}>{label}</span>
          {i < OB_STEPS.length - 1 && <div style={{ width: 32, height: 1, margin: '0 4px', background: i < current ? 'var(--edg-indigo)' : 'rgba(255,255,255,0.08)' }}></div>}
        </div>
      ))}
    </div>
  );
}

function OnboardingScreen({ onComplete }) {
  const [step, setStep] = React.useState(0);
  const [profile, setProfile] = React.useState('');
  const [priorities, setPriorities] = React.useState(['Build Edg3', 'Close two enterprise deals', 'Daily gym + 7h sleep']);
  const [callTime, setCallTime] = React.useState('07:00');
  const [phone, setPhone] = React.useState('');
  const next = () => (step < 3 ? setStep(step + 1) : onComplete());

  const TZ = [
    { label: 'New York / Toronto (ET)', value: 'America/New_York' },
    { label: 'Vancouver / Los Angeles (PT)', value: 'America/Vancouver' },
    { label: 'London (GMT)', value: 'Europe/London' },
    { label: 'Hong Kong / Singapore (HKT)', value: 'Asia/Hong_Kong' },
    { label: 'Tokyo (JST)', value: 'Asia/Tokyo' },
  ];

  return (
    <div style={{ position: 'relative', minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 16px', background: 'var(--surface-page)', overflow: 'hidden' }}>
      <OB.Orb variant={1} />
      <OB.Orb variant={2} />
      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 512 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <OB.Logo size={24} />
          <p style={{ marginTop: 4, fontSize: 14, color: 'var(--text-muted)' }}>Setup · {step + 1} of 4</p>
        </div>

        <OB.Card padding={32}>
          <StepIndicator current={step} />

          {step === 0 && (
            <div>
              <h2 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px' }}>Build your profile</h2>
              <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 24px' }}>Edg3 needs your full context to give you truly useful briefings.</p>
              <OB.Card accent padding={20} style={{ background: 'var(--edg-accent-08)', marginBottom: 24 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-accent)', margin: '0 0 8px' }}>Get your profile from ChatGPT</p>
                <div style={{ borderRadius: 8, padding: 16, fontSize: 13, fontFamily: 'var(--font-mono)', lineHeight: 1.6, background: 'rgba(0,0,0,0.3)', color: 'var(--text-body)' }}>
                  "Summarize everything you know about me — goals, strengths, weaknesses, recurring challenges, and where I may be self-sabotaging. Format as a briefing for a Chief of Staff."
                </div>
              </OB.Card>
              <OB.Textarea label="Paste your ChatGPT summary here" value={profile} onChange={(e) => setProfile(e.target.value)}
                placeholder="Paste your full summary here. The more detail, the better Edg3 can serve you…" style={{ minHeight: 160 }} />
              <OB.Button variant="primary" fullWidth style={{ marginTop: 16 }} onClick={next}>Save profile &amp; continue →</OB.Button>
            </div>
          )}

          {step === 1 && (
            <div>
              <h2 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px' }}>Connect your calendar</h2>
              <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 32px' }}>Edg3 reads your Google Calendar to surface conflicts and misalignment between your priorities and your time.</p>
              <OB.Card padding={24} style={{ textAlign: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>📅</div>
                <h3 style={{ fontWeight: 700, margin: '0 0 8px' }}>Google Calendar</h3>
                <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 20px' }}>Read-only access. Edg3 sees your events to build smarter briefings. Nothing is modified.</p>
                <OB.Button variant="primary" fullWidth onClick={next}>Connect Google Calendar</OB.Button>
              </OB.Card>
              <OB.Button variant="subtle" fullWidth onClick={next}>Skip for now — I'll connect later</OB.Button>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px' }}>This week's top priorities</h2>
              <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 16px' }}>Edg3 checks every briefing to make sure your calendar actually reflects these.</p>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '8px 12px', borderRadius: 8, marginBottom: 16, background: 'var(--edg-accent-08)', color: 'var(--text-accent)', border: '1px solid var(--edg-accent-15)' }}>✦ Suggested from your profile — edit freely</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {priorities.map((p, i) => (
                  <div key={i}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--edg-indigo)', marginBottom: 8 }}>PRIORITY #{i + 1}</label>
                    <OB.Input value={p} onChange={(e) => { const n = [...priorities]; n[i] = e.target.value; setPriorities(n); }} />
                  </div>
                ))}
              </div>
              <OB.Button variant="primary" fullWidth style={{ marginTop: 16 }} onClick={next}>Set priorities &amp; continue →</OB.Button>
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px' }}>Schedule your morning call</h2>
              <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 32px' }}>Edg3 calls you at this time every morning. Pick a time when you're alert and can give it 3 minutes.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <OB.Input label="Call time" type="time" value={callTime} onChange={(e) => setCallTime(e.target.value)} />
                <OB.Select label="Timezone" defaultValue="America/New_York" options={TZ} />
                <div>
                  <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 8 }}>Phone number</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ width: 64, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600, borderRadius: 10, background: 'var(--surface-input)', border: '1px solid var(--border-card)' }}>+1</div>
                    <OB.Input type="tel" placeholder="(555) 000-0000" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} />
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 8 }}>US &amp; Canada only. Edg3 will call you here every morning.</p>
                </div>
              </div>
              <OB.Button variant="primary" fullWidth style={{ marginTop: 24 }} onClick={next}>Complete setup →</OB.Button>
            </div>
          )}
        </OB.Card>
      </div>
    </div>
  );
}

window.OnboardingScreen = OnboardingScreen;
