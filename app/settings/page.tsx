'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface ProfileData {
  name: string;
  email: string;
  call_time: string;
  timezone: string;
}

interface AccountsData {
  calendar?: { connected: boolean; email?: string };
  whoop?: { connected: boolean };
}

export default function SettingsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [accounts, setAccounts] = useState<AccountsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [gratitudeMode, setGratitudeMode] = useState(false);
  const [gratitudeSaved, setGratitudeSaved] = useState(false);
  const [language, setLanguage] = useState('en');
  const [languageSaved, setLanguageSaved] = useState(false);
  const [quoteEnabled, setQuoteEnabled] = useState(false);
  const [quoteTheme, setQuoteTheme] = useState('resilience');
  const [quoteSaved, setQuoteSaved] = useState(false);
  // R33 — work hours (so Edge never suggests booking work blocks outside them).
  const [workStart, setWorkStart] = useState(9);
  const [workEnd, setWorkEnd] = useState(18);
  const [workDays, setWorkDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [workSaved, setWorkSaved] = useState(false);
  const [workError, setWorkError] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/api/auth/me').then(r => r.ok ? r.json() : null),
      fetch('/api/auth/accounts').then(r => r.ok ? r.json() : null),
      fetch('/api/settings/gratitude-mode').then(r => r.ok ? r.json() : null),
      fetch('/api/settings/language').then(r => r.ok ? r.json() : null),
      fetch('/api/settings/gratitude-quote').then(r => r.ok ? r.json() : null),
      fetch('/api/profile/work-hours').then(r => r.ok ? r.json() : null),
    ]).then(([me, accts, gm, lang, quote, work]) => {
      if (!me) { router.push('/login'); return; }
      setProfile(me);
      setAccounts(accts);
      if (gm) setGratitudeMode(!!gm.gratitudeMode);
      if (lang) setLanguage(lang.language ?? 'en');
      if (quote) { setQuoteEnabled(!!quote.quoteEnabled); setQuoteTheme(quote.quoteTheme ?? 'resilience'); }
      if (work?.schedule) { setWorkStart(work.schedule.start); setWorkEnd(work.schedule.end); setWorkDays(work.schedule.days); }
    }).catch(() => router.push('/login'))
      .finally(() => setLoading(false));
  }, [router]);

  async function handleGratitudeToggle() {
    const next = !gratitudeMode;
    setGratitudeMode(next);
    fetch('/api/settings/gratitude-mode', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    }).then(r => {
      if (r.ok) { setGratitudeSaved(true); setTimeout(() => setGratitudeSaved(false), 2000); }
      else setGratitudeMode(!next);
    }).catch(() => setGratitudeMode(!next));
  }

  function handleLanguageChange(lang: 'en' | 'yue') {
    setLanguage(lang);
    fetch('/api/settings/language', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: lang }),
    }).then(r => {
      if (r.ok) { setLanguageSaved(true); setTimeout(() => setLanguageSaved(false), 2000); }
      else setLanguage(lang === 'en' ? 'yue' : 'en');
    }).catch(() => setLanguage(lang === 'en' ? 'yue' : 'en'));
  }

  function handleQuoteToggle() {
    const next = !quoteEnabled;
    setQuoteEnabled(next);
    fetch('/api/settings/gratitude-quote', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next, theme: quoteTheme }),
    }).then(r => {
      if (r.ok) { setQuoteSaved(true); setTimeout(() => setQuoteSaved(false), 2000); }
      else setQuoteEnabled(!next);
    }).catch(() => setQuoteEnabled(!next));
  }

  function handleThemeBlur() {
    if (!quoteEnabled) return;
    fetch('/api/settings/gratitude-quote', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: quoteEnabled, theme: quoteTheme }),
    }).then(r => {
      if (r.ok) { setQuoteSaved(true); setTimeout(() => setQuoteSaved(false), 2000); }
    }).catch(() => {});
  }

  function toggleWorkDay(d: number) {
    setWorkDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort((a, b) => a - b));
  }

  async function handleSaveWorkHours() {
    setWorkError('');
    if (workEnd <= workStart) { setWorkError('End time must be after start time.'); return; }
    if (workDays.length === 0) { setWorkError('Pick at least one work day.'); return; }
    try {
      const r = await fetch('/api/profile/work-hours', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: workStart, end: workEnd, days: workDays }),
      });
      if (r.ok) { setWorkSaved(true); setTimeout(() => setWorkSaved(false), 2000); }
      else { const d = await r.json().catch(() => ({})); setWorkError(d.error ?? 'Could not save.'); }
    } catch { setWorkError('Network error. Please try again.'); }
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError('');
    try {
      const r = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'delete my account' }),
      });
      if (r.ok) {
        router.push('/login');
      } else {
        const d = await r.json().catch(() => ({}));
        setDeleteError(d.error ?? 'Deletion failed. Please try again.');
        setDeleteConfirm(false);
      }
    } catch {
      setDeleteError('Network error. Please try again.');
      setDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  }

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--surface-page)' }}>
        <div className="w-7 h-7 border-2 spinner animate-spin" />
      </div>
    );
  }

  const fmtTime = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  };

  return (
    <div className="min-h-screen relative" style={{ background: 'var(--surface-page)' }}>
      <div className="orb orb-1" />
      <div className="orb orb-2" />

      <div className="relative z-10 max-w-[540px] mx-auto px-6 py-12">
        {/* Nav */}
        <div className="flex items-center gap-3 mb-10">
          <Link href="/dashboard" className="text-xs" style={{ color: 'var(--text-faint)' }}>
            ← Dashboard
          </Link>
          <span style={{ color: 'var(--edg-hairline)' }}>/</span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Settings</span>
        </div>

        <h1 className="text-2xl font-black mb-8">Settings</h1>

        <div className="space-y-4">

          {/* 0 — Morning ritual */}
          <section className="glass-card p-6 space-y-4">
            <p className="label-caps flex items-center gap-2">
              <span style={{ color: 'var(--text-faint)' }}>✦</span>
              Morning ritual
            </p>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-strong)' }}>Gratitude mode</p>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  Your open call becomes a 3-minute check-in — date, weather, and what you&apos;re grateful for. No tasks, no calendar.
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <label className="toggle mt-0.5">
                  <input type="checkbox" checked={gratitudeMode} onChange={handleGratitudeToggle} />
                  <span className="toggle-track"><span className="toggle-thumb" /></span>
                </label>
                {gratitudeSaved && <span className="text-xs" style={{ color: 'var(--edg-green, #4ade80)' }}>Saved ✓</span>}
              </div>
            </div>
            {gratitudeMode && (
              <div className="pl-2 border-l-2 space-y-3" style={{ borderColor: 'var(--edg-hairline)' }}>
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Daily quote</p>
                  <div className="flex flex-col items-end gap-1">
                    <label className="toggle" style={{ width: 34, height: 18 }}>
                      <input type="checkbox" checked={quoteEnabled} onChange={handleQuoteToggle} />
                      <span className="toggle-track"><span className="toggle-thumb" /></span>
                    </label>
                    {quoteSaved && <span className="text-xs" style={{ color: 'var(--edg-green, #4ade80)' }}>Saved ✓</span>}
                  </div>
                </div>
                {quoteEnabled && (
                  <div>
                    <p className="text-xs mb-1" style={{ color: 'var(--text-faint)' }}>Quote theme</p>
                    <input
                      className="input w-full text-xs"
                      placeholder="e.g. rebuilding, resilience, new beginnings"
                      maxLength={100}
                      value={quoteTheme}
                      onChange={e => setQuoteTheme(e.target.value)}
                      onBlur={handleThemeBlur}
                    />
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Language */}
          <section className="glass-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <p className="label-caps">Language</p>
              {languageSaved && <span className="text-xs" style={{ color: 'var(--edg-green, #4ade80)' }}>Saved ✓</span>}
            </div>
            <div className="flex gap-2">
              {(['en', 'yue'] as const).map(lang => (
                <button
                  key={lang}
                  onClick={() => handleLanguageChange(lang)}
                  className="rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
                  style={{
                    background: language === lang ? 'var(--edg-accent, var(--edg-indigo))' : 'var(--edg-fill-04)',
                    color: language === lang ? '#fff' : 'var(--text-muted)',
                  }}
                >
                  {lang === 'en' ? 'English' : '廣東話'}
                </button>
              ))}
            </div>
          </section>

          {/* Work hours */}
          <section className="glass-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <p className="label-caps">Work hours</p>
              {workSaved && <span className="text-xs" style={{ color: 'var(--edg-green, #4ade80)' }}>Saved ✓</span>}
            </div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Edge won&apos;t suggest blocking work time outside these hours — after hours, it offers the next work day instead.
            </p>
            <div className="flex items-center gap-3">
              <div>
                <p className="text-xs mb-1" style={{ color: 'var(--text-faint)' }}>Start</p>
                <select className="input text-sm" value={workStart} onChange={e => setWorkStart(Number(e.target.value))}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>{(h % 12 || 12)} {h < 12 ? 'AM' : 'PM'}</option>
                  ))}
                </select>
              </div>
              <div>
                <p className="text-xs mb-1" style={{ color: 'var(--text-faint)' }}>End</p>
                <select className="input text-sm" value={workEnd} onChange={e => setWorkEnd(Number(e.target.value))}>
                  {Array.from({ length: 24 }, (_, i) => i + 1).map(h => (
                    <option key={h} value={h}>{(h % 12 || 12)} {h < 12 || h === 24 ? 'AM' : 'PM'}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <p className="text-xs mb-1.5" style={{ color: 'var(--text-faint)' }}>Work days</p>
              <div className="flex gap-1.5 flex-wrap">
                {([[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']] as const).map(([d, label]) => (
                  <button
                    key={d}
                    onClick={() => toggleWorkDay(d)}
                    className="rounded-full px-3 py-1 text-xs font-medium transition-colors"
                    style={{
                      background: workDays.includes(d) ? 'var(--edg-accent, var(--edg-indigo))' : 'var(--edg-fill-04)',
                      color: workDays.includes(d) ? '#fff' : 'var(--text-muted)',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {workError && <p className="text-xs" style={{ color: 'var(--edg-danger)' }}>{workError}</p>}
            <button
              onClick={handleSaveWorkHours}
              className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
              style={{ background: 'var(--edg-accent, var(--edg-indigo))', color: '#fff' }}
            >
              Save work hours
            </button>
          </section>

          {/* 1 — Profile */}
          <section className="glass-card p-6 space-y-4">
            <p className="label-caps">Profile</p>
            <div className="space-y-3">
              <div>
                <p className="text-xs mb-1" style={{ color: 'var(--text-faint)' }}>Name</p>
                <p className="text-sm font-medium" style={{ color: 'var(--text-strong)' }}>{profile.name || '—'}</p>
              </div>
              <div>
                <p className="text-xs mb-1" style={{ color: 'var(--text-faint)' }}>Email</p>
                <p className="text-sm" style={{ color: 'var(--text-body)' }}>{profile.email || '—'}</p>
              </div>
            </div>
          </section>

          {/* 2 — Morning call */}
          <section className="glass-card p-6 space-y-3">
            <p className="label-caps">Morning call</p>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs mb-1" style={{ color: 'var(--text-faint)' }}>Scheduled time</p>
                <p className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>
                  {fmtTime(profile.call_time)} · {profile.timezone.split('/').pop()?.replace('_', ' ')}
                </p>
              </div>
              <Link
                href="/onboarding?step=call-time"
                className="text-xs font-medium"
                style={{ color: 'var(--text-accent)' }}
              >
                Change →
              </Link>
            </div>
          </section>

          {/* 3 — Connections */}
          <section className="glass-card p-6 space-y-3">
            <p className="label-caps">Connections</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: accounts?.calendar?.connected ? 'var(--edg-success)' : 'var(--text-faint)' }}>●</span>
                  <span className="text-sm" style={{ color: 'var(--text-body)' }}>Google Calendar</span>
                  {accounts?.calendar?.email && (
                    <span className="text-xs" style={{ color: 'var(--text-faint)' }}>{accounts.calendar.email}</span>
                  )}
                </div>
                <span className="text-xs" style={{ color: accounts?.calendar?.connected ? 'var(--edg-success)' : 'var(--text-faint)' }}>
                  {accounts?.calendar?.connected ? 'Connected' : 'Not connected'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: accounts?.whoop?.connected ? 'var(--edg-success)' : 'var(--text-faint)' }}>●</span>
                  <span className="text-sm" style={{ color: 'var(--text-body)' }}>Whoop</span>
                </div>
                <span className="text-xs" style={{ color: accounts?.whoop?.connected ? 'var(--edg-success)' : 'var(--text-faint)' }}>
                  {accounts?.whoop?.connected ? 'Connected' : 'Not connected'}
                </span>
              </div>
            </div>
            <Link href="/dashboard" className="text-xs" style={{ color: 'var(--text-accent)' }}>
              Manage in your dashboard →
            </Link>
          </section>

          {/* 4 — Your data */}
          <section className="glass-card p-6 space-y-3">
            <p className="label-caps">Your data</p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Download everything Edge knows about you — call history, memories, priorities, and facts — as a JSON file.
            </p>
            <a
              href="/api/account/export"
              download
              className="text-xs font-medium"
              style={{ color: 'var(--text-accent)', display: 'inline-block' }}
            >
              ↓ Download your data
            </a>
          </section>

          {/* 5 — Account / delete */}
          <section className="glass-card p-6 space-y-4" style={{ borderColor: 'var(--edg-danger-border)' }}>
            <p className="label-caps">Account</p>
            {!deleteConfirm ? (
              <div>
                <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                  Permanently delete your account and all associated data. This cannot be undone.
                </p>
                <button
                  onClick={() => setDeleteConfirm(true)}
                  className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
                  style={{
                    background: 'var(--edg-danger-tint)',
                    color: 'var(--edg-danger)',
                    border: '1px solid var(--edg-danger-border)',
                  }}
                >
                  Delete account
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs font-semibold" style={{ color: 'var(--edg-danger)' }}>
                  Are you sure? This will permanently delete all your data.
                </p>
                {deleteError && (
                  <p className="text-xs" style={{ color: 'var(--edg-danger)' }}>{deleteError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleDeleteAccount}
                    disabled={deleting}
                    className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
                    style={{
                      background: 'var(--edg-danger)',
                      color: '#fff',
                      opacity: deleting ? 0.6 : 1,
                    }}
                  >
                    {deleting ? 'Deleting…' : 'Yes, delete everything'}
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(false)}
                    className="text-xs px-4 py-2 rounded-lg"
                    style={{ color: 'var(--text-muted)', background: 'var(--edg-fill-04)' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>

        </div>
      </div>
    </div>
  );
}
