/* Edg3 UI Kit — Dashboard (authenticated app shell). Recreated from app/dashboard/page.tsx */
const DB = window.Edg3DesignSystem_b79f44;

const NAV = [
  { id: 'briefings', label: 'Briefings', icon: '📋' },
  { id: 'tasks', label: 'Tasks', icon: '✓' },
  { id: 'priorities', label: 'Priorities', icon: '🎯' },
  { id: 'memory', label: 'Memory', icon: '🧠' },
  { id: 'profile', label: 'Profile', icon: '👤' },
];

const SEED_BRIEFINGS = [
  { id: 3, when: 'Today · 7:00 AM', status: 'completed', said: 'Shipping the beta today — clearing the morning for it.',
    content: "Morning. Three things before you start.\n\nFirst — you blocked 9–11 for deep work but there's a 9:30 sync on your calendar with the design team. That's exactly the kind of fragmentation that killed last week's momentum. I'd move the sync to 2pm.\n\nSecond — the beta ships today. You told me on Monday this was the week. Protect the afternoon.\n\nThird — you've mentioned the Hong Kong move twice this week. When do you want to actually decide?" },
  { id: 2, when: 'Yesterday · 7:02 AM', status: 'completed', said: "Behind on the investor update — doing it first thing.", content: '' },
  { id: 1, when: 'Saturday · 8:14 AM', status: 'missed', said: '', content: '' },
];

function ChatWithEdge() {
  const [messages, setMessages] = React.useState([
    { role: 'edge', text: "What's on your mind? I'll remember everything you tell me and bring it up on our next call." },
  ]);
  const [text, setText] = React.useState('');
  function send(e) {
    e.preventDefault();
    if (!text.trim()) return;
    const t = text.trim();
    setText('');
    setMessages((m) => [...m, { role: 'user', text: t }]);
    setTimeout(() => setMessages((m) => [...m, { role: 'edge', text: "Got it — I'll bring that up on our next call." }]), 500);
  }
  return (
    <DB.Card accent padding={0} style={{ marginBottom: 24, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px 8px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--edg-hairline-soft)' }}>
        <span className="pulse-ring" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--edg-indigo-bright)' }}></span>
        <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--edg-indigo)', margin: 0 }}>CHAT WITH EDGE</p>
        <p style={{ fontSize: 12, marginLeft: 'auto', color: 'var(--text-faint)' }}>Saved to memory · used in next briefing</p>
      </div>
      <div style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 200, overflowY: 'auto' }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              fontSize: 14, padding: '8px 12px', maxWidth: 300, lineHeight: 1.5,
              background: m.role === 'user' ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.06)',
              color: m.role === 'user' ? 'var(--text-strong)' : 'var(--text-body)',
              borderRadius: m.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
            }}>{m.text}</div>
          </div>
        ))}
      </div>
      <form onSubmit={send} style={{ padding: '12px 20px', display: 'flex', gap: 8, borderTop: '1px solid var(--edg-hairline-soft)' }}>
        <DB.Input placeholder="Tell Edge something..." value={text} onChange={(e) => setText(e.target.value)} style={{ padding: '8px 12px' }} />
        <DB.Button variant="primary" size="sm" type="submit" disabled={!text.trim()}>Send</DB.Button>
      </form>
    </DB.Card>
  );
}

function BriefingsTab() {
  const [open, setOpen] = React.useState(3);
  const statusVariant = { completed: 'success', missed: 'danger', calling: 'pending', pending: 'info' };
  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 16px' }}>Briefing history</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {SEED_BRIEFINGS.map((b) => (
          <DB.Card key={b.id} hover padding={20} onClick={() => setOpen(open === b.id ? null : b.id)} style={{ cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <p style={{ fontWeight: 600, fontSize: 14, margin: 0 }}>{b.when}</p>
                {b.said && <p style={{ fontSize: 12, marginTop: 4, color: 'var(--text-muted)', maxWidth: 380 }}>You said: "{b.said}"</p>}
              </div>
              <DB.Badge variant={statusVariant[b.status]}>{b.status}</DB.Badge>
            </div>
            {open === b.id && b.content && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-card)' }}>
                <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 8px', color: 'var(--edg-indigo)' }}>BRIEFING CONTENT</p>
                <p style={{ fontSize: 14, lineHeight: 1.65, whiteSpace: 'pre-wrap', margin: 0, color: 'var(--text-body)' }}>{b.content}</p>
              </div>
            )}
          </DB.Card>
        ))}
      </div>
    </div>
  );
}

