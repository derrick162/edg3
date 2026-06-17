'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type Step = 'profile' | 'calendar' | 'priorities' | 'calltime' | 'done';

const STEPS: Step[] = ['profile', 'calendar', 'priorities', 'calltime'];

// ── Step indicator ────────────────────────────────────────────────────────────

const STEP_META: { label: string; icon: string }[] = [
  { label: 'About you',  icon: '👤' },
  { label: 'Calendar',   icon: '📅' },
  { label: 'Focus',      icon: '🎯' },
  { label: 'Your call',  icon: '📞' },
];

function StepIndicator({ current }: { current: Step }) {
  const idx = STEPS.indexOf(current);
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((s, i) => (
        <div key={s} className="flex items-center flex-1 last:flex-none">
          {/* Node */}
          <div className="flex flex-col items-center gap-1">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300"
              style={{
                background: i < idx
                  ? 'var(--edg-indigo)'
                  : i === idx
                  ? 'var(--edg-accent-20)'
                  : 'var(--edg-fill-04)',
                border: i === idx
                  ? '2px solid var(--edg-indigo)'
                  : '2px solid transparent',
                color: i < idx ? '#fff' : i === idx ? 'var(--text-strong)' : 'var(--text-faint)',
                boxShadow: i === idx ? '0 0 0 4px var(--edg-accent-08)' : 'none',
              }}
            >
              {i < idx ? '✓' : STEP_META[i].icon}
            </div>
            <span
              className="text-xs hidden sm:block text-center"
              style={{ color: i === idx ? 'var(--text-accent)' : 'var(--text-faint)', fontWeight: i === idx ? 600 : 400 }}
            >
              {STEP_META[i].label}
            </span>
          </div>
          {/* Connector */}
          {i < STEPS.length - 1 && (
            <div
              className="flex-1 h-px mx-2 transition-all duration-500"
              style={{ background: i < idx ? 'var(--edg-indigo)' : 'var(--edg-hairline)', marginBottom: 18 }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Step transition wrapper ───────────────────────────────────────────────────

function StepFade({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 20);
    return () => clearTimeout(t);
  }, []);
  return (
    <div
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(8px)',
        transition: 'opacity 0.3s ease, transform 0.3s ease',
      }}
    >
      {children}
    </div>
  );
}

// ── Example profile ───────────────────────────────────────────────────────────

const EXAMPLE_PROFILE = `Current situation: Recently laid off from a corporate role in San Francisco. Reassessing career direction, exploring entrepreneurship, learning AI. Mix of relief, fear, and excitement — this is the beginning of reinvention, not failure.

Goals (next 12 months): Build financial independence through consulting and AI services. Replace corporate income ($5–10k/month by month 6). Create multiple income streams nobody can take away. Develop AI leverage — not as an engineer, but as someone who can identify problems and deploy solutions.

Strengths: Deep corporate experience (stakeholder management, project coordination, customer relationships). Strong communicator — can run meetings, present ideas, build trust. Empathy for customer pain points from years inside organizations. Geographic advantage: based in San Francisco with access to founders, engineers, and early adopters.

Weaknesses / self-sabotage patterns: Seeking permission before acting — waiting for someone to assign the opportunity. Consuming more than creating (courses, tutorials, research) without selling anything. Tendency to underprice services. Identity still partly attached to job title and employer brand.

Opportunities: AI workflow consulting for law firms, agencies, and recruiters. Fractional operations partner (process improvement, automation, retainers). Build publicly — share AI experiments and case studies to create inbound.

Health: Needs to prioritize sleep, daily movement, and social connection during this transition. Burnout is not a business strategy.

Chief of Staff priority: First paying client before first business plan. First $1k earned independently matters more than any pitch deck.`;

// ── Step 1: Profile ───────────────────────────────────────────────────────────

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
    <StepFade>
      <h2 className="text-2xl font-bold mb-1">Let Edge get to know you</h2>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
        The more context you share, the sharper your briefings become from day one.
      </p>

      {/* ChatGPT prompt instruction */}
      <div
        className="rounded-xl p-4 mb-5"
        style={{ background: 'var(--edg-accent-08)', border: '1px solid var(--edg-accent-20)' }}
      >
        <p className="text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-accent)', letterSpacing: '0.08em' }}>
          Get your profile from ChatGPT
        </p>
        <p className="text-xs mb-3 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Open ChatGPT (or whatever AI tool knows you best) and paste this prompt — works best if you have prior conversations:
        </p>
        <div
          className="rounded-lg p-3 text-xs font-mono leading-relaxed select-all cursor-text"
          style={{ background: 'var(--edg-overlay)', color: 'var(--text-body)', userSelect: 'all' }}
        >
          &quot;Summarize everything you know about me including goals, projects, strengths, weaknesses, recurring challenges, opportunities, financial goals, health goals, relationship goals, and areas where I may be self-sabotaging. Format as a briefing for a Chief of Staff.&quot;
        </div>
      </div>

      {/* Example toggle */}
      <div className="mb-4">
        <button
          type="button"
          onClick={() => setShowExample(e => !e)}
          className="flex items-center gap-1.5 text-xs font-medium transition-opacity hover:opacity-80"
          style={{ color: 'var(--text-accent)' }}
        >
          <span
            style={{
              display: 'inline-block',
              transform: showExample ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
            }}
          >
            ▶
          </span>
          See an example profile
        </button>
        {showExample && (
          <div
            className="mt-3 rounded-xl p-4 text-xs leading-relaxed whitespace-pre-wrap"
            style={{
              background: 'var(--edg-overlay)',
              color: 'var(--text-muted)',
              border: '1px solid var(--edg-accent-15)',
              maxHeight: '200px',
              overflowY: 'auto',
              animation: 'score-rise 0.2s ease both',
            }}
          >
            {EXAMPLE_PROFILE}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit}>
        <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-faint)', letterSpacing: '0.08em' }}>
          Paste your summary here
        </label>
        <textarea
          className="input"
          style={{ minHeight: 'clamp(120px, 30vw, 180px)', fontSize: 13 }}
          placeholder="Paste your full ChatGPT summary here — goals, strengths, current challenges, what you're working toward…"
          value={summary}
          onChange={e => setSummary(e.target.value)}
          required
        />
        {error && <p className="text-xs mt-2" style={{ color: 'var(--edg-danger)' }}>{error}</p>}
        <button
          type="submit"
          className="btn-primary w-full mt-4"
          disabled={loading || !summary.trim()}
        >
          {loading ? 'Edge is reading your profile…' : 'Save & continue →'}
        </button>
      </form>
    </StepFade>
  );
}

