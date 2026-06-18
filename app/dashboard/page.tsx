'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { summarizeUserFacingActions } from '@/lib/actionSummary';
import { computeCallStreak } from '@/lib/streak';
import { RecoveryCard, EdgeScoreCard, FocusRecommendationCard, DayPlanCard, NotificationBell, NotificationCenter, OpenLoopsSection, ContentSection, HelpSupportSection, ActivationCard } from '@/components/ui';
import type { CalendarFit, FocusRecommendation, FocusRecommendationArea, CalendarPlan as DayPlanType, OpenLoop } from '@/components/ui';
import { PriorityDerivationCard, PriorityDerivationLoadingCard } from '@/components/ui/PriorityDerivationCard';
import { DataConsentToggle, type DataConsent } from '@/components/ui/DataConsentCard';

// Speech-to-text mis-hears the user's name (e.g. "Derek" for "Derrick"). Stored transcripts
// and call-derived memories are verbatim, but we know the real spelling from the profile — so
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

  const [dataConsent, setDataConsent] = useState<DataConsent>('privacy');
  const [savingConsent, setSavingConsent] = useState(false);
  const [voicePref, setVoicePref] = useState<'daniel' | 'aria'>('daniel');

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.json())
      .then(d => {
        setProfile(d.profile_summary || '');
        if (d.call_time) setCallTime(d.call_time);
        if (d.timezone) setTimezone(d.timezone);
        setCurrentTimezone(d.current_timezone || '');
        if (d.data_consent) setDataConsent(d.data_consent as DataConsent);
        if (d.voice_preference === 'aria') setVoicePref('aria');
        setLoading(false);
      });
  }, []);

  async function handleConsentChange(next: DataConsent) {
    setDataConsent(next);
    setSavingConsent(true);
    await fetch('/api/onboarding/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_consent: next }),
    }).catch(() => {});
    setSavingConsent(false);
  }

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
          Set the timezone you're currently in. Edg3 uses it for your briefings and bookings until you clear it.
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

      {/* Data & Privacy */}
      <div>
        <h2 className="text-lg font-bold mb-4">Data &amp; privacy</h2>
        <DataConsentToggle value={dataConsent} onChange={handleConsentChange} saving={savingConsent} />
      </div>

      {/* Voice preference */}
      <div>
        <h2 className="text-lg font-bold mb-1">Edg3&apos;s voice</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>Choose the voice Edg3 uses on your morning briefings.</p>
        <div className="flex gap-3">
          {([
            { key: 'daniel', label: 'Daniel', desc: 'Deep, calm' },
            { key: 'aria',   label: 'Aria',   desc: 'Clear, direct' },
          ] as { key: 'daniel' | 'aria'; label: string; desc: string }[]).map(opt => {
            const active = voicePref === opt.key;
            return (
              <button
                key={opt.key}
                onClick={async () => {
                  setVoicePref(opt.key);
                  await fetch('/api/profile/voice', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ voice_preference: opt.key }),
                  }).catch(() => {});
                }}
                className="flex-1 rounded-xl px-4 py-3 text-left transition-colors"
                style={{
                  background: active ? 'var(--edg-accent-08)' : 'var(--edg-fill-04)',
                  border: `1px solid ${active ? 'var(--edg-accent-25, var(--edg-accent-20))' : 'var(--edg-hairline)'}`,
                  cursor: 'pointer',
                }}
                aria-pressed={active}
              >
                <p className="text-sm font-semibold mb-0.5" style={{ color: active ? 'var(--text-accent)' : 'var(--text-strong)' }}>{opt.label}</p>
                <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{opt.desc}</p>
              </button>
            );
          })}
        </div>
        <p className="text-xs mt-2" style={{ color: 'var(--text-faint)' }}>Applies to your next call.</p>
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
        text="Your north star. Edg3 anchors every briefing and scheduling suggestion to these."
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
                                className="opacity-30 group-hover:opacity-100 text-xs transition-opacity"
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
  const [fetchError, setFetchError] = useState(false);
  const [undoingId, setUndoingId] = useState<number | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // email_signal_fetch subject receipts: receiptId → subjects[] | 'loading' | 'error' | 'none'
  const [emailSubjects, setEmailSubjects] = useState<Record<number, string[] | 'loading' | 'error' | 'none'>>({});

  async function load() {
    setLoading(true);
    setFetchError(false);
    try {
      const r = await fetch('/api/activity');
      if (!r.ok) { setFetchError(true); setLoading(false); return; }
      const d = await r.json();
      setItems(d.items || []);
    } catch {
      setFetchError(true);
    }
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

  function dayLabel(created_at: string): string {
    const d = new Date(created_at);
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

  if (fetchError) return (
    <div className="glass-card p-8 text-center mt-2">
      <p className="text-2xl mb-3" role="img" aria-label="warning">⚠</p>
      <p className="font-semibold mb-1" style={{ color: 'var(--text-body)' }}>Couldn&apos;t load your activity</p>
      <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
        This is usually a temporary blip.
      </p>
      <button onClick={load} className="btn-secondary text-sm py-2 px-5">Try again</button>
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
        text="Every change Edg3 made to your calendar. Review or undo anything."
      />
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-bold">Edg3&apos;s actions</h2>
        <button onClick={load} className="text-xs" style={{ color: 'var(--text-faint)' }}>↻ Refresh</button>
      </div>
      <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
        Every change Edg3 makes appears here — review it, undo it, or just keep the audit trail.
      </p>

      {undoError && (
        <div className="mb-4 text-sm px-4 py-2 rounded-lg" style={{ background: 'var(--edg-danger-tint)', border: '1px solid var(--edg-danger-border)', color: 'var(--edg-danger)' }}>
          {undoError}
        </div>
      )}

      {items.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <p className="text-3xl mb-3" role="img" aria-label="shield">&#x1F6E1;</p>
          <p className="font-semibold mb-2">Edg3 hasn&apos;t changed anything yet</p>
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
                        onClick={() => {
                          if (!hasDetail) return;
                          const next = isExpanded ? null : item.id;
                          setExpandedId(next);
                          // Eagerly load email subjects when expanding an email receipt row.
                          if (next && item.emailReceiptId && emailSubjects[item.emailReceiptId] === undefined) {
                            setEmailSubjects(prev => ({ ...prev, [item.emailReceiptId!]: 'loading' }));
                            fetch(`/api/activity/email-receipt/${item.emailReceiptId}`)
                              .then(r => r.ok ? r.json() : null)
                              .then(d => {
                                if (d?.subjects?.length > 0) setEmailSubjects(prev => ({ ...prev, [item.emailReceiptId!]: d.subjects }));
                                else setEmailSubjects(prev => ({ ...prev, [item.emailReceiptId!]: 'none' }));
                              })
                              .catch(() => setEmailSubjects(prev => ({ ...prev, [item.emailReceiptId!]: 'error' })));
                          }
                        }}
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
                          {/* Email receipt — lazy-fetched on expand */}
                          {item.emailReceiptId && (() => {
                            const state = emailSubjects[item.emailReceiptId];
                            const SIGNAL_KEYWORDS = ['urgent', 'invoice', 'legal', 'contract', 'overdue', 'payment', 'lawsuit', 'agreement'];
                            const isFlagged = (s: string) => SIGNAL_KEYWORDS.some(k => s.toLowerCase().includes(k));
                            return (
                              <div className="mt-3">
                                <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-faint)', letterSpacing: '0.04em' }}>
                                  Threads Edg3 reviewed
                                </p>
                                {state === 'loading' ? (
                                  <div className="space-y-1.5 animate-pulse">
                                    {[80, 65, 75].map((w, i) => (
                                      <div key={i} className="h-7 rounded" style={{ background: 'var(--edg-fill-04)', width: `${w}%` }} />
                                    ))}
                                  </div>
                                ) : (state === 'error' || state === 'none' || (Array.isArray(state) && state.length === 0)) ? (
                                  <p className="text-xs px-3 py-2 rounded-lg" style={{ background: 'var(--edg-fill-04)', color: 'var(--text-faint)' }}>
                                    {state === 'error' ? "Couldn't load subjects for this scan." : 'No subject lines recorded — newer scans will show them here.'}
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
                                        Edg3 reads subject lines only — never message content.
                                      </p>
                                    </div>
                                  );
                                })() : null}
                              </div>
                            );
                          })()}
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
  category: 'person' | 'project' | 'goal' | 'preference' | 'fact' | 'pattern';
  statement: string;
  entity: string | null;
  learned_at: string;
  // Core populates these when available
  confidence?: 'low' | null;
  source_briefing_id?: number | null;
  source?: string | null;
}

// ── Fact source label ─────────────────────────────────────────────────────────

function factSourceLabel(f: Fact): { text: string; href: string | null } {
  const date = format(new Date(f.learned_at), 'MMM d');
  if (f.source === 'email') {
    return { text: `learned ${date} · from your inbox`, href: null };
  }
  if (f.source === 'priority-sync') {
    return { text: `learned ${date} · from your priorities`, href: null };
  }
  // briefing source (source_briefing_id set, or default for call-originated facts)
  if (f.source_briefing_id) {
    return { text: `learned ${date} · from your morning call`, href: `/dashboard?briefing=${f.source_briefing_id}` };
  }
  return { text: `learned ${date}`, href: null };
}

// ── Focus Scoreboard ──────────────────────────────────────────────────────────

