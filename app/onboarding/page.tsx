'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type Step = 'profile' | 'calendar' | 'priorities' | 'calltime' | 'done';

const STEPS: Step[] = ['profile', 'calendar', 'priorities', 'calltime'];

function StepIndicator({ current }: { current: Step }) {
  const labels = ['Profile', 'Calendar', 'Priorities', 'Call Time'];
  const idx = STEPS.indexOf(current);
  return (
    <div className="flex items-center gap-1.5 md:gap-2 mb-6 md:mb-8">
      {STEPS.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all"
            style={{
              background: i < idx ? 'var(--edg-indigo)' : i === idx ? 'var(--edg-accent-20)' : 'rgba(255,255,255,0.05)',
              border: i === idx ? '2px solid var(--edg-indigo)' : '2px solid transparent',
              color: i <= idx ? 'var(--text-strong)' : 'var(--text-faint)',
            }}
          >
            {i < idx ? '✓' : i + 1}
          </div>
          <span className="text-xs hidden sm:block" style={{ color: i === idx ? 'var(--text-strong)' : 'var(--text-faint)' }}>
            {labels[i]}
          </span>
          {i < STEPS.length - 1 && (
            <div className="w-8 h-px mx-1" style={{ background: i < idx ? 'var(--edg-indigo)' : 'rgba(255,255,255,0.08)' }} />
          )}
        </div>
      ))}
    </div>
  );
}

const EXAMPLE_PROFILE = `Current situation: Recently laid off from a corporate role in San Francisco. Reassessing career direction, exploring entrepreneurship, learning AI. Mix of relief, fear, and excitement — this is the beginning of reinvention, not failure.

Goals (next 12 months): Build financial independence through consulting and AI services. Replace corporate income ($5–10k/month by month 6). Create multiple income streams nobody can take away. Develop AI leverage — not as an engineer, but as someone who can identify problems and deploy solutions.

Strengths: Deep corporate experience (stakeholder management, project coordination, customer relationships). Strong communicator — can run meetings, present ideas, build trust. Empathy for customer pain points from years inside organizations. Geographic advantage: based in San Francisco with access to founders, engineers, and early adopters.

Weaknesses / self-sabotage patterns: Seeking permission before acting — waiting for someone to assign the opportunity. Consuming more than creating (courses, tutorials, research) without selling anything. Tendency to underprice services. Identity still partly attached to job title and employer brand.

Opportunities: AI workflow consulting for law firms, agencies, and recruiters. Fractional operations partner (process improvement, automation, retainers). Build publicly — share AI experiments and case studies to create inbound.

Health: Needs to prioritize sleep, daily movement, and social connection during this transition. Burnout is not a business strategy.

Chief of Staff priority: First paying client before first business plan. First $1k earned independently matters more than any pitch deck.`;

