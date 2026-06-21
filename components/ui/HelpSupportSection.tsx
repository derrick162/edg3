'use client';

import { useState } from 'react';

// ── FAQ content ───────────────────────────────────────────────────────────────
// Source: content/faq.md (Esther — not yet written; placeholders below).
// When Esther's file lands, replace this data structure with a parsed version.

interface FaqItem {
  q: string;
  a: string;
}

interface FaqSection {
  title: string;
  icon: string;
  items: FaqItem[];
}

const FAQ_SECTIONS: FaqSection[] = [
  {
    title: 'Getting started',
    icon: '🚀',
    items: [
      {
        q: 'What is Edg3?',
        a: 'Edg3 is your daily focus OS. Each morning Edg3 calls you, learns what matters today, and reshapes your calendar around your top three priorities — so you spend energy on what actually moves the needle.',
      },
      {
        q: 'How do I set up my first call?',
        a: 'Complete onboarding: connect your Google Calendar, set your top three focus areas, and pick a call time. Edg3 will ring you at that time tomorrow morning. The first call takes about three minutes.',
      },
      {
        q: 'Do I need to connect Google Calendar?',
        a: 'Calendar connection is what gives Edg3 the data to be useful — without it Edg3 can\'t see your schedule or suggest changes. Gmail connection is optional (needed for email drafting and reply tracking).',
      },
    ],
  },
  {
    title: 'How it works',
    icon: '⚙️',
    items: [
      {
        q: 'What happens during a morning briefing?',
        a: 'Edg3 calls you, opens with the most important event on your calendar, checks in on your energy and priorities, and proposes any calendar changes that would put more time on your top focus areas. You can accept, adjust, or dismiss each suggestion live on the call.',
      },
      {
        q: 'How does Edg3 learn my preferences?',
        a: 'Everything you say on a call is remembered — your energy profile, recurring commitments, people you work with, and how you like your calendar structured. The more calls you complete, the sharper Edg3\'s recommendations become.',
      },
      {
        q: 'Can Edg3 make changes to my calendar without asking?',
        a: 'No. Every calendar change requires your explicit "yes" on a call or in the dashboard. Edg3 proposes; you decide.',
      },
      {
        q: 'What is the Edg3 Score?',
        a: 'Your Edg3 Score is a daily readout (0–100) of how well-positioned you are to do your best work today. It combines Focus (is your calendar aligned with your priorities?), Energy (how\'s your recovery?), Clarity (how well does Edg3 know you?), and Momentum (are you showing up consistently?).',
      },
    ],
  },
  {
    title: 'Your data & privacy',
    icon: '🔒',
    items: [
      {
        q: 'What data does Edg3 store?',
        a: 'Edg3 stores your calendar events (fetched from Google in real time, not copied to our database), your stated focus areas and preferences, and a structured summary of each call. Health data from Whoop is stored encrypted at rest. We never sell your data.',
      },
      {
        q: 'Can I delete my data?',
        a: 'Yes. You can disconnect any integration (Google Calendar, Gmail, Whoop) from the dashboard sidebar at any time. To delete your account and all associated data, contact us via the form below.',
      },
      {
        q: 'Who can see my information?',
        a: 'Only you. Call transcripts are stored encrypted and accessible only via your authenticated session. No team member can read your calls or calendar without your explicit consent.',
      },
    ],
  },
  {
    title: 'The Edg3 Score',
    icon: '✦',
    items: [
      {
        q: 'Why is my Edg3 Score low?',
        a: 'Common reasons: your calendar has little time on your stated focus areas (Focus component), your Whoop recovery is low or not connected (Energy), you haven\'t completed many calls yet (Clarity + Momentum). Tap the score on the dashboard to see a breakdown.',
      },
      {
        q: 'How do I improve my score?',
        a: 'Complete your morning briefing each day (builds Momentum), confirm your Today\'s Focus areas, let Edg3 help you block time for your priorities (boosts Focus), and connect Whoop if you have one (fills in the Energy component with real data).',
      },
    ],
  },
  {
    title: 'Calls',
    icon: '📞',
    items: [
      {
        q: 'What if I miss a call?',
        a: 'No problem — Edg3 won\'t leave a voicemail or retry. You can open the dashboard any time and review what would have been in your briefing. Tomorrow\'s call starts fresh.',
      },
      {
        q: 'Can I change my call time?',
        a: 'Yes. Go to your Profile (or the Settings section) and update your preferred call time. Changes take effect the next morning.',
      },
      {
        q: 'Why did Edg3 say something unexpected?',
        a: 'Edg3 is a voice AI and occasionally mishears or draws the wrong inference. If something is wrong — a fact it learned, a preference it logged — you can correct it in the Memory tab. That correction will be reflected immediately.',
      },
    ],
  },
  {
    title: 'Account',
    icon: '👤',
    items: [
      {
        q: 'How do I reconnect Google after revoking access?',
        a: 'From the dashboard sidebar, tap "Connect Google Calendar" (or "Reconnect"). This re-runs the OAuth flow and re-grants the required permissions.',
      },
      {
        q: 'Is there a mobile app?',
        a: 'Not yet — the dashboard is fully responsive on mobile. A native app is on the roadmap for later this year.',
      },
    ],
  },
];

