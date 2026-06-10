# 🛠️ EDG3 — Core Lane (features / product)

> Backlog for the **Edg3 Engineer (Core)** session. Governed by the shared
> [`ROADMAP.md`](ROADMAP.md) constitution — read that first (ownership map,
> worktree isolation, merge protocol). Work on branch `core` in
> `C:\Users\Derrick\edg3-core`. Update this changelog in the same commit that
> ships work, and claim files in the constitution's Status Board before touching
> anything in the ⚠️ Shared list. The PM routes new product feedback into the
> backlog below.

## Changelog
- **2026-06-10** — ★ **Recent Activity tab SHIPPED** — per-row undo feed in the dashboard.
  - New **Activity** tab (⏪) in the sidebar nav; shows the last 20 actions Edge took on the user's calendar, newest first.
  - Each row: action label (e.g. "created 'Team Meeting' on June 25"), relative timestamp, and an **↩ Undo** button that reverses that specific action in place.
  - Already-undone rows are shown greyed out (full audit trail — nothing hidden). Only one undo runs at a time to prevent race conditions.
  - API changes (all additive, backward-compatible):
    - `GET /api/undo?list=1` → returns `{ actions: [{id, label, undone, created_at}] }` for the feed.
    - `POST /api/undo` with `{ id: N }` → undoes that specific log entry (cross-user guarded); without `id` still undoes the latest (existing sidebar button unaffected).
    - `undoQueries.listRecent(userId, limit)` + `undoQueries.getById(userId, id)` added to `lib/db.ts` (Shared — claimed before editing; additive only).
  - The quick-undo button in the sidebar remains for the most recent action; the Activity tab is for browsing and selective undo of any past action.
  - Acceptance: user can open Activity tab and undo any individual Edge action without a voice call. ✅ tsc clean, 61/61 tests.
- **2026-06-09** — ★ **Email drafting SHIPPED (draft-only)** — `draftEmail` handler wired in
  `app/api/vapi/tool-call/route.ts` (Shared, claimed first; additive) + tool/system-prompt guidance in
  `lib/vapi.ts`. Flow: `emailableRecipients` (skip no-email contacts, report them) → `findFreeSlots` over a
  one-week window (default today→+6, or `startDate`/`endDate`) → `formatSlotsForEmail` → per recipient
  `composeOutreachEmail` (lib/outreach.ts) → Security's `createDraft(userId, {to, subject, body})`
  (lib/gmail.ts, guarded/draft-only) → `recordUndo` with one `deleteDraft` op per draft. Never sends.
  `GmailScopeError` → tells the user to reconnect Google (re-consent); `GmailRateLimitError` → reports the
  cap and keeps/undoes drafts already made. Returns "Drafted N emails in your Gmail — review and send."
  Verified green: tsc clean, 61/61 tests, eslint clean (only pre-existing `_e` warnings).
  - ⚠️ **External step (Vapi dashboard) — the model can't call `draftEmail` until its tool is created there.**
    Add a new tool named **`draftEmail`** with these params:
    - `recipients` — **array** of objects `{ name (string), email (string) }`. The people to email (from research results). Required.
    - `ask` — **string**. What to ask them, e.g. "when they can come by this week". Required.
    - `proposeAvailability` — **boolean**. Include the user's real open calendar slots in the email. Default true.
    - `startDate` — **string** (YYYY-MM-DD), optional. Start of the availability window. Defaults to today.
    - `endDate` — **string** (YYYY-MM-DD), optional. End of the availability window. Defaults to 6 days after start (this week).
    - `subject` — **string**, optional. Overrides the auto-generated subject.
    Then paste the tool's Vapi ID into the `toolIds` array in `lib/vapi.ts` (placeholder comment marks the spot).