function ProfileStep({ onNext }: { onNext: () => void }) {
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showExample, setShowExample] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!summary.trim()) return;
    setLoading(true);
    setError('');

    const res = await fetch('/api/onboarding/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_summary: summary }),
    });

    setLoading(false);
    if (res.ok) {
      onNext();
    } else if (res.status === 401) {
      setError('Session expired — please log in again.');
    } else {
      const d = await res.json();
      setError(d.error || 'Failed to save');
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2">Build your profile</h2>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
        EDG3 needs to understand your full context to give you truly useful briefings.
      </p>

      <div className="glass-card p-5 mb-6" style={{ borderColor: 'var(--edg-accent-20)', background: 'rgba(99,102,241,0.05)' }}>
        <p className="text-sm font-semibold mb-2" style={{ color: 'var(--text-accent)' }}>Step 1 of 2 — Get your profile from ChatGPT</p>
        <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
          Go to ChatGPT (or your most actively used AI tool) and send this prompt (it works best if you've had prior conversations with it):
        </p>
        <div className="rounded-lg p-4 text-sm font-mono leading-relaxed" style={{ background: 'rgba(0,0,0,0.3)', color: 'var(--text-body)', userSelect: 'all', cursor: 'text' }}>
          "Summarize everything you know about me including goals, projects, strengths, weaknesses, recurring challenges, opportunities, financial goals, health goals, relationship goals, and areas where I may be self-sabotaging. Format as a briefing for a Chief of Staff."
        </div>
      </div>

      <div className="mb-4">
        <button
          type="button"
          onClick={() => setShowExample(e => !e)}
          className="flex items-center gap-2 text-sm font-medium"
          style={{ color: 'var(--text-accent)' }}
        >
          <span style={{ transition: 'transform 0.2s', display: 'inline-block', transform: showExample ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
          See an example profile
        </button>
        {showExample && (
          <div className="mt-3 rounded-lg p-4 text-xs leading-relaxed whitespace-pre-wrap"
            style={{ background: 'rgba(0,0,0,0.25)', color: 'var(--text-muted)', border: '1px solid var(--edg-accent-15)', maxHeight: '220px', overflowY: 'auto' }}>
            {EXAMPLE_PROFILE}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit}>
        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
          Paste your ChatGPT summary here
        </label>
        <textarea
          className="input"
          style={{ minHeight: '200px' }}
          placeholder="Paste your full summary from ChatGPT here. The more detail, the better EDG3 can serve you…"
          value={summary}
          onChange={e => setSummary(e.target.value)}
          required
        />

        {error && <p className="text-sm mt-2" style={{ color: 'var(--edg-danger)' }}>{error}</p>}

        <button type="submit" className="btn-primary w-full mt-4" disabled={loading || !summary.trim()}>
          {loading ? 'Saving…' : 'Save profile & continue →'}
        </button>
      </form>
    </div>
  );
}

function CalendarStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.data === 'calendar_connected') onNext();
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onNext]);

  async function connectCalendar() {
    setLoading(true);
    setError('');
    const res = await fetch('/api/calendar/connect');
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error || 'Calendar connection not available');
      return;
    }
    const popup = window.open(data.url, 'google-calendar-oauth', 'width=500,height=650,scrollbars=yes');
    if (!popup) {
      // Fallback if popup blocked
      window.location.href = data.url;
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2">Connect your calendar</h2>
      <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>
        EDG3 reads your Google Calendar to surface scheduling conflicts and misalignment between your priorities and your time.
      </p>

      <div className="glass-card p-6 mb-4 text-center">
        <div className="text-4xl mb-3">📅</div>
        <h3 className="font-bold mb-2">Google Calendar</h3>
        <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
          Edg3 reads your Google Calendar and can create, move, or remove events during your voice calls.
        </p>
        <button className="btn-primary w-full" onClick={connectCalendar} disabled={loading}>
          {loading ? 'Connecting…' : 'Connect Google Calendar'}
        </button>
        {error && <p className="text-sm mt-3" style={{ color: 'var(--edg-warning)' }}>{error}</p>}
      </div>

      <button onClick={onSkip} className="w-full text-sm py-3 text-center" style={{ color: 'var(--text-faint)' }}>
        Skip for now — I'll connect later
      </button>
    </div>
  );
}

function PrioritiesStep({ onNext }: { onNext: () => void }) {
  const [priorities, setPriorities] = useState(['', '', '']);
  const [loading, setLoading] = useState(false);
  const [suggesting, setSuggesting] = useState(true);

  useEffect(() => {
    fetch('/api/onboarding/suggest-priorities')
      .then(r => r.json())
      .then(d => {
        if (d.priorities?.length) {
          const filled = [...d.priorities, '', '', ''].slice(0, 3);
          setPriorities(filled);
        }
      })
      .finally(() => setSuggesting(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const filled = priorities.filter(p => p.trim());
    if (!filled.length) return;
    setLoading(true);

    await fetch('/api/onboarding/priorities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priorities: filled }),
    });

    setLoading(false);
    onNext();
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2">This week's top priorities</h2>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
        EDG3 will check every briefing to make sure your calendar and actions actually reflect these.
      </p>

      {suggesting ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, fontSize: 14, color: 'var(--edg-indigo)' }}>
          <span style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid var(--edg-indigo)', borderTopColor: 'transparent', display: 'inline-block' }} className="animate-spin" />
          Generating suggestions from your profile…
        </div>
      ) : priorities.some(p => p.trim()) && (
        <div className="flex items-center gap-2 mb-4 text-xs px-3 py-2 rounded-lg"
          style={{ background: 'var(--edg-accent-08)', color: 'var(--text-accent)', border: '1px solid var(--edg-accent-15)' }}>
          ✦ Suggested from your profile — edit freely
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {priorities.map((p, i) => (
          <div key={i}>
            <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--edg-indigo)' }}>
              PRIORITY #{i + 1}
            </label>
            <input
              className="input"
              type="text"
              placeholder={
                i === 0 ? 'e.g. Build AI startup' :
                i === 1 ? 'e.g. Improve fitness' :
                'e.g. Move to Hong Kong'
              }
              value={p}
              onChange={e => {
                const next = [...priorities];
                next[i] = e.target.value;
                setPriorities(next);
              }}
            />
          </div>
        ))}

        <button
          type="submit"
          className="btn-primary w-full mt-2"
          disabled={loading || !priorities.some(p => p.trim())}
        >
          {loading ? 'Saving…' : 'Set priorities & continue →'}
        </button>
      </form>
    </div>
  );
}