// ── Support form ──────────────────────────────────────────────────────────────

type SupportType = 'feedback' | 'question' | 'issue';

const SUPPORT_TYPES: { value: SupportType; label: string; placeholder: string }[] = [
  { value: 'feedback', label: 'Feedback',  placeholder: "Tell us what's working or what could be better…" },
  { value: 'question', label: 'Question',  placeholder: "What would you like to know…" },
  { value: 'issue',    label: 'Issue',     placeholder: "Describe what happened and what you expected…" },
];

function SupportForm() {
  const [type, setType] = useState<SupportType>('feedback');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(false);

  const placeholder = SUPPORT_TYPES.find(t => t.value === type)?.placeholder ?? '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setSubmitting(true);
    setError(false);
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, message: message.trim() }),
      });
      if (res.ok) {
        setSubmitted(true);
        setMessage('');
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div
        className="rounded-xl p-5 text-center"
        style={{
          background: 'var(--edg-success-tint)',
          border: '1px solid var(--edg-success-border)',
          animation: 'score-rise 0.3s ease both',
        }}
      >
        <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-strong)' }}>
          Thanks — we read every one. 💙
        </p>
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
          We&apos;ll get back to you if there&apos;s something to follow up on.
        </p>
        <button
          onClick={() => setSubmitted(false)}
          className="text-xs mt-3 underline"
          style={{ color: 'var(--text-faint)' }}
        >
          Send another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* Type selector */}
      <div className="flex gap-2">
        {SUPPORT_TYPES.map(t => (
          <button
            key={t.value}
            type="button"
            onClick={() => setType(t.value)}
            className="flex-1 text-xs py-2 rounded-lg font-medium transition-all"
            style={{
              background: type === t.value ? 'var(--edg-accent-08)' : 'var(--edg-fill-04)',
              color: type === t.value ? 'var(--text-accent)' : 'var(--text-faint)',
              border: type === t.value ? '1px solid var(--edg-accent-20)' : '1px solid var(--edg-hairline)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Message */}
      <textarea
        className="input w-full resize-none text-sm"
        rows={4}
        placeholder={placeholder}
        value={message}
        onChange={e => setMessage(e.target.value)}
        required
        style={{ minHeight: 96 }}
      />

      {error && (
        <p className="text-xs" style={{ color: 'var(--edg-danger)' }}>
          Something went wrong — try again in a moment.
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || !message.trim()}
        className="btn-primary w-full text-sm py-2.5"
      >
        {submitting ? 'Sending…' : 'Send message'}
      </button>
    </form>
  );
}

// ── FAQ accordion ─────────────────────────────────────────────────────────────

function FaqAccordion({ sections }: { sections: FaqSection[] }) {
  const [openSection, setOpenSection] = useState<string | null>(sections[0]?.title ?? null);
  const [openItem, setOpenItem] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {sections.map(section => {
        const isSectionOpen = openSection === section.title;
        return (
          <div
            key={section.title}
            className="rounded-xl overflow-hidden"
            style={{ border: '1px solid var(--edg-hairline)' }}
          >
            {/* Section header */}
            <button
              onClick={() => setOpenSection(isSectionOpen ? null : section.title)}
              aria-expanded={isSectionOpen}
              aria-controls={`help-section-${section.title.toLowerCase().replace(/\s+/g, '-')}`}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors"
              style={{ background: isSectionOpen ? 'var(--edg-accent-08)' : 'var(--edg-fill-04)' }}
            >
              <div className="flex items-center gap-2">
                <span aria-hidden="true">{section.icon}</span>
                <span className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>
                  {section.title}
                </span>
              </div>
              <span
                className="flex-shrink-0 text-xs transition-transform duration-200"
                style={{
                  color: 'var(--text-faint)',
                  transform: isSectionOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                }}
                aria-hidden="true"
              >
                ▼
              </span>
            </button>

            {/* Items */}
            {isSectionOpen && (
              <div
                id={`help-section-${section.title.toLowerCase().replace(/\s+/g, '-')}`}
                className="divide-y"
                style={{ borderTop: '1px solid var(--edg-hairline)', background: 'var(--glass-bg)' }}
              >
                {section.items.map(item => {
                  const key = `${section.title}::${item.q}`;
                  const isOpen = openItem === key;
                  return (
                    <div key={key}>
                      <button
                        onClick={() => setOpenItem(isOpen ? null : key)}
                        aria-expanded={isOpen}
                        aria-controls={`help-item-${key.replace(/[^a-z0-9]/gi, '-')}`}
                        className="w-full flex items-start justify-between gap-3 px-4 py-3 text-left"
                      >
                        <span className="text-sm font-medium leading-snug" style={{ color: 'var(--text-body)' }}>
                          {item.q}
                        </span>
                        <span
                          className="flex-shrink-0 text-xs mt-0.5 transition-transform duration-200"
                          style={{
                            color: 'var(--text-faint)',
                            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                          }}
                          aria-hidden="true"
                        >
                          ▼
                        </span>
                      </button>
                      {isOpen && (
                        <div
                          id={`help-item-${key.replace(/[^a-z0-9]/gi, '-')}`}
                          className="px-4 pb-4 text-sm leading-relaxed"
                          style={{ color: 'var(--text-muted)', animation: 'score-rise 0.2s ease both' }}
                        >
                          {item.a}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── HelpSupportSection ────────────────────────────────────────────────────────

export interface HelpSupportSectionProps {
  /** Override FAQ content (e.g. parsed from content/faq.md when it exists) */
  sections?: FaqSection[];
}

export function HelpSupportSection({ sections = FAQ_SECTIONS }: HelpSupportSectionProps) {
  return (
    <div className="space-y-8">
      {/* FAQ */}
      <div>
        <div className="mb-4">
          <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--text-accent)' }}>
            ✦ FREQUENTLY ASKED
          </p>
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-strong)' }}>
            Common questions
          </h3>
        </div>
        <FaqAccordion sections={sections} />
      </div>

      {/* Contact / feedback */}
      <div className="glass-card p-5">
        <div className="mb-4">
          <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--text-accent)' }}>
            ✦ GET IN TOUCH
          </p>
          <h3 className="text-sm font-bold mb-0.5" style={{ color: 'var(--text-strong)' }}>
            Send us a message
          </h3>
          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
            Feedback, questions, or something not working right — we want to hear it.
          </p>
        </div>
        <SupportForm />
      </div>
    </div>
  );
}
