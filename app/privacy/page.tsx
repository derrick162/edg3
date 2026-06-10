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
            <p className="text-sm" style={{ color: '#4a4a5a' }}>Last updated: June 10, 2026</p>
            <p className="text-sm mt-4 leading-relaxed" style={{ color: '#888899' }}>
              Edg3 ("we", "our", or "us") operates the Edg3 AI Chief of Staff service accessible at edg3.ai.
              This Privacy Policy explains how we collect, use, and protect your information.
            </p>
          </div>

          <section className="glass-card p-8 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: '#818cf8' }}>1. Information We Collect</h2>
            <div className="space-y-4 text-sm leading-relaxed" style={{ color: '#c8c8d8' }}>
              <div>
                <p className="font-semibold mb-2" style={{ color: '#e8e8f0' }}>Account Information</p>
                <p>When you sign up, we collect your name, email address, and password (stored as a secure hash).</p>
              </div>
              <div>
                <p className="font-semibold mb-2" style={{ color: '#e8e8f0' }}>Phone Number</p>
                <p>We collect your phone number to deliver your daily AI briefing call and reminder text messages. By providing your number you consent to receive these communications.</p>
              </div>
              <div>
                <p className="font-semibold mb-2" style={{ color: '#e8e8f0' }}>Profile Summary</p>
                <p>You may provide a personal profile summary (goals, priorities, challenges) to personalize your briefings. This is entirely voluntary and can be updated or deleted at any time.</p>
              </div>
              <div>
                <p className="font-semibold mb-2" style={{ color: '#e8e8f0' }}>Google Calendar Data</p>
                <p>If you connect Google Calendar, we request access to <strong style={{ color: '#e8e8f0' }}>read your calendar and to create, edit, move, and delete events</strong> on your behalf. We use this to surface your schedule in your briefings and to make the calendar changes you ask Edge to make (for example, booking, rescheduling, or cancelling events). Events Edge creates are marked, and Edge can undo its own changes. We do not share your calendar data. You can disconnect Google Calendar at any time from your dashboard.</p>
              </div>
              <div>
                <p className="font-semibold mb-2" style={{ color: '#e8e8f0' }}>Google Gmail Data</p>
                <p>If you grant Gmail access, we request permission to (a) <strong style={{ color: '#e8e8f0' }}>create email drafts</strong> on your behalf and (b) <strong style={{ color: '#e8e8f0' }}>read messages only within the specific email threads Edge started for you</strong>. Edge uses draft access to write outreach emails you asked for (e.g. contacting a service provider), and read access to recognize replies to those emails and surface them in your briefing. <strong style={{ color: '#e8e8f0' }}>Edge never sends email</strong> — it only creates drafts for you to review and send yourself. Edge only reads the threads it created for you; it does not read the rest of your mailbox. You can disconnect at any time from your dashboard.</p>
              </div>
              <div>
                <p className="font-semibold mb-2" style={{ color: '#e8e8f0' }}>Call Transcripts &amp; Responses</p>
                <p>We store transcripts of your daily briefing calls and your spoken responses. This data is used exclusively to improve the quality and continuity of your personal briefings.</p>
              </div>
              <div>
                <p className="font-semibold mb-2" style={{ color: '#e8e8f0' }}>Usage Data</p>
                <p>We collect basic usage data (e.g. login times, feature usage) to operate and improve the service.</p>
              </div>
            </div>
          </section>

          <section className="glass-card p-8 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: '#818cf8' }}>2. How We Use Your Information</h2>
            <ul className="space-y-2 text-sm" style={{ color: '#c8c8d8' }}>
              {[
                'To deliver your daily AI briefing call and reminder texts',
                'To personalize briefings based on your profile, priorities, and calendar',
                'To remember context from previous calls and improve over time',
                'To authenticate your account and keep it secure',
                'To communicate service updates or account-related notices',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span style={{ color: '#6366f1' }}>→</span>
                  {item}
                </li>
              ))}
            </ul>
            <p className="text-sm leading-relaxed" style={{ color: '#c8c8d8' }}>
              We do <strong style={{ color: '#e8e8f0' }}>not</strong> sell, rent, or share your personal information with third parties for advertising or marketing purposes.
            </p>
          </section>

          <section className="glass-card p-8 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: '#818cf8' }}>3. Google User Data — Limited Use Disclosure</h2>
            <p className="text-sm leading-relaxed" style={{ color: '#c8c8d8' }}>
              Edg3's use of information received from Google APIs (Google Calendar and Gmail) adheres to the{' '}
              <a href="https://developers.google.com/terms/api-services-user-data-policy"
                 target="_blank" rel="noopener noreferrer" style={{ color: '#818cf8', textDecoration: 'underline' }}>
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements. Specifically:
            </p>
            <ul className="space-y-2 text-sm" style={{ color: '#c8c8d8' }}>
              {[
                'We only access your Google Calendar and Gmail data to provide the features you requested (your briefings, calendar changes you ask for, drafting outreach emails, and recognizing replies to those emails)',
                'We do not use Google user data for advertising',
                'We do not allow humans to read your Google Calendar or Gmail data except for security, to comply with the law, or with your explicit consent',
                'We do not transfer Google user data to third parties except as necessary to provide the service or as required by law',
                'We do not use Google user data for any purpose unrelated to the features you requested',
                'For Gmail specifically: Edge creates drafts only (it never sends email) and reads only the email threads it created for you — never the rest of your mailbox',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span style={{ color: '#6366f1' }}>→</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section className="glass-card p-8 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: '#818cf8' }}>4. Third-Party Services</h2>
            <p className="text-sm leading-relaxed mb-3" style={{ color: '#c8c8d8' }}>
              We use the following third-party providers to operate the service. Each has their own privacy policy:
            </p>
            <ul className="space-y-2 text-sm" style={{ color: '#c8c8d8' }}>
              {[
                'Anthropic — AI generation of briefing content',
                'Vapi / Twilio — Voice call and SMS delivery',
                'ElevenLabs — AI voice synthesis',
                'Google — Calendar integration',
                'Railway — Cloud hosting and infrastructure',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span style={{ color: '#6366f1' }}>→</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section className="glass-card p-8 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: '#818cf8' }}>5. Data Retention</h2>
            <p className="text-sm leading-relaxed" style={{ color: '#c8c8d8' }}>
              We retain your data for as long as your account is active. Call transcripts and briefing history are retained
              to provide continuity across sessions. You may request deletion of your account and all associated data at
              any time by emailing <span style={{ color: '#818cf8' }}>support@edg3.ai</span>. All data will be permanently
              deleted within 30 days of your request.
            </p>
          </section>

          <section className="glass-card p-8 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: '#818cf8' }}>6. Your Rights</h2>
            <ul className="space-y-2 text-sm" style={{ color: '#c8c8d8' }}>
              {[
                'Access — request a copy of the data we hold about you',
                'Correction — update or correct your personal information at any time from your dashboard',
                'Deletion — request permanent deletion of your account and all associated data',
                'Opt-out — stop receiving calls or texts at any time via your dashboard or by saying "stop" during a call',
                'Disconnect — remove Google Calendar access at any time from your dashboard',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span style={{ color: '#6366f1' }}>→</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section className="glass-card p-8 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: '#818cf8' }}>7. Security</h2>
            <p className="text-sm leading-relaxed" style={{ color: '#c8c8d8' }}>
              We use industry-standard security practices including encrypted connections (HTTPS), hashed passwords,
              encryption of sensitive data at rest (such as your connected-account access tokens and call transcripts,
              using AES-256), and access controls to protect your data. No method of transmission over the internet is
              100% secure, and we cannot guarantee absolute security.
            </p>
          </section>

          <section className="glass-card p-8 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: '#818cf8' }}>8. Children's Privacy</h2>
            <p className="text-sm leading-relaxed" style={{ color: '#c8c8d8' }}>
              Edg3 is not directed at children under 13. We do not knowingly collect personal information from children.
            </p>
          </section>

          <section className="glass-card p-8 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: '#818cf8' }}>9. Changes to This Policy</h2>
            <p className="text-sm leading-relaxed" style={{ color: '#c8c8d8' }}>
              We may update this Privacy Policy from time to time. We will notify you of material changes by posting
              the new policy on this page with an updated date. Continued use of the service after changes constitutes
              acceptance of the updated policy.
            </p>
          </section>

          <section className="glass-card p-8 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: '#818cf8' }}>10. Contact</h2>
            <p className="text-sm leading-relaxed" style={{ color: '#c8c8d8' }}>
              For privacy questions, data requests, or to exercise your rights, contact us at{' '}
              <span style={{ color: '#818cf8' }}>support@edg3.ai</span>.
            </p>
          </section>
        </div>

        <div className="mt-16 pt-8 flex items-center justify-between" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <Link href="/" className="text-sm" style={{ color: '#4a4a5a' }}>← Back to Edg3</Link>
          <Link href="/terms" className="text-sm" style={{ color: '#4a4a5a' }}>Terms of Service →</Link>
        </div>
      </div>
    </div>
  );
}