// ── Step 2: Calendar ──────────────────────────────────────────────────────────

function CalendarStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.data === 'calendar_connected') {
        setConnected(true);
        // Brief celebration before auto-advancing
        setTimeout(() => onNext(), 1400);
      }
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
    if (!popup) window.location.href = data.url;
  }

  // Connected celebration state
  if (connected) {
    return (
      <StepFade>
        <div className="text-center py-8">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-2xl mx-auto mb-4"
            style={{
              background: 'rgba(34,197,94,0.12)',
              border: '2px solid rgba(34,197,94,0.3)',
              boxShadow: '0 0 24px rgba(34,197,94,0.2)',
              animation: 'pop-in 0.4s ease both',
            }}
          >
            ✓
          </div>
          <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--text-strong)' }}>
            Calendar connected
          </h3>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Edge can now see your schedule and help you align your day.
          </p>
        </div>
      </StepFade>
    );
  }

  return (
    <StepFade>
      <h2 className="text-2xl font-bold mb-1">Connect your calendar</h2>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
        Edge reads your schedule to spot conflicts, score your day, and suggest what to move or block.
      </p>

      <div
        className="rounded-xl p-5 mb-3"
        style={{ background: 'var(--rec-area-bg)', border: '1px solid var(--rec-area-border)' }}
      >
        <div className="flex items-start gap-3 mb-4">
          <span
            className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-xl"
            style={{ background: 'var(--edg-accent-08)', border: '1px solid var(--edg-accent-20)' }}
          >
            📅
          </span>
          <div>
            <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--text-strong)' }}>Google Calendar</p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Edge reads events, helps you create or move them on calls, and scores how well your day aligns with your priorities.
            </p>
          </div>
        </div>
        <button className="btn-primary w-full" onClick={connectCalendar} disabled={loading}>
          {loading ? 'Connecting…' : 'Connect Google Calendar'}
        </button>
        {error && <p className="text-xs mt-3 text-center" style={{ color: 'var(--edg-warning)' }}>{error}</p>}
      </div>

      {/* What else connects later */}
      <div
        className="rounded-xl px-4 py-3 mb-4 flex items-start gap-2"
        style={{ background: 'var(--edg-fill-04)', border: '1px solid var(--edg-hairline)' }}
      >
        <span className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>ℹ</span>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-faint)' }}>
          You can also connect Gmail and Whoop from your dashboard after setup — Edge uses those to track email threads and your recovery score.
        </p>
      </div>

      <button onClick={onSkip} className="w-full text-xs py-2.5 text-center transition-opacity hover:opacity-80" style={{ color: 'var(--text-faint)' }}>
        Skip for now — I&apos;ll connect later
      </button>
    </StepFade>
  );
}

