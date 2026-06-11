'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { summarizeUserFacingActions } from '@/lib/actionSummary';
import { computeCallStreak } from '@/lib/streak';

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
  const [profileExpanded, setProfileExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [callTime, setCallTime] = useState('07:00');
  const [timezone, setTimezone] = useState('America/Vancouver');
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  const [currentTimezone, setCurrentTimezone] = useState(''); // '' = home (no override)
  const [savingTz, setSavingTz] = useState(false);

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.json())
      .then(d => {
        setProfile(d.profile_summary || '');
        if (d.call_time) setCallTime(d.call_time);
        if (d.timezone) setTimezone(d.timezone);
        setCurrentTimezone(d.current_timezone || '');
        setLoading(false);
      });
  }, []);

  async function saveCurrentTimezone(tz: string) {
    setSavingTz(true);
    setCurrentTimezone(tz);
    await fetch('/api/profile/timezone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_timezone: tz || null }),
    });
    setSavingTz(false);
    onSettingsSaved?.();
  }

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

  if (loading) return <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>;

  return (
    <div className="space-y-8">
      {/* Call Settings */}
      <div>
        <h2 className="text-lg font-bold mb-4">Call settings</h2>
        <form onSubmit={handleSaveSettings} className="glass-card p-6 space-y-4">
          <div className="flex gap-4 flex-wrap">
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Call time</label>
              <input
                type="time"
                className="input"
                value={callTime}
                onChange={e => setCallTime(e.target.value)}
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Timezone</label>
              <select
                className="input"
                style={{ background: 'var(--edg-bg-select)', color: 'var(--text-strong)' }}
                value={timezone}
                onChange={e => setTimezone(e.target.value)}
              >
                {TIMEZONES.map(tz => (
                  <option key={tz.value} value={tz.value} style={{ background: 'var(--edg-bg-select)', color: 'var(--text-strong)' }}>{tz.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" className="btn-primary text-sm py-2 px-5" disabled={savingSettings}>
              {savingSettings ? 'Saving…' : 'Save settings'}
            </button>
            {settingsSaved && <span className="text-sm" style={{ color: 'var(--edg-success)' }}>✓ Saved</span>}
          </div>
        </form>
      </div>

      {/* Traveling this week */}
      <div>
        <h2 className="text-lg font-bold mb-1">Traveling this week?</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          Set the timezone you're currently in. Edge uses it for your briefings and bookings until you clear it.
        </p>
        <div className="glass-card p-6">
          {currentTimezone ? (
            <div className="flex items-center gap-3 flex-wrap mb-4">
              <span className="badge badge-info">📍 Currently in {TIMEZONES.find(t => t.value === currentTimezone)?.label || currentTimezone}</span>
              <button onClick={() => saveCurrentTimezone('')} disabled={savingTz} className="text-xs" style={{ color: 'var(--edg-danger)' }}>
                {savingTz ? 'Saving…' : "Clear — I'm home"}
              </button>
            </div>
          ) : (
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>Using your home timezone.</p>
          )}
          <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>I'm currently in</label>
          <select
            className="input"
            style={{ background: 'var(--edg-bg-select)', color: 'var(--text-strong)', maxWidth: 360 }}
            value={currentTimezone}
            onChange={e => saveCurrentTimezone(e.target.value)}
            disabled={savingTz}
          >
            <option value="" style={{ background: 'var(--edg-bg-select)', color: 'var(--text-strong)' }}>Home ({TIMEZONES.find(t => t.value === timezone)?.label || timezone})</option>
            {TIMEZONES.map(tz => (
              <option key={tz.value} value={tz.value} style={{ background: 'var(--edg-bg-select)', color: 'var(--text-strong)' }}>{tz.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Profile */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Your profile</h2>
          <div className="flex items-center gap-3">
            {saved && <span className="text-sm" style={{ color: 'var(--edg-success)' }}>✓ Saved</span>}
            {!editing && (
              <button onClick={() => setEditing(true)} className="btn-secondary text-sm py-2 px-4">
                ✎ Edit
              </button>
            )}
          </div>
        </div>

        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
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
              <>
                <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-body)', maxHeight: profileExpanded ? 'none' : '9rem', overflow: 'hidden', maskImage: profileExpanded ? 'none' : 'linear-gradient(to bottom, black 70%, transparent)', WebkitMaskImage: profileExpanded ? 'none' : 'linear-gradient(to bottom, black 70%, transparent)' }}>
                {profile}
              </p>
                {profile.length > 280 && (
                  <button onClick={() => setProfileExpanded(v => !v)} className="text-xs mt-3" style={{ color: 'var(--text-accent)' }}>
                    {profileExpanded ? '▲ Show less' : '▼ Show more'}
                  </button>
                )}
              </>
            ) : (
              <p className="text-sm text-center py-4" style={{ color: 'var(--text-faint)' }}>
                No profile set. Click Edit to add one.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TasksTab({ tasks, onToggle, onAdd, onDelete, onCompleteAll }: {
  tasks: Task[];
  onToggle: (id: number, completed: boolean) => Promise<void>;
  onAdd: (text: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onCompleteAll: (ids: number[]) => Promise<void>;
}) {
  const [newTask, setNewTask] = useState('');
  const [adding, setAdding] = useState(false);
  const [completingAll, setCompletingAll] = useState(false);
  const [filterView, setFilterView] = useState<'open' | 'completed' | 'all'>('open');

  const today = new Date().toLocaleDateString('en-CA');
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString('en-CA');

  // Open view: today/tomorrow tasks + past incomplete (carried over)
  const todayTasks = tasks.filter(t => t.date === today || t.date === tomorrowStr).sort((a, b) => b.id - a.id);
  const pastTasks = tasks.filter(t => t.date < today && !t.completed);
  const incompleteVisible = [...todayTasks, ...pastTasks].filter(t => !t.completed);

  // Completed view: all completed tasks newest-completed first
  const completedTasks = tasks
    .filter(t => !!t.completed)
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? '') || b.id - a.id);

  // All view: everything by date DESC, then id DESC
  const allTasks = [...tasks].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newTask.trim()) return;
    setAdding(true);
    await onAdd(newTask.trim());
    setNewTask('');
    setAdding(false);
  }

  async function handleCompleteAll() {
    if (!incompleteVisible.length || completingAll) return;
    setCompletingAll(true);
    await onCompleteAll(incompleteVisible.map(t => t.id));
    setCompletingAll(false);
  }

  const isTomorrow = todayTasks.some(t => t.date === tomorrowStr) && !todayTasks.some(t => t.date === today);
  const headingByView = { open: isTomorrow ? "Tomorrow's tasks" : "Today's tasks", completed: 'Completed', all: 'All tasks' };

  const filterControl = (
    <div className="flex gap-1 mb-4 p-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)', width: 'fit-content' }}>
      {(['open', 'completed', 'all'] as const).map(v => (
        <button
          key={v}
          onClick={() => setFilterView(v)}
          className="text-xs py-1 px-3 rounded-md transition-all capitalize"
          style={{
            background: filterView === v ? 'rgba(99,102,241,0.2)' : 'transparent',
            color: filterView === v ? 'var(--text-accent)' : 'var(--text-muted)',
            fontWeight: filterView === v ? 600 : 400,
          }}
        >
          {v.charAt(0).toUpperCase() + v.slice(1)}
        </button>
      ))}
    </div>
  );

  return (
    <div>
      {filterControl}

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">{headingByView[filterView]}</h2>
        <div className="flex items-center gap-3">
          {filterView === 'open' && incompleteVisible.length > 0 && (
            <button
              onClick={handleCompleteAll}
              disabled={completingAll}
              className="text-xs font-medium transition-colors"
              style={{ color: completingAll ? 'var(--text-faint)' : 'var(--edg-success)' }}
            >
              {completingAll ? 'Completing…' : `✓ Complete all (${incompleteVisible.length})`}
            </button>
          )}
          {filterView === 'open' && (
            <span className="badge badge-info">
              {todayTasks.filter(t => t.completed).length}/{todayTasks.length} done
            </span>
          )}
        </div>
      </div>

      {/* Add task — always visible */}
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

      {/* Open view */}
      {filterView === 'open' && (
        <>
          {todayTasks.filter(t => t.source === 'edg3').length > 0 && (
            <div className="mb-2">
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--edg-indigo)' }}>✦ SUGGESTED BY EDG3</p>
              <div className="space-y-2">
                {todayTasks.filter(t => t.source === 'edg3' && !t.completed).map(task => (
                  <TaskRow key={task.id} task={task} onToggle={onToggle} onDelete={onDelete} />
                ))}
              </div>
            </div>
          )}
          {todayTasks.filter(t => t.source === 'manual' && !t.completed).length > 0 && (
            <div className="mb-2 mt-4">
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-faint)' }}>YOUR TASKS</p>
              <div className="space-y-2">
                {todayTasks.filter(t => t.source === 'manual' && !t.completed).map(task => (
                  <TaskRow key={task.id} task={task} onToggle={onToggle} onDelete={onDelete} />
                ))}
              </div>
            </div>
          )}
          {incompleteVisible.length === 0 && (
            <div className="glass-card p-8 text-center mb-4">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {todayTasks.length === 0
                  ? 'No tasks yet today. They\'ll appear here after your morning call.'
                  : 'All done for today.'}
              </p>
            </div>
          )}
          {pastTasks.length > 0 && (
            <div className="mt-6">
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--edg-warning)' }}>⚠ CARRIED OVER</p>
              <div className="space-y-2">
                {pastTasks.map(task => (
                  <TaskRow key={task.id} task={task} onToggle={onToggle} onDelete={onDelete} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Completed view */}
      {filterView === 'completed' && (
        completedTasks.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No completed tasks in the last 30 days.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {completedTasks.map(task => (
              <TaskRow key={task.id} task={task} onToggle={onToggle} onDelete={onDelete} />
            ))}
          </div>
        )
      )}

      {/* All view */}
      {filterView === 'all' && (
        allTasks.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No tasks yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {allTasks.map(task => (
              <TaskRow key={task.id} task={task} onToggle={onToggle} onDelete={onDelete} />
            ))}
          </div>
        )
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
          background: task.completed ? 'var(--edg-indigo)' : 'transparent',
          border: task.completed ? '2px solid #6366f1' : '2px solid rgba(255,255,255,0.15)',
        }}
      >
        {task.completed && <span style={{ color: '#fff', fontSize: 10 }}>✓</span>}
      </button>
      <span
        className="flex-1 text-sm"
        style={{
          color: task.completed ? 'var(--text-faint)' : 'var(--text-strong)',
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
        style={{ color: 'var(--text-faint)' }}
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
                   style={{ background: 'rgba(99,102,241,0.2)', color: 'var(--text-accent)' }}>
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
              <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>No priorities set for this week.</p>
              <button onClick={startEdit} className="btn-primary text-sm py-2 px-5">Set priorities</button>
            </div>
          ) : (
            <div className="space-y-3">
              {priorities.map((p, i) => (
                <div key={p.id} className="glass-card p-5 flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-black flex-shrink-0"
                       style={{ background: 'rgba(99,102,241,0.2)', color: 'var(--text-accent)' }}>
                    {i + 1}
                  </div>
                  <p className="font-medium text-sm pt-1">{p.text}</p>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs mt-4" style={{ color: 'var(--text-faint)' }}>
            EDG3 checks these every morning against your calendar.
          </p>
        </>
      )}
    </div>
  );
}



interface ActivityItem {
  id: number;
  action: string;
  label: string;
  detail: {
    sections: { label: string; value: string }[];
    changes?: { label: string; before: string; after: string }[];
  } | null;
  ok: boolean;
  created_at: string;
  undoId: number | null;
  undoLabel: string | null;
  undone: number | null;
}

function ActivityTab() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [undoingId, setUndoingId] = useState<number | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    const r = await fetch('/api/activity');
    if (!r.ok) { setLoading(false); return; }
    const d = await r.json();
    setItems(d.items || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleUndo(undoId: number) {
    setUndoingId(undoId);
    setUndoError(null);
    const r = await fetch('/api/undo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: undoId }),
    });
    const d = await r.json().catch(() => ({}));
    setUndoingId(null);
    if (r.ok && d.success) {
      await load();
    } else {
      setUndoError(d.error || 'Could not undo — please check your calendar.');
      setTimeout(() => setUndoError(null), 4000);
    }
  }

  function relativeTime(created_at: string): string {
    const ms = Date.now() - new Date(created_at).getTime();
    const s = Math.floor(ms / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  }

  if (loading) return <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">Recent activity</h2>
        <button onClick={load} className="text-xs" style={{ color: 'var(--text-faint)' }}>↻ Refresh</button>
      </div>
      <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
        Everything Edge has done on your calendar — click any row for details, undo individually.
      </p>

      {undoError && (
        <div className="mb-4 text-sm px-4 py-2 rounded-lg" style={{ background: 'var(--edg-danger-tint)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--edg-danger)' }}>
          {undoError}
        </div>
      )}

      {items.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <p className="text-2xl mb-3">⏪</p>
          <p className="font-medium mb-1">No activity yet</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            When Edge creates or edits calendar events, each action will appear here so you can review and undo.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => {
            const isExpanded = expandedId === item.id;
            const isUndone = item.undone === 1;
            const canUndo = item.undoId !== null && !isUndone;
            const hasDetail = !!item.detail;
            return (
              <div
                key={item.id}
                className="glass-card overflow-hidden"
                style={{ opacity: isUndone ? 0.55 : 1 }}
              >
                {/* Row header — click to expand if detail is available */}
                <div
                  className="p-4 flex items-center gap-3"
                  style={{ cursor: hasDetail ? 'pointer' : 'default' }}
                  onClick={() => hasDetail && setExpandedId(isExpanded ? null : item.id)}
                  role={hasDetail ? 'button' : undefined}
                  aria-expanded={hasDetail ? isExpanded : undefined}
                >
                  <span style={{ color: isUndone ? 'var(--text-faint)' : 'var(--text-accent)', flexShrink: 0 }}>
                    {isUndone ? '↩' : '✦'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" style={{ color: isUndone ? 'var(--text-faint)' : 'var(--text-strong)' }}>
                      {item.label}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
                      {isUndone ? 'Undone · ' : ''}{relativeTime(item.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {canUndo && (
                      <button
                        onClick={e => { e.stopPropagation(); handleUndo(item.undoId!); }}
                        disabled={undoingId !== null}
                        className="text-xs py-1 px-3 rounded"
                        style={{
                          background: 'rgba(245,158,11,0.12)',
                          color: undoingId === item.undoId ? 'var(--text-muted)' : 'var(--edg-warning)',
                          border: '1px solid rgba(245,158,11,0.2)',
                          cursor: undoingId !== null ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {undoingId === item.undoId ? 'Undoing…' : '↩ Undo'}
                      </button>
                    )}
                    {hasDetail && (
                      <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                        {isExpanded ? '▲' : '▼'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Expanded detail panel */}
                {isExpanded && item.detail && (
                  <div
                    className="px-4 pb-4"
                    style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    {item.detail.sections.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {item.detail.sections.map((sec, i) => (
                          <div key={i} className="flex gap-3">
                            <span className="text-xs w-24 shrink-0 pt-0.5" style={{ color: 'var(--text-faint)' }}>
                              {sec.label}
                            </span>
                            <span
                              className="text-sm flex-1"
                              style={{ color: 'var(--text-body)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                            >
                              {sec.value}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {item.detail.changes && item.detail.changes.length > 0 && (
                      <div className="mt-3 space-y-3">
                        {item.detail.changes.map((c, i) => (
                          <div key={i}>
                            <p className="text-xs mb-1.5" style={{ color: 'var(--text-faint)' }}>
                              {c.label} changed
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="text-xs p-2 rounded" style={{ background: 'rgba(239,68,68,0.08)' }}>
                                <p className="font-semibold mb-1" style={{ color: 'var(--edg-danger)' }}>Before</p>
                                <p style={{ color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>{c.before}</p>
                              </div>
                              <div className="text-xs p-2 rounded" style={{ background: 'rgba(34,197,94,0.08)' }}>
                                <p className="font-semibold mb-1" style={{ color: 'var(--edg-success)' }}>After</p>
                                <p style={{ color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>{c.after}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
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
  calendar_actions: string | null;
  edge_promises: string | null;
  tool_actions: string | null;
  created_at: string;
}

interface Priority {
  id: number;
  text: string;
  rank: number;
  week_of?: string;
}

interface Memory {
  id: number;
  type: string;
  content: string;
  created_at: string;
}

interface Fact {
  id: number;
  user_id: number;
  category: 'person' | 'project' | 'goal' | 'preference' | 'fact';
  statement: string;
  entity: string | null;
  learned_at: string;
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
  const [facts, setFacts] = useState<Fact[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  const [briefingsLoaded, setBriefingsLoaded] = useState(false);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [initiatingCall, setInitiatingCall] = useState(false);
  const [openingCall, setOpeningCall] = useState(false);
  const [activeTab, setActiveTab] = useState<'briefings' | 'tasks' | 'priorities' | 'memory' | 'profile' | 'activity'>('briefings');
  const [memoryPage, setMemoryPage] = useState(1);
  const [expandedFactCats, setExpandedFactCats] = useState<Set<string>>(new Set());
  const [selectedBriefing, setSelectedBriefing] = useState<Briefing | null>(null);
  const [briefingText, setBriefingText] = useState('');
  const isWelcome = typeof window !== 'undefined' && sessionStorage.getItem('edg3_welcome') === '1';
  const [showWelcome, setShowWelcome] = useState(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem('edg3_welcome') === '1') {
      sessionStorage.removeItem('edg3_welcome');
      return true;
    }
    return false;
  });
  const [introCalling, setIntroCalling] = useState(false);
  const [showNextCallTip, setShowNextCallTip] = useState(() => isWelcome);
  const [calendarConnected, setCalendarConnected] = useState<boolean | null>(null);
  const [disconnectingCalendar, setDisconnectingCalendar] = useState(false);
  const [reminderInCalendar, setReminderInCalendar] = useState<boolean | null>(null);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [linkedNotice, setLinkedNotice] = useState(false);
  const [notifs, setNotifs] = useState<{ id: number; title: string | null; body: string | null; read: number; created_at: number }[]>([]);
  const [notifUnread, setNotifUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifChecking, setNotifChecking] = useState(false);
  const [bookFor, setBookFor] = useState<{ id: number } | null>(null);
  const [bookForm, setBookForm] = useState({ title: '', date: '', time: '14:00', duration: 30 });
  const [booking, setBooking] = useState(false);

  const loadData = useCallback(async () => {
    // Gate the page on just "who am I" (a fast local lookup) so the dashboard renders
    // immediately — then load everything else in the background. Previously the spinner
    // waited for ALL calls including the live Google Calendar checks (status/reminder),
    // which made the whole dashboard feel slow.
    const meRes = await fetch('/api/auth/me');
    if (!meRes.ok) { router.push('/login'); return; }
    setUser(await meRes.json());

    // Background loads — each section fills in as its data arrives; none blocks render.
    // Briefing history: a transient non-200 (cold start, session-timing race on first load)
    // must NOT masquerade as "you have no briefings" — that made history vanish until a manual
    // reload, and wrongly tripped the Day-1 preview. Retry a few times; only commit on a real 200.
    const loadHistory = (attempt = 0) => {
      fetch('/api/briefing/history')
        .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .then(d => { setBriefings(d.briefings || []); setBriefingsLoaded(true); })
        .catch(() => {
          if (attempt < 3) setTimeout(() => loadHistory(attempt + 1), 400 * (attempt + 1));
          else setBriefingsLoaded(true); // genuine persistent failure — stop spinning
        });
    };
    loadHistory();

    // Same retry-on-transient pattern for other user-facing data fetches — a cold-start or
    // session-timing race must not silently blank out priorities/memory/tasks until a reload.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const retryFetch = (url: string, onSuccess: (d: any) => void, attempt = 0) => {
      fetch(url)
        .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .then(onSuccess)
        .catch(() => { if (attempt < 3) setTimeout(() => retryFetch(url, onSuccess, attempt + 1), 400 * (attempt + 1)); });
    };
    retryFetch('/api/onboarding/priorities', d => setPriorities(d.priorities || []));
    retryFetch('/api/memory', d => { setMemories(d.memories || []); setFacts(d.facts || []); });
    retryFetch('/api/tasks', d => setTasks(d.tasks || []));
    // The slow ones (live Google Calendar) — no longer block the dashboard from showing.
    fetch('/api/calendar/status').then(r => r.ok ? r.json() : { connected: false }).then(d => setCalendarConnected(!!d.connected)).catch(() => {});
    fetch('/api/calendar/reminder').then(r => r.ok ? r.json() : { exists: false }).then(d => setReminderInCalendar(!!d.exists)).catch(() => {});
  }, [router]);

  async function addDailyCallReminder() {
    setReminderBusy(true);
    const res = await fetch('/api/calendar/reminder', { method: 'POST' });
    setReminderBusy(false);
    if (res.ok) setReminderInCalendar(true);
    else alert('Could not add it — make sure your Google Calendar is connected.');
  }
  async function removeDailyCallReminder() {
    setReminderBusy(true);
    await fetch('/api/calendar/reminder', { method: 'DELETE' });
    setReminderBusy(false);
    setReminderInCalendar(false);
  }

  useEffect(() => { loadData(); }, [loadData]);
  // Reset memory pagination when switching tabs or when data reloads.
  useEffect(() => { setMemoryPage(1); }, [activeTab, memories]);

  // Streak: consecutive days with a completed briefing call.
  const callStreak = useMemo(
    () => (user && briefings.length ? computeCallStreak(briefings, user.timezone) : 0),
    [briefings, user],
  );

  // Priority staleness: priorities with week_of > 7 days ago need a refresh nudge.
  const prioritiesStale = useMemo(() => {
    const weekOf = priorities[0]?.week_of;
    if (!weekOf) return false;
    return (Date.now() - new Date(weekOf + 'T00:00:00Z').getTime()) / 86400000 > 7;
  }, [priorities]);

  const [keepingPriorities, setKeepingPriorities] = useState(false);
  const [prioritiesDismissed, setPrioritiesDismissed] = useState(false);

  async function handleKeepPriorities() {
    setKeepingPriorities(true);
    await fetch('/api/priorities/keep', { method: 'POST' });
    setKeepingPriorities(false);
    setPrioritiesDismissed(true);
    // Reload priorities so week_of is fresh
    fetch('/api/onboarding/priorities').then(r => r.ok ? r.json() : { priorities: [] }).then(d => setPriorities(d.priorities || [])).catch(() => {});
  }

  // Day-1 preview: once we know the user is onboarded and has no real briefings, fetch the preview.
  // The API generates it once and caches it — subsequent calls return instantly.
  useEffect(() => {
    if (!user || !briefingsLoaded) return;
    if (!user.onboarding_complete || briefings.length > 0) return;
    setPreviewLoading(true);
    fetch('/api/briefing/preview')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.content) setPreviewContent(d.content); })
      .catch(() => {})
      .finally(() => setPreviewLoading(false));
  }, [user, briefingsLoaded, briefings.length]);

  const loadNotifs = useCallback(async () => {
    const r = await fetch('/api/notifications');
    if (!r.ok) return;
    const d = await r.json();
    setNotifs(d.notifications || []);
    setNotifUnread(d.unread || 0);
  }, []);
  useEffect(() => { loadNotifs(); }, [loadNotifs]);

  async function notifAction(action: 'check' | 'markRead' | 'markAllRead', id?: number) {
    if (action === 'check') setNotifChecking(true);
    const r = await fetch('/api/notifications', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, id }),
    });
    if (action === 'check') setNotifChecking(false);
    if (r.ok) { const d = await r.json(); setNotifs(d.notifications || []); setNotifUnread(d.unread || 0); }
  }

  function openBook(n: { id: number; title: string | null }) {
    const who = (n.title || '').split(' replied')[0].split(' · ')[0].trim() || 'contact';
    const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
    setBookForm({ title: `Meeting with ${who}`, date: today, time: '14:00', duration: 30 });
    setBookFor({ id: n.id });
  }
  async function submitBook() {
    if (!bookForm.title.trim() || !bookForm.date || !bookForm.time) { alert('Add a title, date and time.'); return; }
    setBooking(true);
    const r = await fetch('/api/calendar/book', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: bookForm.title, date: bookForm.date, time: bookForm.time, durationMins: bookForm.duration, notificationId: bookFor?.id }),
    });
    setBooking(false);
    if (r.ok) { setBookFor(null); loadNotifs(); loadData(); }
    else { const d = await r.json().catch(() => ({})); alert(d.error || 'Could not book that.'); }
  }

  // After re-linking Google, the callback returns to /dashboard?linked=1 — show a brief
  // "linked ✓" confirmation (and clean the URL) instead of any onboarding detour.
  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('linked')) {
      setLinkedNotice(true);
      window.history.replaceState({}, '', '/dashboard');
      const t = setTimeout(() => setLinkedNotice(false), 4000);
      return () => clearTimeout(t);
    }
  }, []);


  async function callIntro() {
    setIntroCalling(true);
    const res = await fetch('/api/briefing/intro', { method: 'POST' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert('Intro call failed: ' + (data.error || res.status));
      setIntroCalling(false);
    }
    // Keep modal open in "calling" state — user dismisses after call ends
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

  async function openCall() {
    setOpeningCall(true);
    const res = await fetch('/api/briefing/open-call', { method: 'POST' });
    const data = await res.json();
    setOpeningCall(false);
    if (!res.ok) {
      alert(data.error || 'Failed to start open call');
    } else {
      alert('Calling you now for an open conversation — no briefing.');
      loadData();
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  }

  async function connectCalendar() {
    const res = await fetch('/api/calendar/connect');
    const data = await res.json();
    if (data.url) window.location.href = data.url;
  }

  async function disconnectCalendar() {
    if (!confirm('Disconnect your Google Calendar? Edg3 will stop reading your schedule and can no longer add or change calendar events until you reconnect.')) return;
    setDisconnectingCalendar(true);
    const res = await fetch('/api/calendar/disconnect', { method: 'POST' });
    setDisconnectingCalendar(false);
    if (res.ok) {
      setCalendarConnected(false);
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Failed to disconnect calendar');
    }
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--surface-page)' }}>
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const latestBriefing = briefings[0];
  const statusColor = {
    completed: 'badge-success',
    calling: 'badge-pending',
    failed: 'badge-danger',
    missed: 'badge-danger',
    pending: 'badge-info',
  };

  return (
    <div className="min-h-screen relative" style={{ background: 'var(--surface-page)' }}>
      <div className="orb orb-1" />
      <div className="orb orb-2" />

      {linkedNotice && (
        <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 50, background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)', color: 'var(--edg-success)', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
          ✓ Google account linked
        </div>
      )}

      {/* Notification center */}
      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 60 }}>
        <button
          onClick={() => { const next = !notifOpen; setNotifOpen(next); if (next && notifUnread > 0) notifAction('markAllRead'); }}
          title="Notifications"
          style={{ position: 'relative', width: 40, height: 40, borderRadius: 9999, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', fontSize: 18, cursor: 'pointer' }}
        >
          🔔
          {notifUnread > 0 && (
            <span style={{ position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9999, background: 'var(--edg-danger)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {notifUnread}
            </span>
          )}
        </button>
        {notifOpen && (
          <div className="glass-card" style={{ position: 'absolute', top: 48, right: 0, width: 340, maxHeight: 420, overflowY: 'auto', padding: 12 }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold" style={{ color: 'var(--text-strong)' }}>Notifications</span>
              <button onClick={() => notifAction('check')} disabled={notifChecking} className="text-xs" style={{ color: 'var(--text-accent)' }}>
                {notifChecking ? 'Checking…' : '↻ Check for replies'}
              </button>
            </div>
            {notifs.length === 0 ? (
              <p className="text-xs py-6 text-center" style={{ color: 'var(--text-faint)' }}>No notifications yet. When someone replies to an email Edge drafted, it&apos;ll show up here.</p>
            ) : (
              notifs.map((n) => (
                <div key={n.id} className="py-2" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', opacity: n.read ? 0.6 : 1 }}>
                  <p className="text-xs font-semibold" style={{ color: 'var(--text-strong)' }}>{n.title}</p>
                  {n.body && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{n.body}</p>}
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{new Date(n.created_at).toLocaleString()}</p>
                    <button onClick={() => openBook(n)} className="text-xs" style={{ color: 'var(--text-accent)' }}>📅 Book a time</button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Quick-book modal (from a notification's "Book a time") */}
      {bookFor && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setBookFor(null)}>
          <div className="glass-card" style={{ width: 380, maxWidth: '100%', padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-bold mb-1" style={{ color: 'var(--text-strong)' }}>Book a time</p>
            <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>Confirm the details and Edge will add it to your calendar.</p>
            <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Title</label>
            <input className="input mt-1 mb-3" value={bookForm.title} onChange={(e) => setBookForm(f => ({ ...f, title: e.target.value }))} />
            <div className="flex gap-2 mb-3">
              <div className="flex-1">
                <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Date</label>
                <input type="date" className="input mt-1" value={bookForm.date} onChange={(e) => setBookForm(f => ({ ...f, date: e.target.value }))} />
              </div>
              <div className="flex-1">
                <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Time</label>
                <input type="time" className="input mt-1" value={bookForm.time} onChange={(e) => setBookForm(f => ({ ...f, time: e.target.value }))} />
              </div>
            </div>
            <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Duration</label>
            <select className="input mt-1 mb-5" value={bookForm.duration} onChange={(e) => setBookForm(f => ({ ...f, duration: Number(e.target.value) }))}>
              <option value={30} style={{ background: 'var(--edg-bg-select)' }}>30 minutes</option>
              <option value={60} style={{ background: 'var(--edg-bg-select)' }}>1 hour</option>
              <option value={90} style={{ background: 'var(--edg-bg-select)' }}>1.5 hours</option>
              <option value={120} style={{ background: 'var(--edg-bg-select)' }}>2 hours</option>
            </select>
            <div className="flex gap-2">
              <button className="btn-primary text-sm py-2 px-5" onClick={submitBook} disabled={booking}>{booking ? 'Booking…' : 'Book it'}</button>
              <button className="btn-secondary text-sm py-2 px-4" onClick={() => setBookFor(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar + main layout */}
      <div className="relative z-10 flex min-h-screen">
        {/* Sidebar */}
        <aside className="w-60 flex-shrink-0 flex flex-col py-6 px-4 border-r" style={{ borderColor: 'var(--card-border)' }}>
          <div className="mb-8">
            <span className="logo-text text-xl">EDG3</span>
          </div>

          <nav className="space-y-1">
            {[
              { id: 'briefings', label: 'Briefings', icon: '📋' },
              { id: 'tasks', label: 'Tasks', icon: '✓' },
              { id: 'priorities', label: 'Priorities', icon: '🎯' },
              { id: 'activity', label: 'Activity', icon: '⏪' },
              { id: 'memory', label: 'Memory', icon: '🧠' },
              { id: 'profile', label: 'Profile', icon: '👤' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all text-left"
                style={{
                  background: activeTab === tab.id ? 'rgba(99,102,241,0.15)' : 'transparent',
                  color: activeTab === tab.id ? 'var(--text-accent)' : 'var(--text-muted)',
                  border: activeTab === tab.id ? '1px solid rgba(99,102,241,0.2)' : '1px solid transparent',
                }}
              >
                <span>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="mt-6 space-y-3">
            <div
              className="glass-card p-3 transition-all"
              style={showNextCallTip ? {
                border: '1px solid rgba(99,102,241,0.6)',
                boxShadow: '0 0 16px rgba(99,102,241,0.25)',
              } : {}}
            >
              <div className="flex items-center gap-2 mb-1">
                <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Next call</p>
                {showNextCallTip && (
                  <span className="text-xs px-1.5 py-0.5 rounded font-semibold animate-pulse"
                    style={{ background: 'rgba(99,102,241,0.2)', color: 'var(--text-accent)' }}>
                    ← this is you
                  </span>
                )}
              </div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>
                {user.call_time} {user.timezone.split('/').pop()?.replace('_', ' ')}
              </p>
              {callStreak >= 2 && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--edg-warning, #f59e0b)' }}>
                  🔥 {callStreak}-day streak
                </p>
              )}
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                {reminderInCalendar === true ? (
                  <>
                    <span className="text-xs" style={{ color: 'var(--edg-success)' }}>✓ On your calendar</span>
                    <button onClick={removeDailyCallReminder} disabled={reminderBusy} className="text-xs ml-auto" style={{ color: 'var(--text-faint)' }}>
                      {reminderBusy ? '…' : 'Remove'}
                    </button>
                  </>
                ) : reminderInCalendar === false ? (
                  <button
                    onClick={addDailyCallReminder}
                    disabled={reminderBusy}
                    className="text-xs py-1 px-2 rounded"
                    style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--text-accent)', border: '1px solid rgba(99,102,241,0.2)' }}
                  >
                    {reminderBusy ? 'Adding…' : '📅 Add daily call to calendar'}
                  </button>
                ) : null}
              </div>
            </div>
            {prioritiesStale && !prioritiesDismissed && (
              <div className="glass-card p-3" style={{ border: '1px solid rgba(245,158,11,0.3)' }}>
                <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                  Still your top priorities this week?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setActiveTab('priorities')}
                    className="text-xs py-1 px-2 rounded flex-1"
                    style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--text-accent)', border: '1px solid rgba(99,102,241,0.2)' }}
                  >
                    Update
                  </button>
                  <button
                    onClick={handleKeepPriorities}
                    disabled={keepingPriorities}
                    className="text-xs py-1 px-2 rounded flex-1"
                    style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-faint)', border: '1px solid rgba(255,255,255,0.1)' }}
                  >
                    {keepingPriorities ? '…' : 'Keep'}
                  </button>
                </div>
              </div>
            )}
            {calendarConnected === false ? (
              <button
                onClick={connectCalendar}
                className="w-full text-xs py-2 text-left px-2 rounded"
                style={{ color: 'var(--text-faint)' }}
              >
                📅 Connect calendar
              </button>
            ) : (
              // Default for connected AND unknown/loading state — never leave the user with no
              // way to reconnect/disconnect (a null status used to render nothing here).
              <div className="px-2 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <span style={{ color: 'var(--edg-success)', fontSize: 11 }}>●</span>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{calendarConnected ? 'Calendar connected' : 'Google connection'}</p>
                </div>
                <div className="flex items-center gap-3 pl-3.5">
                  <button
                    onClick={connectCalendar}
                    className="text-xs"
                    style={{ color: 'var(--text-faint)' }}
                  >
                    Reconnect
                  </button>
                  <button
                    onClick={disconnectCalendar}
                    disabled={disconnectingCalendar}
                    className="text-xs"
                    style={{ color: 'var(--edg-danger)' }}
                  >
                    {disconnectingCalendar ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                </div>
              </div>
            )}
            {briefings.length === 0 && (
              <button
                onClick={() => { setIntroCalling(false); setShowWelcome(true); }}
                className="w-full text-xs py-2 text-left px-2 rounded"
                style={{ color: 'var(--text-faint)' }}
              >
                <span style={{ filter: 'hue-rotate(100deg) saturate(2)' }}>📞</span> Get intro call
              </button>
            )}
            <button
              onClick={logout}
              className="w-full text-xs py-2 text-left px-2 rounded"
              style={{ color: 'var(--text-faint)' }}
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
              <h1 className="text-2xl font-bold">{(() => {
                const h = new Date().getHours();
                const g = h >= 18 ? 'Good evening' : h >= 12 ? 'Good afternoon' : 'Good morning';
                return `${g}, ${user.name.split(' ')[0]}`;
              })()}</h1>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                {format(new Date(), 'EEEE, MMMM d, yyyy')}
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={openCall}
                disabled={openingCall}
                className="btn-secondary text-sm py-2 px-4"
                title="An open conversation — no briefing"
              >
                {openingCall ? 'Calling…' : '💬 Open call'}
              </button>
              <button
                onClick={initiateCall}
                disabled={initiatingCall}
                className="btn-primary text-sm py-2 px-4"
              >
                {initiatingCall ? 'Calling…' : '📞 Call me now'}
              </button>
            </div>
          </div>

          {/* Generated briefing preview */}
          {briefingText && (
            <div className="glass-card p-6 mb-6" style={{ borderColor: 'rgba(99,102,241,0.2)' }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-sm" style={{ color: 'var(--text-accent)' }}>TODAY'S BRIEFING PREVIEW</h3>
                <button onClick={() => setBriefingText('')} style={{ color: 'var(--text-faint)', fontSize: 12 }}>✕ dismiss</button>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-body)' }}>
                {briefingText}
              </p>
            </div>
          )}

          {/* Tab content */}
          {activeTab === 'briefings' && (
            <div>
              <h2 className="text-lg font-bold mb-4">Briefing history</h2>
              {briefings.length === 0 ? (
                previewLoading ? (
                  <div className="glass-card p-8 text-center" style={{ borderColor: 'rgba(99,102,241,0.2)' }}>
                    <p className="text-xs font-semibold mb-4" style={{ color: 'var(--edg-indigo)' }}>✦ HERE&apos;S WHAT EDG3 ALREADY KNOWS ABOUT YOUR WEEK</p>
                    <div className="flex items-center justify-center gap-2" style={{ color: 'var(--text-muted)' }}>
                      <span className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin inline-block" />
                      <span className="text-sm">Edg3 is putting together your preview…</span>
                    </div>
                  </div>
                ) : previewContent ? (
                  <div className="glass-card p-6 mb-4" style={{ borderColor: 'rgba(99,102,241,0.25)', background: 'rgba(99,102,241,0.04)' }}>
                    <p className="text-xs font-semibold mb-4" style={{ color: 'var(--edg-indigo)' }}>✦ HERE&apos;S WHAT EDG3 ALREADY KNOWS ABOUT YOUR WEEK</p>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-body)' }}>
                      {previewContent}
                    </p>
                    <p className="text-xs mt-4" style={{ color: 'var(--text-faint)' }}>
                      Your briefing history will appear here after your first call.
                    </p>
                  </div>
                ) : (
                  <div className="glass-card p-8 text-center">
                    <p className="text-4xl mb-3">📞</p>
                    <p className="font-medium mb-1">No briefings yet</p>
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      Click &quot;Call me now&quot; to get your first briefing, or wait for your scheduled call at {user.call_time}.
                    </p>
                  </div>
                )
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
                            <p className="text-xs mt-1 line-clamp-1 max-w-sm" style={{ color: 'var(--text-muted)' }}>
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
                          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--edg-indigo)' }}>BRIEFING CONTENT</p>
                          <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-body)' }}>
                            {b.content}
                          </p>

                          {b.transcript && (
                            <div className="mt-4 p-4 rounded-lg" style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)' }}>
                              <p className="text-xs font-semibold mb-3" style={{ color: 'var(--edg-indigo)' }}>CALL TRANSCRIPT</p>
                              <div className="space-y-2">
                                {b.transcript.split('\n').filter((l: string) => l.trim()).map((line: string, i: number) => {
                                  const isUser = line.startsWith('User:') || line.startsWith('Customer:');
                                  const isAI = line.startsWith('Assistant:') || line.startsWith('Bot:') || line.startsWith('AI:');
                                  const text = line.replace(/^(User:|Customer:|Assistant:|Bot:|AI:)\s*/, '');
                                  return (
                                    <div key={i} className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
                                      <p className="text-xs leading-relaxed px-3 py-2 rounded-lg max-w-xs"
                                        style={{
                                          background: isUser ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.05)',
                                          color: isUser ? 'var(--text-strong)' : 'var(--text-muted)',
                                        }}>
                                        {text}
                                      </p>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {b.edge_promises && (() => {
                            try {
                              const promises = JSON.parse(b.edge_promises);
                              if (!promises.length) return null;
                              return (
                                <div className="mt-4 p-4 rounded-lg" style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)' }}>
                                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-accent)' }}>✅ EDGE ACTION ITEMS</p>
                                  <div className="space-y-1">
                                    {promises.map((p: string, i: number) => (
                                      <p key={i} className="text-xs" style={{ color: 'var(--text-body)' }}>
                                        <span style={{ color: 'var(--edg-indigo)' }}>→</span> {p}
                                      </p>
                                    ))}
                                  </div>
                                </div>
                              );
                            } catch { return null; }
                          })()}

                          {(b as any).calendar_actions && (() => {
                            try {
                              const actions = JSON.parse((b as any).calendar_actions);
                              if (!actions.length) return null;
                              return (
                                <div className="mt-4 p-4 rounded-lg" style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.15)' }}>
                                  <p className="text-xs font-semibold mb-2" style={{ color: '#4ade80' }}>📅 CALENDAR ACTIONS</p>
                                  <div className="space-y-1">
                                    {actions.map((a: any, i: number) => (
                                      <p key={i} className="text-xs" style={{ color: 'var(--text-body)' }}>
                                        <span style={{ color: '#4ade80' }}>✓</span> {a.type === 'created' ? 'Added' : a.type} — {a.title}
                                        {a.start && <span style={{ color: 'var(--text-muted)' }}> · {new Date(a.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>}
                                      </p>
                                    ))}
                                  </div>
                                </div>
                              );
                            } catch { return null; }
                          })()}

                          {b.tool_actions && (() => {
                            try {
                              const labels = summarizeUserFacingActions(JSON.parse(b.tool_actions));
                              if (!labels.length) return null;
                              return (
                                <div className="mt-4 p-4 rounded-lg" style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)' }}>
                                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-accent)' }}>🛠 EDGE&apos;S ACTIONS THIS CALL</p>
                                  <div className="space-y-1.5">
                                    {labels.map((label: string, i: number) => (
                                      <div key={i} className="text-xs flex items-start gap-2" style={{ color: 'var(--text-body)' }}>
                                        <span style={{ color: '#4ade80' }}>✓</span>
                                        <span>{label}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            } catch { return null; }
                          })()}
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
            }} onCompleteAll={async (ids) => {
              await fetch('/api/tasks/complete-all', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids }),
              });
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

          {activeTab === 'activity' && <ActivityTab />}

          {activeTab === 'memory' && (
            <div>
              <h2 className="text-lg font-bold mb-4">What Edge knows</h2>
              <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
                Structured facts Edge has learned about you, your work, and your world — built up over every call.
              </p>

              {/* Structured facts grouped by category */}
              {facts.length > 0 && (() => {
                const CATEGORY_LABELS: Record<string, string> = {
                  goal: 'Goals',
                  project: 'Projects',
                  person: 'People',
                  preference: 'Preferences',
                  fact: 'Facts',
                };
                const FACTS_CAT_LIMIT = 15;
                const ORDER = ['goal', 'project', 'person', 'preference', 'fact'];
                const grouped = ORDER.reduce<Record<string, Fact[]>>((acc, cat) => {
                  const items = facts.filter(f => f.category === cat);
                  if (items.length) acc[cat] = items;
                  return acc;
                }, {});
                return (
                  <div className="space-y-6 mb-8">
                    {Object.entries(grouped).map(([cat, items]) => {
                      const isExpanded = expandedFactCats.has(cat);
                      const visible = items.length > FACTS_CAT_LIMIT && !isExpanded ? items.slice(0, FACTS_CAT_LIMIT) : items;
                      return (
                        <div key={cat}>
                          <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-faint)' }}>
                            {CATEGORY_LABELS[cat] ?? cat}
                          </h3>
                          <div className="space-y-2">
                            {visible.map(f => (
                              <div key={f.id} className="glass-card p-3 flex items-start justify-between gap-4">
                                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
                                  {f.entity && (
                                    <span className="font-semibold" style={{ color: 'var(--text-strong)' }}>{f.entity}: </span>
                                  )}
                                  {f.statement}
                                </p>
                                <span className="text-xs shrink-0 mt-0.5" style={{ color: 'var(--text-faint)' }}>
                                  learned {format(new Date(f.learned_at), 'MMM d')}
                                </span>
                              </div>
                            ))}
                          </div>
                          {items.length > FACTS_CAT_LIMIT && (
                            <button
                              onClick={() => setExpandedFactCats(prev => {
                                const next = new Set(prev);
                                isExpanded ? next.delete(cat) : next.add(cat);
                                return next;
                              })}
                              className="mt-2 text-xs"
                              style={{ color: 'var(--text-accent)' }}
                            >
                              {isExpanded ? 'Show less' : `Show all (${items.length})`}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Raw memories — paginated */}
              {memories.length > 0 && (() => {
                const PAGE_SIZE = 20;
                const totalPages = Math.ceil(memories.length / PAGE_SIZE);
                const page = Math.min(memoryPage, totalPages);
                const pageItems = memories.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
                return (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-faint)' }}>
                      Call notes
                    </h3>
                    <div className="space-y-3">
                      {pageItems.map(m => (
                        <div key={m.id} className="glass-card p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`badge ${
                              m.type === 'insight' ? 'badge-success' :
                              m.type === 'transcript' ? 'badge-info' :
                              m.type === 'profile' ? 'badge-pending' : 'badge-info'
                            }`}>
                              {m.type}
                            </span>
                            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                              {format(new Date(m.created_at), 'MMM d, yyyy')}
                            </span>
                          </div>
                          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
                            {m.content.length > 300 ? m.content.slice(0, 300) + '…' : m.content}
                          </p>
                        </div>
                      ))}
                    </div>
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between mt-4">
                        <button
                          onClick={() => setMemoryPage(p => Math.max(1, p - 1))}
                          disabled={page <= 1}
                          className="btn-secondary text-sm py-1.5 px-4"
                        >
                          Prev
                        </button>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          Page {page} of {totalPages}
                        </span>
                        <button
                          onClick={() => setMemoryPage(p => Math.min(totalPages, p + 1))}
                          disabled={page >= totalPages}
                          className="btn-secondary text-sm py-1.5 px-4"
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {facts.length === 0 && memories.length === 0 && (
                <div className="glass-card p-8 text-center">
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No memories yet. They'll build after your first call.</p>
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
            <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
              Edg3 will call you now at <span style={{ color: 'var(--text-strong)', fontWeight: 600 }}>{(user as any)?.phone_number || 'your phone'}</span> for a quick 30-second intro — your first of many conversations.
            </p>
            <div className="space-y-2 text-left glass-card p-4 mb-6" style={{ background: 'rgba(99,102,241,0.05)' }}>
              <p className="text-xs font-semibold mb-3" style={{ color: 'var(--edg-indigo)' }}>EDG3 WILL HELP YOU:</p>
              {['Align your calendar with your actual priorities', 'Track patterns in your life you\'re too close to see', 'Hold you accountable — honestly, like a great advisor'].map((item, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="text-indigo-400 font-bold text-sm">{i + 1}.</span>
                  <p className="text-sm" style={{ color: 'var(--text-body)' }}>{item}</p>
                </div>
              ))}
            </div>
            {!introCalling ? (
              <button
                onClick={callIntro}
                className="btn-primary w-full py-3 text-base"
              >
                <span style={{ filter: 'hue-rotate(100deg) saturate(2)' }}>📞</span> Meet Edg3
              </button>
            ) : (
              <div className="text-center space-y-4">
                <div className="flex items-center justify-center gap-3 py-3">
                  <span className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                  <span className="font-semibold" style={{ color: 'var(--text-accent)' }}>Edg3 is calling you now…</span>
                </div>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Pick up — it'll only take 30 seconds.</p>
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
