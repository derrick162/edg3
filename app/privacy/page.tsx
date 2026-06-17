import Link from 'next/link';

export default function PrivacyPage() {
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

        <div className="space-y-10">
          <div>
            <h1 className="text-4xl font-black mb-3">Privacy Policy</h1>
            <p className="text-sm" style={{ color: 'var(--text-faint)' }}>Last updated: June 14, 2026</p>
            <p className="text-sm mt-4 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Edg3 (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;us&rdquo;) operates the Edg3 AI Chief of Staff service accessible at edg3.ai.
              This Privacy Policy explains how we collect, use, and protect your information.
            </p>
          </div>

          <section className="glass-card p-8 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-accent)' }}>1. Information We Collect</h2>
            <div className="space-y-4 text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
              <div>
                <p className="font-semibold mb-2" style={{ color: 'var(--text-strong)' }}>Account Information</p>
                <p>When you sign up, we collect your name, email address, and password (stored as a secure hash).</p>
              </div>
              <div>
                <p className="font-semibold mb-2" style={{ color: 'var(--text-strong)' }}>Phone Number</p>
                <p>We collect your phone number to deliver your daily AI briefing call and reminder text messages. By providing your number you consent to receive these communications.</p>
              </div>
              <div>
                <p className="font-semibold mb-2" style={{ color: 'var(--text-strong)' }}>Profile Summary</p>
                <p>You may provide a personal profile summary (goals, priorities, challenges) to personalize your briefings. This is entirely voluntary and can be updated or deleted at any time.</p>
              </div>
              <div>
                <p className="font-semibold mb-2" style={{ color: 'var(--text-strong)' }}>Google Calendar Data</p>
                <p>If you connect Google Calendar, we request access to <strong style={{ color: 'var(--text-strong)' }}>read your calendar and to create, edit, move, and delete events</strong> on your behalf. We use this to surface your schedule in your briefings and to make the calendar changes you ask Edge to make (for example, booking, rescheduling, or cancelling events). Events Edge creates are marked, and Edge can undo its own changes. We do not share your calendar data. You can disconnect Google Calendar at any time from your dashboard.</p>
              </div>
              <div>
                <p className="font-semibold mb-2" style={{ color: 'var(--text-strong)' }}>Google Gmail Data</p>
                <p>If you grant Gmail access, we use it in two ways:</p>
                <ul className="mt-2 space-y-2 pl-1">
                  <li><strong style={{ color: 'var(--text-strong)' }}>Draft creation:</strong> Edge creates email drafts on your behalf for outreach you asked for. <strong style={{ color: 'var(--text-strong)' }}>Edge never sends email</strong> — it only creates drafts for you to review and send yourself.</li>
                  <li><strong style={{ color: 'var(--text-strong)' }}>Inbox signal (metadata only):</strong> Edge reads <em>metadata</em> from recent inbox threads — sender name, subject line, and the auto-generated snippet Google provides. <strong style={{ color: 'var(--text-strong)' }}>Edge never reads email body content.</strong> This metadata is used to compute your daily Focus score and to recognize replies to outreach Edge drafted for you. Thread subject lines are stored <strong style={{ color: 'var(--text-strong)' }}>encrypted at rest</strong> (AES-256-GCM) in your activity log so you can see exactly which emails Edge reviewed — visible only to you in your Activity tab. Subjects are retained for 90 days then automatically deleted. Senders, snippets, and bodies are never stored.</li>
                </ul>
                <p className="mt-2">You can disconnect Gmail at any time from your dashboard, which immediately revokes both draft and read access.</p>
              </div>
              <div>
                <p className="font-semibold mb-2" style={{ color: 'var(--text-strong)' }}>Whoop Health Data</p>
                <p>If you connect your Whoop device, we request read-only access to your <strong style={{ color: 'var(--text-strong)' }}>recovery score, sleep data, and strain</strong> from the Whoop API. We use this data solely to personalize your daily briefing — for example, noting your recovery level and adjusting the day&apos;s recommendations accordingly. We do not share your health data with any third party, do not store raw health metrics beyond the current briefing session, and do not use it for any purpose other than personalizing your briefing. You can disconnect Whoop at any time from your dashboard. Health data is treated as sensitive personal information and handled with the same encrypted-at-rest protections as the rest of your data.</p>
              </div>
              <div>
                <p className="font-semibold mb-2" style={{ color: 'var(--text-strong)' }}>Call Transcripts &amp; Responses</p>
                <p>We store transcripts of your daily briefing calls and your spoken responses. This data is used exclusively to improve the quality and continuity of your personal briefings.</p>
              </div>
              <div>
                <p className="font-semibold mb-2" style={{ color: 'var(--text-strong)' }}>Usage Data</p>
                <p>We collect basic usage data (e.g. login times, feature usage) to operate and improve the service.</p>
              </div>
            </div>
          </section>

          <section className="glass-card p-8 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-accent)' }}>2. How We Use Your Information</h2>
            <ul className="space-y-2 text-sm" style={{ color: 'var(--text-body)' }}>
              {[
                'To deliver your daily AI briefing call and reminder texts',
                'To personalize briefings based on your profile, priorities, calendar, and (optionally) Whoop recovery data',
                'To compute your daily Focus and Energy scores using calendar event patterns and inbox metadata (sender/subject/snippet — no message bodies)',
                'To remember context from previous calls and improve over time',
                'To authenticate your account and keep it secure',
                'To communicate service updates or account-related notices',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span style={{ color: 'var(--edg-indigo)' }}>&#x2192;</span>
                  {item}
                </li>
              ))}
            </ul>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
              We do <strong style={{ color: 'var(--text-strong)' }}>not</strong> sell, rent, or share your personal information with third parties for advertising or marketing purposes.
            </p>
          </section>

          <section className="glass-card p-8 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-accent)' }}>3. Google User Data — Limited Use Disclosure</h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
              Edg3&apos;s use of information received from Google APIs (Google Calendar and Gmail) adheres to the{' '}
              <a href="https://developers.google.com/terms/api-services-user-data-policy"
                 target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-accent)', textDecoration: 'underline' }}>
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements. Specifically:
            </p>
            <ul className="space-y-2 text-sm" style={{ color: 'var(--text-body)' }}>
              {[
                'We only access your Google Calendar and Gmail data to provide the features you requested (your briefings, calendar changes you ask for, drafting outreach emails, and recognizing replies to those emails)',
                'We do not use Google user data for advertising',
                'We do not allow humans to read your Google Calendar or Gmail data except for security, to comply with the law, or with your explicit consent',
                'We do not transfer Google user data to third parties except as necessary to provide the service or as required by law',
                'We do not use Google user data for any purpose unrelated to the features you requested',
                'For Gmail specifically: Edge creates drafts only (it never sends email); it reads inbox thread metadata (sender, subject, auto-snippet — never message bodies) to compute your Focus score and recognize replies. Thread subject lines are stored encrypted at rest for 90 days so you can review them in your Activity tab; senders, snippets, and bodies are never stored.',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span style={{ color: 'var(--edg-indigo)' }}>&#x2192;</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section className="glass-card p-8 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-accent)' }}>4. Third-Party Services</h2>
            <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--text-body)' }}>
              We use the following third-party providers to operate the service. Each has their own privacy policy:
            </p>
            <ul className="space-y-2 text-sm" style={{ color: 'var(--text-body)' }}>
              {[
                'Anthropic — AI generation of briefing content',
                'Vapi / Twilio — Voice call and SMS delivery',
                'ElevenLabs — AI voice synthesis',
                'Google — Calendar integration',
                'Railway — Cloud hosting and infrastructure',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span style={{ color: 'var(--edg-indigo)' }}>&#x2192;</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section className="glass-card p-8 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-accent)' }}>5. Data Retention</h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
              We retain your data for as long as your account is active. Call transcripts and briefing history are retained
              to provide continuity across sessions. You may request deletion of your account and all associated data at
              any time by emailing <span style={{ color: 'var(--text-accent)' }}>support@edg3.ai</span>. All data will be permanently
              deleted within 30 days of your request.
            </p>
          </section>

          <section className="glass-card p-8 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-accent)' }}>6. Your Rights</h2>
            <ul className="space-y-2 text-sm" style={{ color: 'var(--text-body)' }}>
              {[
                'Access — request a copy of the data we hold about you',
                'Correction — update or correct your personal information at any time from your dashboard',
                'Deletion — request permanent deletion of your account and all associated data',
                'Opt-out — stop receiving calls or texts at any time via your dashboard or by saying "stop" during a call',
                'Disconnect — remove Google Calendar access at any time from your dashboard',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span style={{ color: 'var(--edg-indigo)' }}>&#x2192;</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section className="glass-card p-8 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-accent)' }}>7. Security</h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
              We use industry-standard security practices including encrypted connections (HTTPS), hashed passwords,
              encryption of sensitive data at rest (such as your connected-account access tokens and call transcripts,
              using AES-256), and access controls to protect your data. No method of transmission over the internet is
              100% secure, and we cannot guarantee absolute security.
            </p>
          </section>

          <section className="glass-card p-8 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-accent)' }}>8. Children&apos;s Privacy</h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
              Edg3 is not directed at children under 13. We do not knowingly collect personal information from children.
            </p>
          </section>

          <section className="glass-card p-8 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-accent)' }}>9. Changes to This Policy</h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
              We may update this Privacy Policy from time to time. We will notify you of material changes by posting
              the new policy on this page with an updated date. Continued use of the service after changes constitutes
              acceptance of the updated policy.
            </p>
          </section>

          <section className="glass-card p-8 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-accent)' }}>10. Contact</h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
              For privacy questions, data requests, or to exercise your rights, contact us at{' '}
              <span style={{ color: 'var(--text-accent)' }}>support@edg3.ai</span>.
            </p>
          </section>
        </div>

        <div className="mt-16 pt-8 flex items-center justify-between" style={{ borderTop: '1px solid var(--edg-hairline)' }}>
          <Link href="/" className="text-sm" style={{ color: 'var(--text-faint)' }}>&#x2190; Back to Edg3</Link>
          <Link href="/terms" className="text-sm" style={{ color: 'var(--text-faint)' }}>Terms of Service &#x2192;</Link>
        </div>
      </div>
    </div>
  );
}