function CallTimeStep({ onNext }: { onNext: () => void }) {
  const [callTime, setCallTime] = useState('07:00');
  const [timezone, setTimezone] = useState('America/New_York');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);

  const timezones = [
    { label: 'Vancouver / Los Angeles (PT)', value: 'America/Vancouver' },
    { label: 'Denver (MT)', value: 'America/Denver' },
    { label: 'Chicago (CT)', value: 'America/Chicago' },
    { label: 'New York / Toronto (ET)', value: 'America/New_York' },
    { label: 'São Paulo (BRT)', value: 'America/Sao_Paulo' },
    { label: 'London (GMT)', value: 'Europe/London' },
    { label: 'Paris / Berlin (CET)', value: 'Europe/Paris' },
    { label: 'Cairo (EET)', value: 'Africa/Cairo' },
    { label: 'Dubai (GST)', value: 'Asia/Dubai' },
    { label: 'Mumbai (IST)', value: 'Asia/Kolkata' },
    { label: 'Bangkok (ICT)', value: 'Asia/Bangkok' },
    { label: 'Hong Kong / Singapore (HKT)', value: 'Asia/Hong_Kong' },
    { label: 'Tokyo (JST)', value: 'Asia/Tokyo' },
    { label: 'Sydney (AEST)', value: 'Australia/Sydney' },
    { label: 'Auckland (NZST)', value: 'Pacific/Auckland' },
  ];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    await fetch('/api/onboarding/call-time', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call_time: callTime, timezone, phone_number: `+1${phone}` }),
    });

    setLoading(false);
    onNext();
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2">Schedule your morning call</h2>
      <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>
        EDG3 will call you at this time every morning. Pick a time when you're alert and can give it 3 minutes.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Call time</label>
          <input
            className="input"
            type="time"
            value={callTime}
            onChange={e => setCallTime(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Timezone</label>
          <select
            className="input"
            style={{ background: 'var(--edg-bg-select)', color: 'var(--text-strong)' }}
            value={timezone}
            onChange={e => setTimezone(e.target.value)}
          >
            {timezones.map(tz => (
              <option key={tz.value} value={tz.value} style={{ background: 'var(--edg-bg-select)', color: 'var(--text-strong)' }}>{tz.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
            Phone number
          </label>
          <div className="flex gap-2">
            <div className="input flex items-center px-3 text-sm font-semibold flex-shrink-0"
              style={{ width: '64px', color: 'var(--text-strong)', background: 'rgba(255,255,255,0.04)', cursor: 'default' }}>
              +1
            </div>
            <input
              className="input flex-1"
              type="tel"
              placeholder="(555) 000-0000"
              value={phone}
              onChange={e => {
                const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                setPhone(digits);
              }}
              required
            />
          </div>
          <p className="text-xs mt-2" style={{ color: 'var(--text-faint)' }}>
            US &amp; Canada only. Edg3 will call you here every morning.
          </p>
          <p className="text-xs mt-3 leading-relaxed" style={{ color: 'var(--text-faint)' }}>
            By entering your number, you consent to receive one automated AI voice call and reminder text per day from Edg3.
            Message and data rates may apply. You can opt out anytime from your dashboard.{' '}
            <a href="/terms" target="_blank" style={{ color: 'var(--edg-indigo)', textDecoration: 'underline' }}>Terms</a> &amp; <a href="/privacy" target="_blank" style={{ color: 'var(--edg-indigo)', textDecoration: 'underline' }}>Privacy Policy</a>.
          </p>
        </div>

        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? 'Finalizing setup…' : 'Complete setup →'}
        </button>
      </form>
    </div>
  );
}

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>('profile');

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (!d.id) router.push('/login');
      else if (d.onboarding_complete) router.push('/dashboard');
    });
  }, [router]);

  useEffect(() => {
    const stepParam = searchParams.get('step') as Step | null;
    if (stepParam && STEPS.includes(stepParam)) setStep(stepParam);
  }, [searchParams]);

  function advance() {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) {
      setStep(STEPS[idx + 1]);
    } else {
      sessionStorage.setItem('edg3_welcome', '1');
      router.push('/dashboard');
    }
  }

  if (step === 'done') {
    router.push('/dashboard');
    return null;
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center px-4 py-8 md:py-16" style={{ background: 'var(--background)' }}>
      <div className="orb orb-1" />
      <div className="orb orb-2" />

      <div className="relative z-10 w-full max-w-lg">
        <div className="text-center mb-8">
          <span className="logo-text text-2xl">EDG3</span>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Setup · {STEPS.indexOf(step) + 1} of {STEPS.length}</p>
        </div>

        <div className="glass-card p-5 md:p-8">
          <StepIndicator current={step} />

          {step === 'profile' && <ProfileStep onNext={advance} />}
          {step === 'calendar' && <CalendarStep onNext={advance} onSkip={advance} />}
          {step === 'priorities' && <PrioritiesStep onNext={advance} />}
          {step === 'calltime' && <CallTimeStep onNext={advance} />}
        </div>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingContent />
    </Suspense>
  );
}