interface ScoreboardMilestone { id: number; title: string; done: boolean; completedAt: string | null }
interface ScoreboardPriority {
  id: number; text: string; rank: number; energyCost: 'high' | 'medium' | 'low' | null;
  hoursThisWeek: number; weeklyAvgHours: number;
  milestoneDone: number; milestoneTotal: number;
  milestones: ScoreboardMilestone[];
}
interface ScoreboardWeek {
  weekLabel: string; weekStart: string;
  perPriority: { [text: string]: number }; otherHours: number;
}
interface ScoreboardData {
  perPriority: ScoreboardPriority[]; weeklyTrend: ScoreboardWeek[];
  totalHoursThisWeek: number; weeksBack: number; timezone?: string;
}

const ENERGY_COLOR: Record<string, { bg: string; text: string; label: string }> = {
  high:   { bg: 'rgba(251,191,36,0.12)',  text: 'rgba(251,191,36,0.9)',  label: '⚡ High energy' },
  medium: { bg: 'rgba(99,102,241,0.10)',  text: 'rgba(139,92,246,0.85)', label: '~ Medium energy' },
  low:    { bg: 'rgba(148,163,184,0.10)', text: 'var(--text-faint)',      label: '· Low energy' },
};

function MilestoneDots({ milestones }: { milestones: ScoreboardMilestone[] }) {
  if (milestones.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {milestones.map(m => (
        <span key={m.id} className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full"
          style={{
            background: m.done ? 'rgba(99,102,241,0.12)' : 'var(--edg-accent-08)',
            color: m.done ? 'var(--text-accent)' : 'var(--text-faint)',
            textDecoration: m.done ? 'line-through' : 'none',
          }}>
          <span style={{ fontSize: 8 }}>{m.done ? '●' : '○'}</span>
          {m.title.length > 22 ? m.title.slice(0, 20) + '…' : m.title}
        </span>
      ))}
    </div>
  );
}

