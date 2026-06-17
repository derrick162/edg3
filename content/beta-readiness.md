# Edge — Beta Readiness (Trust-Gated)
_What must be true before we invite the first beta users. Organized by trust pillar._
_Last updated: June 17, 2026._

---

## How to read this

Each pillar has a **gate** — the minimum bar to invite users — and **nice-to-haves** for wave 2. A gate marked 🔴 blocks launch. 🟡 means in progress. ✅ means done.

---

## Pillar 1 — Show Your Work

**Gate (must have):**
- ✅ Activity tab live — every calendar mutation logged with action + before/after
- ✅ Undo per action — users can reverse any single change
- ✅ Undo plan as a unit — full hero loop reshape reversible in one tap (S3, June 17)
- ✅ Email receipt backend — encrypted subjects stored per inbox scan, API endpoint ready
- 🟡 **Expandable inbox receipts UI** — Activity tab "Read N threads" expands to subject list. Backend done (S4); Design/Core to wire the UI. **Blocks beta for privacy-sensitive users.**

**Nice-to-have (wave 2):**
- "Why did Edge propose this?" reasoning shown on each hero loop proposal
- "What Edge did today" end-of-day summary card

---

## Pillar 2 — Accuracy You Can Verify

**Gate (must have):**
- ✅ Focus Score recalibrated (ratio × coverage; routine events excluded)
- ✅ Energy Score shows "calibrating" on thin data — never fakes 100
- ✅ Score projection real (Ticket H, June 17) — `scoreBefore`/`scoreAfter` are genuine 4-component re-derivations
- 🟡 **Fact correction UI (T1 — spec written)** — users can edit/delete facts in "What Edge knows." Live trust bug (STT name mishear, no fix path). **Blocks beta** — discovered errors with no correction = churn.

**Nice-to-have (wave 2):**
- Score explanation modal (tap component → full calculation breakdown)
- Confidence tier on focus proposals ("early read" vs "high confidence")

---

## Pillar 3 — Reversibility + Control

**Gate (must have):**
- ✅ Undo per action + undo plan as unit (S3)
- ✅ Account deletion — immediate, all 19 tables, self-service (`DELETE /api/account`)
- ✅ Google + Whoop disconnect with token revocation (RFC 7009)
- 🟡 **Prominent undo toast post-Apply (T3)** — surface-level "Undo this reshape" immediately after Apply. Currently undo is buried in Activity tab. Nice-to-have for wave 1; **required for wave 2** when users are less forgiving.

**Deprioritized (not in beta scope):**
- Data export
- Pause mode

---

## Pillar 4 — Honest Limits

**Gate (must have):**
- ✅ "Calibrating" state on all 4 Edge Score components with thin data
- ✅ `GROUNDED & DECISIVE` prompt — Edge only states what data supports
- ✅ `HONEST FAILURE` block — never dismisses, always offers an alternative
- ✅ Recovery correlation requires ≥10 paired data days — degrades to null otherwise

**Nice-to-have (wave 2):**
- Explicit data-gap disclosures in briefing ("Whoop didn't sync — using last call's check-in")
- "What Edge doesn't know yet" dashboard section

---

## Pillar 5 — Predictability

**Gate (must have):**
- ✅ Score flicker fixed — scores don't jump randomly between sessions
- ✅ Focus Score formula deterministic and documented
- ✅ Hero loop uses same 4-component scoring as dashboard (Ticket H)
- 🟡 **Score changelog (T3)** — "score went 64→71 — here's why." Needed for trust on first Apply. **Wire after T3 spec ships.**

**Nice-to-have (wave 2):**
- 7-day Edge Score sparkline on dashboard (data computed; needs surface)

---

## Pillar 6 — Privacy You Can Feel

