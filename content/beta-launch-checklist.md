# Edge — Beta Launch Checklist
_Pull the trigger when all ✅ gates are clear. Last updated: June 18, 2026._

---

## How to use this

Work through the gates in order. Don't invite beta users until all HARD GATES are green. SOFT GATES should be green before wave 2 (first 10+ users). Flag Derrick on anything that needs a decision.

---

## 🔴 HARD GATES — must be true before inviting anyone

### Security & Privacy
- [ ] **Privacy policy is accurate** — reflects actual calendar write access, Gmail reading for focus prioritization, Whoop health data. (`app/privacy/page.tsx`) — flag Security to verify.
- [ ] **FAQ privacy section reviewed by Derrick** — `content/faq.md` §"Your data and privacy". Confirm language matches what Security actually does.
- [ ] **`DATA_ENCRYPTION_KEY` set on Railway** — activates at-rest encryption. Verify in Railway env vars.
- [ ] **Self-service account deletion works** — test `DELETE /api/account` with `{"confirm": "delete my account"}`. Verify all tables cleared.
- [ ] **Google disconnect revokes token** — test dashboard → Disconnect Google → verify token revoked at Google + deleted from DB.

### Core product
- [ ] **Morning call works end-to-end** — Twilio live, call initiates, Edge reads calendar, proposes changes, executes on approval.
- [ ] **Twilio A2P registration approved** — follow-up email ready in `content/twilio-followup-email.md`; send today if not done.
- [ ] **Onboarding flow works** — new user can complete setup (calendar connect → focus areas → call time) without errors. Test on a fresh account.
- [ ] **Edge Score displays for new users** — all 4 components show or show "calibrating" correctly. No broken states.
- [ ] **Calendar changes are undoable** — Activity tab shows Edge's actions; undo works.
- [ ] **Fact correction UI works** — "What Edge knows" tab allows inline edit and delete of facts. T1 API live ✅; Cam's UI in progress.
- [ ] **Inbox receipts expandable** — Activity tab "Read N threads" rows expand to show subject list. T2 backend live ✅; Cam's UI in progress.
- [ ] **Whoop connect works for new users** — test full OAuth flow: connect → callback → status shows connected.

### Content & comms
- [ ] **FAQ live in-app** — `content/faq.md` rendered and accessible to users (Cam to confirm).
- [ ] **Support channel working** — `/api/support` endpoint routes feedback to admin dashboard. Test it.
- [ ] **Derrick's email set up** — `derrick@deltaedg3.com` sending and receiving reliably.

---

## 🟡 SOFT GATES — should be true before wave 2 (10+ users)

### Product
- [ ] **Google OAuth verification submitted** — or actively in CASA review. Don't block beta on this, but don't grow past ~10 users without it.
- [ ] **Gmail signal working for new users** — `gmail.readonly` scope active; email signal flows into focus recommendations. Requires re-consent from users who connected before this scope was added.
- [ ] **Notification center working** — users get notified of important Edge actions (Cam's build).
- [ ] **Education cards live in-app** — `content/education-cards.md` rendered as content cards on dashboard.

### GTM
- [ ] **Waitlist landing page live** — `content/landing-page-copy.md` built and deployed.
- [ ] **Founding story post drafted** — `content/founding-story-post.md` — Derrick picks a draft, rewrites in his voice. Post timed with beta launch.
- [ ] **Pricing confirmed** — decision needed: $49/month, $79/month, or other. Needed before wave 2 (can be free for wave 1 design partners).

---

## 🟢 OPEN INPUTS — decisions only Derrick can make

| Decision | Status | Why it matters |
|---|---|---|
| **5 design partner names** | ⏳ Pending Derrick | Can't send outreach without names. Templates ready in `content/design-partner-outreach.md`. |
| **Pricing tier** | ⏳ Pending Derrick | $49–79/month proposed in GTM strategy. Confirm before wave 2. |
| **Founding story post** | ⏳ Pending Derrick voice-check | GTM seed. Drafts in `content/founding-story-post.md`. |
| **Demo video recording** | ⏳ Pending Derrick | Required for Google CASA. Shot-list in `specs/google-verification.md §6`. Needs live app + narration. |
| **FAQ privacy section sign-off** | ⏳ Pending Derrick | Beta users will read this carefully. Confirm it's accurate before anyone sees it. |

---

## Launch sequence (once all hard gates clear)

1. **Send design partner outreach** (Derrick, using `content/design-partner-outreach.md`)
2. **Onboard each partner personally** — Derrick walks them through setup on a quick call or Loom
3. **Monitor day 1–3 closely** — watch for broken onboarding, call failures, Edge Score weirdness
4. **Send Email 1 from onboarding sequence** immediately on account creation (`content/beta-onboarding-sequence.md`)
5. **Post founding story** on LinkedIn/Twitter — timed to beta momentum, not before
6. **Week 1 review** — Derrick + Kevin, Monday cadence from `content/beta-feedback-loop.md`
7. **Week 2 design partner calls** — 30 min each, structured by feedback guide
8. **Wave 2 decision** — at day 30, if ≥4/5 partners retained and hero loop landing: open to waitlist wave 1 (50–100 users)

---

## Current status

| Gate | Status | Owner | Notes |
|---|---|---|---|
| Privacy policy accurate | 🟡 Review needed | Security + Derrick | Vijay to verify §1–4 of `how-edge-protects-you.md` |
| FAQ privacy reviewed | 🟡 Review needed | Derrick | `content/faq.md` §privacy |
| DATA_ENCRYPTION_KEY on Railway | ✅ Set | PM | Done 2026-06-09 |
| Account deletion works | ✅ Shipped | Security | `DELETE /api/account` — 19 tables |
| Google disconnect revokes token | ✅ Shipped | Security | `lib/calendar.ts:disconnectCalendar()` |
| AES-256-GCM encryption at rest | ✅ Shipped | Security | All tokens, transcripts, email subjects, health data |
| STT grounding (no more Jim/Gym) | ✅ Shipped | Core | `lib/grounding.ts` — proper nouns corrected against calendar |
| Fact correction API (PATCH/DELETE) | ✅ Shipped | Security+Core | `app/api/memory/facts/[id]/route.ts` |
| Fact correction UI | 🟡 In progress | Design | Cam wiring inline-edit; T1 API live |
| Inbox receipts expandable UI | 🟡 In progress | Design | T2 backend live; Cam building UI |
| Hero loop deep (real score, always-on) | ✅ Shipped | Core | Ticket H — 4-component projection, no fake +12 |
| Morning call end-to-end | 🔴 Twilio pending | Derrick | Follow-up email ready: `content/twilio-followup-email.md` |
| Onboarding flow | 🟡 In progress | Design | Cam's flow; needs end-to-end test |
| Edge Score new users | 🟡 Needs test | Core | All 4 components need verify on fresh account |
| Whoop connect new users | 🟡 Needs test | Security | |
| FAQ live in-app | 🔴 Not yet | Design/Core | Content ready; needs rendering |
| Design partner names | 🔴 Pending | Derrick | Outreach kit ready: `content/design-partner-outreach-kit.md` |
| Pricing confirmed | 🔴 Pending | Derrick | Analysis in `content/pricing-analysis.md` |
| Founding story post | 🔴 Pending | Derrick | Drafts in `content/founding-story-post.md` |
| Demo video | 🔴 Not recorded | Derrick | Script ready: `content/google-casa-video-script.md` |