function TasksTab() {
  const [tasks, setTasks] = React.useState([
    { id: 1, text: 'Move 9:30 design sync to 2pm', done: false, source: 'edg3' },
    { id: 2, text: 'Ship beta — protect 1–5pm', done: false, source: 'edg3' },
    { id: 3, text: 'Reply to investor update thread', done: true, source: 'manual' },
  ]);
  const toggle = (id) => setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const edg3 = tasks.filter((t) => t.source === 'edg3');
  const manual = tasks.filter((t) => t.source === 'manual');
  const Row = (t) => (
    <DB.Card key={t.id} hover padding={16} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <DB.Checkbox checked={t.done} onChange={() => toggle(t.id)} />
      <span style={{ flex: 1, fontSize: 14, color: t.done ? 'var(--text-faint)' : 'var(--text-strong)', textDecoration: t.done ? 'line-through' : 'none' }}>{t.text}</span>
      {t.source === 'edg3' && <DB.Badge variant="info">EDG3</DB.Badge>}
    </DB.Card>
  );
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Today's tasks</h2>
        <DB.Badge variant="info">{tasks.filter((t) => t.done).length}/{tasks.length} done</DB.Badge>
      </div>
      <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 8px', color: 'var(--edg-indigo)' }}>✦ SUGGESTED BY EDG3</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>{edg3.map(Row)}</div>
      <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 8px', color: 'var(--text-faint)' }}>YOUR TASKS</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{manual.map(Row)}</div>
    </div>
  );
}

function PrioritiesTab() {
  const items = ['Build Edg3', 'Close two enterprise deals', 'Daily gym + 7h sleep'];
  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 16px' }}>This week's priorities</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {items.map((p, i) => (
          <DB.Card key={i} padding={20} style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
            <DB.Avatar initials={String(i + 1)} size={32} />
            <p style={{ fontWeight: 500, fontSize: 14, paddingTop: 4, margin: 0 }}>{p}</p>
          </DB.Card>
        ))}
      </div>
      <p style={{ fontSize: 12, marginTop: 16, color: 'var(--text-faint)' }}>Edg3 checks these every morning against your calendar.</p>
    </div>
  );
}

function MemoryTab() {
  const mems = [
    { type: 'insight', date: 'Jun 9', text: 'Consistently over-commits mornings, then loses the afternoon to context-switching. Protect deep-work blocks.' },
    { type: 'pattern', date: 'Jun 7', text: 'Mentioned moving to Hong Kong 8 times in the last 30 days. Recurring, unresolved decision.' },
    { type: 'profile', date: 'Jun 1', text: 'Building Edg3 full-time. Priority #1 is shipping. Identity still partly attached to former title.' },
  ];
  const v = { insight: 'success', pattern: 'info', profile: 'pending' };
  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>Memory bank</h2>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 16px' }}>Everything Edg3 remembers about you accumulates here over time.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {mems.map((m, i) => (
          <DB.Card key={i} padding={16}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <DB.Badge variant={v[m.type]}>{m.type}</DB.Badge>
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{m.date}, 2026</span>
            </div>
            <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0, color: 'var(--text-body)' }}>{m.text}</p>
          </DB.Card>
        ))}
      </div>
    </div>
  );
}

