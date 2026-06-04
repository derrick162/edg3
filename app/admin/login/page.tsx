'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error || 'Invalid password');
      return;
    }

    router.push('/admin');
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center px-4" style={{ background: 'var(--background)' }}>
      <div className="orb orb-1" />
      <div className="orb orb-2" />

      <div className="relative z-10 w-full max-w-sm">
        <div className="text-center mb-8">
          <span className="logo-text text-3xl">EDG3</span>
          <p className="text-xs mt-1" style={{ color: '#6366f1', letterSpacing: '0.1em' }}>ADMIN</p>
        </div>

        <div className="glass-card p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: '#aaa' }}>Admin Password</label>
              <input
                className="input"
                type="password"
                placeholder="Enter admin password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoFocus
              />
            </div>

            {error && (
              <p className="text-sm px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary w-full mt-2" disabled={loading}>
              {loading ? 'Authenticating…' : 'Access Admin'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
