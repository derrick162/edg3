'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { summarizeUserFacingActions } from '@/lib/actionSummary';
import { computeCallStreak } from '@/lib/streak';
import { RecoveryCard, EdgeScoreCard, FocusRecommendationCard, DayPlanCard, NotificationBell, NotificationCenter, ActivationCard, ContentSection, OpenLoopsSection, HelpSupportSection, TimeAllocationViz } from '@/components/ui';
import type { CalendarFit, FocusRecommendation, FocusRecommendationArea, CalendarPlan as DayPlanType, OpenLoop, TimeAllocationBucket } from '@/components/ui';
import { PriorityDerivationCard, PriorityDerivationLoadingCard } from '@/components/ui/PriorityDerivationCard';

// Speech-to-text mis-hears the user's name (e.g. "Derek" for "Derrick"). Stored transcripts
// and call-derived memories are verbatim, but we know the real spelling from the profile — so
// SQLite stores timestamps as "2026-06-16 01:20:00" (space, no 'Z') — V8 parses that as LOCAL
// time, shifting dates by the UTC offset (e.g. shows "Tuesday" at 9 PM ET when it's still Monday).
// Normalise to ISO 8601 with an explicit 'Z' so the Date is correctly interpreted as UTC,
// then displayed in the user's local timezone by the browser.
function parseUTC(ts: string): Date {
  return new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
}

// for DISPLAY only, correct capitalized words that are clearly a mishearing of the user's first
// name (same first 3 letters, similar length). Conservative: leaves all other words untouched.
function correctName(text: string, firstName: string): string {
  const fn = (firstName || '').trim();
  if (fn.length < 3) return text;
  const key = fn.slice(0, 3).toLowerCase();
  return text.replace(/\b[A-Z][a-zA-Z]{2,}\b/g, (w) => {
    if (w.toLowerCase() === fn.toLowerCase()) return w;
    if (w.slice(0, 3).toLowerCase() === key && Math.abs(w.length - fn.length) <= 2) return fn;
    return w;
  });
}

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

  if (loading) return (
    <div className="space-y-4 mt-2 animate-pulse">
      {[1, 2, 3].map(i => (
        <div key={i} className="glass-card p-5">
          <div className="h-3 rounded w-1/4 mb-4" style={{ background: 'var(--edg-fill-04)' }} />
          <div className="h-9 rounded" style={{ background: 'var(--edg-fill-04)' }} />
        </div>
      ))}
    </div>
  );

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

function SectionHint({ id, text }: { id: string; text: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (typeof window !== 'undefined' && !localStorage.getItem(`edg3-hint-${id}`)) {
      setVisible(true);
    }
  }, [id]);
  if (!visible) return null;
  return (
    <div
      className="flex items-start gap-3 mb-5 px-3 py-2.5 rounded-lg"
      style={{ background: 'var(--edg-fill-04)', borderLeft: '2px solid var(--edg-hairline)' }}
    >
      <p className="text-xs flex-1 leading-relaxed" style={{ color: 'var(--text-faint)' }}>
        {text}
      </p>
      <button
        onClick={() => { localStorage.setItem(`edg3-hint-${id}`, '1'); setVisible(false); }}
        className="text-xs flex-shrink-0 mt-0.5 px-1"
        style={{ color: 'var(--text-faint)' }}
        aria-label="Dismiss"
      >
        &#x2715;
      </button>
    </div>
  );
}

interface Milestone {
  id: number;
  priority_id: number;
  title: string;
  done: number;
  completed_at: string | null;
}