- **2026-06-09** — Ownership-split fix (PM ruling, ROADMAP §3): both lanes had created `lib/gmail.ts`.
  Resolved — `lib/gmail.ts`/`lib/google-auth.ts` are 🔒 Security's (the Gmail access primitive +
  guarded `createDraft`); Core's **composition** lives in new `lib/outreach.ts`. Deleted my
  `lib/gmail.ts`/`lib/gmail.test.ts`; ported the composition helpers to `lib/outreach.ts`
  (`emailableRecipients`, `formatSlotsForEmail`, `buildOutreachBody`, `composeOutreachEmail` →
  `{recipient, subject, body}`) with unit tests in `lib/outreach.test.ts` (6 pure-helper tests). Dropped
  the Gmail primitives (`buildRawMessage`/`createGmailDraft`/`deleteGmailDraft`) — those are Security's;
  the future `draftEmail` handler will call Security's `createDraft` + `deleteDraft` undo op. Full suite
  39/39 green, tsc + eslint clean. Frees the `gmail.ts` filename so Security's foundation merges cleanly.
  - ⏳ **Still gated on 🔒 Security** (Gmail scope + `createDraft` + `deleteDraft` UndoOp on master).
    On the PM's "scope landed" signal: `git merge master`, claim `tool-call/route.ts` (Shared), wire
    `draftEmail`, merge. Then user adds `draftEmail` params to the Vapi dashboard. Remaining wiring steps
    documented in `lib/outreach.ts` header.