**Gate (must have):**
- ✅ AES-256-GCM encryption at rest — all tokens, transcripts, health data, email subjects
- ✅ Email bodies never fetched (`format:'metadata'` enforced at API level)
- ✅ Privacy policy accurate — reflects actual scopes + Gmail inbox reading
- ✅ FAQ privacy section — plain-language, reviewed by Security (S4 updated June 17)
- 🔴 **Google OAuth verification** — unrestricted production use blocked without it. Currently in review. **Hard dependency — cannot grow past test users.**
- 🔴 **Twilio A2P registration** — outbound calls from a recognized number. **Hard dependency — no calls without it.**

**Nice-to-have (wave 2):**
- Live "what Edge can see" panel in Settings
- Inbox scan notification in Activity feed (T2 UI covers this)

---

## Pillar 7 — Confirmation Before Consequence

**Gate (must have):**
- ✅ `confirmToken` gate on all batch delete operations
- ✅ Organizer check before moving other people's events
- ✅ Read-only calendar detection — honest message, no cryptic 403
- ✅ Hero loop shows full before/after preview before Apply button
- ✅ Idempotency on Apply — double-click safely rejected (S3)

**Nice-to-have (wave 2):**
- Email draft preview before creating ("here's what I'd say — does that sound right?")

---

## Onboarding funnel (must work end-to-end)

The waitlist → first call sequence must be seamless before inviting anyone:

1. **Waitlist capture** — ✅ `/api/waitlist` live, rate-limited, hardened (S1)
2. **Account creation** — 🟡 Cam's onboarding flow in progress. Must be testable before beta.
3. **Calendar connect** — ✅ Google OAuth works. Re-consent needed for Gmail scope.
4. **The "Clarity reveal" activation moment** — on completing setup, Edge shows what it already learned. Copy below.
5. **First call** — 🔴 Blocked on Twilio A2P. Can simulate with a manual call in the meantime.

### Activation moment copy — "Here's what I already know about you"

_Shown after onboarding completes, before the first call. Dynamic — generated from connected sources._

**If calendar + Gmail connected:**
> "Before we even talk, here's what I already know.
>
> From your calendar: you have [N] events this week. [Focus area] has no protected time — I'll fix that on our first call.
>
> From your inbox: I found [N] threads that may need your attention, including [1 urgent example if exists].
>
> Your Edge Score is [N] — [one-line honest diagnosis]. Tomorrow morning at [time], I'll call you and we'll raise it."

**If calendar only:**
> "From your calendar, I can already see [N] events this week. [Focus area] has no protected time yet.
>
> Your Edge Score is [N]. Tomorrow at [time], I'll call you and we'll fix that."

**Copy principle:** specific beats generic. "I found 3 urgent emails" is more powerful than "I scanned your inbox." Show the work immediately.

---

## External dependencies (Derrick must unblock)

| Dependency | Status | Impact if missing | Action needed |
|---|---|---|---|
| **Google OAuth verification** | 🔴 In review | Cannot grow past 100 test users; Gmail scope restricted | Follow up on review status; record demo video |
| **Twilio A2P registration** | 🔴 Pending | No outbound calls → no product | Follow up; escalate if no response in 48h |
| **Pricing decision** | 🟡 Pending | Can run beta free; needed before wave 2 (~10+ users) | Confirm $49–79/mo range or set alternative |
| **Design partner names** | 🔴 Pending | Can't send outreach | 5 names; templates ready in `content/design-partner-outreach.md` |
| **Demo video** | 🔴 Not recorded | Blocks Google CASA | Shot-list in `specs/google-verification.md §6`; < 5 min, narrated |
| **Privacy/FAQ review** | 🟡 Pending Derrick | Beta users read the privacy section carefully | Sign off on `content/faq.md` §"Your data and privacy" |

---

## Wave 1 beta go / no-go summary

**Go when:**
- T1 (fact correction) shipped
- T2 (inbox receipts UI) shipped
- Twilio live
- Onboarding flow testable end-to-end
- Pricing decision made (can be "free for beta")

**Can proceed without (wave 2 gates):**
- Google OAuth verification (growth-limited but functional)
- T3 (undo toast + changelog)
- Data export, pause mode

**Target: wave 1 = 5 design partners, July 2026.**
