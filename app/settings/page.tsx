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

  useEffect(() => {
    Promise.all([
      fetch('/api/auth/me').then(r => r.ok ? r.json() : null),
      fetch('/api/auth/accounts').then(r => r.ok ? r.json() : null),
    ]).then(([me, accts]) => {
      if (!me) { router.push('/login'); return; }
      setProfile(me);
      setAccounts(accts);
    }).catch(() => router.push('/login'))
      .finally(() => setLoading(false));
  }, [router]);

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