- **2026-06-09** — Shipped both **Now** tickets in one pass (`app/api/vapi/tool-call/route.ts` + `lib/vapi.ts`):
  - **Multi-day all-day + editable all-day.** `createEvent` all-day branch now takes an inclusive
    `endDate` and writes one spanning event (Google `end.date = nextDay(endDate)`) instead of forcing
    a per-day loop. `moveEvent` now re-dates all-day events via date-only `newStartDate`/`newEndDate`
    (auto-detected for any all-day target), so "make it just the 26th" / "extend it to the 30th" works;
    delete already worked. System prompt in `lib/vapi.ts` instructs the model to make ONE spanning
    event for a range and to use `moveEvent` date params to fix it.
  - **Research replaces, not piles up.** `researchToEvent` wraps findings in `--- Edge research ---`
    delimiters; each call strips the prior research block and writes only the latest, while preserving
    the user's own typed notes (`stripResearchBlock`).
  - ⚠️ **External step (Vapi dashboard, cannot be done from code):** the tool param schemas live in
    Vapi (referenced by `toolIds` in `lib/vapi.ts`), not the repo. Add `endDate` (string, date) to the
    **createEvent** tool and `newStartDate`/`newEndDate` (string, date) to the **moveEvent** tool so the
    model can pass them. Until then route.ts degrades safely (single-day all-day; re-date still works for
    detected all-day events via the existing datetime params sliced to a date).
  - 🤝 **Security coupling (#3 idempotency):** this rewrite makes the all-day path a *single* insert
    (was a model-driven multi-call loop), so it reduces — not increases — duplicate-on-retry surface.
    No dedupe added here (Security's lane). Sync before the `tool-call/route.ts` master merge.
- **2026-06-09** — Lane created (renamed from "Builder" → "Core"). Mandate set:
  ship new user-facing features for the Edg3 voice/calendar assistant. Backlog
  below is a **seed** — the PM refines it from user feedback.

---

## Mandate
Ship new **user-facing features** for the Edg3 voice + calendar assistant —
improving the dashboard, briefing, calendar, and onboarding experiences. Move
product value fast while staying inside the Core ownership lane (constitution
§3); hand anything touching auth/secrets/infra to the Security lane.

## How priorities are ranked
By user-visible value shipped per day, inside the Core-owned surface. The PM sets
priority from user feedback.

## Backlog (seed — PM refines from user feedback)
### Now
- [x] **Multi-day all-day events + ability to edit/fix them** — _from a real user call, 2026-06-09._ **✅ Shipped 2026-06-09 (see changelog).**
  - **Symptom:** User asked Edge to "create all-day events from June 25–28." Edge made four separate one-day all-day events instead of one spanning event, then could not fix it when asked.
  - **Root cause:**
    - `createEvent` all-day branch (`app/api/vapi/tool-call/route.ts:279`) hardcodes `end: { date: nextDay(dateOnly) }` → it can only make a *single-day* all-day event. No range param, so the model is forced to loop one-per-day.
    - No tool can re-date an all-day event afterward: `editEvent` only changes description/location; `moveEvent` takes datetimes, not date-only. So "fix it" is structurally impossible.
  - **Fix:**
    1. Add an inclusive `endDate` param to the all-day path; set Google `end.date = nextDay(endDateInclusive)` so one event spans the range (25→28 inclusive ⇒ start `2026-06-25`, end `2026-06-29`).
    2. Make all-day events editable — let `moveEvent`/`editEvent` (or a new path) change an all-day event's start/end *dates*, so "make it just the 26th" / "extend it to the 30th" works.
    3. Update the `createEvent` tool schema + system-prompt guidance in `lib/vapi.ts` so the model passes one spanning all-day event for a date range instead of looping.
  - **Acceptance:** "Create an all-day event from June 25 to 28" → one event spanning 25–28. "Actually just the 26th" → adjusts in place. "Remove it" → gone in one action.
  - **Coordination:** touches `app/api/vapi/tool-call/route.ts` + `lib/vapi.ts` (Shared — constitution §5). Core owns the calendar behavior; ping Security since these are vapi-path files.
- [x] **Research notes should replace, not pile up** — _from a real user call, 2026-06-09 (Hong Kong gyms w/ sauna)._ **✅ Shipped 2026-06-09 (see changelog).**
  - **Symptom:** Re-running research on an event stacks the new findings on top of the old research. Notes should show only the newest / most relevant, not an accumulating pile.
  - **Root cause:** `researchToEvent` (`app/api/vapi/tool-call/route.ts:268`) always appends — `description: e.description ? \`${e.description}\n\n${block}\` : block`. No replace/dedupe of prior research.
  - **Fix:** Wrap each research block in a recognizable delimiter (e.g. a marker header). On every research call, strip any prior research block(s) and write only the fresh findings, while **preserving the user's own (non-research) notes** in the description. Keep the existing "most relevant first, up to 6" prompt.
  - **Acceptance:** Researching the same event twice → description shows only the latest research plus any user-typed notes; no duplicated/stacked piles.
  - **Coordination:** same Shared file as the all-day ticket (`tool-call/route.ts`) — batch them; both touch event description/creation logic.

### Next (decided)
- [x] **Email-reply tracking → proactive surfacing in the briefing** — **✅ SHIPPED 2026-06-10 (by PM session directly to master)**. `lib/replies.ts` (`checkOutreachReplies` + `understandReply`); `lib/briefing.ts` calls it; `draftEmail` registers `threadId` → `watched_threads`; `lib/gmail.ts` `readThread` (Security); `notifications` table + `notificationQueries`. Degrades safely if `gmail.readonly` not yet granted.
- [x] **Notifications v1: in-app notification center** — **✅ SHIPPED 2026-06-10 (by PM session directly to master)**. Bell icon + unread badge + panel in dashboard; `/api/notifications` GET/POST; `notificationQueries` CRUD. Replies trigger notifications at briefing time + on-demand via "↻ Check for replies" button.
- [x] **★ TOP PRIORITY: Email drafting — outreach with calendar availability (draft-only Gmail)** — _PM decision 2026-06-09, user request._ **✅ SHIPPED & working end-to-end 2026-06-09 (after fixing moveEvent trailing-space key + setting the draftEmail tool server URL). Left here for reference; superseded by the reply-tracking ticket above.**
  - **Goal:** After research (e.g. plumbers), Edge drafts a personalized outreach email per contact asking their availability this week and **proposing the user's real open calendar slots**, saved as a **Gmail draft** for the user to review + send. Draft-only — Edge NEVER sends.
  - **Depends on 🔒 Security:** the Gmail OAuth scope + a safe draft-create helper (see `ROADMAP-SECURITY.md` "Gmail access"). Gate on that landing first.
  - **New tool:** `draftEmail` in `tool-call/route.ts` — params: `recipients` (name + email, from research results), `ask` (e.g. "when can you come this week"), `proposeAvailability` (bool), `dateRange` (defaults to this week).
  - **Implementation:** (a) pull availability by reusing `findFreeSlots` → format proposed times in the user's tz; (b) compose a short, polite plain-text email per recipient (Claude) including the ask + proposed slots; (c) create the draft via `gmail.users.drafts.create` (new `lib/gmail.ts` wrapper using the OAuth client Security extends); (d) gracefully skip recipients with no email ("Email: not found") and tell the user which lacked one; (e) `recordUndo` = delete the draft.
  - **Trust:** never call `messages.send`. Confirm back: "Drafted N emails in your Gmail — review and send."
  - **Acceptance:** After researching plumbers, "draft emails asking when they can come this week and suggest my availability" → N Gmail drafts, each with the ask + the user's real open slots; nothing sent.
  - **Coordination:** touches Shared `tool-call/route.ts`; `lib/gmail.ts` is Core-owned but rides on the OAuth scope/token Security manages. Effort ~2–3d after scope lands.
- [x] **"Recent activity" review surface** — _PM decision 2026-06-09._ **✅ Shipped 2026-06-10 (see changelog).**
  - **Why:** The user keeps discovering messy calendar edits mid-call (duplicate all-day events, piled-up research). A dashboard feed of what Edge did — with one-tap undo/correct — turns silent frustration into something visible and fixable.
  - **Scope:** Dashboard view listing recent actions Edge took (newest first): what changed, when, on which event, with an **Undo** affordance per row (reuse the existing `undo_log` inverse ops shipped in `28f364d`).
  - **Dependency (cross-lane):** wants a clean, append-only activity feed as its data source → **Security item #7 (harden audit log: before/after snapshots, append-only table)**. Two-phase: Security #7 builds the backbone, Core builds the view on top. A quick v0 can read the current `undo_log` if we want something shippable before #7 lands.
  - **Acceptance:** From the dashboard the user can see the last N actions Edge took and undo any one of them without a voice call.

- [x] ~~**Travel price lookup (flights + hotels) → trip event**~~ — ❌ **DROPPED 2026-06-09.** Rationale: low-frequency (people book travel a few times/year) and a commoditized space with strong incumbents (Google Flights, Kayak) — hard to beat the user's existing workflow. Refocusing on **research** instead (high-frequency, unique to Edge's research→save→act chain). _PM + user decision._
  - **Goal:** On a call, Edge looks up **real** flight/hotel prices and saves the options to a calendar trip event. Voice flow: "What are flights to Hong Kong on June 25?" → Edge fetches options → reads them back → attaches them to a trip event.
  - **Data source (decided):** a real travel-pricing API, **not** web search — fares must be quotable with confidence. Candidate: **Amadeus Self-Service** (flight offers search + hotel search, free test tier). Wrap in a new `lib/travel.ts`.
  - **New tool:** `researchTravel` in `tool-call/route.ts` — params: `type` (flight|hotel), `origin`, `destination`, `departDate` (YYYY-MM-DD), `returnDate?`, `passengers?`, `nights?`. Format results as clean plain-text (reuse the `researchToEvent` note-cleaning), then patch onto a trip event (create one if none exists) via the same `recordUndo` path.
  - **Trust:** only quote prices the API returned — keep the "NEVER INVENT TRAVEL FACTS" guardrail (now Edge can cite the API). Include currency and a "fetched <date>" stamp since fares change. Follows the research-replace rule (don't pile up stale quotes).
  - **Coordination (Security):** introduces a new external API credential (`AMADEUS_*`) → **Security owns provisioning + securing the secret, env config, and a rate-limit/cost guardrail** (these calls cost money / are rate-limited). Coordinate before merging. Also touches the Shared `tool-call/route.ts`.
  - **Acceptance:** "Find flights to Hong Kong June 25 returning July 2" → Edge returns real fare options sourced from the API, timestamped, saved to a HK trip event. Re-running replaces stale quotes rather than stacking them.
  - **Effort:** ~2–4d.

### Dashboard polish (from dogfooding 2026-06-10) — small, quick
- [x] **Re-link flow shouldn't route through onboarding.** **✅ Fixed 2026-06-10 (PM session).** Callback now redirects already-onboarded users to `/dashboard?linked=1` with a "Google account linked ✓" toast; first-time users still continue to onboarding.
- [x] **Profile page: "Your Profile" section is too long.** **✅ Fixed 2026-06-10 (PM session).** Section is now collapsible — collapsed to ~3 lines by default with a "▼ Show more" toggle.
- [x] **"Next call" section: the Undo button is unclear.** **✅ Addressed 2026-06-10.** Sidebar button now shows only when an undoable action exists, labeled "Edge's last calendar change — {what}". Full per-action undo lives in the new Activity tab (⏪).

### UX/UI — Onboarding v2 (2026-06-10, from designer audit · PM sign-off pending)
> Goal: get a new user to their first moment of value in under 90 seconds. Current profile step is the #1 drop-off risk. Batch these together — they ship as one onboarding rewrite.

- [ ] **Flip onboarding step order + defer profile** — _UX audit 2026-06-10. ~0.5d_
  - **Problem:** Step 1 sends users out of the app to ChatGPT before they've seen any value. Highest drop-off risk in the entire funnel.
  - **Fix:** New order: **Calendar → Priorities → Call Time → Profile (optional, post-signup)**. Profile step becomes a dashboard prompt ("Help Edg3 know you better") shown after the first briefing, when the user is already bought in. Profile is still supported — just not gating.
  - **Acceptance:** A new user can complete onboarding and reach the dashboard without ever touching the profile step.

- [ ] **Rewrite calendar step value prop** — _UX audit 2026-06-10. ~1h_
  - **Problem:** "Read-only access. EDG3 sees your events to build smarter briefings. Nothing is modified." doesn't motivate action.
  - **Fix:** Replace with: *"Edg3 tells you when your week doesn't match your priorities. That only works if it can see your week."* Also: note is currently inaccurate (calendar access is read-write, not read-only — needed for creating/moving events). Fix copy to reflect reality while staying reassuring.
  - **Acceptance:** Copy is accurate and motivating. No mention of "read-only."

- [ ] **Day 1 preview briefing post-onboarding** — _UX audit 2026-06-10. ~1d_
  - **Problem:** If the user misses or declines the intro call, there's a 12–24hr gap before any value arrives. No designed aha moment.
  - **Fix:** Immediately after onboarding completes, auto-generate and display a briefing preview on the dashboard using the data already collected (priorities + calendar if connected). Label it clearly: *"Here's what Edg3 already knows about your week."* This is the aha moment — it should happen in seconds, not tomorrow morning.
  - **Acceptance:** Every new user sees a personalized preview on first dashboard load, regardless of whether they took the intro call.

- [ ] **International users: phone number fallback message** — _UX audit 2026-06-10. ~1h_
  - **Problem:** Call Time step requires a US/Canada number with no recovery path for international users — dead end with zero explanation.
  - **Fix:** Below the phone input, add: *"Outside the US or Canada? Skip for now — you'll receive web briefings instead, and can add a number later."* Add a skip link that completes setup without a phone number.
  - **Acceptance:** Non-US users can complete onboarding without a phone number and reach the dashboard.

---

### UX/UI — Dashboard v2 (2026-06-10, from designer audit · PM sign-off pending)
> Goal: answer "what matters today?" within 3 seconds of opening the dashboard. Current layout buries today's focus behind tabs and leads with an input box.

- [ ] **Move UpdateBox (chat) below the briefing list** — _UX audit 2026-06-10. ~1h_
  - **Problem:** The "Tell Edge something" chat box is the first element a user sees on every dashboard load. It's a secondary input flow masquerading as the primary one.
  - **Fix:** Move `<UpdateBox />` below the briefing list/Today view. The hero of the dashboard should be today's briefing.
  - **Acceptance:** Dashboard opens on the briefing/Today content; chat box is reachable by scrolling.

- [ ] **Hide notification bell at zero-state** — _UX audit 2026-06-10. ~30min_
  - **Problem:** The bell icon renders for all users at all times, adding chrome for a feature most new users won't trigger in their first 30 days.
  - **Fix:** Render the bell only when `notifUnread > 0` or when the user has at least one watched thread. Zero-state = no bell.
  - **Acceptance:** A brand-new user's dashboard has no notification bell. Bell appears once there's something to notify about.

- [ ] **"Today" consolidated tab as default dashboard view** — _UX audit 2026-06-10. ~1–2d_
  - **Problem:** The briefings tab shows a collapsed history list; tasks and priorities require separate tab clicks. Opening the dashboard doesn't answer "what matters today?"
  - **Fix:** Add a **Today** tab (or rename Briefings → Today) that shows in a single view: (1) latest briefing content expanded by default, (2) today's tasks, (3) current priorities. This becomes the landing tab. Briefing history moves to a "Past briefings" collapsible section below.
  - **Acceptance:** A user opening the dashboard at 9am sees their briefing, today's tasks, and priorities without clicking any tabs.

- [ ] **Collapse to 3 tabs: Today / Memory / Settings** — _UX audit 2026-06-10. ~1d_
  - **Problem:** Five tabs (Briefings / Tasks / Priorities / Memory / Profile) cause decision fatigue and split content that belongs together.
  - **Fix:** Merge into three tabs: **Today** (briefing + tasks + priorities), **Memory** (unchanged), **Settings** (profile summary + call settings + calendar connect — currently split across Profile tab and sidebar). Remove the standalone Priorities and Tasks tabs.
  - **Note:** Coordinate with the Today tab ticket above — ship together.
  - **Acceptance:** Dashboard has exactly 3 tabs. All existing functionality is reachable within them.

---

### UX/UI — 30-Day Retention (2026-06-10, from designer audit · PM sign-off pending)
> These address the habit-formation gap: nothing currently pulls a user back after missed calls or a streak break.

- [ ] **Priority drift prompt at 7 days** — _UX audit 2026-06-10. ~0.5d_
  - **Problem:** No mechanism prompts users to keep priorities current. Stale priorities = stale briefings = lower perceived value.
  - **Fix:** If `priorities.updated_at` is older than 7 days, show a dashboard banner: *"Are these still your top priorities this week? [Update] [Yes, keep them]"*. Tapping "Yes, keep them" updates the timestamp; tapping Update opens the priorities editor inline.
  - **Acceptance:** Users who haven't updated priorities in 7+ days see the prompt on dashboard load. Users who dismiss it don't see it again for another 7 days.

- [ ] **Streak/consistency indicator in sidebar** — _UX audit 2026-06-10. ~0.5d_
  - **Problem:** No visual feedback for consistent engagement. Users don't feel the cost of breaking a streak, so there's no loss-aversion hook.
  - **Fix:** Add a simple call-streak counter below the "Next call" card in the sidebar: *"🔥 7-day streak"* (increments on completed briefing calls, resets on a missed day). No gamification overload — one number, one label.
  - **Acceptance:** Sidebar shows current streak. Streak increments after a completed call. Resets to 0 after a missed day.

- [ ] **Weekly summary email/digest** — _UX audit 2026-06-10. ~1d (needs email infra confirmation)_
  - **Problem:** If a user misses several calls in a row, nothing brings them back. The product goes silent.
  - **Fix:** A short weekly email (Sunday evening or Monday morning): what Edg3 observed this week, whether the user's calendar matched their priorities, any open threads or unresolved tasks. Plain text, personal tone. Opt-out in one click.
  - **Dependency:** Needs an email sender (Resend / SendGrid / similar). Confirm with PM before building — if no sender is configured, this stays in Later.
  - **Acceptance:** Users receive a weekly digest. Unsubscribe works in one click. Digest is generated from existing briefing + priority data with no new data collection.

---

### Later / candidates (not yet committed)
- [ ] **🔮 V2 / POST-LAUNCH — Google Drive / Sheets awareness** (PM-deferred 2026-06-10, user idea). Edge pulls the doc/spreadsheet tied to a calendar event (e.g. the weekly P&L sheet for the "P&L review" block) and works it into the briefing. **Deferred because:** it's another *restricted* Google scope (compounds the verification we haven't started), it's new scope against the September freeze, and summarizing financial spreadsheets accurately is high-trust/high-risk. Lighter near-term paths if ever needed: (a) surface the doc *link* in the briefing (no new scope); (b) `drive.file` + file-picker so the user designates only specific docs (non-restricted scope).
- [ ] Onboarding: smoother first-run (connect calendar → first briefing) flow.
- [ ] Briefing: richer briefing content / personalization controls.
- [ ] Calendar: better event review & edit UX from the dashboard.

### Later
- [ ] _…_

---

## Guardrails for this lane
- Stay in the Core-owned files (constitution §3). For `lib/db.ts` schema changes,
  follow the Shared-file protocol (§5).
- New writes that create calendar events must be **idempotency-aware** — coordinate
  with the Security lane so features don't reintroduce duplicate-on-retry bugs.
- Don't weaken any destructive-action confirmation or undo behavior the Security
  lane has shipped.
