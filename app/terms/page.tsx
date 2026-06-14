import Link from 'next/link';

export default function TermsPage() {
  return (
    <div className="min-h-screen relative" style={{ background: 'var(--background)' }}>
      <div className="orb orb-1" />
      <div className="orb orb-2" />

      <div className="relative z-10 max-w-3xl mx-auto px-8 py-16">
        {/* Nav */}
        <div className="flex items-center justify-between mb-16">
          <Link href="/">
            <span className="logo-text text-2xl">EDG3</span>
          </Link>
          <Link href="/signup" className="btn-primary text-sm py-2 px-5">Get started</Link>
        </div>

        <div className="space-y-12">
          <div>
            <h1 className="text-4xl font-black mb-3">Terms of Service &amp; Privacy Policy</h1>
            <p className="text-sm" style={{ color: 'var(--text-faint)' }}>Last updated: June 3, 2026</p>
          </div>

          <section className="glass-card p-8 space-y-4" style={{ borderColor: 'var(--edg-accent-20)' }}>
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-accent)' }}>What Edg3 Does</h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
              Edg3 (the &ldquo;Service&rdquo;) is an AI Chief of Staff that delivers a personalized daily briefing via outbound voice call.
              When you create an account and provide your phone number, you will receive one automated AI-generated voice call
              each morning at the time you select during onboarding.
            </p>
          </section>

          <section className="glass-card p-8 space-y-4" style={{ borderColor: 'var(--border-accent)', background: 'var(--edg-accent-08)' }}>
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-accent)' }}>Consent to Receive Calls</h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
              By creating an account and entering your phone number, <strong style={{ color: 'var(--text-strong)' }}>you expressly consent</strong> to
              receive automated AI voice calls from Edg3 at the phone number you provide. These calls are:
            </p>
            <ul className="space-y-2 text-sm" style={{ color: 'var(--text-body)' }}>
              {[
                'Daily, one call per day at your chosen time',
                'Preceded by a reminder text message before your scheduled call',
                'Automated and AI-generated (not a live human caller)',
                'Informational — your personal daily briefing',
                'Initiated only to numbers you provide and verify',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span style={{ color: 'var(--edg-indigo)' }}>&#x2192;</span>
                  {item}
                </li>
              ))}
            </ul>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
              Standard message and data rates from your carrier may apply. Consent is not a condition of purchase.
            </p>
          </section>

          <section className="glass-card p-8 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-accent)' }}>How to Opt Out</h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
              You can stop receiving calls at any time by:
            </p>
            <ul className="space-y-2 text-sm" style={{ color: 'var(--text-body)' }}>
              {[
                'Logging into your dashboard and removing your phone number',
                'Saying "stop", "unsubscribe", or "cancel" during a call',
                'Emailing us at support@edg3.ai',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span style={{ color: 'var(--edg-indigo)' }}>&#x2192;</span>
                  {item}
                </li>
              ))}
            </ul>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
              Opt-out requests are processed immediately. You will receive no further calls after opting out.
            </p>
          </section>

          <section className="glass-card p-8 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-accent)' }}>Information We Collect</h2>
            <ul className="space-y-2 text-sm" style={{ color: 'var(--text-body)' }}>
              {[
                'Name and email address (account creation)',
                'Phone number (to deliver your daily briefing call)',
                'Profile summary you provide (to personalize briefings)',
                'Google Calendar data — read-only access, never modified',
                'Call transcripts — used solely to improve your briefings',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span style={{ color: 'var(--edg-indigo)' }}>&#x2192;</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section className="glass-card p-8 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-accent)' }}>How We Use Your Information</h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
              Your information is used exclusively to operate and improve the Service. We do not sell, rent, or share your
              personal information with third parties for marketing purposes. Data is shared only with infrastructure providers
              (Anthropic for AI generation, Vapi/Twilio for voice delivery, Google for calendar access) as required to operate the Service.
            </p>
          </section>

          <section className="glass-card p-8 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-accent)' }}>Data Retention &amp; Deletion</h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
              You may request deletion of your account and all associated data at any time by emailing support@edg3.ai.
              Your data will be permanently deleted within 30 days of your request.
            </p>
          </section>

          <section className="glass-card p-8 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-accent)' }}>Contact</h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
              For questions about these terms or your data, contact us at{' '}
              <span style={{ color: 'var(--text-accent)' }}>support@edg3.ai</span>.
            </p>
          </section>
        </div>

        <div className="mt-16 pt-8 text-center" style={{ borderTop: '1px solid var(--edg-hairline)' }}>
          <Link href="/" className="text-sm" style={{ color: 'var(--text-faint)' }}>&#x2190; Back to Edg3</Link>
        </div>
      </div>
    </div>
  );
}
