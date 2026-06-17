'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Logo } from '@/components/ui';

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: '', name: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error || 'Something went wrong');
      return;
    }

    router.push('/onboarding');
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center px-4" style={{ background: 'var(--surface-page)' }}>
      <div className="orb orb-1" />
      <div className="orb orb-2" />

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/"><Logo size={28} eyebrow /></Link>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>Create your account</p>
        </div>

        <div className="glass-card p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="signup-name" className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Full name</label>
              <input id="signup-name" className="input" type="text" autoComplete="name"
                placeholder="Your name" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
            </div>
            <div>
              <label htmlFor="signup-email" className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Email</label>
              <input id="signup-email" className="input" type="email" autoComplete="email"
                placeholder="you@example.com" value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
            </div>
            <div>
              <label htmlFor="signup-password" className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Password</label>
              <input id="signup-password" className="input" type="password" autoComplete="new-password"
                placeholder="At least 8 characters" value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required minLength={8} />
            </div>

            {error && (
              <p className="text-sm px-3 py-2 rounded-lg" style={{ background: 'var(--edg-danger-tint)', color: 'var(--edg-danger)' }}>
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary w-full mt-2" disabled={loading}>
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <p className="text-center text-sm mt-6" style={{ color: 'var(--text-muted)' }}>
            Already have an account?{' '}
            <Link href="/login" style={{ color: 'var(--text-accent)' }}>Log in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
