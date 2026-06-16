# 🌙 Overnight build queue — Night 3 (2026-06-16)

Night-2 fully shipped (Open Loops + understanding upgrades, 827 green, master abf8c10). This is the next wave.
THEME continues: **deepen Edge's understanding of email + calendar; polish the first-run experience.**

Rules: `git merge master` before EVERY push. Run full `npm run preflight` (build + tests, real exit code)
BEFORE pushing. Commit small. PM (Kevin) auto-integrates green. Cam owns dashboard LAYOUT, Darren owns
data/logic — overlap → merge master + keep both. Decisions for Derrick → lane roadmap + Status Board.

## 🛠️ Darren (Core)
1. **★ Email ↔ calendar ↔ memory cross-link (meeting prep)** — for an upcoming event, surface related
   email thread(s) + known facts/open-loops about the attendees/topic ("your 2pm with Faiza — here's the
   CIBC thread + what I know"). `lib/meetingContext.ts` + endpoint; Edge mentions on calls.
2. **Deeper email understanding** — extract deadlines, dollar amounts, sender importance (VIP vs noise) →
   sharper open-loops + recs.
3. **Calendar pattern/routine detection** (~6mo) — real anchors, peak/trough, meeting-load trends → Energy + recs + energy-profile.
4. **Time-allocation trends** — time split across focus areas over weeks ("60% meetings, 8% on #1").
5. **Open Loops refinement** — call-surfacing, snooze, recurring detection.

## 🎨 Cam (Design)
1. **First-run / onboarding flow polish** — connect sources → "here's what I learned" activation → first
   Edge Score. Make the first experience magical + clear (it converts).
2. **Open Loops polish** — interactions, empty states ("all caught up ✓"), calm/reassuring feel.
3. **Meeting-prep UI** — clean "context for your next meeting" card (wire when Darren's endpoint lands).
4. **Mobile responsiveness** pass on the new home cockpit.
5. **Design-system consistency** sweep across new components + globals.css.

## 🔒 Vijay (Security)
1. **Encrypt `facts.statement`** at rest (PM decision: GO — sensitive email-derived PII). Scan other new
   tables (daily_focus, calendar_scores, meeting-context) for plaintext sensitive PII; encrypt as needed.
2. **9am call reliability hardening** — scheduler + call path end-to-end (today's call is the proof point):
   reliable fire, no double-dial/stuck-calling, graceful Vapi errors, new tools work.
3. **Backups/durability** for new write paths (open_loops, daily_focus, calendar_scores, facts, email data).
4. **CASA prep** — advance remaining; doc code-done vs needs-Derrick.

## 🔧 Esther (CoS)
1. **Grow content library** (+4–6 pieces in `content/education-cards.md`): Open Loops, how Edge reads email,
   Edge Score breakdown, red-day recovery, context-switching cost, designing your ideal week.
2. **GTM + 30-60-90** (the strategic deliverable for Derrick).
3. **Onboarding narrative/copy** (pairs with Cam's first-run flow).

## Late additions (dispatched via messages; this doc is the durable backup)
- **Darren:** Whoop Intelligence (baselines+deviation, strain/sleep-debt, ★ Whoop→calendar recommendations, correlations+recovery-hint, call coaching) ; actionable Today's Focus (complete/dismiss→ranked-pool replacement + learning signal) ; ★ memory salience/weighting (reinforcement·recency·anchor-relevance·type/consequence·confidence·decay → rank context for recs/briefing) ; `/api/support` + `support_messages` table (feedback backend).
- **Cam:** Help & Support hub (FAQ accordion + feedback/contact form) ; actionable Today's Focus UI (✓ complete + ✕ dismiss→replace).
- **Vijay:** ★ Security PAGE (`content/security.md`, honest, grounded in what's built) + ★ Security GAP ASSESSMENT (secrets/session/rate-limit/headers/deps/admin-routes — fix quick wins, flag big ones) ; **FAQ privacy verification** — cross-check `content/faq.md` §3 (Data & Privacy) claims against the actual code + privacy policy (encryption, no-sell, email-signal-vs-full-read, deletion-immediate-purges-all-new-tables); confirm true or fix mismatch. CRITICAL pre-beta.
- **Esther:** ✅ delivered GTM, 30-60-90, onboarding copy, 12 content cards, FAQ. Derrick input needed: pricing ($49–79/mo), 5 design-partner names, voice-check #2/#3.

---
_Highest value: the meeting-prep cross-link (Darren) + the first-run experience (Cam) + the security gap assessment (Vijay). Leave the tree green._