function FocusScoreboardPanel() {
  const [data, setData] = useState<ScoreboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/scoreboard')
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="mb-6 space-y-3 animate-pulse">
        {[0.6, 0.8, 0.4].map((w, i) => (
          <div key={i} className="glass-card p-4" style={{ minHeight: 72 }}>
            <div className="flex items-center gap-3 mb-3">
              <div className="rounded-full flex-shrink-0" style={{ width: 28, height: 28, background: 'var(--edg-accent-15)' }} />
              <div className="h-3 rounded flex-1" style={{ maxWidth: `${w * 100}%`, background: 'var(--edg-accent-08)' }} />
            </div>
            <div className="h-2 rounded-full" style={{ background: 'var(--edg-accent-08)' }} />
          </div>
        ))}
      </div>
    );
  }

  if (!data || data.perPriority.length === 0) return null;

  const maxHours = Math.max(...data.perPriority.map(p => Math.max(p.hoursThisWeek, p.weeklyAvgHours, 0.5)));
  const trendWeeks = data.weeklyTrend.slice(-4);
  const maxTrendHours = trendWeeks.length > 0
    ? Math.max(...trendWeeks.flatMap(w => data.perPriority.map(p => w.perPriority[p.text] ?? 0)), 1)
    : 1;

  const trendDelta = (text: string): { arrow: string; up: boolean; flat: boolean } => {
    const weeks = trendWeeks.map(w => w.perPriority[text] ?? 0);
    if (weeks.length < 2) return { arrow: '', up: false, flat: true };
    const recent = weeks[weeks.length - 1];
    const prev   = weeks[weeks.length - 2];
    if (recent > prev + 0.5) return { arrow: '↑', up: true, flat: false };
    if (recent < prev - 0.5) return { arrow: '↓', up: false, flat: false };
    return { arrow: '→', up: false, flat: true };
  };

  return (
    <div className="mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
          Focus this week
        </h3>
        {data.totalHoursThisWeek > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: 'var(--edg-accent-15)', color: 'var(--text-accent)' }}>
            {data.totalHoursThisWeek}h logged
          </span>
        )}
      </div>

      {/* Per-priority cards */}
      <div className="space-y-3 mb-5">
        {data.perPriority.map(p => {
          const barPct    = maxHours > 0 ? Math.round((p.hoursThisWeek  / maxHours) * 100) : 0;
          const avgBarPct = maxHours > 0 ? Math.round((p.weeklyAvgHours / maxHours) * 100) : 0;
          const delta     = trendDelta(p.text);
          const energy    = p.energyCost ? ENERGY_COLOR[p.energyCost] : null;
          const allDone   = p.milestoneTotal > 0 && p.milestoneDone === p.milestoneTotal;

          return (
            <div key={p.id} className="glass-card p-4">
              {/* Title row */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3 min-w-0">
                  {/* Rank circle */}
                  <span className="flex-shrink-0 flex items-center justify-center rounded-full text-xs font-black"
                    style={{
                      width: 28, height: 28,
                      background: p.rank === 1 ? 'rgba(99,102,241,0.18)' : 'var(--edg-accent-08)',
                      color: p.rank === 1 ? 'var(--edg-indigo)' : 'var(--text-muted)',
                      border: p.rank === 1 ? '1px solid rgba(99,102,241,0.3)' : '1px solid transparent',
                    }}>
                    {p.rank}
                  </span>
                  <span className="text-sm font-semibold leading-snug" style={{ color: 'var(--text-strong)' }}>
                    {p.text}
                  </span>
                </div>

                {/* Badges */}
                <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                  {energy && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                      style={{ background: energy.bg, color: energy.text }}>
                      {energy.label}
                    </span>
                  )}
                  {delta.arrow && (
                    <span className="text-xs font-bold"
                      style={{ color: delta.up ? 'var(--edg-success)' : delta.flat ? 'var(--text-faint)' : 'rgba(239,68,68,0.8)' }}>
                      {delta.arrow}
                    </span>
                  )}
                </div>
              </div>

              {/* Hours bar with avg tick */}
              <div className="relative mb-1">
                <div className="rounded-full overflow-hidden" style={{ height: 8, background: 'var(--edg-accent-08)' }}>
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${barPct}%`,
                      background: barPct > 60
                        ? 'linear-gradient(90deg, var(--edg-indigo), rgba(139,92,246,0.9))'
                        : barPct > 25
                        ? 'linear-gradient(90deg, rgba(99,102,241,0.7), var(--edg-indigo))'
                        : 'rgba(99,102,241,0.5)',
                    }} />
                </div>
                {/* Avg marker tick */}
                {avgBarPct > 0 && Math.abs(avgBarPct - barPct) > 3 && (
                  <div className="absolute top-0 bottom-0 flex items-center" style={{ left: `${avgBarPct}%` }}>
                    <div style={{ width: 2, height: 12, marginTop: -2, background: 'var(--text-faint)', borderRadius: 1, opacity: 0.5 }} />
                  </div>
                )}
              </div>

              {/* Hours label */}
              <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-faint)' }}>
                <span style={{ color: p.hoursThisWeek > 0 ? 'var(--text-muted)' : 'var(--text-faint)' }}>
                  {p.hoursThisWeek > 0 ? `${p.hoursThisWeek}h this week` : 'No time logged yet'}
                </span>
                {p.weeklyAvgHours > 0 && (
                  <span>avg {p.weeklyAvgHours}h/wk</span>
                )}
              </div>

              {/* Milestone dots */}
              {p.milestoneTotal > 0 && (
                <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--edg-accent-08)' }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs" style={{ color: 'var(--text-faint)' }}>Milestones</span>
                    <span className="text-xs font-medium"
                      style={{ color: allDone ? 'var(--edg-success)' : 'var(--text-muted)' }}>
                      {p.milestoneDone}/{p.milestoneTotal}{allDone ? ' ✓ complete' : ''}
                    </span>
                  </div>
                  <MilestoneDots milestones={p.milestones} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 4-week heatmap table */}
      {trendWeeks.length >= 2 && (
        <div className="glass-card p-4 overflow-x-auto">
          <p className="text-xs mb-3 font-medium" style={{ color: 'var(--text-faint)' }}>
            {data.weeksBack}-week trend
          </p>
          <table className="text-xs w-full" style={{ borderCollapse: 'separate', borderSpacing: '0 4px' }}>
            <thead>
              <tr>
                <th className="text-left pb-1 font-normal pr-4" style={{ color: 'var(--text-faint)', minWidth: 100 }}>
                  Priority
                </th>
                {trendWeeks.map(w => (
                  <th key={w.weekStart} className="text-center pb-1 px-1 font-normal"
                    style={{ color: 'var(--text-faint)', minWidth: 48 }}>
                    {w.weekLabel}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.perPriority.map(p => (
                <tr key={p.id}>
                  <td className="pr-4 py-0.5 font-medium" style={{ color: 'var(--text-muted)', maxWidth: 120 }}>
                    <span className="block truncate">{p.text.length > 16 ? p.text.slice(0, 14) + '…' : p.text}</span>
                  </td>
                  {trendWeeks.map(w => {
                    const h = w.perPriority[p.text] ?? 0;
                    const intensity = maxTrendHours > 0 ? h / maxTrendHours : 0;
                    return (
                      <td key={w.weekStart} className="text-center px-1 py-0.5">
                        <span className="inline-block rounded px-1.5 py-0.5 font-medium transition-all"
                          style={{
                            background: h > 0 ? `rgba(99,102,241,${0.08 + intensity * 0.28})` : 'transparent',
                            color: h > 0 ? `rgba(199,210,254,${0.6 + intensity * 0.4})` : 'var(--text-faint)',
                            minWidth: 32,
                          }}>
                          {h > 0 ? `${h}h` : '—'}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [priorities, setPriorities] = useState<Priority[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [people, setPeople] = useState<{ canonical_name: string; interaction_count: number; last_interaction: string | null; upcoming_interaction: string | null }[]>([]);
  const [patterns, setPatterns] = useState<{ type: string; summary: string; confidence: string; sampleDays: number }[]>([]);
  const [accountability, setAccountability] = useState<{ done: { id: number; text: string; source: string; madeAt: string; dueDate: string | null; outcome: string; resolvedAt: string | null; daysOpen: number }[]; stillOpen: { id: number; text: string; source: string; madeAt: string; dueDate: string | null; outcome: string; resolvedAt: string | null; daysOpen: number }[]; completionRate: number | null; lookbackDays: number } | null>(null);
  const [episodes, setEpisodes] = useState<{ id: number; source: string; occurredAt: string; topics: string[]; commitments: string[] }[]>([]);
  const [expandedEpisodes, setExpandedEpisodes] = useState<Set<number>>(new Set());
  const [dismissedStaleIds, setDismissedStaleIds] = useState<Set<number>>(new Set());
  const [briefingsLoaded, setBriefingsLoaded] = useState(false);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [initiatingCall, setInitiatingCall] = useState(false);
  const [openingCall, setOpeningCall] = useState(false);
  const [activeTab, setActiveTab] = useState<'home' | 'briefings' | 'priorities' | 'memory' | 'profile' | 'activity' | 'help'>('home');
  const [memoryPage, setMemoryPage] = useState(1);
  const [expandedFactCats, setExpandedFactCats] = useState<Set<string>>(new Set());
  const [collapsedMemorySections, setCollapsedMemorySections] = useState<Set<string>>(
    new Set(['call-notes', 'people-m2', 'patterns-m3', 'accountability', 'fact', 'preference'])
  );
  const toggleMemorySection = (key: string) =>
    setCollapsedMemorySections(prev => { const next = new Set(prev); prev.has(key) ? next.delete(key) : next.add(key); return next; });
  // UX-4: once facts load, collapse all but first 3 populated categories
  const didInitMemoryCollapse = useRef(false);
  useEffect(() => {
    if (facts.length === 0 || didInitMemoryCollapse.current) return;
    didInitMemoryCollapse.current = true;
    const CAT_ORDER = ['goal', 'project', 'person', 'pattern', 'preference', 'fact'];
    const activeCats = CAT_ORDER.filter(cat => facts.some(f => f.category === cat));
    const collapsed = new Set(['call-notes', 'people-m2', 'patterns-m3', 'accountability']);
    if (activeCats.length >= 4) activeCats.slice(3).forEach(cat => collapsed.add(cat));
    setCollapsedMemorySections(collapsed);
  }, [facts]);
  const [editingFactId, setEditingFactId] = useState<number | null>(null);
  const [editFactText, setEditFactText] = useState('');
  const [deletingFactId, setDeletingFactId] = useState<number | null>(null);
  const [savedFactId, setSavedFactId] = useState<number | null>(null);
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
  const [showActivatedBanner, setShowActivatedBanner] = useState(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem('edg3_activated') === '1') {
      sessionStorage.removeItem('edg3_activated');
      return true;
    }
    return false;
  });
  const [calendarConnected, setCalendarConnected] = useState<boolean | null>(null);
  const [disconnectingCalendar, setDisconnectingCalendar] = useState(false);
  const [whoopConnected, setWhoopConnected] = useState<boolean | null>(null);
  const [disconnectingWhoop, setDisconnectingWhoop] = useState(false);
  const [whoopData, setWhoopData] = useState<{
    recoveryScore: number | null;
    tier: 'high' | 'medium' | 'low' | null;
    sleepScore: number | null;
    sleepHours: number | null;
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
  const [focusRec, setFocusRec] = useState<FocusRecommendation | null>(null);
  const [focusRecLoading, setFocusRecLoading] = useState(false);
  const [focusRecDismissed, setFocusRecDismissed] = useState(false);
  const [focusLockedAreas, setFocusLockedAreas] = useState<FocusRecommendationArea[] | null>(null);
  const [edgeScoreCelebrating, setEdgeScoreCelebrating] = useState(false);
  const [dayPlan, setDayPlan] = useState<DayPlanType | null>(null);
  const [dayPlanLoading, setDayPlanLoading] = useState(false);
  const [dayPlanApplied, setDayPlanApplied] = useState(false);
  const [dayPlanAppliedScore, setDayPlanAppliedScore] = useState<number | undefined>(undefined);
  const [openLoops, setOpenLoops] = useState<OpenLoop[]>([]);
  const [activationFacts, setActivationFacts] = useState<string[]>([]);
  const [activationDismissed, setActivationDismissed] = useState(false);

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
    fetch('/api/relationships').then(r => r.ok ? r.json() : null).then(d => { if (d?.profiles) setPeople(d.profiles); }).catch(() => {});
    fetch('/api/patterns').then(r => r.ok ? r.json() : null).then(d => { if (d?.patterns) setPatterns(d.patterns); }).catch(() => {});
    fetch('/api/accountability').then(r => r.ok ? r.json() : null).then(d => { if (d?.snapshot) setAccountability(d.snapshot); }).catch(() => {});
    fetch('/api/episodes').then(r => r.ok ? r.json() : null).then(d => { if (d?.episodes) setEpisodes(d.episodes); }).catch(() => {});
    // The slow ones (live Google Calendar) — no longer block the dashboard from showing.
    fetch('/api/briefing/today-status').then(r => r.ok ? r.json() : null).then(d => { if (d) setTodayCallStatus(d); }).catch(() => {});
    fetch('/api/energy/today').then(r => r.ok ? r.json() : null).then(d => { if (d?.signal) setEnergySignal(d.signal); }).catch(() => {});
    setCalendarFitLoading(true);
    fetch('/api/scores').then(r => r.ok ? r.json() : null).then(d => { if (d) setCalendarFit(d); }).catch(() => {}).finally(() => setCalendarFitLoading(false));
    setFocusRecLoading(true);
    fetch('/api/focus/recommend').then(r => r.ok ? r.json() : null).then(d => { if (d) setFocusRec(d); }).catch(() => {}).finally(() => setFocusRecLoading(false));
    // Check if already confirmed today — show locked state, prevent re-confirm.
    fetch('/api/focus/confirm').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.confirmed && Array.isArray(d.areas) && d.areas.length > 0) {
        setFocusLockedAreas(d.areas);
        setFocusRecDismissed(true);
      }
    }).catch(() => {});
    setDayPlanLoading(true);
    fetch('/api/day-plan').then(r => r.ok ? r.json() : null).then(d => { setDayPlan(d ?? null); }).catch(() => {}).finally(() => setDayPlanLoading(false));
    fetch('/api/open-loops').then(r => r.ok ? r.json() : null).then(d => { if (d?.loops) setOpenLoops(d.loops); }).catch(() => {});
    fetch('/api/learned').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.isFresh && d.recentFacts?.length > 0) {
        setActivationFacts(d.recentFacts.map((f: { statement: string }) => f.statement).slice(0, 6));
      }
    }).catch(() => {});
    retryFetch('/api/milestones', d => setMilestones(d.milestones || []));
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
      }
    }).catch(() => {});
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
    setFacts(prev => prev.map(f => f.id === id ? { ...f, statement, confidence: null } : f));
    setEditingFactId(null);
    setSavedFactId(id);
    setTimeout(() => setSavedFactId(null), 2000);
    await fetch(`/api/memory/facts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statement, confidence: null }),
    });
  }

  async function deleteFact(id: number) {
    setFacts(prev => prev.filter(f => f.id !== id));
    setDeletingFactId(null);
    await fetch(`/api/memory/facts/${id}`, { method: 'DELETE' });
  }

  async function handleConfirmFocus(areas: FocusRecommendationArea[]) {
    const prevScore = calendarFit?.edgeScore ?? null;
    await fetch('/api/focus/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ areas }),
    });
    setFocusLockedAreas(areas);
    setFocusRecDismissed(true);
    // Refetch Edge Score; if it rose, trigger the spark celebration
    fetch('/api/scores').then(r => r.ok ? r.json() : null).then(s => {
      if (!s) return;
      setCalendarFit(s);
      if (prevScore !== null && typeof s.edgeScore === 'number' && s.edgeScore > prevScore) {
        setEdgeScoreCelebrating(true);
        setTimeout(() => setEdgeScoreCelebrating(false), 1500);
      }
    }).catch(() => {});
  }

  async function handleConfirmDayPlan(planId: string) {
    const res = await fetch('/api/day-plan/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId }),
    });
    const d = await res.json().catch(() => ({}));
    setDayPlanApplied(true);
    if (d.newScore != null) setDayPlanAppliedScore(d.newScore);
    // ALWAYS refetch the canonical Edge Score so the HEADLINE moves to the real new
    // value — otherwise the headline stayed stale (e.g. 63) while the plan card showed
    // its projected number (67). One Edge Score, and it's the headline.
    fetch('/api/scores').then(r => r.ok ? r.json() : null).then(s => { if (s) setCalendarFit(s); }).catch(() => {});
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
      setActiveTab('briefings' as const);
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

  // Proactive priority derivation
  const [derivedProposal, setDerivedProposal] = useState<{
    priorities: { text: string; rationale: string; evidenceTags: string[] }[];
    summaryLine: string;
    dataSnapshot?: { calendarEventCount: number; calendarDaysSpanned: number; emailThreadCount: number; factsCount: number; openLoopsCount: number };
  } | null>(null);
  const [deriveLoading, setDeriveLoading] = useState(false);
  const [deriveDismissed, setDeriveDismissed] = useState(false);
  const [acceptingDerived, setAcceptingDerived] = useState(false);

  const shouldDerive = (priorities.length === 0 || prioritiesStale) && !deriveDismissed && !derivedProposal && !deriveLoading;
  useEffect(() => {
    if (!user || !shouldDerive) return;
    setDeriveLoading(true);
    fetch('/api/priorities/derive')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.proposal) setDerivedProposal(d.proposal); })
      .catch(() => {})
      .finally(() => setDeriveLoading(false));
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
    fetch('/api/onboarding/priorities')
      .then(r => r.ok ? r.json() : { priorities: [] })
      .then(d => setPriorities(d.priorities || []))
      .catch(() => {});
    setDerivedProposal(null);
    setAcceptingDerived(false);
  }

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

  async function connectWhoop() {
    const res = await fetch('/api/whoop/connect');
    if (!res.ok) { alert('Whoop is not configured yet — contact support.'); return; }
    const data = await res.json();
    if (data.url) window.location.href = data.url;
  }

  async function disconnectWhoop() {
    if (!confirm('Disconnect Whoop? Edg3 will stop including your recovery data in briefings.')) return;
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
          <div className="glass-card" style={{ position: 'absolute', top: 48, right: 0, width: 340, maxHeight: 420, overflowY: 'auto' }}>
            <NotificationCenter
              notifications={notifs.map(n => ({
                id: n.id,
                type: 'general' as const,
                title: n.title,
                body: n.body,
                read: !!n.read,
                createdAt: n.created_at,
                actions: [],
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
            <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>Confirm the details and Edg3 will add it to your calendar.</p>
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
              { id: 'home', label: 'Home', icon: '✦' },
              { id: 'briefings', label: 'Briefings', icon: '📋' },
              { id: 'priorities', label: 'Priorities', icon: '🎯' },
              { id: 'activity', label: 'Activity', icon: '⏪' },
              { id: 'memory', label: 'Memory', icon: '🧠' },
              { id: 'profile', label: 'Profile', icon: '👤' },
              { id: 'help', label: 'Help', icon: '?' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                aria-label={tab.label}
                aria-current={activeTab === tab.id ? 'page' : undefined}
                className="flex-shrink-0 md:w-full flex items-center gap-2 md:gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all text-left"
                style={{
                  background: activeTab === tab.id ? 'var(--edg-accent-15)' : 'transparent',
                  color: activeTab === tab.id ? 'var(--text-accent)' : 'var(--text-muted)',
                  border: activeTab === tab.id ? '1px solid var(--edg-accent-20)' : '1px solid transparent',
                }}
              >
                <span aria-hidden="true">{tab.icon}</span>
                <span className="hidden md:inline">{tab.label}</span>
              </button>
            ))}
          </nav>

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
            {prioritiesStale && !prioritiesDismissed && (
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
                  {energySignal.level === 'green' ? 'Full power — Edg3 will schedule high-focus work today.' :
                   energySignal.level === 'yellow' ? 'Moderate day — Edg3 will mix focused + lighter tasks.' :
                   'Low energy — Edg3 will protect your schedule and defer deep work.'}
                  {energySignal.source === 'whoop' && <span className="ml-1 opacity-60">(from Whoop)</span>}
                </p>
              ) : (
                <p className="text-xs mt-1.5" style={{ color: 'var(--text-faint)' }}>
                  Set before your call → Edg3 skips asking
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
                      sleepScore={whoopData.sleepScore ?? undefined}
                      sleepHours={whoopData.sleepHours ?? undefined}
                      strain={whoopData.strain ?? undefined}
                      history={whoopData.history}
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
          {/* Screen 7 — activation arrival banner (dismissible, non-gating) */}
          {showActivatedBanner && (
            <div
              className="flex items-start gap-3 rounded-xl px-4 py-3 mb-5"
              style={{
                background: 'var(--edg-accent-08)',
                border: '1px solid var(--edg-accent-20)',
                animation: 'score-rise 0.4s ease both',
              }}
            >
              <span style={{ color: 'var(--text-accent)', fontSize: 13, flexShrink: 0, marginTop: 2 }}>✦</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
                  Edg3 has everything it needs.{' '}
                  <span style={{ color: 'var(--text-muted)' }}>
                    Until your first call — everything Edg3 knows about you is in the
                    &ldquo;What Edg3 knows&rdquo; tab. You can edit or delete anything there.
                  </span>
                </p>
              </div>
              <button
                onClick={() => setShowActivatedBanner(false)}
                className="flex-shrink-0 text-xs p-1 transition-opacity hover:opacity-80"
                style={{ color: 'var(--text-faint)' }}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          )}
          {/* Header */}
          <div className="flex items-center justify-between mb-4 md:mb-8">
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
            <div className="glass-card p-6 mb-6" style={{ borderColor: 'var(--edg-accent-20)' }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-sm" style={{ color: 'var(--text-accent)' }}>TODAY'S BRIEFING PREVIEW</h3>
                <button onClick={() => setBriefingText('')} style={{ color: 'var(--text-faint)', fontSize: 12 }}>✕ dismiss</button>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-body)' }}>
                {briefingText}
              </p>
            </div>
          )}

          {/* ── Home tab — morning cockpit ──────────────────────────── */}
          {activeTab === 'home' && (
            <div className="space-y-6">
              {/* Activation card — "here's what I already know" — pre-first-briefing only */}
              {briefings.length === 0 && !activationDismissed && activationFacts.length > 0 && (
                <ActivationCard
                  facts={activationFacts}
                  name={user?.name?.split(' ')[0] ?? undefined}
                  onDismiss={() => setActivationDismissed(true)}
                />
              )}
              {/* Edge Score — hero */}
              <EdgeScoreCard
                fit={calendarFit}
                loading={calendarFitLoading}
                sparse={priorities.length === 0 || calendarConnected === false}
                celebrating={edgeScoreCelebrating}
                onRequestFix={() => {/* DayPlanCard below handles fixes */}}
              />
              {/* Today's focus recommendations */}
              {focusLockedAreas ? (
                <div className="glass-card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span style={{ color: 'var(--edg-indigo)' }}>🎯</span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Today&apos;s focus — set for today</span>
                  </div>
                  <ol className="list-none space-y-1">
                    {focusLockedAreas.map((a, i) => (
                      <li key={i} style={{ color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                        <span style={{ color: 'var(--edg-indigo)', fontWeight: 600, marginRight: '0.5rem' }}>{i + 1}.</span>{a.title}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : !focusRecDismissed && (
                <FocusRecommendationCard
                  recommendation={focusRec}
                  loading={focusRecLoading}
                  onConfirm={handleConfirmFocus}
                  onDismiss={() => setFocusRecDismissed(true)}
                />
              )}
              {/* Day plan — reshape CTA / "Your day looks good" */}
              {calendarConnected !== false && (
                <DayPlanCard
                  plan={dayPlan}
                  loading={dayPlanLoading}
                  onConfirm={handleConfirmDayPlan}
                  onDismiss={() => setDayPlan(null)}
                  applied={dayPlanApplied}
                  appliedScore={dayPlanAppliedScore}
                />
              )}
              {/* Open loops — commitments Edge is tracking */}
              {openLoops.length > 0 && (
                <OpenLoopsSection
                  loops={openLoops}
                  onResolve={async (id) => {
                    await fetch(`/api/open-loops/${id}/resolve`, { method: 'POST' }).catch(() => {});
                    setOpenLoops(prev => prev.map(l => l.id === id ? { ...l, status: 'done' as const } : l));
                  }}
                  onDismiss={async (id) => {
                    await fetch(`/api/open-loops/${id}/dismiss`, { method: 'POST' }).catch(() => {});
                    setOpenLoops(prev => prev.map(l => l.id === id ? { ...l, status: 'dismissed' as const } : l));
                  }}
                />
              )}
              {/* Content cards — education for the home tab */}
              <ContentSection />
            </div>
          )}

          {/* Tab content */}
          {activeTab === 'briefings' && (
            <div>
              <SectionHint
                id="briefings"
                text="Your call history and full transcripts."
              />
              <h2 className="text-lg font-bold mb-4">Briefing history</h2>
              {!briefingsLoaded ? (
                <div className="space-y-3 animate-pulse">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="glass-card p-5">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="h-3 rounded w-20" style={{ background: 'var(--edg-fill-04)' }} />
                        <div className="h-3 rounded w-12" style={{ background: 'var(--edg-fill-04)' }} />
                      </div>
                      <div className="h-3 rounded w-full mb-2" style={{ background: 'var(--edg-fill-04)' }} />
                      <div className="h-3 rounded w-3/4" style={{ background: 'var(--edg-fill-04)' }} />
                    </div>
                  ))}
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
            <div className="space-y-6">
            {/* Focus Scoreboard — hours invested + milestone progress + 4-week trend */}
            <FocusScoreboardPanel />
            {/* Derivation card — shown when no priorities or stale */}
            {(priorities.length === 0 || prioritiesStale) && !deriveDismissed && (
              deriveLoading ? (
                <PriorityDerivationLoadingCard />
              ) : derivedProposal ? (
                <PriorityDerivationCard
                  proposal={derivedProposal}
                  onAccept={handleAcceptDerived}
                  onTweak={() => { setDerivedProposal(null); }}
                  onDismiss={() => setDeriveDismissed(true)}
                  accepting={acceptingDerived}
                />
              ) : null
            )}
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
            </div>
          )}

          {activeTab === 'activity' && <ActivityTab />}

          {activeTab === 'memory' && (
            <div>
              <SectionHint
                id="memory"
                text="Everything Edg3 has learned from your calls — the memory it draws on. Edit or remove anything that's off."
              />
              <div className="flex items-baseline justify-between gap-3 mb-1 flex-wrap">
                <h2 className="text-lg font-bold">Here&apos;s what Edg3 knows about you</h2>
                {facts.length > 0 && (
                  <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                    {facts.length} fact{facts.length !== 1 ? 's' : ''} across {new Set(facts.map(f => f.category)).size} areas
                  </span>
                )}
              </div>
              <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
                Built from your calls — not filled out by hand. Correcting anything here makes Edg3 smarter.
              </p>

              {/* Recently learned — newest 5 facts across all categories */}
              {facts.length > 0 && (() => {
                const recent = [...facts]
                  .sort((a, b) => new Date(b.learned_at).getTime() - new Date(a.learned_at).getTime())
                  .slice(0, 5);
                const CATEGORY_ICONS: Record<string, string> = {
                  goal: '🎯', project: '🗂', person: '👤', preference: '⚡', fact: '📌', pattern: '📈',
                };
                const firstName = (user?.name || '').split(' ')[0];
                return (
                  <div className="mb-8">
                    <h3 className="flex items-center gap-1.5 text-sm font-semibold mb-3" style={{ color: 'var(--text-body)' }}>
                      <span aria-hidden="true">✦</span>
                      Recently learned
                    </h3>
                    <div className="space-y-1.5">
                      {recent.map(f => (
                        <div key={f.id} className="glass-card px-4 py-3 flex items-start gap-3" style={{ border: '1px solid var(--edg-accent-08)' }}>
                          <span className="text-xs mt-0.5 flex-shrink-0" aria-hidden="true">
                            {CATEGORY_ICONS[f.category] ?? '📌'}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
                              {f.entity && (
                                <span className="font-semibold" style={{ color: 'var(--text-strong)' }}>
                                  {correctName(f.entity, firstName)}:{' '}
                                </span>
                              )}
                              {correctName(f.statement, firstName)}
                            </p>
                            {(() => {
                              const src = factSourceLabel(f);
                              return src.href ? (
                                <a href={src.href} className="text-xs mt-0.5 block hover:underline" style={{ color: 'var(--text-faint)' }}>
                                  {src.text} ↗
                                </a>
                              ) : (
                                <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>{src.text}</p>
                              );
                            })()}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Memory health card — stale facts */}
              {facts.length > 0 && (() => {
                const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);
                const staleFacts = facts.filter(f => !dismissedStaleIds.has(f.id) && new Date(f.learned_at) < ninetyDaysAgo);
                if (staleFacts.length === 0) return null;
                const CATEGORY_META_HEALTH: Record<string, { label: string; icon: string }> = {
                  goal: { label: 'Goals', icon: '🎯' }, project: { label: 'Projects', icon: '🗂' },
                  person: { label: 'People', icon: '👤' }, preference: { label: 'Preferences', icon: '⚡' },
                  fact: { label: 'Facts', icon: '📌' }, pattern: { label: 'Patterns', icon: '📈' },
                };
                const staleCats = [...new Set(staleFacts.map(f => f.category))];
                return (
                  <div className="mb-6 rounded-xl px-4 py-3" style={{ background: 'var(--edg-warning-tint)', border: '1px solid var(--edg-warning-border)' }}>
                    <div className="flex items-start gap-3">
                      <span className="flex-shrink-0 text-base mt-0.5" aria-hidden="true">🔍</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--text-strong)' }}>Some facts may be outdated</p>
                        <p className="text-xs mb-2" style={{ color: 'var(--text-faint)' }}>
                          {staleFacts.length} {staleFacts.length === 1 ? 'fact hasn\'t' : 'facts haven\'t'} been confirmed in 90+ days — worth a quick check.
                        </p>
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {staleCats.map(cat => {
                            const meta = CATEGORY_META_HEALTH[cat] ?? { label: cat, icon: '' };
                            const count = staleFacts.filter(f => f.category === cat).length;
                            return (
                              <span key={cat} className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--edg-warning-tint)', color: 'var(--edg-warning)', border: '1px solid var(--edg-warning-border)' }}>
                                {meta.icon} {meta.label} · {count}
                              </span>
                            );
                          })}
                        </div>
                        <div className="space-y-1.5">
                          {staleFacts.slice(0, 3).map(f => (
                            <div key={f.id} className="flex items-start gap-2">
                              <p className="text-xs flex-1 min-w-0" style={{ color: 'var(--text-muted)' }}>
                                {f.entity && <span className="font-medium" style={{ color: 'var(--text-body)' }}>{f.entity}: </span>}
                                {f.statement}
                              </p>
                              <div className="flex gap-1.5 flex-shrink-0">
                                <button
                                  onClick={() => { setEditingFactId(f.id); setEditFactText(f.statement); }}
                                  className="text-xs px-2 py-0.5 rounded"
                                  style={{ background: 'var(--edg-accent-08)', color: 'var(--text-accent)', border: '1px solid var(--edg-accent-15)' }}
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => setDismissedStaleIds(prev => new Set(prev).add(f.id))}
                                  className="text-xs px-2 py-0.5 rounded"
                                  style={{ color: 'var(--text-faint)' }}
                                >
                                  Still true
                                </button>
                              </div>
                            </div>
                          ))}
                          {staleFacts.length > 3 && (
                            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>+ {staleFacts.length - 3} more stale facts in the sections below.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Structured facts grouped by category */}
              {facts.length > 0 && (() => {
                const CATEGORY_META: Record<string, { label: string; icon: string }> = {
                  goal:       { label: 'Goals',       icon: '🎯' },
                  project:    { label: 'Projects',    icon: '🗂' },
                  person:     { label: 'People',      icon: '👤' },
                  preference: { label: 'Preferences', icon: '⚡' },
                  fact:       { label: 'Facts',       icon: '📌' },
                  pattern:    { label: 'Patterns',    icon: '📈' },
                };
                const FACTS_CAT_LIMIT = 15;
                const ORDER = ['goal', 'project', 'person', 'pattern', 'preference', 'fact'];
                const grouped = ORDER.reduce<Record<string, Fact[]>>((acc, cat) => {
                  const items = facts.filter(f => f.category === cat);
                  if (items.length) acc[cat] = items;
                  return acc;
                }, {});

                // ── Reusable fact row (used in both person cards and flat lists) ──
                function FactRow({ f, indented }: { f: Fact; indented?: boolean }) {
                  const isEditing = editingFactId === f.id;
                  const isConfirmingDelete = deletingFactId === f.id;
                  const justSaved = savedFactId === f.id;
                  const firstName = (user?.name || '').split(' ')[0];
                  return (
                    <div
                      className={`group ${indented ? '' : 'glass-card px-4 py-3'}`}
                      style={indented ? { padding: '6px 0' } : { transition: 'background 0.1s' }}
                    >
                      {isEditing ? (
                        <div className="flex items-start gap-2">
                          <div className="flex-1">
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
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingFactId(null)}
                              className="text-xs px-2.5 py-1 rounded-md"
                              style={{ color: 'var(--text-faint)' }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : isConfirmingDelete ? (
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Remove this fact?</p>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                              onClick={() => deleteFact(f.id)}
                              className="text-xs px-2.5 py-1 rounded-md font-medium"
                              style={{ background: 'var(--edg-danger-tint)', color: 'var(--edg-danger)', border: '1px solid var(--whoop-low-border)' }}
                            >
                              Remove
                            </button>
                            <button onClick={() => setDeletingFactId(null)} className="text-xs px-2.5 py-1 rounded-md" style={{ color: 'var(--text-faint)' }}>Keep</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            {justSaved ? (
                              <p className="text-xs font-medium" style={{ color: 'var(--edg-success)' }}>✓ Edg3 updated</p>
                            ) : (
                              <>
                                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
                                  {!indented && f.entity && (
                                    <span className="font-semibold" style={{ color: 'var(--text-strong)' }}>{correctName(f.entity, firstName)}: </span>
                                  )}
                                  {correctName(f.statement, firstName)}
                                  {f.confidence === 'low' && (
                                    <button
                                      title="Edg3 isn't sure it caught this right — tap to fix"
                                      onClick={() => { setEditingFactId(f.id); setEditFactText(f.statement); setDeletingFactId(null); }}
                                      className="inline-flex items-center gap-1 ml-2 px-1.5 py-0.5 rounded text-xs align-middle"
                                      style={{ background: 'var(--edg-warning-tint)', color: 'var(--edg-warning)', border: '1px solid var(--edg-warning-border)', lineHeight: 1 }}
                                    >
                                      &#x26A0; verify
                                    </button>
                                  )}
                                </p>
                                {(() => {
                                  const src = factSourceLabel(f);
                                  return src.href ? (
                                    <a href={src.href} className="text-xs mt-0.5 block hover:underline" style={{ color: 'var(--text-faint)' }}>{src.text} ↗</a>
                                  ) : (
                                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>{src.text}</p>
                                  );
                                })()}
                              </>
                            )}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0 opacity-30 group-hover:opacity-100 focus-within:opacity-100 transition-opacity pt-0.5">
                            <button
                              title="Edit"
                              onClick={() => { setEditingFactId(f.id); setEditFactText(f.statement); setDeletingFactId(null); }}
                              className="p-1 rounded"
                              style={{ color: 'var(--text-faint)', lineHeight: 1 }}
                              aria-label="Edit fact"
                            >✎</button>
                            <button
                              title="Remove"
                              onClick={() => { setDeletingFactId(f.id); setEditingFactId(null); }}
                              className="p-1 rounded"
                              style={{ color: 'var(--text-faint)', lineHeight: 1 }}
                              aria-label="Remove fact"
                            >&#x2715;</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <div className="space-y-6 mb-8">
                    {Object.entries(grouped).map(([cat, catItems]) => {
                      const isExpanded = expandedFactCats.has(cat);
                      const meta = CATEGORY_META[cat] ?? { label: cat, icon: '' };

                      // ── Goals: elevated anchor cards with rank number ──
                      if (cat === 'goal') {
                        const firstName = (user?.name || '').split(' ')[0];
                        const secCollapsed = collapsedMemorySections.has(cat);
                        return (
                          <div key={cat}>
                            <button
                              onClick={() => toggleMemorySection(cat)}
                              aria-expanded={!secCollapsed}
                              className="flex items-center gap-1.5 text-sm font-semibold mb-3 w-full text-left"
                              style={{ color: 'var(--text-body)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                            >
                              <span aria-hidden="true">{meta.icon}</span>
                              {meta.label}
                              <span className="ml-1 text-xs font-normal" style={{ color: 'var(--text-faint)' }}>· {catItems.length}</span>
                              <span className="ml-auto" aria-hidden="true" style={{ color: 'var(--text-faint)', fontSize: 10 }}>{secCollapsed ? '▸' : '▾'}</span>
                            </button>
                            {!secCollapsed && <div className="space-y-2">
                              {catItems.map((f, idx) => {
                                const isEditing = editingFactId === f.id;
                                const justSaved = savedFactId === f.id;
                                const isConfirmingDelete = deletingFactId === f.id;
                                return (
                                  <div
                                    key={f.id}
                                    className="glass-card px-4 py-3 group"
                                    style={{ border: `1px solid ${idx === 0 ? 'var(--edg-accent-20)' : 'var(--edg-hairline)'}`, background: idx === 0 ? 'var(--edg-accent-04)' : undefined }}
                                  >
                                    {isEditing ? (
                                      <div className="flex items-start gap-2">
                                        <div className="flex-1">
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
                                          <button onClick={() => { if (editFactText.trim()) saveFact(f.id, editFactText.trim()); }} className="text-xs px-2.5 py-1 rounded-md font-medium" style={{ background: 'var(--edg-accent-15)', color: 'var(--edg-indigo-bright)', border: '1px solid var(--edg-accent-25)' }}>Save</button>
                                          <button onClick={() => setEditingFactId(null)} className="text-xs px-2.5 py-1 rounded-md" style={{ color: 'var(--text-faint)' }}>Cancel</button>
                                        </div>
                                      </div>
                                    ) : isConfirmingDelete ? (
                                      <div className="flex items-center justify-between gap-3">
                                        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Remove this goal?</p>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                          <button onClick={() => deleteFact(f.id)} className="text-xs px-2.5 py-1 rounded-md font-medium" style={{ background: 'var(--edg-danger-tint)', color: 'var(--edg-danger)', border: '1px solid var(--whoop-low-border)' }}>Remove</button>
                                          <button onClick={() => setDeletingFactId(null)} className="text-xs px-2.5 py-1 rounded-md" style={{ color: 'var(--text-faint)' }}>Keep</button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="flex items-start gap-3">
                                        <div
                                          className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mt-0.5"
                                          style={{ background: idx === 0 ? 'var(--edg-indigo)' : 'var(--edg-accent-15)', color: idx === 0 ? '#fff' : 'var(--text-accent)' }}
                                          aria-hidden="true"
                                        >
                                          {idx + 1}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          {justSaved ? (
                                            <p className="text-sm font-medium" style={{ color: 'var(--edg-success)' }}>✓ Edg3 updated</p>
                                          ) : (
                                            <>
                                              <p className="text-sm font-medium leading-snug" style={{ color: 'var(--text-strong)' }}>
                                                {correctName(f.statement, firstName)}
                                              </p>
                                              {(() => {
                                                const src = factSourceLabel(f);
                                                return src.href ? (
                                                  <a href={src.href} className="text-xs mt-0.5 block hover:underline" style={{ color: 'var(--text-faint)' }}>{src.text} ↗</a>
                                                ) : (
                                                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>{src.text}</p>
                                                );
                                              })()}
                                            </>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-1 flex-shrink-0 opacity-30 group-hover:opacity-100 focus-within:opacity-100 transition-opacity pt-0.5">
                                          <button title="Edit" onClick={() => { setEditingFactId(f.id); setEditFactText(f.statement); setDeletingFactId(null); }} className="p-1 rounded" style={{ color: 'var(--text-faint)', lineHeight: 1 }} aria-label="Edit goal">✎</button>
                                          <button title="Remove" onClick={() => { setDeletingFactId(f.id); setEditingFactId(null); }} className="p-1 rounded" style={{ color: 'var(--text-faint)', lineHeight: 1 }} aria-label="Remove goal">&#x2715;</button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>}
                          </div>
                        );
                      }

                      // ── People: group by entity into relationship profile cards ──
                      if (cat === 'person') {
                        const byEntity = catItems.reduce<Record<string, Fact[]>>((acc, f) => {
                          const key = f.entity || '(unknown)';
                          (acc[key] = acc[key] || []).push(f);
                          return acc;
                        }, {});
                        // UX-2+3: filter out self-references and AI entities
                        const userFirstName = (user?.name || '').split(' ')[0].toLowerCase();
                        const userFullName = (user?.name || '').toLowerCase();
                        const AI_ENTITY_NAMES = new Set(['edge', 'edg3', 'ai', 'assistant']);
                        const allEntities = Object.keys(byEntity);
                        const entities = allEntities.filter(entity => {
                          const lower = entity.toLowerCase();
                          return lower !== userFirstName && lower !== userFullName && !AI_ENTITY_NAMES.has(lower);
                        });
                        const PERSON_LIMIT = 8;
                        const visibleEntities = entities.length > PERSON_LIMIT && !isExpanded ? entities.slice(0, PERSON_LIMIT) : entities;
                        const secCollapsed = collapsedMemorySections.has(cat);
                        if (entities.length === 0) return null;
                        return (
                          <div key={cat}>
                            <button
                              onClick={() => toggleMemorySection(cat)}
                              aria-expanded={!secCollapsed}
                              className="flex items-center gap-1.5 text-sm font-semibold mb-3 w-full text-left"
                              style={{ color: 'var(--text-body)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                            >
                              <span aria-hidden="true">{meta.icon}</span>
                              {meta.label}
                              <span className="ml-1 text-xs font-normal" style={{ color: 'var(--text-faint)' }}>· {entities.length} {entities.length === 1 ? 'person' : 'people'}</span>
                              <span className="ml-auto" aria-hidden="true" style={{ color: 'var(--text-faint)', fontSize: 10 }}>{secCollapsed ? '▸' : '▾'}</span>
                            </button>
                            {!secCollapsed && <div className="space-y-2">
                              {visibleEntities.map(entity => {
                                const firstName = (user?.name || '').split(' ')[0];
                                const rawFacts = byEntity[entity];
                                // UX-2: collapse near-identical fact statements
                                const seenKeys = new Set<string>();
                                const uniqueFacts: Fact[] = [];
                                let dupeCount = 0;
                                for (const f of rawFacts) {
                                  const key = f.statement.trim().toLowerCase().slice(0, 80);
                                  if (seenKeys.has(key)) { dupeCount++; } else { seenKeys.add(key); uniqueFacts.push(f); }
                                }
                                const mostRecent = rawFacts.reduce((a, b) => new Date(a.learned_at) > new Date(b.learned_at) ? a : b);
                                return (
                                  <div key={entity} className="glass-card px-4 py-3" style={{ border: '1px solid var(--edg-hairline)' }}>
                                    <div className="flex items-center gap-2 mb-2">
                                      <div
                                        className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                                        style={{ background: 'var(--edg-accent-15)', color: 'var(--text-accent)' }}
                                      >
                                        {correctName(entity, firstName).charAt(0).toUpperCase()}
                                      </div>
                                      <p className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>
                                        {correctName(entity, firstName)}
                                      </p>
                                      <p className="text-xs ml-auto flex-shrink-0" style={{ color: 'var(--text-faint)' }}>
                                        last updated {format(new Date(mostRecent.learned_at), 'MMM d')}
                                      </p>
                                    </div>
                                    <div className="space-y-0">
                                      {uniqueFacts.map(f => <FactRow key={f.id} f={f} indented />)}
                                      {dupeCount > 0 && (
                                        <p className="text-xs pt-1" style={{ color: 'var(--text-faint)' }}>
                                          {dupeCount} duplicate {dupeCount === 1 ? 'entry' : 'entries'} merged
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>}
                            {entities.length > PERSON_LIMIT && (
                              <button
                                onClick={() => setExpandedFactCats(prev => { const next = new Set(prev); isExpanded ? next.delete(cat) : next.add(cat); return next; })}
                                className="mt-2 text-xs"
                                style={{ color: 'var(--text-accent)' }}
                              >
                                {isExpanded ? 'Show less' : `Show all (${entities.length} people)`}
                              </button>
                            )}
                          </div>
                        );
                      }

                      // ── All other categories: flat list ──
                      const secCollapsed = collapsedMemorySections.has(cat);
                      const visible = catItems.length > FACTS_CAT_LIMIT && !isExpanded ? catItems.slice(0, FACTS_CAT_LIMIT) : catItems;
                      return (
                        <div key={cat}>
                          <button
                            onClick={() => toggleMemorySection(cat)}
                            aria-expanded={!secCollapsed}
                            className="flex items-center gap-1.5 text-sm font-semibold mb-3 w-full text-left"
                            style={{ color: 'var(--text-body)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                          >
                            <span aria-hidden="true">{meta.icon}</span>
                            {meta.label}
                            <span className="ml-1 text-xs font-normal" style={{ color: 'var(--text-faint)' }}>· {catItems.length}</span>
                            <span className="ml-auto" aria-hidden="true" style={{ color: 'var(--text-faint)', fontSize: 10 }}>{secCollapsed ? '▸' : '▾'}</span>
                          </button>
                          {!secCollapsed && <div className="space-y-1.5">
                            {visible.map(f => <FactRow key={f.id} f={f} />)}
                          </div>}
                          {catItems.length > FACTS_CAT_LIMIT && (
                            <button
                              onClick={() => setExpandedFactCats(prev => { const next = new Set(prev); isExpanded ? next.delete(cat) : next.add(cat); return next; })}
                              className="mt-2 text-xs"
                              style={{ color: 'var(--text-accent)' }}
                            >
                              {isExpanded ? 'Show less' : `Show all (${catItems.length})`}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Memory layer placeholders — shown until Core ships the relevant data */}
              {facts.length > 0 && (
                <div className="space-y-4 mb-8">
                  {/* Patterns (M3) */}
                  {facts.filter(f => f.category === 'pattern').length === 0 && (
                    <div>
                      <h3 className="flex items-center gap-1.5 text-sm font-semibold mb-2" style={{ color: 'var(--text-body)' }}>
                        <span aria-hidden="true">📈</span>
                        Patterns
                      </h3>
                      <div className="rounded-xl px-4 py-3" style={{ background: 'var(--edg-fill-04)', border: '1px dashed var(--edg-hairline)' }}>
                        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                          Edg3 is building a picture of your patterns — your most productive days, energy cycles, and what tends to get squeezed out.
                        </p>
                      </div>
                    </div>
                  )}
                  {/* Decisions (M4/L4) */}
                  <div>
                    <h3 className="flex items-center gap-1.5 text-sm font-semibold mb-2" style={{ color: 'var(--text-body)' }}>
                      <span aria-hidden="true">🔑</span>
                      Decisions
                    </h3>
                    <div className="rounded-xl px-4 py-3" style={{ background: 'var(--edg-fill-04)', border: '1px dashed var(--edg-hairline)' }}>
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        Major decisions and their rationale — so Edg3 never re-litigates what you&apos;ve already resolved.
                      </p>
                    </div>
                  </div>
                  {/* Accountability (L7) */}
                  <div>
                    <h3 className="flex items-center gap-1.5 text-sm font-semibold mb-2" style={{ color: 'var(--text-body)' }}>
                      <span aria-hidden="true">✓</span>
                      Commitments &amp; outcomes
                    </h3>
                    <div className="rounded-xl px-4 py-3" style={{ background: 'var(--edg-fill-04)', border: '1px dashed var(--edg-hairline)' }}>
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        What you committed to, and what actually happened. Edg3 uses this to learn from reality, not just your intentions.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Divider between structured facts and raw call notes */}
              {facts.length > 0 && memories.length > 0 && (
                <div className="mb-6" style={{ borderTop: '1px solid var(--edg-hairline)' }} />
              )}

              {/* Past commitments (M4 accountability) */}
              {accountability && (accountability.stillOpen.length > 0 || accountability.done.length > 0) && (
                <div className="mb-8">
                  <button
                    onClick={() => toggleMemorySection('accountability')}
                    aria-expanded={!collapsedMemorySections.has('accountability')}
                    className="flex items-center gap-1.5 text-sm font-semibold mb-1 w-full text-left"
                    style={{ color: 'var(--text-body)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                  >
                    <span aria-hidden="true">✅</span>
                    Past commitments
                    <span className="ml-1 text-xs font-normal" style={{ color: 'var(--text-faint)' }}>· {accountability.stillOpen.length + accountability.done.length}</span>
                    {accountability.completionRate !== null && (
                      <span className="ml-2 text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{
                          background: accountability.completionRate >= 0.7 ? 'rgba(34,197,94,0.1)' : 'var(--edg-fill-04)',
                          color: accountability.completionRate >= 0.7 ? 'var(--edg-success)' : 'var(--text-faint)',
                        }}>
                        {Math.round(accountability.completionRate * 100)}% done
                      </span>
                    )}
                    <span className="ml-auto" aria-hidden="true" style={{ color: 'var(--text-faint)', fontSize: 10 }}>{collapsedMemorySections.has('accountability') ? '▸' : '▾'}</span>
                  </button>
                  {!collapsedMemorySections.has('accountability') && <>
                  <p className="text-xs mb-3" style={{ color: 'var(--text-faint)' }}>
                    What you&apos;ve committed to on calls — Edg3 checks in when they stay open.
                  </p>
                  {accountability.stillOpen.length > 0 && (
                    <div className="space-y-2 mb-3">
                      <p className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-faint)', letterSpacing: '0.06em' }}>Still open</p>
                      {accountability.stillOpen.slice(0, 5).map(c => {
                        const urgent = c.daysOpen >= 7;
                        return (
                          <div key={`ol-${c.id}-${c.source}`} className="glass-card px-4 py-3 flex items-start gap-3"
                            style={urgent ? { borderColor: 'rgba(245,158,11,0.25)' } : undefined}>
                            <span className="mt-0.5 flex-shrink-0 text-base" aria-hidden="true"
                              style={{ color: urgent ? 'rgba(245,158,11,0.8)' : 'var(--text-faint)' }}>
                              {urgent ? '⚠' : '⏳'}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm leading-snug" style={{ color: 'var(--text-body)' }}>{c.text}</p>
                              <p className="text-xs mt-0.5" style={{ color: urgent ? 'rgba(245,158,11,0.7)' : 'var(--text-faint)' }}>
                                Open {c.daysOpen === 1 ? '1 day' : `${c.daysOpen} days`}
                                {c.dueDate ? ` · due ${c.dueDate}` : ''}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {accountability.done.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-faint)', letterSpacing: '0.06em' }}>Completed</p>
                      {accountability.done.slice(0, 3).map(c => (
                        <div key={`done-${c.id}-${c.source}`} className="flex items-start gap-3 px-4 py-2.5 rounded-xl"
                          style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.12)' }}>
                          <span className="mt-0.5 flex-shrink-0 text-sm" aria-hidden="true" style={{ color: 'var(--edg-success)' }}>✓</span>
                          <p className="text-sm leading-snug" style={{ color: 'var(--text-muted)' }}>{c.text}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  </>}
                </div>
              )}

              {/* Episode history timeline (M5) */}
              {episodes.length > 0 && (() => {
                const SOURCE_ICON: Record<string, string> = { call: '📞', email: '✉️', calendar: '📅' };
                const SOURCE_LABEL: Record<string, string> = { call: 'Morning call', email: 'Email', calendar: 'Calendar' };
                const byDate = episodes.reduce<Record<string, typeof episodes>>((acc, ep) => {
                  const key = ep.occurredAt.slice(0, 10);
                  (acc[key] = acc[key] || []).push(ep);
                  return acc;
                }, {});
                const dateKeys = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
                const secCollapsed = collapsedMemorySections.has('episodes');
                return (
                  <div className="mb-8">
                    <button
                      onClick={() => toggleMemorySection('episodes')}
                      aria-expanded={!secCollapsed}
                      className="flex items-center gap-1.5 text-sm font-semibold mb-3 w-full text-left"
                      style={{ color: 'var(--text-body)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                    >
                      <span aria-hidden="true">🧠</span>
                      What Edg3 remembers
                      <span className="ml-1 text-xs font-normal" style={{ color: 'var(--text-faint)' }}>· {episodes.length} {episodes.length === 1 ? 'session' : 'sessions'}</span>
                      <span className="ml-auto" aria-hidden="true" style={{ color: 'var(--text-faint)', fontSize: 10 }}>{secCollapsed ? '▸' : '▾'}</span>
                    </button>
                    {!secCollapsed && <>
                      <p className="text-xs mb-4" style={{ color: 'var(--text-faint)' }}>
                        Every conversation Edg3 has held onto — the accumulated memory that makes each briefing smarter than the last.
                      </p>
                      <div className="pl-4" style={{ borderLeft: '2px solid var(--edg-accent-15)' }}>
                        {dateKeys.map((dateKey, di) => {
                          const dayEps = byDate[dateKey];
                          const dateLabel = new Date(dateKey + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
                          return (
                            <div key={dateKey} className={di > 0 ? 'mt-5' : ''}>
                              <div className="flex items-center gap-2 mb-2 relative">
                                <div
                                  className="absolute rounded-full"
                                  style={{ left: -20, top: 3, width: 10, height: 10, background: 'var(--edg-bg)', border: '2px solid var(--edg-accent-30, var(--edg-accent-20))' }}
                                  aria-hidden="true"
                                />
                                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)', letterSpacing: '0.06em' }}>{dateLabel}</p>
                              </div>
                              <div className="space-y-2">
                                {dayEps.map(ep => {
                                  const isEpExpanded = expandedEpisodes.has(ep.id);
                                  return (
                                    <div key={ep.id} className="glass-card px-4 py-3" style={{ border: '1px solid var(--edg-hairline)' }}>
                                      <div className="flex items-center gap-2 mb-2">
                                        <span className="text-base flex-shrink-0" aria-hidden="true">{SOURCE_ICON[ep.source] ?? '📞'}</span>
                                        <p className="text-sm font-medium" style={{ color: 'var(--text-strong)' }}>{SOURCE_LABEL[ep.source] ?? 'Call'}</p>
                                        <p className="text-xs ml-auto flex-shrink-0" style={{ color: 'var(--text-faint)' }}>
                                          {new Date(ep.occurredAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                                        </p>
                                      </div>
                                      {ep.topics.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mb-2" role="list" aria-label="Topics discussed">
                                          {ep.topics.slice(0, 5).map((t, i) => (
                                            <span key={i} role="listitem" className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--edg-accent-08)', color: 'var(--text-accent)', border: '1px solid var(--edg-accent-15)' }}>
                                              {t}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                      {ep.commitments.length > 0 && (
                                        <div>
                                          <button
                                            onClick={() => setExpandedEpisodes(prev => { const next = new Set(prev); isEpExpanded ? next.delete(ep.id) : next.add(ep.id); return next; })}
                                            className="flex items-center gap-1 text-xs"
                                            style={{ color: 'var(--text-faint)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                                            aria-expanded={isEpExpanded}
                                          >
                                            <span aria-hidden="true" style={{ fontSize: 10 }}>{isEpExpanded ? '▾' : '▸'}</span>
                                            {ep.commitments.length} commitment{ep.commitments.length !== 1 ? 's' : ''}
                                          </button>
                                          {isEpExpanded && (
                                            <ul className="mt-2 space-y-1.5 pl-1">
                                              {ep.commitments.map((c, i) => (
                                                <li key={i} className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                                                  <span className="flex-shrink-0 font-bold" style={{ color: 'var(--edg-indigo)', lineHeight: '1.4' }} aria-hidden="true">↳</span>
                                                  {c}
                                                </li>
                                              ))}
                                            </ul>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>}
                  </div>
                );
              })()}

              {/* Behavioral patterns (M3) */}
              {patterns.length > 0 && (
                <div className="mb-8">
                  <button
                    onClick={() => toggleMemorySection('patterns-m3')}
                    aria-expanded={!collapsedMemorySections.has('patterns-m3')}
                    className="flex items-center gap-1.5 text-sm font-semibold mb-1 w-full text-left"
                    style={{ color: 'var(--text-body)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                  >
                    <span aria-hidden="true">📈</span>
                    Patterns Edg3 has noticed
                    <span className="ml-1 text-xs font-normal" style={{ color: 'var(--text-faint)' }}>· {patterns.length}</span>
                    <span className="ml-auto" aria-hidden="true" style={{ color: 'var(--text-faint)', fontSize: 10 }}>{collapsedMemorySections.has('patterns-m3') ? '▸' : '▾'}</span>
                  </button>
                  {!collapsedMemorySections.has('patterns-m3') && <>
                  <p className="text-xs mb-3" style={{ color: 'var(--text-faint)' }}>
                    Detected from your calendar and health data — used to protect your best time.
                  </p>
                  <div className="space-y-2">
                    {patterns.map((p, i) => {
                      const isHigh = p.confidence === 'high';
                      return (
                        <div key={i} className="glass-card px-4 py-3 flex items-start gap-3">
                          <span className="flex-shrink-0 mt-0.5 text-base" aria-hidden="true">
                            {p.type === 'energy' ? '⚡' : p.type === 'meeting' ? '📅' : p.type === 'focus' ? '🎯' : '〰'}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>{p.summary}</p>
                            <div className="flex items-center gap-2 mt-1.5">
                              <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                                style={{
                                  background: isHigh ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
                                  color: isHigh ? 'var(--edg-success)' : 'rgba(245,158,11,0.9)',
                                }}>
                                {isHigh ? 'High' : 'Medium'} confidence
                              </span>
                              <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                                {p.sampleDays} data point{p.sampleDays !== 1 ? 's' : ''}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  </>}
                </div>
              )}

              {/* People profiles (M2) */}
              {people.length > 0 && (() => {
                const PEOPLE_LIMIT = 15;
                const topPeople = people.slice(0, PEOPLE_LIMIT);
                return (
                  <div className="mb-8">
                    <button
                      onClick={() => toggleMemorySection('people-m2')}
                      aria-expanded={!collapsedMemorySections.has('people-m2')}
                      className="flex items-center gap-1.5 text-sm font-semibold mb-1 w-full text-left"
                      style={{ color: 'var(--text-body)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                    >
                      <span aria-hidden="true">🤝</span>
                      People you meet with
                      <span className="ml-1 text-xs font-normal" style={{ color: 'var(--text-faint)' }}>· {people.length}</span>
                      <span className="ml-auto" aria-hidden="true" style={{ color: 'var(--text-faint)', fontSize: 10 }}>{collapsedMemorySections.has('people-m2') ? '▸' : '▾'}</span>
                    </button>
                    {!collapsedMemorySections.has('people-m2') && <>
                    <p className="text-xs mb-3" style={{ color: 'var(--text-faint)' }}>
                      Built from your calendar — sorted by how often you meet.
                    </p>
                    <div className="space-y-2">
                      {topPeople.map(p => {
                        const initial = p.canonical_name.trim()[0]?.toUpperCase() ?? '?';
                        const lastDate = p.last_interaction
                          ? new Date(p.last_interaction + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
                          : null;
                        const nextDate = p.upcoming_interaction
                          ? new Date(p.upcoming_interaction + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
                          : null;
                        const isFrequent = p.interaction_count >= 5;
                        return (
                          <div key={p.canonical_name} className="glass-card px-4 py-3 flex items-center gap-3">
                            {/* Avatar */}
                            <div className="flex-shrink-0 flex items-center justify-center rounded-full text-sm font-bold select-none"
                              style={{
                                width: 36, height: 36,
                                background: isFrequent ? 'var(--edg-accent-15)' : 'var(--edg-fill-hover)',
                                color: isFrequent ? 'var(--edg-indigo-bright)' : 'var(--text-muted)',
                                border: isFrequent ? '1px solid var(--edg-accent-20)' : '1px solid transparent',
                              }}>
                              {initial}
                            </div>
                            {/* Name + stats */}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold leading-snug truncate" style={{ color: 'var(--text-strong)' }}>
                                {p.canonical_name}
                              </p>
                              <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
                                {p.interaction_count} meeting{p.interaction_count !== 1 ? 's' : ''}
                                {lastDate && <> · last {lastDate}</>}
                              </p>
                            </div>
                            {/* Next meeting pill */}
                            {nextDate && (
                              <span className="flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium"
                                style={{ background: 'var(--edg-accent-08)', color: 'var(--text-accent)', border: '1px solid var(--edg-accent-15)' }}>
                                {nextDate}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    </>}
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
                    <button
                      onClick={() => toggleMemorySection('call-notes')}
                      aria-expanded={!collapsedMemorySections.has('call-notes')}
                      className="flex items-center gap-1.5 text-sm font-semibold mb-3 w-full text-left"
                      style={{ color: 'var(--text-body)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                    >
                      <span aria-hidden="true">📋</span>
                      Call notes
                      <span className="ml-1 text-xs font-normal" style={{ color: 'var(--text-faint)' }}>· {memories.length}</span>
                      <span className="ml-auto" aria-hidden="true" style={{ color: 'var(--text-faint)', fontSize: 10 }}>{collapsedMemorySections.has('call-notes') ? '▸' : '▾'}</span>
                    </button>
                    {!collapsedMemorySections.has('call-notes') && <><div className="space-y-3">
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
                            {correctName(m.content.length > 300 ? m.content.slice(0, 300) + '…' : m.content, (user?.name || '').split(' ')[0])}
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
                    )}</>}
                  </div>
                );
              })()}

              {facts.length === 0 && memories.length === 0 && (
                <div className="glass-card p-8 text-center">
                  <p className="text-3xl mb-3" role="img" aria-label="seedling">&#x1F331;</p>
                  <p className="font-semibold mb-2">Nothing stored yet</p>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    After your first call, Edg3 will start building a picture of you here — goals, projects, preferences, and more.
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'profile' && (
            <ProfileTab onSettingsSaved={loadData} />
          )}

          {activeTab === 'help' && (
            <div className="max-w-2xl mx-auto">
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
