'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';

const TIMEZONES = [
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

function ProfileTab({ onSettingsSaved }: { onSettingsSaved?: () => void }) {
  const [profile, setProfile] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [callTime, setCallTime] = useState('07:00');
  const [timezone, setTimezone] = useState('America/Vancouver');
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.json())
      .then(d => {
        setProfile(d.profile_summary || '');
        if (d.call_time) setCallTime(d.call_time);
        if (d.timezone) setTimezone(d.timezone);
        setLoading(false);
      });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_summary: profile }),
    });
    setSaving(false);
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSavingSettings(true);
    await fetch('/api/onboarding/call-time', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call_time: callTime, timezone }),
    });
    setSavingSettings(false);
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 3000);
    onSettingsSaved?.();
  }

  if (loading) return <div className="text-sm" style={{ color: '#888899' }}>Loading…</div>;

  return (
    <div className="space-y-8">
      {/* Call Settings */}
      <div>
        <h2 className="text-lg font-bold mb-4">Call settings</h2>
        <form onSubmit={handleSaveSettings} className="glass-card p-6 space-y-4">
          <div className="flex gap-4 flex-wrap">
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs mb-1" style={{ color: '#888899' }}>Call time</label>
              <input
                type="time"
                className="input"
                value={callTime}
                onChange={e => setCallTime(e.target.value)}
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs mb-1" style={{ color: '#888899' }}>Timezone</label>
              <select
                className="input"
                style={{ background: '#1a1a2e', color: '#e8e8f0' }}
                value={timezone}
                onChange={e => setTimezone(e.target.value)}
              >
                {TIMEZONES.map(tz => (
                  <option key={tz.value} value={tz.value} style={{ background: '#1a1a2e', color: '#e8e8f0' }}>{tz.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" className="btn-primary text-sm py-2 px-5" disabled={savingSettings}>
              {savingSettings ? 'Saving…' : 'Save settings'}
            </button>
            {settingsSaved && <span className="text-sm" style={{ color: '#10b981' }}>✓ Saved</span>}
          </div>
        </form>
      </div>

      {/* Profile */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Your profile</h2>
          <div className="flex items-center gap-3">
            {saved && <span className="text-sm" style={{ color: '#10b981' }}>✓ Saved</span>}
            {!editing && (
              <button onClick={() => setEditing(true)} className="btn-secondary text-sm py-2 px-4">
                ✎ Edit
              </button>
            )}
          </div>
        </div>

        <p className="text-sm mb-4" style={{ color: '#888899' }}>
          This is the full context EDG3 uses to understand who you are. Keep it current.
        </p>

        {editing ? (
          <form onSubmit={handleSave}>
            <textarea
              className="input"
              style={{ minHeight: '400px', fontFamily: 'inherit' }}
              value={profile}
              onChange={e => setProfile(e.target.value)}
            />
            <div className="flex gap-3 mt-4">
              <button type="submit" className="btn-primary text-sm py-2 px-5" disabled={saving}>
                {saving ? 'Saving…' : 'Save profile'}
              </button>
              <button type="button" className="btn-secondary text-sm py-2 px-4" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="glass-card p-6">
            {profile ? (
              <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: '#c8c8d8' }}>
                {profile}
              </p>
            ) : (
              <p className="text-sm text-center py-4" style={{ color: '#4a4a5a' }}>
                No profile set. Click Edit to add one.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TasksTab({ tasks, onToggle, onAdd, onDelete }: {
  tasks: Task[];
  onToggle: (id: number, completed: boolean) => Promise<void>;
  onAdd: (text: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [newTask, setNewTask] = useState('');
  const [adding, setAdding] = useState(false);

  const today = new Date().toLocaleDateString('en-CA');
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString('en-CA');
  const todayTasks = tasks.filter(t => t.date === today || t.date === tomorrowStr);
  const pastTasks = tasks.filter(t => t.date < today && !t.completed);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newTask.trim()) return;
    setAdding(true);
    await onAdd(newTask.trim());
    setNewTask('');
    setAdding(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">{todayTasks.some(t => t.date === tomorrowStr) && !todayTasks.some(t => t.date === today) ? "Tomorrow's tasks" : "Today's tasks"}</h2>
        <span className="badge badge-info">
          {todayTasks.filter(t => t.completed).length}/{todayTasks.length} done
        </span>
      </div>

      {/* Add task */}
      <form onSubmit={handleAdd} className="flex gap-3 mb-6">
        <input
          className="input flex-1"
          placeholder="Add a task…"
          value={newTask}
          onChange={e => setNewTask(e.target.value)}
        />
        <button type="submit" className="btn-primary text-sm py-2 px-4 flex-shrink-0" disabled={adding || !newTask.trim()}>
          Add
        </button>
      </form>

      {/* EDG3 suggested tasks */}
      {todayTasks.filter(t => t.source === 'edg3').length > 0 && (
        <div className="mb-2">
          <p className="text-xs font-semibold mb-2" style={{ color: '#6366f1' }}>✦ SUGGESTED BY EDG3</p>
          <div className="space-y-2">
            {todayTasks.filter(t => t.source === 'edg3').map(task => (
              <TaskRow key={task.id} task={task} onToggle={onToggle} onDelete={onDelete} />
            ))}
          </div>
        </div>
      )}

      {/* Manual tasks */}
      {todayTasks.filter(t => t.source === 'manual').length > 0 && (
        <div className="mb-2 mt-4">
          <p className="text-xs font-semibold mb-2" style={{ color: '#4a4a5a' }}>YOUR TASKS</p>
          <div className="space-y-2">
            {todayTasks.filter(t => t.source === 'manual').map(task => (
              <TaskRow key={task.id} task={task} onToggle={onToggle} onDelete={onDelete} />
            ))}
          </div>
        </div>
      )}

      {todayTasks.length === 0 && (
        <div className="glass-card p-8 text-center mb-4">
          <p className="text-sm" style={{ color: '#888899' }}>No tasks yet today. They'll appear here after your morning call.</p>
        </div>
      )}

      {/* Overdue tasks */}
      {pastTasks.length > 0 && (
        <div className="mt-6">
          <p className="text-xs font-semibold mb-2" style={{ color: '#f59e0b' }}>⚠ CARRIED OVER</p>
          <div className="space-y-2">
            {pastTasks.map(task => (
              <TaskRow key={task.id} task={task} onToggle={onToggle} onDelete={onDelete} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, onToggle, onDelete }: {
  task: Task;
  onToggle: (id: number, completed: boolean) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);

  async function toggle() {
    setLoading(true);
    await onToggle(task.id, !task.completed);
    setLoading(false);
  }

  return (
    <div className="glass-card glass-card-hover p-4 flex items-center gap-3 group">
      <button
        onClick={toggle}
        disabled={loading}
        className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-all"
        style={{
          background: task.completed ? '#6366f1' : 'transparent',
          border: task.completed ? '2px solid #6366f1' : '2px solid rgba(255,255,255,0.15)',
        }}
      >
        {task.completed && <span style={{ color: 'white', fontSize: 10 }}>✓</span>}
      </button>
      <span
        className="flex-1 text-sm"
        style={{
          color: task.completed ? '#4a4a5a' : '#e8e8f0',
          textDecoration: task.completed ? 'line-through' : 'none',
        }}
      >
        {task.text}
      </span>
      {task.source === 'edg3' && (
        <span className="badge badge-info text-xs opacity-60">EDG3</span>
      )}
      <button
        onClick={() => onDelete(task.id)}
        className="opacity-0 group-hover:opacity-100 text-xs transition-opacity"
        style={{ color: '#4a4a5a' }}
      >
        ✕
      </button>
    </div>
  );
}

function PrioritiesTab({ priorities, onSave }: { priorities: Priority[]; onSave: (p: string[]) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState(['', '', '']);
  const [loading, setLoading] = useState(false);

  function startEdit() {
    setValues([
      priorities[0]?.text || '',
      priorities[1]?.text || '',
      priorities[2]?.text || '',
    ]);
    setEditing(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await onSave(values.filter(v => v.trim()));
    setLoading(false);
    setEditing(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">This week's priorities</h2>
        {!editing && (
          <button onClick={startEdit} className="btn-secondary text-sm py-2 px-4">
            ✎ Edit
          </button>
        )}
      </div>

      {editing ? (
        <form onSubmit={handleSave} className="space-y-3">
          {values.map((v, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-black flex-shrink-0"
                   style={{ background: 'rgba(99,102,241,0.2)', color: '#818cf8' }}>
                {i + 1}
              </div>
              <input
                className="input flex-1"
                placeholder={i === 0 ? 'e.g. Build Edg3' : i === 1 ? 'e.g. Handle foreclosure case' : 'e.g. Daily gym'}
                value={v}
                onChange={e => { const n = [...values]; n[i] = e.target.value; setValues(n); }}
              />
            </div>
          ))}
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary text-sm py-2 px-5" disabled={loading}>
              {loading ? 'Saving…' : 'Save priorities'}
            </button>
            <button type="button" className="btn-secondary text-sm py-2 px-4" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          {priorities.length === 0 ? (
            <div className="glass-card p-8 text-center">
              <p className="text-sm mb-3" style={{ color: '#888899' }}>No priorities set for this week.</p>
              <button onClick={startEdit} className="btn-primary text-sm py-2 px-5">Set priorities</button>
            </div>
          ) : (
            <div className="space-y-3">
              {priorities.map((p, i) => (
                <div key={p.id} className="glass-card p-5 flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-black flex-shrink-0"
                       style={{ background: 'rgba(99,102,241,0.2)', color: '#818cf8' }}>
                    {i + 1}
                  </div>
                  <p className="font-medium text-sm pt-1">{p.text}</p>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs mt-4" style={{ color: '#4a4a5a' }}>
            EDG3 checks these every morning against your calendar.
          </p>
        </>
      )}
    </div>
  );
}

function UpdateBox({ onSubmit }: { onSubmit: (text: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handle(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setLoading(true);
    await onSubmit(text);
    setLoading(false);
    setText('');
    setSent(true);
    setTimeout(() => setSent(false), 3000);
  }

  return (
    <div className="glass-card p-5 mb-6" style={{ borderColor: 'rgba(99,102,241,0.2)' }}>
      <p className="text-xs font-semibold mb-3" style={{ color: '#6366f1' }}>
        ✦ TELL EDG3 SOMETHING
      </p>
      <form onSubmit={handle} className="flex gap-3">
        <input
          className="input flex-1"
          placeholder="e.g. I have a foreclosure hearing tomorrow at 10am... I'm feeling overwhelmed today... I just closed a deal..."
          value={text}
          onChange={e => setText(e.target.value)}
        />
        <button
          type="submit"
          className="btn-primary text-sm py-2 px-5 flex-shrink-0"
          disabled={loading || !text.trim()}
        >
          {sent ? '✓ Saved' : loading ? '…' : 'Send'}
        </button>
      </form>
      <p className="text-xs mt-2" style={{ color: '#4a4a5a' }}>
        EDG3 will remember this and reference it in tomorrow's briefing.
      </p>
    </div>
  );
}

interface User {
  id: number;
  name: string;
  email: string;
  call_time: string;
  timezone: string;
  onboarding_complete: boolean;
  has_profile: boolean;
}

interface Briefing {
  id: number;
  content: string;
  status: string;
  scheduled_for: string;
  user_response: string | null;
  transcript: string | null;
}

interface Priority {
  id: number;
  text: string;
  rank: number;
}

interface Memory {
  id: number;
  type: string;
  content: string;
  created_at: string;
}

interface Task {
  id: number;
  text: string;
  completed: number;
  source: string;
  date: string;
  completed_at: string | null;
}

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [priorities, setPriorities] = useState<Priority[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [generatingBriefing, setGeneratingBriefing] = useState(false);
  const [initiatingCall, setInitiatingCall] = useState(false);
  const [activeTab, setActiveTab] = useState<'briefings' | 'tasks' | 'priorities' | 'memory' | 'profile'>('briefings');
  const [selectedBriefing, setSelectedBriefing] = useState<Briefing | null>(null);
  const [briefingText, setBriefingText] = useState('');
  const isWelcome = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('welcome') === '1';
  const [showWelcome, setShowWelcome] = useState(() => isWelcome);
  const [introCalling, setIntroCalling] = useState(false);
  const [showNextCallTip, setShowNextCallTip] = useState(() => isWelcome);
  const [reminderAdded, setReminderAdded] = useState(false);

  const loadData = useCallback(async () => {
    const [meRes, briefingsRes, prioritiesRes, memoriesRes, tasksRes] = await Promise.all([
      fetch('/api/auth/me'),
      fetch('/api/briefing/history'),
      fetch('/api/onboarding/priorities'),
      fetch('/api/memory'),
      fetch('/api/tasks'),
    ]);

    if (!meRes.ok) { router.push('/login'); return; }

    const [me, br, pr, mem, tk] = await Promise.all([
      meRes.json(), briefingsRes.json(), prioritiesRes.json(), memoriesRes.json(), tasksRes.json()
    ]);

    setUser(me);
    setBriefings(br.briefings || []);
    setPriorities(pr.priorities || []);
    setMemories(mem.memories || []);
    setTasks(tk.tasks || []);
  }, [router]);

  useEffect(() => { loadData(); }, [loadData]);


  async function callIntro() {
    setIntroCalling(true);
    await fetch('/api/briefing/intro', { method: 'POST' });
    // Keep modal open in "calling" state — user dismisses after call ends
  }

  async function generateBriefing() {
    setGeneratingBriefing(true);
    setBriefingText('');
    const res = await fetch('/api/briefing/generate', { method: 'POST' });
    const data = await res.json();
    setGeneratingBriefing(false);
    if (res.ok) {
      setBriefingText(data.content);
      loadData();
    }
  }

  async function initiateCall() {
    setInitiatingCall(true);
    const res = await fetch('/api/briefing/call', { method: 'POST' });
    const data = await res.json();
    setInitiatingCall(false);
    if (!res.ok) {
      alert(data.error || 'Failed to initiate call');
    } else {
      alert('Call initiated! EDG3 will call you shortly.');
      loadData();
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
  }

  async function submitUpdate(text: string) {
    if (!text.trim()) return;
    await fetch('/api/memory/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
    });
    loadData();
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--background)' }}>
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const latestBriefing = briefings[0];
  const statusColor = {
    completed: 'badge-success',
    calling: 'badge-pending',
    failed: 'badge-danger',
    pending: 'badge-info',
  };

  return (
    <div className="min-h-screen relative" style={{ background: 'var(--background)' }}>
      <div className="orb orb-1" />
      <div className="orb orb-2" />

      {/* Sidebar + main layout */}
      <div className="relative z-10 flex min-h-screen">
        {/* Sidebar */}
        <aside className="w-60 flex-shrink-0 flex flex-col py-6 px-4 border-r" style={{ borderColor: 'var(--card-border)' }}>
          <div className="mb-8">
            <span className="logo-text text-xl">EDG3</span>
          </div>

          <nav className="flex-1 space-y-1">
            {[
              { id: 'briefings', label: 'Briefings', icon: '📋' },
              { id: 'tasks', label: 'Tasks', icon: '✓' },
              { id: 'priorities', label: 'Priorities', icon: '🎯' },
              { id: 'memory', label: 'Memory', icon: '🧠' },
              { id: 'profile', label: 'Profile', icon: '👤' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all text-left"
                style={{
                  background: activeTab === tab.id ? 'rgba(99,102,241,0.15)' : 'transparent',
                  color: activeTab === tab.id ? '#818cf8' : '#888899',
                  border: activeTab === tab.id ? '1px solid rgba(99,102,241,0.2)' : '1px solid transparent',
                }}
              >
                <span>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="mt-auto space-y-3">
            <div
              className="glass-card p-3 transition-all"
              style={showNextCallTip ? {
                border: '1px solid rgba(99,102,241,0.6)',
                boxShadow: '0 0 16px rgba(99,102,241,0.25)',
              } : {}}
            >
              <div className="flex items-center gap-2 mb-1">
                <p className="text-xs" style={{ color: '#4a4a5a' }}>Next call</p>
                {showNextCallTip && (
                  <span className="text-xs px-1.5 py-0.5 rounded font-semibold animate-pulse"
                    style={{ background: 'rgba(99,102,241,0.2)', color: '#818cf8' }}>
                    ← this is you
                  </span>
                )}
              </div>
              <p className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>
                {user.call_time} {user.timezone.split('/').pop()?.replace('_', ' ')}
              </p>
              {showNextCallTip && (
                <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(99,102,241,0.15)' }}>
                  {!reminderAdded ? (
                    <>
                      <p className="text-xs mb-2" style={{ color: '#888899' }}>
                        Add a daily reminder so you're ready when Edg3 calls.
                      </p>
                      <button
                        onClick={async () => {
                          const res = await fetch('/api/calendar/reminder', { method: 'POST' });
                          if (res.ok) { setReminderAdded(true); }
                        }}
                        className="btn-primary w-full py-2 text-xs"
                      >
                        📅 Add to calendar
                      </button>
                    </>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span style={{ color: '#6366f1' }}>✓</span>
                      <p className="text-xs" style={{ color: '#888899' }}>Added to your calendar.</p>
                      <button onClick={() => setShowNextCallTip(false)} className="ml-auto text-xs" style={{ color: '#4a4a5a' }}>Dismiss</button>
                    </div>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={async () => {
                const res = await fetch('/api/calendar/connect');
                const data = await res.json();
                if (data.url) window.location.href = data.url;
              }}
              className="w-full text-xs py-2 text-left px-2 rounded"
              style={{ color: '#4a4a5a' }}
            >
              📅 Reconnect calendar
            </button>
            <button
              onClick={logout}
              className="w-full text-xs py-2 text-left px-2 rounded"
              style={{ color: '#4a4a5a' }}
            >
              Sign out
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 p-8 overflow-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold">Good morning, {user.name.split(' ')[0]}</h1>
              <p className="text-sm mt-1" style={{ color: '#888899' }}>
                {format(new Date(), 'EEEE, MMMM d, yyyy')}
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={initiateCall}
                disabled={initiatingCall}
                className="btn-primary text-sm py-2 px-4"
              >
                {initiatingCall ? 'Calling…' : '📞 Call me now'}
              </button>
            </div>
          </div>

          {/* Tell EDG3 something */}
          <UpdateBox onSubmit={submitUpdate} />

          {/* Generated briefing preview */}
          {briefingText && (
            <div className="glass-card p-6 mb-6" style={{ borderColor: 'rgba(99,102,241,0.2)' }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-sm" style={{ color: '#818cf8' }}>TODAY'S BRIEFING PREVIEW</h3>
                <button onClick={() => setBriefingText('')} style={{ color: '#4a4a5a', fontSize: 12 }}>✕ dismiss</button>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: '#c8c8d8' }}>
                {briefingText}
              </p>
            </div>
          )}

          {/* Tab content */}
          {activeTab === 'briefings' && (
            <div>
              <h2 className="text-lg font-bold mb-4">Briefing history</h2>
              {briefings.length === 0 ? (
                <div className="glass-card p-8 text-center">
                  <p className="text-4xl mb-3">📞</p>
                  <p className="font-medium mb-1">No briefings yet</p>
                  <p className="text-sm" style={{ color: '#888899' }}>
                    Click "Call me now" to get your first briefing, or wait for your scheduled call at {user.call_time}.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {briefings.map(b => (
                    <div
                      key={b.id}
                      className="glass-card glass-card-hover p-5 cursor-pointer"
                      onClick={() => setSelectedBriefing(selectedBriefing?.id === b.id ? null : b)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-sm">
                            {format(new Date(b.scheduled_for), 'EEEE, MMM d · h:mm a')}
                          </p>
                          {b.user_response && (
                            <p className="text-xs mt-1 truncate max-w-sm" style={{ color: '#888899' }}>
                              You said: "{b.user_response}"
                            </p>
                          )}
                        </div>
                        <span className={`badge ${statusColor[b.status as keyof typeof statusColor] || 'badge-info'}`}>
                          {b.status}
                        </span>
                      </div>

                      {selectedBriefing?.id === b.id && (
                        <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--card-border)' }}>
                          <p className="text-xs font-semibold mb-2" style={{ color: '#6366f1' }}>BRIEFING CONTENT</p>
                          <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: '#c8c8d8' }}>
                            {b.content}
                          </p>
                          {b.user_response && (
                            <div className="mt-4 p-4 rounded-lg" style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)' }}>
                              <p className="text-xs font-semibold mb-1" style={{ color: '#6366f1' }}>YOUR RESPONSE</p>
                              <p className="text-sm leading-relaxed" style={{ color: '#c8c8d8' }}>
                                "{b.user_response}"
                              </p>
                            </div>
                          )}
                          {false && b.transcript && (
                            <>
                              <p className="text-xs font-semibold mt-4 mb-2" style={{ color: '#6366f1' }}>CALL TRANSCRIPT</p>
                              <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: '#888899' }}>
                                {b.transcript}
                              </p>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'tasks' && (
            <TasksTab tasks={tasks} onToggle={async (id, completed) => {
              await fetch(`/api/tasks/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ completed }),
              });
              loadData();
            }} onAdd={async (text) => {
              await fetch('/api/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text }),
              });
              loadData();
            }} onDelete={async (id) => {
              await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
              loadData();
            }} />
          )}

          {activeTab === 'priorities' && (
            <PrioritiesTab priorities={priorities} onSave={async (newPriorities) => {
              await fetch('/api/onboarding/priorities', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ priorities: newPriorities }),
              });
              loadData();
            }} />
          )}

          {activeTab === 'memory' && (
            <div>
              <h2 className="text-lg font-bold mb-4">Memory bank</h2>
              <p className="text-sm mb-4" style={{ color: '#888899' }}>
                Everything EDG3 remembers about you accumulates here over time.
              </p>
              {memories.length === 0 ? (
                <div className="glass-card p-8 text-center">
                  <p className="text-sm" style={{ color: '#888899' }}>No memories yet. They'll build after your first call.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {memories.map(m => (
                    <div key={m.id} className="glass-card p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`badge ${
                          m.type === 'insight' ? 'badge-success' :
                          m.type === 'transcript' ? 'badge-info' :
                          m.type === 'profile' ? 'badge-pending' : 'badge-info'
                        }`}>
                          {m.type}
                        </span>
                        <span className="text-xs" style={{ color: '#4a4a5a' }}>
                          {format(new Date(m.created_at), 'MMM d, yyyy')}
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed" style={{ color: '#c8c8d8' }}>
                        {m.content.length > 300 ? m.content.slice(0, 300) + '…' : m.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'profile' && (
            <ProfileTab onSettingsSaved={loadData} />
          )}
        </main>
      </div>

      {/* Welcome modal */}
      {showWelcome && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="glass-card p-8 max-w-md w-full text-center relative" style={{ border: '1px solid rgba(99,102,241,0.3)' }}>
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6"
                 style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)' }}>
              <span className="logo-text text-2xl">E</span>
            </div>
            <h2 className="text-2xl font-black mb-2">Edg3 wants to introduce himself.</h2>
            <p className="text-sm mb-6" style={{ color: '#888899' }}>
              Edg3 will call you now at <span style={{ color: '#e8e8f0', fontWeight: 600 }}>{(user as any)?.phone_number || 'your phone'}</span> for a quick 30-second intro — your first of many conversations.
            </p>
            <div className="space-y-2 text-left glass-card p-4 mb-6" style={{ background: 'rgba(99,102,241,0.05)' }}>
              <p className="text-xs font-semibold mb-3" style={{ color: '#6366f1' }}>EDG3 WILL HELP YOU:</p>
              {['Align your calendar with your actual priorities', 'Track patterns in your life you\'re too close to see', 'Hold you accountable — honestly, like a great advisor'].map((item, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="text-indigo-400 font-bold text-sm">{i + 1}.</span>
                  <p className="text-sm" style={{ color: '#c8c8d8' }}>{item}</p>
                </div>
              ))}
            </div>
            {!introCalling ? (
              <button
                onClick={callIntro}
                className="btn-primary w-full py-3 text-base"
              >
                📗 Meet Edg3
              </button>
            ) : (
              <div className="text-center space-y-4">
                <div className="flex items-center justify-center gap-3 py-3">
                  <span className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                  <span className="font-semibold" style={{ color: '#818cf8' }}>Edg3 is calling you now…</span>
                </div>
                <p className="text-sm" style={{ color: '#888899' }}>Pick up — it'll only take 30 seconds.</p>
                <button
                  onClick={() => { setShowWelcome(false); setShowNextCallTip(true); router.replace('/dashboard'); }}
                  className="btn-secondary w-full py-2 text-sm"
                >
                  ✓ Done, I got the call
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