function ProfileTab() {
  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 16px' }}>Call settings</h2>
      <DB.Card padding={24} style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160 }}><DB.Input label="Call time" type="time" defaultValue="07:00" /></div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <DB.Select label="Timezone" defaultValue="America/New_York" options={[
              { label: 'New York / Toronto (ET)', value: 'America/New_York' },
              { label: 'London (GMT)', value: 'Europe/London' },
            ]} />
          </div>
        </div>
        <DB.Button variant="primary" size="sm" style={{ marginTop: 16 }}>Save settings</DB.Button>
      </DB.Card>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>Your profile</h2>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 16px' }}>The full context Edg3 uses to understand who you are. Keep it current.</p>
      <DB.Card padding={24}>
        <p style={{ fontSize: 14, lineHeight: 1.65, margin: 0, color: 'var(--text-body)' }}>
          Building Edg3 full-time after leaving a corporate role. Goal: financial independence through the product and selective consulting. Strengths: communication, stakeholder management. Watch-outs: over-commits mornings, under-prices, seeks permission before acting. Chief-of-Staff priority — ship before you polish.
        </p>
      </DB.Card>
    </div>
  );
}

function CallModal({ onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
      <DB.Card accent padding={32} style={{ maxWidth: 400, width: '100%', textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', background: 'var(--edg-accent-15)', border: '1px solid var(--edg-accent-20)', position: 'relative' }}>
          <span className="pulse-ring" style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid var(--edg-indigo)' }}></span>
          <span style={{ fontSize: 24 }}>📞</span>
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 900, margin: '0 0 8px' }}>Edg3 is calling you now…</h2>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 24px' }}>Pick up — your briefing takes about 3 minutes.</p>
        <DB.Button variant="secondary" fullWidth onClick={onClose}>✓ Done, I got the call</DB.Button>
      </DB.Card>
    </div>
  );
}

function DashboardScreen({ onSignOut }) {
  const [tab, setTab] = React.useState('briefings');
  const [calling, setCalling] = React.useState(false);
  return (
    <div style={{ position: 'relative', minHeight: '100%', background: 'var(--surface-page)' }}>
      <DB.Orb variant={1} />
      <DB.Orb variant={2} />
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', minHeight: '100%' }}>
        {/* Sidebar */}
        <aside style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', padding: '24px 16px', borderRight: '1px solid var(--border-card)' }}>
          <div style={{ marginBottom: 32, paddingLeft: 8 }}><DB.Logo size={20} /></div>
          <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {NAV.map((n) => (
              <button key={n.id} onClick={() => setTab(n.id)} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderRadius: 8, fontSize: 14, fontWeight: 500, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                background: tab === n.id ? 'var(--edg-accent-15)' : 'transparent',
                color: tab === n.id ? 'var(--text-accent)' : 'var(--text-muted)',
                border: tab === n.id ? '1px solid var(--edg-accent-20)' : '1px solid transparent',
              }}>
                <span>{n.icon}</span>{n.label}
              </button>
            ))}
          </nav>
          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <DB.Card padding={12}>
              <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '0 0 2px' }}>Next call</p>
              <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>07:00 New York</p>
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--edg-success)' }}>✓ On your calendar</span>
              </div>
            </DB.Card>
            <button onClick={onSignOut} style={{ background: 'none', border: 'none', textAlign: 'left', padding: '8px', fontSize: 12, color: 'var(--text-faint)', cursor: 'pointer', fontFamily: 'inherit' }}>Sign out</button>
          </div>
        </aside>

        {/* Main */}
        <main style={{ flex: 1, padding: 32, overflow: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Good morning, Alex</h1>
              <p style={{ fontSize: 14, marginTop: 4, color: 'var(--text-muted)' }}>Tuesday, June 10, 2026</p>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <DB.Button variant="secondary" size="sm">💬 Open call</DB.Button>
              <DB.Button variant="primary" size="sm" onClick={() => setCalling(true)}>📞 Call me now</DB.Button>
            </div>
          </div>

          <ChatWithEdge />

          {tab === 'briefings' && <BriefingsTab />}
          {tab === 'tasks' && <TasksTab />}
          {tab === 'priorities' && <PrioritiesTab />}
          {tab === 'memory' && <MemoryTab />}
          {tab === 'profile' && <ProfileTab />}
        </main>
      </div>
      {calling && <CallModal onClose={() => setCalling(false)} />}
    </div>
  );
}

window.DashboardScreen = DashboardScreen;
