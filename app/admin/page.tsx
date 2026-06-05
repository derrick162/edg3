'use client';

import { useState, useEffect, useCallback } from 'react';

interface LastBriefing {
  scheduled_for: string;
  status: string;
}

interface AdminUser {
  id: number;
  name: string;
  email: string;
  call_time: string;
  timezone: string;
  phone_number: string | null;
  onboarding_complete: number;
  created_at: string;
  last_briefing: LastBriefing | null;
  next_call: string | null;
  total_briefings: number;
  completed_briefings: number;
}

interface Stats {
  totalUsers: number;
  callsToday: number;
  completedToday: number;
  missedToday: number;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    completed: { cls: 'badge-success', label: 'Completed' },
    calling:   { cls: 'badge-pending', label: 'Calling' },
    failed:    { cls: 'badge-danger',  label: 'Failed' },
    missed:    { cls: 'badge-danger',  label: 'Missed' },
    pending:   { cls: 'badge-info',    label: 'Pending' },
  };
  const { cls, label } = map[status] || { cls: 'badge-info', label: status };
  return <span className={`badge ${cls}`}>{label}</span>;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

interface Briefing {
  id: number;
  user_id: number;
  status: string;
  scheduled_for: string;
  edge_promises: string | null;
  tool_actions: string | null;
  calendar_actions: string | null;
  user_response: string | null;
}

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggerLoading, setTriggerLoading] = useState<number | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<number | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  const loadBriefings = async (userId: number) => {
    setSelectedUserId(userId);
    const res = await fetch(`/api/admin/briefings?userId=${userId}&limit=10`);
    const data = await res.json();
    setBriefings(data.briefings || []);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const [uRes, sRes] = await Promise.all([
      fetch('/api/admin/users'),
      fetch('/api/admin/stats'),
    ]);
    if (uRes.ok) {
      const d = await uRes.json();
      setUsers(d.users);
    }
    if (sRes.ok) {
      const d = await sRes.json();
      setStats(d);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function triggerCall(userId: number) {
    setTriggerLoading(userId);
    setMessage(null);
    const res = await fetch('/api/admin/trigger-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    const data = await res.json();
    setTriggerLoading(null);
    if (res.ok) {
      setMessage({ text: 'Call triggered successfully', ok: true });
      load();
    } else {
      setMessage({ text: data.error || 'Failed to trigger call', ok: false });
    }
  }

  async function deleteUser(userId: number, name: string) {
    if (!confirm(`Delete user "${name}" and all their data? This cannot be undone.`)) return;
    setDeleteLoading(userId);
    setMessage(null);
    const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
    setDeleteLoading(null);
    if (res.ok) {
      setMessage({ text: `User "${name}" deleted`, ok: true });
      load();
    } else {
      const data = await res.json();
      setMessage({ text: data.error || 'Failed to delete user', ok: false });
    }
  }

  return (
    <div style={{ background: 'var(--background)', minHeight: '100vh', color: 'var(--foreground)' }}>
      <div className="orb orb-1" />
      <div className="orb orb-2" />

      <div className="relative z-10" style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 24px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
          <div>
            <span className="logo-text" style={{ fontSize: 28 }}>EDG3</span>
            <span style={{ marginLeft: 10, fontSize: 13, color: '#6366f1', letterSpacing: '0.12em', fontWeight: 700 }}>ADMIN</span>
          </div>
          <button
            onClick={load}
            className="btn-secondary"
            style={{ padding: '8px 18px', fontSize: 13 }}
          >
            Refresh
          </button>
        </div>

        {/* Message banner */}
        {message && (
          <div
            style={{
              marginBottom: 20,
              padding: '10px 16px',
              borderRadius: 10,
              fontSize: 14,
              background: message.ok ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
              color: message.ok ? '#10b981' : '#ef4444',
              border: `1px solid ${message.ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
            }}
          >
            {message.text}
          </div>
        )}

        {/* Stats bar */}
        {stats && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
            {[
              { label: 'Total Users', value: stats.totalUsers, color: '#818cf8' },
              { label: 'Calls Today', value: stats.callsToday, color: '#f59e0b' },
              { label: 'Completed Today', value: stats.completedToday, color: '#10b981' },
              { label: 'Missed Today', value: stats.missedToday, color: '#ef4444' },
            ].map(stat => (
              <div key={stat.label} className="glass-card" style={{ padding: '20px 24px' }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: stat.color }}>{stat.value}</div>
                <div style={{ fontSize: 12, color: '#888899', marginTop: 4 }}>{stat.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Users table */}
        <div className="glass-card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--card-border)' }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Users</h2>
          </div>

          {loading ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#888899' }}>Loading…</div>
          ) : users.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#888899' }}>No users found</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--card-border)' }}>
                    {['User', 'Phone', 'Call Time', 'Last Call', 'Next Call', 'Calls', 'Onboarding', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: '#888899', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map(user => (
                    <tr
                      key={user.id}
                      style={{ borderBottom: '1px solid var(--card-border)' }}
                    >
                      {/* User */}
                      <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 600 }}>{user.name}</div>
                        <div style={{ color: '#888899', fontSize: 12 }}>{user.email}</div>
                      </td>

                      {/* Phone */}
                      <td style={{ padding: '14px 16px', color: '#aaa', whiteSpace: 'nowrap' }}>
                        {user.phone_number || <span style={{ color: '#555' }}>—</span>}
                      </td>

                      {/* Call time */}
                      <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                        <div>{user.call_time || '—'}</div>
                        <div style={{ color: '#888899', fontSize: 11 }}>{user.timezone}</div>
                      </td>

                      {/* Last call */}
                      <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                        {user.last_briefing ? (
                          <>
                            <div style={{ marginBottom: 4 }}><StatusBadge status={user.last_briefing.status} /></div>
                            <div style={{ color: '#888899', fontSize: 11 }}>{formatDate(user.last_briefing.scheduled_for)}</div>
                          </>
                        ) : (
                          <span style={{ color: '#555' }}>—</span>
                        )}
                      </td>

                      {/* Next call */}
                      <td style={{ padding: '14px 16px', whiteSpace: 'nowrap', color: '#818cf8' }}>
                        {user.next_call || '—'}
                      </td>

                      {/* Calls count */}
                      <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                        <span style={{ color: '#10b981', fontWeight: 600 }}>{user.completed_briefings}</span>
                        <span style={{ color: '#555' }}> / </span>
                        <span>{user.total_briefings}</span>
                      </td>

                      {/* Onboarding */}
                      <td style={{ padding: '14px 16px' }}>
                        {user.onboarding_complete ? (
                          <span className="badge badge-success">Complete</span>
                        ) : (
                          <span className="badge badge-pending">Pending</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            onClick={() => loadBriefings(user.id)}
                            className="text-xs px-2 py-1 rounded"
                            style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' }}
                          >
                            📋 Calls
                          </button>
                          <button
                            onClick={() => triggerCall(user.id)}
                            disabled={triggerLoading === user.id}
                            style={{
                              background: 'rgba(99,102,241,0.15)',
                              color: '#818cf8',
                              border: '1px solid rgba(99,102,241,0.3)',
                              borderRadius: 8,
                              padding: '6px 12px',
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: triggerLoading === user.id ? 'not-allowed' : 'pointer',
                              opacity: triggerLoading === user.id ? 0.5 : 1,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {triggerLoading === user.id ? 'Calling…' : 'Call Now'}
                          </button>
                          <button
                            onClick={() => deleteUser(user.id, user.name)}
                            disabled={deleteLoading === user.id}
                            style={{
                              background: 'rgba(239,68,68,0.1)',
                              color: '#ef4444',
                              border: '1px solid rgba(239,68,68,0.2)',
                              borderRadius: 8,
                              padding: '6px 12px',
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: deleteLoading === user.id ? 'not-allowed' : 'pointer',
                              opacity: deleteLoading === user.id ? 0.5 : 1,
                            }}
                          >
                            {deleteLoading === user.id ? '…' : 'Delete'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Briefing promise tracker */}
        {selectedUserId && briefings.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Call History — User #{selectedUserId}</h2>
              <button onClick={() => { setBriefings([]); setSelectedUserId(null); }} className="text-xs" style={{ color: '#4a4a5a' }}>Close</button>
            </div>
            <div className="space-y-4">
              {briefings.map(b => {
                const promises: string[] = (() => { try { return b.edge_promises ? JSON.parse(b.edge_promises) : []; } catch { return []; } })();
                const toolActions: Array<{ fn: string; result: string }> = (() => { try { return b.tool_actions ? JSON.parse(b.tool_actions) : []; } catch { return []; } })();
                const calActions: Array<{ type: string; title: string }> = (() => { try { return b.calendar_actions ? JSON.parse(b.calendar_actions) : []; } catch { return []; } })();

                return (
                  <div key={b.id} className="glass-card p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <StatusBadge status={b.status} />
                      <span className="text-sm font-semibold">{formatDate(b.scheduled_for)}</span>
                      <span className="text-xs" style={{ color: '#4a4a5a' }}>Briefing #{b.id}</span>
                    </div>

                    {promises.length > 0 && (
                      <div className="mb-3">
                        <p className="text-xs font-semibold mb-2" style={{ color: '#818cf8' }}>PROMISES MADE</p>
                        <div className="space-y-1">
                          {promises.map((p, i) => (
                            <p key={i} className="text-xs" style={{ color: '#c8c8d8' }}>→ {p}</p>
                          ))}
                        </div>
                      </div>
                    )}

                    {toolActions.length > 0 && (
                      <div className="mb-3">
                        <p className="text-xs font-semibold mb-2" style={{ color: '#4ade80' }}>✅ EXECUTED (live tools)</p>
                        <div className="space-y-1">
                          {toolActions.map((a, i) => (
                            <p key={i} className="text-xs" style={{ color: '#c8c8d8' }}><span style={{ color: '#4ade80' }}>✓</span> {a.fn}: {a.result}</p>
                          ))}
                        </div>
                      </div>
                    )}

                    {calActions.length > 0 && (
                      <div className="mb-3">
                        <p className="text-xs font-semibold mb-2" style={{ color: '#fbbf24' }}>📅 POST-CALL ACTIONS</p>
                        <div className="space-y-1">
                          {calActions.map((a, i) => (
                            <p key={i} className="text-xs" style={{ color: '#c8c8d8' }}><span style={{ color: '#fbbf24' }}>✓</span> {a.type} — {a.title}</p>
                          ))}
                        </div>
                      </div>
                    )}

                    {b.user_response && (
                      <div>
                        <p className="text-xs font-semibold mb-1" style={{ color: '#6366f1' }}>YOU SAID</p>
                        <p className="text-xs" style={{ color: '#888899' }}>"{b.user_response}"</p>
                      </div>
                    )}

                    {promises.length === 0 && toolActions.length === 0 && calActions.length === 0 && (
                      <p className="text-xs" style={{ color: '#4a4a5a' }}>No promises or actions recorded for this call.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