function PrioritiesTab({
  priorities, milestones, onSave, onMilestoneAdd, onMilestoneToggle, onMilestoneDelete,
}: {
  priorities: Priority[];
  milestones: Milestone[];
  onSave: (p: string[]) => Promise<void>;
  onMilestoneAdd?: (priorityId: number, text: string) => Promise<void>;
  onMilestoneToggle?: (id: number, done: boolean) => Promise<void>;
  onMilestoneDelete?: (id: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState(['', '', '']);
  const [loading, setLoading] = useState(false);
  const [newMilestoneText, setNewMilestoneText] = useState<{ [priorityId: number]: string }>({});
  const [addingMilestone, setAddingMilestone] = useState<number | null>(null);

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
      <SectionHint
        id="priorities"
        text="Your north star. Edge anchors every briefing and scheduling suggestion to these."
      />
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">This week&apos;s priorities</h2>
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
                   style={{ background: 'var(--edg-accent-20)', color: 'var(--text-accent)' }}>
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
                       style={{ background: 'var(--edg-accent-20)', color: 'var(--text-accent)' }}>
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm mb-3">{p.text}</p>
                    {/* Milestone checklist */}
                    {(() => {
                      const pMilestones = milestones.filter(m => m.priority_id === p.id);
                      const done = pMilestones.filter(m => m.done === 1).length;
                      return (
                        <div className="space-y-1">
                          {pMilestones.length > 0 && (
                            <p className="text-xs mb-1" style={{ color: 'var(--text-faint)' }}>
                              Milestones {done}/{pMilestones.length}
                            </p>
                          )}
                          {pMilestones.map(m => (
                            <div key={m.id} className="flex items-center gap-2 group">
                              <button
                                onClick={() => onMilestoneToggle?.(m.id, m.done === 0)}
                                className="flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-all"
                                style={{
                                  background: m.done === 1 ? 'var(--edg-success)' : 'transparent',
                                  borderColor: m.done === 1 ? 'var(--edg-success)' : 'var(--edg-hairline)',
                                }}
                              >
                                {m.done === 1 && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>}
                              </button>
                              <span className="text-xs flex-1" style={{
                                color: m.done === 1 ? 'var(--text-faint)' : 'var(--text-muted)',
                                textDecoration: m.done === 1 ? 'line-through' : 'none',
                              }}>
                                {m.title}
                              </span>
                              <button
                                onClick={() => onMilestoneDelete?.(m.id)}
                                aria-label="Remove milestone"
                                className="opacity-30 group-hover:opacity-100 focus:opacity-100 text-xs transition-opacity p-1"
                                style={{ color: 'var(--edg-danger)' }}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          {addingMilestone === p.id ? (
                            <div className="flex items-center gap-2 mt-1">
                              <input
                                autoFocus
                                className="input text-xs py-0.5 flex-1"
                                placeholder="Add a milestone…"
                                value={newMilestoneText[p.id] || ''}
                                onChange={e => setNewMilestoneText(prev => ({ ...prev, [p.id]: e.target.value }))}
                                onKeyDown={async e => {
                                  if (e.key === 'Enter') {
                                    const text = (newMilestoneText[p.id] || '').trim();
                                    if (text) { await onMilestoneAdd?.(p.id, text); setNewMilestoneText(prev => ({ ...prev, [p.id]: '' })); }
                                    setAddingMilestone(null);
                                  } else if (e.key === 'Escape') { setAddingMilestone(null); }
                                }}
                                onBlur={async () => {
                                  const text = (newMilestoneText[p.id] || '').trim();
                                  if (text) { await onMilestoneAdd?.(p.id, text); setNewMilestoneText(prev => ({ ...prev, [p.id]: '' })); }
                                  setAddingMilestone(null);
                                }}
                              />
                            </div>
                          ) : (
                            <button
                              onClick={() => setAddingMilestone(p.id)}
                              className="text-xs mt-0.5"
                              style={{ color: 'var(--text-faint)' }}
                            >
                              + milestone
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
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
  emailReceiptId?: number | null;
}

function ActivityTab() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [undoingId, setUndoingId] = useState<number | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // email_signal_fetch subject receipts: receiptId → subjects[] | 'loading' | 'error'
  // 'none' = this (older) scan predates subject-recording — not an error, just nothing to show.
  const [emailSubjects, setEmailSubjects] = useState<Record<number, string[] | 'loading' | 'error' | 'none'>>({});

  async function load() {
    setLoading(true);
    const r = await fetch('/api/activity');
    if (!r.ok) { setLoading(false); return; }
    const d = await r.json();
    setItems(d.items || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleExpandItem(item: ActivityItem) {
    const isExpanded = expandedId === item.id;
    setExpandedId(isExpanded ? null : item.id);
    // Eagerly load email subjects when expanding an email receipt row.
    if (!isExpanded && item.emailReceiptId && emailSubjects[item.emailReceiptId] === undefined) {
      setEmailSubjects(prev => ({ ...prev, [item.emailReceiptId!]: 'loading' }));
      try {
        const r = await fetch(`/api/activity/email-receipt/${item.emailReceiptId}`);
        if (r.ok) {
          const d = await r.json();
          setEmailSubjects(prev => ({ ...prev, [item.emailReceiptId!]: d.subjects ?? [] }));
        } else if (r.status === 404) {
          // Older scan from before Edge started recording subjects — graceful, not an error.
          setEmailSubjects(prev => ({ ...prev, [item.emailReceiptId!]: 'none' }));
        } else {
          setEmailSubjects(prev => ({ ...prev, [item.emailReceiptId!]: 'error' }));
        }
      } catch {
        setEmailSubjects(prev => ({ ...prev, [item.emailReceiptId!]: 'error' }));
      }
    }
  }

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
    const ms = Date.now() - parseUTC(created_at).getTime();
    const s = Math.floor(ms / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  }

  function dayLabel(created_at: string): string {
    const d = parseUTC(created_at);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return format(d, 'EEEE, MMM d');
  }

  function actionIcon(action: string): string {
    if (action.includes('delete') || action.includes('Delete')) return '🗑';
    if (action.includes('move') || action.includes('Move')) return '⇅';
    if (action.includes('email') || action.includes('Email') || action.includes('draft') || action.includes('Draft')) return '✉';
    if (action.includes('research') || action.includes('Research')) return '🔍';
    if (action.includes('edit') || action.includes('Edit') || action.includes('update') || action.includes('Update')) return '✎';
    return '📅';
  }

  if (loading) return (
    <div className="space-y-3 mt-2">
      {[1, 2, 3].map(i => (
        <div key={i} className="glass-card p-4 animate-pulse">
          <div className="h-3 rounded w-1/3 mb-3" style={{ background: 'var(--edg-fill-04)' }} />
          <div className="h-4 rounded w-3/4 mb-2" style={{ background: 'var(--edg-fill-04)' }} />
          <div className="h-3 rounded w-1/2" style={{ background: 'var(--edg-fill-04)' }} />
        </div>
      ))}
    </div>
  );

  // Group items by day
  const groups: { day: string; items: ActivityItem[] }[] = [];
  for (const item of items) {
    const day = dayLabel(item.created_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) {
      last.items.push(item);
    } else {
      groups.push({ day, items: [item] });
    }
  }

  return (
    <div>
      <SectionHint
        id="activity"
        text="Every change Edge made to your calendar. Review or undo anything."
      />
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-bold">Edge&apos;s actions</h2>
        <button onClick={load} className="text-xs" style={{ color: 'var(--text-faint)' }}>↻ Refresh</button>
      </div>
      <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
        Every change Edge makes appears here — review it, undo it, or just keep the audit trail.
      </p>

      {undoError && (
        <div className="mb-4 text-sm px-4 py-2 rounded-lg" style={{ background: 'var(--edg-danger-tint)', border: '1px solid var(--edg-danger-border)', color: 'var(--edg-danger)' }}>
          {undoError}
        </div>
      )}

      {items.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <p className="text-3xl mb-3" role="img" aria-label="shield">&#x1F6E1;</p>
          <p className="font-semibold mb-2">Edge hasn&apos;t changed anything yet</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            You&apos;ll see every calendar action here — nothing happens without a trace.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map(group => (
            <div key={group.day}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-faint)' }}>
                {group.day}
              </p>
              <div className="space-y-1.5">
                {group.items.map(item => {
                  const isExpanded = expandedId === item.id;
                  const isUndone = item.undone === 1;
                  const canUndo = item.undoId !== null && !isUndone;
                  const hasDetail = !!item.detail;
                  return (
                    <div
                      key={item.id}
                      className="glass-card overflow-hidden"
                      style={{ opacity: isUndone ? 0.5 : 1, transition: 'opacity 0.15s' }}
                    >
                      <div
                        className="px-4 py-3 flex items-center gap-3"
                        style={{ cursor: hasDetail ? 'pointer' : 'default' }}
                        onClick={() => hasDetail && handleExpandItem(item)}
                        role={hasDetail ? 'button' : undefined}
                        aria-expanded={hasDetail ? isExpanded : undefined}
                      >
                        {/* Action icon */}
                        <span
                          className="text-base flex-shrink-0 w-6 text-center"
                          style={{ filter: isUndone ? 'grayscale(1)' : 'none' }}
                          aria-hidden="true"
                        >
                          {actionIcon(item.action)}
                        </span>

                        {/* Label + time */}
                        <div className="flex-1 min-w-0">
                          <p
                            className="text-sm leading-snug"
                            style={{ color: isUndone ? 'var(--text-faint)' : 'var(--text-body)' }}
                          >
                            {item.label}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                              {relativeTime(item.created_at)}
                            </span>
                            {isUndone && (
                              <span
                                className="text-xs px-1.5 py-0.5 rounded"
                                style={{ background: 'var(--edg-fill-hover)', color: 'var(--text-faint)' }}
                              >
                                undone
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Controls */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {canUndo && (
                            <button
                              onClick={e => { e.stopPropagation(); handleUndo(item.undoId!); }}
                              disabled={undoingId !== null}
                              className="text-xs py-1 px-2.5 rounded-md font-medium"
                              style={{
                                background: 'var(--edg-fill-hover)',
                                color: undoingId === item.undoId ? 'var(--text-faint)' : 'var(--text-muted)',
                                border: '1px solid var(--edg-hairline)',
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
                          style={{ borderTop: '1px solid var(--edg-hairline)' }}
                        >
                          {/* Email receipt — lazy-fetched via handleExpandItem */}
                          {item.emailReceiptId && (() => {
                            const state = emailSubjects[item.emailReceiptId];
                            const SIGNAL_KEYWORDS = ['urgent', 'invoice', 'legal', 'contract', 'overdue', 'payment', 'lawsuit', 'agreement'];
                            const isFlagged = (s: string) => SIGNAL_KEYWORDS.some(k => s.toLowerCase().includes(k));
                            return (
                              <div className="mt-3">
                                <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-faint)', letterSpacing: '0.04em' }}>
                                  Threads Edge reviewed
                                </p>
                                {state === 'loading' ? (
                                  <div className="space-y-1.5 animate-pulse">
                                    {[80, 65, 75].map((w, i) => (
                                      <div key={i} className="h-7 rounded" style={{ background: 'var(--edg-fill-04)', width: `${w}%` }} />
                                    ))}
                                  </div>
                                ) : state === 'error' ? (
                                  <p className="text-xs px-3 py-2 rounded-lg" style={{ background: 'var(--edg-fill-04)', color: 'var(--text-faint)' }}>
                                    Couldn&apos;t load subjects for this scan.
                                  </p>
                                ) : (state === 'none' || (Array.isArray(state) && state.length === 0)) ? (
                                  <p className="text-xs px-3 py-2 rounded-lg" style={{ background: 'var(--edg-fill-04)', color: 'var(--text-faint)' }}>
                                    No subject lines recorded — newer scans will show them here.
                                  </p>
                                ) : Array.isArray(state) ? (() => {
                                  const flagged = state.filter(isFlagged);
                                  const rest = state.filter(s => !isFlagged(s));
                                  const SHOW = 10;
                                  const overflow = state.length - SHOW;
                                  return (
                                    <div className="space-y-1">
                                      {flagged.slice(0, SHOW).map((s, i) => (
                                        <div key={`f${i}`} className="flex items-start gap-2 text-xs px-2.5 py-1.5 rounded-lg"
                                             style={{ background: 'var(--edg-warning-tint)', color: 'var(--text-muted)', border: '1px solid var(--edg-warning-border)' }}>
                                          <span className="flex-shrink-0 mt-0.5" style={{ color: 'var(--edg-warning)' }}>⚑</span>
                                          <span className="leading-snug">{s}</span>
                                        </div>
                                      ))}
                                      {rest.slice(0, Math.max(0, SHOW - flagged.length)).map((s, i) => (
                                        <div key={`r${i}`} className="text-xs px-2.5 py-1.5 rounded-lg leading-snug"
                                             style={{ background: 'var(--edg-fill-04)', color: 'var(--text-muted)' }}>
                                          {s}
                                        </div>
                                      ))}
                                      {overflow > 0 && (
                                        <p className="pt-0.5 text-xs" style={{ color: 'var(--text-faint)' }}>+ {overflow} more threads</p>
                                      )}
                                      <p className="pt-1 text-xs" style={{ color: 'var(--text-faint)', fontSize: '10px' }}>
                                        Subject lines only — Edge never reads message content.
                                      </p>
                                    </div>
                                  );
                                })() : null}
                              </div>
                            );
                          })()}
                          {/* Generic detail sections for non-receipt rows */}
                          {!item.emailReceiptId && item.detail && item.detail.sections.length > 0 && (
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
                                    <div className="text-xs p-2 rounded" style={{ background: 'var(--edg-danger-tint)' }}>
                                      <p className="font-semibold mb-1" style={{ color: 'var(--edg-danger)' }}>Before</p>
                                      <p style={{ color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>{c.before}</p>
                                    </div>
                                    <div className="text-xs p-2 rounded" style={{ background: 'var(--edg-calendar-green-tint)' }}>
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
            </div>
          ))}
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
  // Core populates these when available
  confidence?: 'low' | null;
  source_briefing_id?: number | null;
}

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [priorities, setPriorities] = useState<Priority[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [briefingsLoaded, setBriefingsLoaded] = useState(false);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [initiatingCall, setInitiatingCall] = useState(false);
  const [openingCall, setOpeningCall] = useState(false);
  const [activeTab, setActiveTab] = useState<'home' | 'briefings' | 'priorities' | 'memory' | 'profile' | 'activity' | 'help'>('home');
  const [memoryPage, setMemoryPage] = useState(1);
  const [expandedFactCats, setExpandedFactCats] = useState<Set<string>>(new Set());
  const [expandedMemorySections, setExpandedMemorySections] = useState<Set<string>>(new Set());
  const [callNotesExpanded, setCallNotesExpanded] = useState(false);
  const [editingFactId, setEditingFactId] = useState<number | null>(null);
  const [editFactText, setEditFactText] = useState('');
  const [deletingFactId, setDeletingFactId] = useState<number | null>(null);
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
  const [whoopConnected, setWhoopConnected] = useState<boolean | null>(null);
  const [disconnectingWhoop, setDisconnectingWhoop] = useState(false);
  const [whoopIntelligence, setWhoopIntelligence] = useState<{
    deviationPts: number | null;
    flags: string[];
    recoveryAction: string | null;
  } | null>(null);
  const [timeAllocation, setTimeAllocation] = useState<{
    buckets: TimeAllocationBucket[];
    periodWeeks: number;
    biggestMisalignment: string | null;
  } | null>(null);
  const [whoopData, setWhoopData] = useState<{
    recoveryScore: number | null;
    tier: 'high' | 'medium' | 'low' | null;
    sleepHours: number | null;
    sleepScore: number | null;
    sleepTier: 'high' | 'medium' | 'low' | null;
    strain: number | null;
    history: { date: string; score: number }[];
  } | null>(null);
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
  const [todayCallStatus, setTodayCallStatus] = useState<{ status: string } | null>(null);
  const [retryingCall, setRetryingCall] = useState(false);
  const [retryCalled, setRetryCalled] = useState(false);
  const [copiedTranscriptId, setCopiedTranscriptId] = useState<number | null>(null);
  const [energySignal, setEnergySignal] = useState<{ level: 'red' | 'yellow' | 'green'; source: string } | null>(null);
  const [settingEnergy, setSettingEnergy] = useState(false);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [calendarFit, setCalendarFit] = useState<CalendarFit | null>(null);
  const [calendarFitLoading, setCalendarFitLoading] = useState(false);
  const [celebrateFromScore, setCelebrateFromScore] = useState<number | null>(null);
  const [focusRec, setFocusRec] = useState<FocusRecommendation | null>(null);
  const [focusRecLoading, setFocusRecLoading] = useState(false);
  const [focusRecDismissed, setFocusRecDismissed] = useState(false);
  const [focusCandidates, setFocusCandidates] = useState<FocusRecommendationArea[]>([]);
  const [confirmedFocusAreas, setConfirmedFocusAreas] = useState<FocusRecommendationArea[] | null>(null);
  const [dayPlan, setDayPlan] = useState<DayPlanType | null>(null);
  const [dayPlanLoading, setDayPlanLoading] = useState(false);
  const [dayPlanApplied, setDayPlanApplied] = useState(false);
  const [dayPlanAppliedScore, setDayPlanAppliedScore] = useState<number | undefined>(undefined);
  const dayPlanRef = useRef<HTMLDivElement>(null);

  const [activationFacts, setActivationFacts] = useState<string[]>([]);
  const [activationDismissed, setActivationDismissed] = useState(false);
  const [openLoops, setOpenLoops] = useState<OpenLoop[]>([]);
  const [derivedProposal, setDerivedProposal] = useState<{
    priorities: { text: string; rationale: string; evidenceTags: string[] }[];
    summaryLine: string;
  } | null>(null);
  const [deriveLoading, setDeriveLoading] = useState(false);
  const [deriveDismissed, setDeriveDismissed] = useState(false);
  const [acceptingDerived, setAcceptingDerived] = useState(false);

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
    // session-timing race must not silently blank out priorities/memory until a reload.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const retryFetch = (url: string, onSuccess: (d: any) => void, attempt = 0) => {
      fetch(url)
        .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .then(onSuccess)
        .catch(() => { if (attempt < 3) setTimeout(() => retryFetch(url, onSuccess, attempt + 1), 400 * (attempt + 1)); });
    };
    retryFetch('/api/onboarding/priorities', d => setPriorities(d.priorities || []));
    retryFetch('/api/memory', d => { setMemories(d.memories || []); setFacts(d.facts || []); });
    // The slow ones (live Google Calendar) — no longer block the dashboard from showing.
    fetch('/api/briefing/today-status').then(r => r.ok ? r.json() : null).then(d => { if (d) setTodayCallStatus(d); }).catch(() => {});
    fetch('/api/energy/today').then(r => r.ok ? r.json() : null).then(d => { if (d?.signal) setEnergySignal(d.signal); }).catch(() => {});
    setCalendarFitLoading(true);
    fetch('/api/scores').then(r => r.ok ? r.json() : null).then(d => { if (d) setCalendarFit(d); }).catch(() => {}).finally(() => setCalendarFitLoading(false));
    setFocusRecLoading(true);
    fetch('/api/focus/recommend').then(r => r.ok ? r.json() : null).then(d => { if (d) { setFocusRec(d); if (d.candidates) setFocusCandidates(d.candidates); } }).catch(() => {}).finally(() => setFocusRecLoading(false));
    setDayPlanLoading(true);
    fetch('/api/day-plan').then(r => r.ok ? r.json() : null).then(d => { setDayPlan(d ?? null); }).catch(() => {}).finally(() => setDayPlanLoading(false));
    retryFetch('/api/milestones', d => setMilestones(d.milestones || []));
    fetch('/api/learned').then(r => r.ok ? r.json() : null).then(d => { if (d?.recentFacts) setActivationFacts(d.recentFacts.map((f: { statement: string }) => f.statement)); }).catch(() => {});
    fetch('/api/open-loops').then(r => r.ok ? r.json() : null).then(d => { if (d?.loops) setOpenLoops(d.loops); }).catch(() => {});
    fetch('/api/focus/confirm').then(r => r.ok ? r.json() : null).then(d => { if (d?.confirmed && d.areas?.length) setConfirmedFocusAreas(d.areas); }).catch(() => {});
    fetch('/api/calendar/status').then(r => r.ok ? r.json() : { connected: false }).then(d => setCalendarConnected(!!d.connected)).catch(() => {});
    fetch('/api/calendar/reminder').then(r => r.ok ? r.json() : { exists: false }).then(d => setReminderInCalendar(!!d.exists)).catch(() => {});
    fetch('/api/whoop/status').then(r => r.ok ? r.json() : { connected: false }).then(d => {
      setWhoopConnected(!!d.connected);
      if (d.connected) {
        // Connected → pull recovery score + 14-day history for the dashboard card.
        fetch('/api/whoop/recovery')
          .then(r => r.ok ? r.json() : null)
          .then(rd => { if (rd && rd.connected) setWhoopData(rd); })
          .catch(() => {});
        // Whoop Intelligence (deviation, flags, action) — gracefully 404 until Darren ships endpoint
        fetch('/api/whoop/intelligence')
          .then(r => r.ok ? r.json() : null)
          .then(intel => { if (intel) setWhoopIntelligence(intel); })
          .catch(() => {});
      }
    }).catch(() => {});
    // Time allocation (gracefully absent until Core ships /api/time-allocation)
    fetch('/api/time-allocation')
      .then(r => r.ok ? r.json() : null)
      .then(ta => { if (ta?.buckets?.length) setTimeAllocation(ta); })
      .catch(() => {});
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

  async function saveFact(id: number, statement: string) {
    setFacts(prev => prev.map(f => f.id === id ? { ...f, statement } : f));
    setEditingFactId(null);
    await fetch(`/api/memory/facts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statement }),
    });
  }

  async function deleteFact(id: number) {
    setFacts(prev => prev.filter(f => f.id !== id));
    setDeletingFactId(null);
    await fetch(`/api/memory/facts/${id}`, { method: 'DELETE' });
  }

  async function handleConfirmFocus(areas: FocusRecommendationArea[]) {
    const oldScore = typeof calendarFit?.edgeScore === 'number' ? calendarFit.edgeScore : null;
    await fetch('/api/focus/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ areas }),
    });
    // Transition card to confirmed state (don't dismiss — the locked view fills the slot)
    setConfirmedFocusAreas(areas);
    // Re-fetch Edge Score — Momentum bonus fires on confirm so the number rises.
    fetch('/api/scores').then(r => r.ok ? r.json() : null).then(s => {
      if (s) {
        setCalendarFit(s);
        // Trigger celebration animation when score genuinely rose
        if (oldScore !== null && typeof s.edgeScore === 'number' && s.edgeScore > oldScore) {
          setCelebrateFromScore(oldScore);
        }
      }
    }).catch(() => {});
  }

  async function handleCompleteArea(idOrTitle: string) {
    await fetch('/api/focus/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idOrTitle }),
    }).catch(() => {});
  }

  async function handleDismissArea(idOrTitle: string) {
    await fetch('/api/focus/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idOrTitle }),
    }).catch(() => {});
  }

  async function handleConfirmDayPlan(planId: string) {
    const oldScore = typeof calendarFit?.edgeScore === 'number' ? calendarFit.edgeScore : null;
    const res = await fetch('/api/day-plan/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId }),
    });
    const d = await res.json().catch(() => ({}));
    setDayPlanApplied(true);
    if (d.newScore != null) {
      setDayPlanAppliedScore(d.newScore);
      fetch('/api/scores').then(r => r.ok ? r.json() : null).then(s => {
        if (s) {
          setCalendarFit(s);
          if (oldScore !== null && typeof s.edgeScore === 'number' && s.edgeScore > oldScore) {
            setCelebrateFromScore(oldScore);
          }
        }
      }).catch(() => {});
    }
  }

  async function retryBriefingCall() {
    setRetryingCall(true);
    const res = await fetch('/api/briefing/retry-call', { method: 'POST' });
    setRetryingCall(false);
    if (res.ok) {
      setRetryCalled(true);
      setTodayCallStatus({ status: 'calling' });
    } else {
      const d = await res.json().catch(() => ({}));
      alert(d.error || 'Could not place the call — please try again shortly.');
    }
  }

  useEffect(() => { loadData(); }, [loadData]);

  // Reset memory pagination when switching tabs or when data reloads.
  useEffect(() => { setMemoryPage(1); }, [activeTab, memories]);
  // Deep-link: ?briefing=<id> auto-expands that briefing entry once history loads.
  useEffect(() => {
    // Read from window (client-only) rather than useSearchParams — the latter forces a
    // <Suspense> boundary / breaks static prerender of this page. Matches the ?linked pattern.
    const idParam = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('briefing') : null;
    if (!idParam || !briefingsLoaded || !briefings.length) return;
    const id = parseInt(idParam, 10);
    if (isNaN(id)) return;
    const target = briefings.find(b => b.id === id);
    if (target) {
      setActiveTab('briefings');
      setSelectedBriefing(target);
    }
  }, [briefingsLoaded, briefings]);

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

  // Lazy derivation: fetch Edge's proposed priorities when the user has none or stale ones.
  const shouldDerive = (priorities.length === 0 || prioritiesStale) && !deriveDismissed && !derivedProposal && !deriveLoading;
  useEffect(() => {
    if (!user || !shouldDerive) return;
    setDeriveLoading(true);
    fetch('/api/priorities/derive')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.proposal) setDerivedProposal(d.proposal); })
      .catch(() => {})
      .finally(() => setDeriveLoading(false));
  // shouldDerive is derived from priorities/prioritiesStale/dismiss/loading — stable deps are user
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, shouldDerive]);

  async function handleAcceptDerived() {
    if (!derivedProposal) return;
    setAcceptingDerived(true);
    const texts = derivedProposal.priorities.map(p => p.text);
    await fetch('/api/priorities/derive/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priorities: texts }),
    }).catch(() => {});
    // Reload priorities
    fetch('/api/onboarding/priorities')
      .then(r => r.ok ? r.json() : { priorities: [] })
      .then(d => setPriorities(d.priorities || []))
      .catch(() => {});
    setDerivedProposal(null);
    setAcceptingDerived(false);
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

  async function connectWhoop() {
    const res = await fetch('/api/whoop/connect');
    if (!res.ok) { alert('Whoop is not configured yet — contact support.'); return; }
    const data = await res.json();
    if (data.url) window.location.href = data.url;
  }

  async function disconnectWhoop() {
    if (!confirm('Disconnect Whoop? Edge will stop including your recovery data in briefings.')) return;
    setDisconnectingWhoop(true);
    const res = await fetch('/api/whoop/disconnect', { method: 'POST' });
    setDisconnectingWhoop(false);
    if (res.ok) setWhoopConnected(false);
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
        <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 50, background: 'var(--edg-success-tint)', border: '1px solid var(--edg-success-border)', color: 'var(--edg-success)', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
          ✓ Google account linked
        </div>
      )}

      {/* Notification center */}
      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 60 }}>
        <NotificationBell
          unreadCount={notifUnread}
          onClick={() => {
            const next = !notifOpen;
            setNotifOpen(next);
            if (next && notifUnread > 0) notifAction('markAllRead');
          }}
        />
        {notifOpen && (
          <div className="glass-card" style={{ position: 'absolute', top: 48, right: 0, width: 'calc(100vw - 32px)', maxWidth: 340, maxHeight: 420, overflowY: 'auto' }}>
            <NotificationCenter
              notifications={notifs.map(n => ({
                id: n.id,
                type: 'general' as const,
                title: n.title,
                body: n.body,
                read: !!n.read,
                createdAt: n.created_at,
                // "Book a time" belongs ONLY on reply notifications (its whole purpose:
                // schedule with whoever replied). It was wrongly attached to EVERY
                // notification — incl. Edge Score changes — which read as nonsensical.
                // Gate it to reply notifications (their title contains "replied").
                actions: (n.title || '').includes('replied')
                  ? [{ label: '📅 Book a time', variant: 'secondary' as const, onClick: () => openBook(n) }]
                  : undefined,
              }))}
              onDismiss={() => {}}
            />
            <div className="px-3 pb-3 pt-1 flex justify-end" style={{ borderTop: '1px solid var(--edg-hairline)' }}>
              <button onClick={() => notifAction('check')} disabled={notifChecking} className="text-xs" style={{ color: 'var(--text-accent)' }}>
                {notifChecking ? 'Checking…' : '↻ Check for replies'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Quick-book modal (from a notification's "Book a time") */}
      {bookFor && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'var(--edg-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setBookFor(null)}>
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
      <div className="relative z-10 flex flex-col md:flex-row min-h-screen">
        {/* Sidebar */}
        <aside className="w-full md:w-60 md:flex-shrink-0 flex flex-col py-3 md:py-6 px-4 border-b md:border-b-0 md:border-r" style={{ borderColor: 'var(--card-border)' }}>
          <div className="hidden md:block mb-8">
            <span className="logo-text text-xl">EDG3</span>
          </div>
          <div className="flex md:hidden items-center mb-2">
            <span className="logo-text text-lg">EDG3</span>
          </div>

          <nav className="flex md:flex-col overflow-x-auto gap-1 md:gap-0 md:space-y-1 no-scrollbar -mx-1 px-1 pb-1 md:pb-0">
            {[
              { id: 'home', label: 'Home', icon: '⚡' },
              { id: 'briefings', label: 'Briefings', icon: '📋' },
              { id: 'priorities', label: 'Priorities', icon: '🎯' },
              { id: 'activity', label: 'Activity', icon: '⏪' },
              { id: 'memory', label: 'Memory', icon: '🧠' },
              { id: 'profile', label: 'Profile', icon: '👤' },
              { id: 'help', label: 'Help', icon: '?' },
            ].map(tab => (
              <button
                key={tab.id}
                aria-label={tab.label}
                onClick={() => setActiveTab(tab.id as any)}
                className="flex-shrink-0 md:w-full flex items-center gap-2 md:gap-3 px-3 py-2.5 md:py-2 rounded-lg text-sm font-medium transition-all text-left"
                style={{
                  background: activeTab === tab.id ? 'var(--edg-accent-15)' : 'transparent',
                  color: activeTab === tab.id ? 'var(--text-accent)' : 'var(--text-muted)',
                  border: activeTab === tab.id ? '1px solid var(--edg-accent-20)' : '1px solid transparent',
                }}
              >
                <span>{tab.icon}</span>
                <span className="hidden md:inline">{tab.label}</span>
              </button>
            ))}
          </nav>

          {/* Mobile: compact Next Call strip */}
          <div className="flex md:hidden items-center justify-between px-1 py-2 mt-1 border-t" style={{ borderColor: 'var(--edg-hairline)' }}>
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--text-faint)' }}>Next call</span>
              <span className="text-xs font-semibold" style={{ color: 'var(--text-strong)' }}>
                {user.call_time} {user.timezone.split('/').pop()?.replace('_', ' ')}
              </span>
              {callStreak >= 2 && (
                <span className="text-xs" style={{ color: 'var(--edg-warning)' }}>🔥 {callStreak}d</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {calendarConnected && (
                <span className="text-xs" style={{ color: 'var(--edg-success)' }}>● Cal</span>
              )}
              {whoopConnected && (
                <span className="text-xs" style={{ color: 'var(--edg-success)' }}>● Whoop</span>
              )}
              {todayCallStatus?.status === 'completed' && (
                <span className="text-xs" style={{ color: 'var(--edg-success)' }}>✓ Done</span>
              )}
            </div>
          </div>

          <div className="hidden md:flex md:flex-col mt-6 space-y-3">
            <div
              className="glass-card p-3 transition-all"
              style={showNextCallTip ? {
                border: '1px solid var(--edg-accent-60)',
                boxShadow: '0 0 16px var(--edg-accent-25)',
              } : {}}
            >
              <div className="flex items-center gap-2 mb-1">
                <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Next call</p>
                {showNextCallTip && (
                  <span className="text-xs px-1.5 py-0.5 rounded font-semibold animate-pulse"
                    style={{ background: 'var(--edg-accent-20)', color: 'var(--text-accent)' }}>
                    ← this is you
                  </span>
                )}
              </div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>
                {user.call_time} {user.timezone.split('/').pop()?.replace('_', ' ')}
              </p>
              {callStreak >= 2 && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--edg-warning)' }}>
                  🔥 {callStreak}-day streak
                </p>
              )}
              {todayCallStatus && todayCallStatus.status !== 'none' && (
                <div className="mt-1.5">
                  {todayCallStatus.status === 'completed' && (
                    <p className="text-xs" style={{ color: 'var(--edg-success)' }}>✓ Call done for today</p>
                  )}
                  {todayCallStatus.status === 'calling' && (
                    <p className="text-xs" style={{ color: 'var(--text-accent)' }}>● In progress…</p>
                  )}
                  {(todayCallStatus.status === 'missed' || todayCallStatus.status === 'failed') && !retryCalled && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xs" style={{ color: 'var(--edg-warning)' }}>
                        {todayCallStatus.status === 'missed' ? 'Missed today' : 'Call failed'}
                      </p>
                      <button
                        onClick={retryBriefingCall}
                        disabled={retryingCall}
                        className="text-xs py-0.5 px-2 rounded"
                        style={{ background: 'var(--edg-accent-15)', color: 'var(--text-accent)', border: '1px solid var(--edg-accent-20)' }}
                      >
                        {retryingCall ? 'Calling…' : 'Call me now'}
                      </button>
                    </div>
                  )}
                  {retryCalled && (
                    <p className="text-xs" style={{ color: 'var(--text-accent)' }}>Calling you now…</p>
                  )}
                </div>
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
                    style={{ background: 'var(--edg-accent-15)', color: 'var(--text-accent)', border: '1px solid var(--edg-accent-20)' }}
                  >
                    {reminderBusy ? 'Adding…' : '📅 Add daily call to calendar'}
                  </button>
                ) : null}
              </div>
            </div>
            {/* Proactive priority derivation card — shown when priorities are empty or stale */}
            {(priorities.length === 0 || prioritiesStale) && !deriveDismissed && (
              deriveLoading ? (
                <PriorityDerivationLoadingCard />
              ) : derivedProposal ? (
                <PriorityDerivationCard
                  proposal={derivedProposal}
                  onAccept={handleAcceptDerived}
                  onTweak={() => setActiveTab('priorities')}
                  onDismiss={() => setDeriveDismissed(true)}
                  accepting={acceptingDerived}
                />
              ) : prioritiesStale && !prioritiesDismissed ? (
                // Fallback: no derivation proposal, just show stale nudge
                <div className="glass-card p-3" style={{ border: '1px solid var(--edg-warning-border)' }}>
                  <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                    Still your top priorities this week?
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setActiveTab('priorities')}
                      className="text-xs py-1 px-2 rounded flex-1"
                      style={{ background: 'var(--edg-accent-15)', color: 'var(--text-accent)', border: '1px solid var(--edg-accent-20)' }}
                    >
                      Update
                    </button>
                    <button
                      onClick={handleKeepPriorities}
                      disabled={keepingPriorities}
                      className="text-xs py-1 px-2 rounded flex-1"
                      style={{ background: 'var(--edg-hairline)', color: 'var(--text-faint)', border: '1px solid var(--edg-border-10)' }}
                    >
                      {keepingPriorities ? '…' : 'Keep'}
                    </button>
                  </div>
                </div>
              ) : null
            )}
            {/* Energy OS — daily energy logger */}
            <div className="glass-card p-3">
              <p className="text-xs mb-2" style={{ color: 'var(--text-faint)' }}>
                Today&apos;s energy
              </p>
              <div className="flex gap-2">
                {([
                  { level: 'green' as const, emoji: '🟢', label: 'High', color: 'var(--energy-green)', tint: 'var(--energy-green-tint)', border: 'var(--energy-green-border)' },
                  { level: 'yellow' as const, emoji: '🟡', label: 'Med', color: 'var(--energy-yellow)', tint: 'var(--energy-yellow-tint)', border: 'var(--energy-yellow-border)' },
                  { level: 'red' as const, emoji: '🔴', label: 'Low', color: 'var(--energy-red)', tint: 'var(--energy-red-tint)', border: 'var(--energy-red-border)' },
                ] as const).map(({ level, emoji, label, color, tint, border }) => (
                  <button
                    key={level}
                    disabled={settingEnergy}
                    onClick={async () => {
                      setSettingEnergy(true);
                      const src = energySignal?.source === 'whoop' ? 'override' : 'manual';
                      const res = await fetch('/api/energy/today', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ level, source: src }),
                      });
                      if (res.ok) setEnergySignal({ level, source: src });
                      setSettingEnergy(false);
                    }}
                    className="flex-1 flex flex-col items-center gap-0.5 py-2 px-1 rounded-lg text-xs font-medium transition-all"
                    style={energySignal?.level === level
                      ? { background: tint, border: `1px solid ${border}`, color }
                      : { background: 'transparent', border: '1px solid var(--edg-hairline)', color: 'var(--text-faint)' }
                    }
                  >
                    <span style={{ fontSize: 16 }}>{emoji}</span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
              {energySignal ? (
                <p className="text-xs mt-2" style={{ color: 'var(--text-faint)' }}>
                  {energySignal.level === 'green' ? 'Full power — Edge will schedule high-focus work today.' :
                   energySignal.level === 'yellow' ? 'Moderate day — Edge will mix focused + lighter tasks.' :
                   'Low energy — Edge will protect your schedule and defer deep work.'}
                  {energySignal.source === 'whoop' && <span className="ml-1 opacity-60">(from Whoop)</span>}
                </p>
              ) : (
                <p className="text-xs mt-1.5" style={{ color: 'var(--text-faint)' }}>
                  Set before your call → Edge skips asking
                </p>
              )}
            </div>
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
            {whoopConnected === false ? (
              <button
                onClick={connectWhoop}
                className="w-full text-xs py-2 text-left px-2 rounded"
                style={{ color: 'var(--text-faint)' }}
              >
                ⚡ Connect Whoop
              </button>
            ) : whoopConnected ? (
              <div>
                {whoopData && whoopData.recoveryScore !== null && whoopData.tier && (
                  <div className="mb-2">
                    <RecoveryCard
                      recoveryScore={whoopData.recoveryScore}
                      tier={whoopData.tier}
                      sleepHours={whoopData.sleepHours ?? undefined}
                      sleepScore={whoopData.sleepScore ?? undefined}
                      sleepTier={whoopData.sleepTier ?? undefined}
                      strain={whoopData.strain ?? undefined}
                      history={whoopData.history}
                      deviationPts={whoopIntelligence?.deviationPts ?? null}
                      flags={(whoopIntelligence?.flags ?? []) as any}
                      recoveryAction={whoopIntelligence?.recoveryAction ?? null}
                    />
                  </div>
                )}
                <div className="px-2 pt-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span style={{ color: 'var(--edg-success)', fontSize: 11 }}>●</span>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Whoop connected</p>
                  </div>
                  <div className="flex items-center gap-3 pl-3.5">
                    <button
                      onClick={disconnectWhoop}
                      disabled={disconnectingWhoop}
                      className="text-xs"
                      style={{ color: 'var(--edg-danger)' }}
                    >
                      {disconnectingWhoop ? 'Disconnecting…' : 'Disconnect'}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
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
        <main className="flex-1 p-4 md:p-8 overflow-auto min-w-0">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 md:mb-8">
            <div>
              <h1 className="text-xl md:text-2xl font-bold">{(() => {
                const h = new Date().getHours();
                const g = h >= 18 ? 'Good evening' : h >= 12 ? 'Good afternoon' : 'Good morning';
                return `${g}, ${user.name.split(' ')[0]}`;
              })()}</h1>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                {format(new Date(), 'EEEE, MMMM d, yyyy')}
              </p>
            </div>
            <div className="flex gap-2 sm:gap-3 flex-shrink-0">
              <button
                onClick={openCall}
                disabled={openingCall}
                className="btn-secondary text-sm py-2.5 sm:py-2 px-3 sm:px-4 flex-1 sm:flex-none"
                title="An open conversation — no briefing"
              >
                {openingCall ? 'Calling…' : '💬 Open call'}
              </button>
              <button
                onClick={initiateCall}
                disabled={initiatingCall}
                className="btn-primary text-sm py-2.5 sm:py-2 px-3 sm:px-4 flex-1 sm:flex-none"
              >
                {initiatingCall ? 'Calling…' : '📞 Call me now'}
              </button>
            </div>
          </div>


          {/* Tab content */}
          {activeTab === 'home' && (
            <div>
              {/* Briefing preview — shown when a briefing was just generated */}
              {briefingText && (
                <div className="glass-card p-6 mb-6" style={{ borderColor: 'var(--edg-accent-20)' }}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-sm" style={{ color: 'var(--text-accent)' }}>✦ THIS MORNING&apos;S BRIEFING</h3>
                    <button onClick={() => setBriefingText('')} style={{ color: 'var(--text-faint)', fontSize: 12 }}>✕ Dismiss</button>
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-body)' }}>
                    {briefingText}
                  </p>
                </div>
              )}

              {/* Activation moment — first connection, before first briefing */}
              {!activationDismissed && activationFacts.length > 0 && briefings.length === 0 && (
                <div className="mb-6">
                  <ActivationCard
                    facts={activationFacts}
                    name={user?.name?.split(' ')[0]}
                    onDismiss={() => setActivationDismissed(true)}
                  />
                </div>
              )}

              {/* Hero loop — always-first greeting card: "Here's what's off" or "You're well-aligned" */}
              <div ref={dayPlanRef} className="mb-6">
                <DayPlanCard
                  // Anchor the plan's before/after to the ONE canonical Edge Score
                  // (the EdgeScoreCard value) so the hero loop never shows a second,
                  // differently-computed "EDGE SCORE". Preserves the projected delta.
                  plan={dayPlan && typeof calendarFit?.edgeScore === 'number'
                    ? {
                        ...dayPlan,
                        scoreBefore: calendarFit.edgeScore,
                        scoreAfter: Math.max(0, Math.min(100, calendarFit.edgeScore + (dayPlan.scoreAfter - dayPlan.scoreBefore))),
                      }
                    : dayPlan}
                  loading={dayPlanLoading}
                  onConfirm={handleConfirmDayPlan}
                  onDismiss={dayPlan ? () => setDayPlan(null) : undefined}
                  applied={dayPlanApplied}
                  appliedScore={dayPlanAppliedScore}
                  diagnoses={dayPlan?.diagnoses}
                />
              </div>

              {/* Edge Score */}
              <div className="mb-6">
                <EdgeScoreCard
                  fit={calendarFit}
                  loading={calendarFitLoading}
                  sparse={priorities.length === 0 || calendarConnected === false}
                  calibrating={calendarFit?.calibrating === true}
                  calibratingHalf={
                    calendarFit?.focusScore.score === 0 && calendarFit?.energyScore.calibrating
                      ? 'both'
                      : calendarFit?.energyScore.calibrating
                      ? 'energy'
                      : undefined
                  }
                  celebrateFromScore={celebrateFromScore}
                  onRequestFix={() => {
                    setActiveTab('home');
                    setTimeout(() => {
                      dayPlanRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 50);
                    // If the plan was dismissed, re-fetch it
                    if (!dayPlan && !dayPlanLoading) {
                      setDayPlanLoading(true);
                      fetch('/api/day-plan').then(r => r.ok ? r.json() : null).then(d => { setDayPlan(d ?? null); }).catch(() => {}).finally(() => setDayPlanLoading(false));
                    }
                  }}
                />
              </div>

              {/* Section divider */}
              <div className="flex items-center gap-3 mb-5" style={{ borderTop: '1px solid var(--edg-hairline)', paddingTop: '1.25rem' }}>
                <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-faint)', letterSpacing: '0.1em' }}>Your day</span>
                <div className="flex-1" style={{ height: 1, background: 'var(--edg-hairline)' }} />
              </div>

              {/* Focus recommendation — stays visible after confirm (transitions to locked state) */}
              {(!focusRecDismissed || confirmedFocusAreas) && (
                <div className="mb-6">
                  <FocusRecommendationCard
                    recommendation={focusRec}
                    loading={focusRecLoading}
                    confirmedAreas={confirmedFocusAreas ?? undefined}
                    candidates={focusCandidates}
                    onConfirm={handleConfirmFocus}
                    onDismiss={confirmedFocusAreas ? undefined : () => setFocusRecDismissed(true)}
                    onCompleteArea={handleCompleteArea}
                    onDismissArea={handleDismissArea}
                  />
                </div>
              )}


              {/* Time allocation viz — where time actually went vs priorities */}
              {timeAllocation && (
                <div className="glass-card p-4 mb-6">
                  <TimeAllocationViz
                    buckets={timeAllocation.buckets}
                    periodWeeks={timeAllocation.periodWeeks}
                    biggestMisalignment={timeAllocation.biggestMisalignment}
                  />
                </div>
              )}

              {/* Open Loops */}
              {openLoops.length > 0 && (
                <div className="mb-6">
                  <OpenLoopsSection
                    loops={openLoops}
                    onResolve={async (id) => {
                      await fetch(`/api/open-loops/${id}/resolve`, { method: 'POST' });
                      setOpenLoops(prev => prev.filter(l => l.id !== id));
                    }}
                    onDismiss={async (id) => {
                      await fetch(`/api/open-loops/${id}/dismiss`, { method: 'POST' });
                      setOpenLoops(prev => prev.filter(l => l.id !== id));
                    }}
                  />
                </div>
              )}

              {/* Learn — section label + content cards */}
              <div className="flex items-center gap-3 mb-4" style={{ borderTop: '1px solid var(--edg-hairline)', paddingTop: '1.25rem' }}>
                <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-faint)', letterSpacing: '0.1em' }}>Learn</span>
                <div className="flex-1" style={{ height: 1, background: 'var(--edg-hairline)' }} />
              </div>
              <div className="mb-6">
                <ContentSection />
              </div>
            </div>
          )}

          {activeTab === 'briefings' && (
            <div>
              <SectionHint
                id="briefings"
                text="Your call history and full transcripts."
              />
              <h2 className="text-lg font-bold mb-4">Briefing history</h2>
              {!briefingsLoaded ? (
                <div className="glass-card p-8 text-center">
                  <span className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin inline-block mb-3" />
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading your briefings…</p>
                </div>
              ) : briefings.length === 0 ? (
                previewLoading ? (
                  <div className="glass-card p-8 text-center" style={{ borderColor: 'var(--edg-accent-20)' }}>
                    <p className="text-xs font-semibold mb-4" style={{ color: 'var(--edg-indigo)' }}>✦ HERE&apos;S WHAT EDG3 ALREADY KNOWS ABOUT YOUR WEEK</p>
                    <div className="flex items-center justify-center gap-2" style={{ color: 'var(--text-muted)' }}>
                      <span className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin inline-block" />
                      <span className="text-sm">Edg3 is putting together your preview…</span>
                    </div>
                  </div>
                ) : previewContent ? (
                  <div className="glass-card p-6 mb-4" style={{ borderColor: 'var(--edg-accent-25)', background: 'var(--edg-accent-04)' }}>
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
                            <div className="mt-4 p-4 rounded-lg" style={{ background: 'var(--edg-accent-08)', border: '1px solid var(--edg-accent-15)' }}>
                              <div className="flex items-center justify-between mb-3">
                                <p className="text-xs font-semibold" style={{ color: 'var(--edg-indigo)' }}>CALL TRANSCRIPT</p>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigator.clipboard.writeText(b.transcript!).then(() => {
                                      setCopiedTranscriptId(b.id);
                                      setTimeout(() => setCopiedTranscriptId(null), 2000);
                                    }).catch(() => {});
                                  }}
                                  className="text-xs px-2 py-0.5 rounded"
                                  style={{ color: copiedTranscriptId === b.id ? 'var(--edg-success)' : 'var(--text-faint)', border: '1px solid var(--card-border)' }}
                                >
                                  {copiedTranscriptId === b.id ? 'Copied ✓' : 'Copy'}
                                </button>
                              </div>
                              <div className="space-y-2">
                                {b.transcript.split('\n').filter((l: string) => l.trim()).map((line: string, i: number) => {
                                  const isUser = line.startsWith('User:') || line.startsWith('Customer:');
                                  const isAI = line.startsWith('Assistant:') || line.startsWith('Bot:') || line.startsWith('AI:');
                                  const rawText = line.replace(/^(User:|Customer:|Assistant:|Bot:|AI:)\s*/, '');
                                  const text = correctName(rawText, (user?.name || '').split(' ')[0]);
                                  return (
                                    <div key={i} className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
                                      <p className="text-xs leading-relaxed px-3 py-2 rounded-lg max-w-[80%]"
                                        style={{
                                          background: isUser ? 'var(--edg-accent-20)' : 'var(--edg-hairline)',
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
                                <div className="mt-4 p-4 rounded-lg" style={{ background: 'var(--edg-accent-06)', border: '1px solid var(--edg-accent-20)' }}>
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
                                <div className="mt-4 p-4 rounded-lg" style={{ background: 'var(--edg-calendar-green-tint)', border: '1px solid var(--edg-calendar-green-border)' }}>
                                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--edg-calendar-green)' }}>📅 CALENDAR ACTIONS</p>
                                  <div className="space-y-1">
                                    {actions.map((a: any, i: number) => (
                                      <p key={i} className="text-xs" style={{ color: 'var(--text-body)' }}>
                                        <span style={{ color: 'var(--edg-calendar-green)' }}>✓</span> {a.type === 'created' ? 'Added' : a.type} — {a.title}
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
                                <div className="mt-4 p-4 rounded-lg" style={{ background: 'var(--edg-accent-06)', border: '1px solid var(--edg-accent-15)' }}>
                                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-accent)' }}>🛠 EDGE&apos;S ACTIONS THIS CALL</p>
                                  <div className="space-y-1.5">
                                    {labels.map((label: string, i: number) => (
                                      <div key={i} className="text-xs flex items-start gap-2" style={{ color: 'var(--text-body)' }}>
                                        <span style={{ color: 'var(--edg-calendar-green)' }}>✓</span>
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

          {activeTab === 'priorities' && (
            <PrioritiesTab
              priorities={priorities}
              milestones={milestones}
              onSave={async (newPriorities) => {
                await fetch('/api/onboarding/priorities', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ priorities: newPriorities }),
                });
                loadData();
              }}
              onMilestoneAdd={async (priorityId, text) => {
                await fetch(`/api/priorities/${priorityId}/milestones`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ title: text }),
                });
                fetch('/api/milestones').then(r => r.ok ? r.json() : null).then(d => { if (d) setMilestones(d.milestones || []); });
              }}
              onMilestoneToggle={async (id, done) => {
                setMilestones(prev => prev.map(m => m.id === id ? { ...m, done: done ? 1 : 0 } : m));
                await fetch(`/api/milestones/${id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ done }),
                });
              }}
              onMilestoneDelete={async (id) => {
                setMilestones(prev => prev.filter(m => m.id !== id));
                await fetch(`/api/milestones/${id}`, { method: 'DELETE' });
              }}
            />
          )}

          {activeTab === 'activity' && <ActivityTab />}

          {activeTab === 'memory' && (() => {
            const CATEGORY_META: Record<string, { label: string; icon: string }> = {
              goal:       { label: 'Goals',       icon: '🎯' },
              project:    { label: 'Projects',    icon: '🗂' },
              person:     { label: 'People',      icon: '👤' },
              preference: { label: 'Preferences', icon: '⚡' },
              fact:       { label: 'Facts',       icon: '📌' },
            };
            const CAT_ORDER = ['goal', 'project', 'person', 'preference', 'fact'];
            const CAT_PREVIEW = 6;
            const firstName = (user?.name || '').split(' ')[0];
            const grouped = CAT_ORDER.reduce<Record<string, Fact[]>>((acc, cat) => {
              const items = facts.filter(f => f.category === cat);
              if (items.length) acc[cat] = items;
              return acc;
            }, {});
            const catEntries = Object.entries(grouped);
            const totalFacts = facts.length;
            const numCats = catEntries.length;
            return (
              <div>
                <SectionHint
                  id="memory"
                  text="Everything Edge has learned from your calls — the memory it draws on. Edit or remove anything that's off."
                />

                {/* Summary strip */}
                {totalFacts > 0 && (
                  <div className="flex items-center justify-between mb-5">
                    <div>
                      <h2 className="text-lg font-bold leading-tight">What Edge knows</h2>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
                        {totalFacts} fact{totalFacts !== 1 ? 's' : ''} across {numCats} area{numCats !== 1 ? 's' : ''}
                        {memories.length > 0 && ` · ${memories.length} call note${memories.length !== 1 ? 's' : ''}`}
                      </p>
                    </div>
                  </div>
                )}

                {/* Collapsible categories */}
                {catEntries.length > 0 && (
                  <div className="space-y-1.5 mb-6">
                    {catEntries.map(([cat, catItems], catIdx) => {
                      const meta = CATEGORY_META[cat] ?? { label: cat, icon: '' };
                      // Auto-open first category when nothing is explicitly expanded yet
                      const isSectionOpen = expandedMemorySections.size === 0 ? catIdx === 0 : expandedMemorySections.has(cat);
                      const isShowAll = expandedFactCats.has(cat);
                      const visible = isShowAll ? catItems : catItems.slice(0, CAT_PREVIEW);
                      const toggleSection = () => setExpandedMemorySections(prev => {
                        const next = new Set(prev); isSectionOpen ? next.delete(cat) : next.add(cat); return next;
                      });
                      return (
                        <div
                          key={cat}
                          className="rounded-xl overflow-hidden"
                          style={{ border: '1px solid var(--edg-hairline)', background: isSectionOpen ? 'var(--edg-fill-04)' : 'transparent' }}
                        >
                          {/* Category header — always visible, click to expand */}
                          <button
                            onClick={toggleSection}
                            aria-expanded={isSectionOpen}
                            aria-label={`${meta.label} — ${catItems.length} facts`}
                            className="w-full flex items-center justify-between px-4 py-3 text-left transition-opacity hover:opacity-80"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-sm" aria-hidden="true">{meta.icon}</span>
                              <span className="text-sm font-semibold" style={{ color: 'var(--text-body)' }}>{meta.label}</span>
                              <span
                                className="text-xs px-1.5 py-0.5 rounded-full font-medium ml-0.5"
                                style={{ background: 'var(--edg-accent-08)', color: 'var(--text-accent)' }}
                              >
                                {catItems.length}
                              </span>
                            </div>
                            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                              {isSectionOpen ? '▲' : '▼'}
                            </span>
                          </button>

                          {/* Expanded fact list */}
                          {isSectionOpen && (
                            <div className="px-4 pb-3">
                              <div
                                className="rounded-lg overflow-hidden"
                                style={{ border: '1px solid var(--edg-hairline)' }}
                              >
                                {visible.map((f, idx) => {
                                  const isEditing = editingFactId === f.id;
                                  const isConfirmingDelete = deletingFactId === f.id;
                                  return (
                                    <div
                                      key={f.id}
                                      className="group px-3 py-2.5"
                                      style={{
                                        borderTop: idx > 0 ? '1px solid var(--edg-hairline)' : 'none',
                                        background: isEditing ? 'var(--edg-accent-04)' : 'transparent',
                                      }}
                                    >
                                      {isEditing ? (
                                        <div className="flex items-start gap-2">
                                          <div className="flex-1">
                                            {f.entity && (
                                              <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-strong)' }}>
                                                {correctName(f.entity, firstName)}
                                              </p>
                                            )}
                                            <textarea
                                              autoFocus
                                              value={editFactText}
                                              onChange={e => setEditFactText(e.target.value)}
                                              onKeyDown={e => {
                                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (editFactText.trim()) saveFact(f.id, editFactText.trim()); }
                                                if (e.key === 'Escape') setEditingFactId(null);
                                              }}
                                              rows={2}
                                              className="input text-sm w-full resize-none"
                                              style={{ padding: '6px 10px', lineHeight: '1.4' }}
                                            />
                                          </div>
                                          <div className="flex flex-col gap-1 pt-0.5 flex-shrink-0">
                                            <button
                                              onClick={() => { if (editFactText.trim()) saveFact(f.id, editFactText.trim()); }}
                                              className="text-xs px-2.5 py-1 rounded-md font-medium"
                                              style={{ background: 'var(--edg-accent-15)', color: 'var(--edg-indigo-bright)', border: '1px solid var(--edg-accent-25)' }}
                                            >Save</button>
                                            <button
                                              onClick={() => setEditingFactId(null)}
                                              className="text-xs px-2.5 py-1 rounded-md"
                                              style={{ color: 'var(--text-faint)' }}
                                            >Cancel</button>
                                          </div>
                                        </div>
                                      ) : isConfirmingDelete ? (
                                        <div className="flex items-center justify-between gap-3">
                                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Remove this fact?</p>
                                          <div className="flex items-center gap-2 flex-shrink-0">
                                            <button
                                              onClick={() => deleteFact(f.id)}
                                              className="text-xs px-2 py-0.5 rounded font-medium"
                                              style={{ background: 'var(--edg-danger-tint)', color: 'var(--edg-danger)', border: '1px solid var(--whoop-low-border)' }}
                                            >Remove</button>
                                            <button
                                              onClick={() => setDeletingFactId(null)}
                                              className="text-xs px-2 py-0.5 rounded"
                                              style={{ color: 'var(--text-faint)' }}
                                            >Keep</button>
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="flex items-start gap-2">
                                          <div className="flex-1 min-w-0">
                                            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-body)' }}>
                                              {f.entity && (
                                                <span className="font-semibold" style={{ color: 'var(--text-strong)' }}>{correctName(f.entity, firstName)}: </span>
                                              )}
                                              {correctName(f.statement, firstName)}
                                              {f.confidence === 'low' && (
                                                <button
                                                  title="Edge isn't sure — tap to fix"
                                                  onClick={() => { setEditingFactId(f.id); setEditFactText(f.statement); setDeletingFactId(null); }}
                                                  className="inline-flex items-center gap-1 ml-1.5 px-1 py-0.5 rounded text-xs align-middle"
                                                  style={{ background: 'var(--edg-warning-tint)', color: 'var(--edg-warning)', border: '1px solid var(--edg-warning-border)', lineHeight: 1 }}
                                                >&#x26A0; verify</button>
                                              )}
                                            </p>
                                            {f.source_briefing_id ? (
                                              <a href={`/dashboard?briefing=${f.source_briefing_id}`} className="text-xs hover:underline" style={{ color: 'var(--text-faint)' }}>
                                                {format(parseUTC(f.learned_at), 'MMM d')} ↗
                                              </a>
                                            ) : (
                                              <span className="text-xs" style={{ color: 'var(--text-faint)' }}>{format(parseUTC(f.learned_at), 'MMM d')}</span>
                                            )}
                                          </div>
                                          <div className="flex items-center gap-1 flex-shrink-0 opacity-30 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                            <button
                                              title="Edit"
                                              onClick={() => { setEditingFactId(f.id); setEditFactText(f.statement); setDeletingFactId(null); }}
                                              className="p-1 rounded text-xs"
                                              style={{ color: 'var(--text-faint)', lineHeight: 1 }}
                                              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-muted)')}
                                              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faint)')}
                                            >✎</button>
                                            <button
                                              title="Remove"
                                              onClick={() => { setDeletingFactId(f.id); setEditingFactId(null); }}
                                              className="p-1 rounded text-xs"
                                              style={{ color: 'var(--text-faint)', lineHeight: 1 }}
                                              onMouseEnter={e => (e.currentTarget.style.color = 'var(--edg-danger)')}
                                              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faint)')}
                                            >✕</button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                              {catItems.length > CAT_PREVIEW && (
                                <button
                                  onClick={() => setExpandedFactCats(prev => {
                                    const next = new Set(prev); isShowAll ? next.delete(cat) : next.add(cat); return next;
                                  })}
                                  className="mt-2 text-xs"
                                  style={{ color: 'var(--text-accent)' }}
                                >
                                  {isShowAll ? 'Show less' : `Show all ${catItems.length}`}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Call notes — collapsible */}
                {memories.length > 0 && (() => {
                  const PAGE_SIZE = 20;
                  const totalPages = Math.ceil(memories.length / PAGE_SIZE);
                  const page = Math.min(memoryPage, totalPages);
                  const pageItems = memories.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
                  return (
                    <div
                      className="rounded-xl overflow-hidden"
                      style={{ border: '1px solid var(--edg-hairline)' }}
                    >
                      <button
                        onClick={() => setCallNotesExpanded(v => !v)}
                        className="w-full flex items-center justify-between px-4 py-3 text-left transition-opacity hover:opacity-80"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm" aria-hidden="true">📋</span>
                          <span className="text-sm font-semibold" style={{ color: 'var(--text-body)' }}>Call notes</span>
                          <span
                            className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                            style={{ background: 'var(--edg-accent-08)', color: 'var(--text-accent)' }}
                          >{memories.length}</span>
                        </div>
                        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                          {callNotesExpanded ? '▲' : '▼'}
                        </span>
                      </button>
                      {callNotesExpanded && (
                        <div className="px-4 pb-4">
                          {totalPages > 1 && (
                            <div className="flex items-center gap-2 mb-3">
                              <button onClick={() => setMemoryPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="btn-secondary text-xs py-1 px-3">Prev</button>
                              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{page} / {totalPages}</span>
                              <button onClick={() => setMemoryPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="btn-secondary text-xs py-1 px-3">Next</button>
                            </div>
                          )}
                          <div className="space-y-2">
                            {pageItems.map(m => (
                              <div key={m.id} className="rounded-lg px-3 py-2.5" style={{ border: '1px solid var(--edg-hairline)', background: 'transparent' }}>
                                <div className="flex items-center gap-2 mb-1.5">
                                  <span className={`badge ${m.type === 'insight' ? 'badge-success' : m.type === 'transcript' ? 'badge-info' : m.type === 'profile' ? 'badge-pending' : 'badge-info'}`}>{m.type}</span>
                                  <span className="text-xs" style={{ color: 'var(--text-faint)' }}>{format(parseUTC(m.created_at), 'MMM d, yyyy')}</span>
                                </div>
                                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-body)' }}>
                                  {correctName(m.content.length > 300 ? m.content.slice(0, 300) + '…' : m.content, firstName)}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {facts.length === 0 && memories.length === 0 && (
                  <div className="glass-card p-8 text-center">
                    <p className="text-3xl mb-3" role="img" aria-label="seedling">&#x1F331;</p>
                    <p className="font-semibold mb-2">Nothing stored yet</p>
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      After your first call, Edge will start building a picture of you here — goals, projects, preferences, and more.
                    </p>
                  </div>
                )}
              </div>
            );
          })()}

          {activeTab === 'profile' && (
            <ProfileTab onSettingsSaved={loadData} />
          )}

          {activeTab === 'help' && (
            <div className="max-w-2xl mx-auto">
              <div className="mb-6">
                <h2 className="text-base font-bold mb-1" style={{ color: 'var(--text-strong)' }}>Help &amp; Support</h2>
                <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  Common questions and a direct line to us.
                </p>
              </div>
              <HelpSupportSection />
            </div>
          )}
        </main>
      </div>

      {/* Welcome modal */}
      {showWelcome && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--edg-overlay-dark)', backdropFilter: 'blur(4px)' }}>
          <div className="glass-card p-8 max-w-md w-full text-center relative" style={{ border: '1px solid var(--border-accent)' }}>
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6"
                 style={{ background: 'var(--edg-accent-15)', border: '1px solid var(--border-accent)' }}>
              <span className="logo-text text-2xl">E</span>
            </div>
            <h2 className="text-2xl font-black mb-2">Edg3 wants to introduce himself.</h2>
            <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
              Edg3 will call you now at <span style={{ color: 'var(--text-strong)', fontWeight: 600 }}>{(user as any)?.phone_number || 'your phone'}</span> for a quick 30-second intro — your first of many conversations.
            </p>
            <div className="space-y-2 text-left glass-card p-4 mb-6" style={{ background: 'var(--edg-accent-08)' }}>
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