// ── Step 3: Priorities ────────────────────────────────────────────────────────

function PrioritiesStep({ onNext }: { onNext: () => void }) {
  const [priorities, setPriorities] = useState(['', '', '']);
  const [loading, setLoading] = useState(false);
  const [suggesting, setSuggesting] = useState(true);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/onboarding/suggest-priorities')
      .then(r => r.json())
      .then(d => {
        if (d.priorities?.length) {
          const filled = [...d.priorities, '', '', ''].slice(0, 3);
          setPriorities(filled);
          setSuggestionsLoaded(true);
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

  const rankLabels = ['Primary', 'Secondary', 'Third'];
  const placeholders = [
    'e.g. Extend my runway to 18 months',
    'e.g. Get to 135 lbs',
    'e.g. Ship Edg3 MVP by September',
  ];

  return (
    <StepFade>
      <h2 className="text-2xl font-bold mb-1">What matters most right now?</h2>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
        Edge checks every briefing to make sure your calendar actually reflects these — not just your intentions.
      </p>

      {suggesting ? (
        <div
          className="flex items-center gap-3 mb-5 px-4 py-3 rounded-xl text-sm"
          style={{ background: 'var(--edg-accent-08)', border: '1px solid var(--edg-accent-20)', color: 'var(--text-accent)' }}
        >
          <span className="w-4 h-4 rounded-full border-2 flex-shrink-0 animate-spin"
            style={{ borderColor: 'var(--edg-indigo)', borderTopColor: 'transparent' }}
          />
          Edge is reading your profile and generating suggestions…
        </div>
      ) : suggestionsLoaded ? (
        <div
          className="flex items-center gap-2 mb-5 px-3 py-2 rounded-lg text-xs"
          style={{ background: 'var(--edg-accent-08)', border: '1px solid var(--edg-accent-15)', color: 'var(--text-accent)', animation: 'score-rise 0.3s ease both' }}
        >
          ✦ Suggested from your profile — edit freely
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-3">
        {priorities.map((p, i) => (
          <div key={i} className="flex items-center gap-3">
            {/* Rank badge */}
            <div
              className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
              style={{
                background: p.trim() ? 'var(--edg-accent-20)' : 'var(--edg-fill-04)',
                color: p.trim() ? 'var(--text-accent)' : 'var(--text-faint)',
                border: '1px solid var(--edg-hairline)',
                transition: 'background 0.2s, color 0.2s',
              }}
            >
              {i + 1}
            </div>
            <div className="flex-1 min-w-0">
              <input
                className="input text-sm"
                type="text"
                placeholder={placeholders[i]}
                value={p}
                onChange={e => {
                  const next = [...priorities];
                  next[i] = e.target.value;
                  setPriorities(next);
                }}
              />
              <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>{rankLabels[i]}</p>
            </div>
          </div>
        ))}

        <button
          type="submit"
          className="btn-primary w-full mt-4"
          disabled={loading || !priorities.some(p => p.trim())}
        >
          {loading ? 'Saving…' : 'Set my focus & continue →'}
        </button>
      </form>
    </StepFade>
  );
}

// ── Step 4: Call time ─────────────────────────────────────────────────────────

function CallTimeStep({ onNext }: { onNext: () => void }) {
  const [callTime, setCallTime] = useState('07:00');
  const [timezone, setTimezone] = useState('America/New_York');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);

  const timezones = [
    { label: 'Vancouver / Los Angeles (PT)', value: 'America/Vancouver' },
    { label: 'Denver (MT)',                  value: 'America/Denver' },
    { label: 'Chicago (CT)',                 value: 'America/Chicago' },
    { label: 'New York / Toronto (ET)',      value: 'America/New_York' },
    { label: 'São Paulo (BRT)',              value: 'America/Sao_Paulo' },
    { label: 'London (GMT)',                 value: 'Europe/London' },
    { label: 'Paris / Berlin (CET)',         value: 'Europe/Paris' },
    { label: 'Cairo (EET)',                  value: 'Africa/Cairo' },
    { label: 'Dubai (GST)',                  value: 'Asia/Dubai' },
    { label: 'Mumbai (IST)',                 value: 'Asia/Kolkata' },
    { label: 'Bangkok (ICT)',                value: 'Asia/Bangkok' },
    { label: 'Hong Kong / Singapore (HKT)', value: 'Asia/Hong_Kong' },
    { label: 'Tokyo (JST)',                  value: 'Asia/Tokyo' },
    { label: 'Sydney (AEST)',                value: 'Australia/Sydney' },
    { label: 'Auckland (NZST)',              value: 'Pacific/Auckland' },
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
    <StepFade>
      <h2 className="text-2xl font-bold mb-1">When should Edge call?</h2>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
        Pick a time when you&apos;re awake and have 3 minutes. Edge calls you every morning with what matters today.
      </p>

      {/* Preview of what the call is */}
      <div
        className="rounded-xl p-4 mb-6 flex items-start gap-3"
        style={{ background: 'var(--edg-fill-04)', border: '1px solid var(--edg-hairline)' }}
      >
        <span className="text-xl flex-shrink-0">📞</span>
        <div>
          <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-strong)' }}>What to expect</p>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-faint)' }}>
            A 3-minute voice call. Edge reviews your day, flags what needs attention, and can move or create calendar events while you talk. You can call Edge anytime too.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-faint)', letterSpacing: '0.08em' }}>
              Call time
            </label>
            <input
              className="input"
              type="time"
              value={callTime}
              onChange={e => setCallTime(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-faint)', letterSpacing: '0.08em' }}>
              Timezone
            </label>
            <select
              className="input"
              style={{ background: 'var(--edg-bg-select)', color: 'var(--text-strong)' }}
              value={timezone}
              onChange={e => setTimezone(e.target.value)}
            >
              {timezones.map(tz => (
                <option key={tz.value} value={tz.value}
                  style={{ background: 'var(--edg-bg-select)', color: 'var(--text-strong)' }}
                >
                  {tz.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-faint)', letterSpacing: '0.08em' }}>
            Phone number
          </label>
          <div className="flex gap-2">
            <div
              className="input flex items-center px-3 text-sm font-semibold flex-shrink-0"
              style={{ width: '56px', color: 'var(--text-strong)', background: 'var(--edg-fill-04)', cursor: 'default' }}
            >
              +1
            </div>
            <input
              className="input flex-1"
              type="tel"
              inputMode="tel"
              placeholder="(555) 000-0000"
              value={phone}
              onChange={e => {
                const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                setPhone(digits);
              }}
              required
            />
          </div>
          <p className="text-xs mt-1.5" style={{ color: 'var(--text-faint)' }}>
            US &amp; Canada only. Edge calls you here each morning.
          </p>
        </div>

        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-faint)' }}>
          By entering your number, you consent to receive one automated AI voice call per day from Edg3.
          Message and data rates may apply. Opt out anytime from your dashboard.{' '}
          <a href="/terms" target="_blank" style={{ color: 'var(--edg-indigo)', textDecoration: 'underline' }}>Terms</a>
          {' '}&amp;{' '}
          <a href="/privacy" target="_blank" style={{ color: 'var(--edg-indigo)', textDecoration: 'underline' }}>Privacy</a>.
        </p>

        <button type="submit" className="btn-primary w-full" disabled={loading || phone.length < 10}>
          {loading ? 'Setting up your account…' : "I'm ready — let's go →"}
        </button>
      </form>
    </StepFade>
  );
}

// ── Page shell ────────────────────────────────────────────────────────────────

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

  const stepIdx = STEPS.indexOf(step);

  return (
    <div
      className="min-h-screen relative flex items-center justify-center px-4 py-8 md:py-16"
      style={{ background: 'var(--background)' }}
    >
      <div className="orb orb-1" />
      <div className="orb orb-2" />

      <div className="relative z-10 w-full max-w-lg">
        {/* Brand + progress */}
        <div className="text-center mb-6">
          <span className="logo-text text-2xl">EDG3</span>
          <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
            Step {stepIdx + 1} of {STEPS.length}
          </p>
        </div>

        <div className="glass-card p-5 md:p-8">
          <StepIndicator current={step} />

          {step === 'profile'   && <ProfileStep   onNext={advance} />}
          {step === 'calendar'  && <CalendarStep  onNext={advance} onSkip={advance} />}
          {step === 'priorities'&& <PrioritiesStep onNext={advance} />}
          {step === 'calltime'  && <CallTimeStep  onNext={advance} />}
        </div>

        {/* Bottom reassurance */}
        <p className="text-center text-xs mt-4" style={{ color: 'var(--text-faint)' }}>
          You can update any of this from your dashboard later.
        </p>
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
