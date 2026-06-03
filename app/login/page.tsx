'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error || 'Invalid credentials');
      return;
    }

    router.push(data.onboarding_complete ? '/dashboard' : '/onboarding');
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center px-4" style={{ background: 'var(--background)' }}>
      <div className="orb orb-1" />
      <div className="orb orb-2" />

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="logo-text text-3xl">EDG3</Link>
          <p className="text-xs mt-1 mb-1" style={{ color: '#6366f1', letterSpacing: '0.08em' }}>ELITE DAILY GUIDANCE ENGINE</p>
          <p className="mt-2 text-sm" style={{ color: '#888899' }}>Welcome back</p>
        </div>

        <div className="glass-card p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: '#aaa' }}>Email</label>
              <input
                className="input"
                type="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: '#aaa' }}>Password</label>
              <input
                className="input"
                type="password"
                placeholder="Your password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                required
              />
            </div>

            {error && (
              <p className="text-sm px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary w-full mt-2" disabled={loading}>
              {loading ? 'Logging in…' : 'Log in'}
            </button>
          </form>

          <p className="text-center text-sm mt-6" style={{ color: '#888899' }}>
            Don't have an account?{' '}
            <Link href="/signup" style={{ color: '#818cf8' }}>Sign up</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
