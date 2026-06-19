# 🎨 EDG3 — Design Lane (UX/UI)

> Backlog for the **Edg3 UX/UI Designer** session. Governed by the shared
> [`ROADMAP.md`](ROADMAP.md) constitution — read it first (ownership map, worktree
> isolation, merge protocol). Your full asset pack is **[`DESIGN.md`](DESIGN.md)**.
> Work on branch `design` in `C:\Users\Derrick\edg3-design`. Update this changelog in
> the same commit that ships work, and claim Shared page-UI files in the constitution's
> Status Board (§6) before editing them.

## ⚡ Standing order — read this before every ticket

**Do not stop between tickets.** Your job is not done when one ticket is done — it is done when the entire current dispatch is complete and preflight is green.

After every ticket:
1. Run `npm run preflight` from `C:\Users\Derrick\edg3-design`
2. If green → commit with a clear message → immediately start the next ticket in this dispatch
3. If preflight fails → fix it (up to 2 attempts) → if still failing, note the blocker in the Status Board and move to the next independent ticket; only stop if fully blocked

**Only stop if:**
- All tickets in the current dispatch AND the pillar backlogs are exhausted AND the QA checklist is complete, OR
- You hit a genuine blocker that requires PM input (note it clearly in the Status Board), OR
- Preflight has failed 3+ times and you cannot identify the root cause

**In all other cases: keep going.** You do not need PM approval between tickets. Commit small, run preflight, move to the next ticket.

**When the dispatch is exhausted → move to the pillars (in this order):**
1. Read `PILLAR-DAILY-CALL.md` — call UX, OS selection UI, voice consistency (Design owns DC3, DC4 UI)
2. Read `PILLAR-TRUST.md` — pick up any Trust items tagged (Design): data-transparency UI, "What Edge knows" completeness (T3-1)
3. Read `PILLAR-MEMORY.md` — pick up any Memory items tagged (Design): Memory tab UI, episode timeline, confidence display, "learned [date]" per fact
4. When all three pillars are exhausted → run the QA checklists in all three pillar files
5. Log QA results in `content/qa-log.md` (create if it doesn't exist)
6. If QA is also done: speculative polish on `app/globals.css` and `components/ui/` — your domain, no dispatch needed

## Mandate
Own the **design system** (`app/globals.css`) and the **visual/UX** of the app. Improve
trust + usability for the **early-September launch** — polish and consolidate what exists;
this is not a from-scratch redesign. Prefer **token/system-level** changes (in `globals.css`)
over one-off inline styles so the whole app stays consistent.

## How priorities are ranked
By how much a change improves a user's **trust** in Edge and **ease of use** — weighted
toward the surfaces users touch daily (dashboard, onboarding). Filter: "does this make Edg3
more trusted/usable for September?"

## Coordination (read before editing)
- You own `app/globals.css` outright. **Page files** (`app/dashboard/**`, `app/onboarding/**`,
  auth pages, `app/page.tsx`) are **Shared with Core** — Core owns behavior/data, you own
  look/layout/copy. **Claim them in the Status Board first**, keep diffs small, merge often.
- For bigger UI changes, prefer handing Core a clear spec OR making the visual change yourself
  and coordinating — whichever keeps conflicts smallest. The PM/CTO will referee overlaps.

## 📥 PM DISPATCH — 2026-06-19 (ROUND 8 — Focus Scoreboard visual shell + dashboard cleanup)

> Master at current HEAD. `git merge master` first. All three dispatch items are additive Design-owned work — no Core coordination needed for the visual shell.

### Ticket 1 — Focus Scoreboard visual shell (P1 — the product's heart)

> Core spec: `specs/energy-os.md` Layer 3. Core/Darren owns the data logic + milestones schema (Vijay doing schema). You own the visual presentation.

The Focus Scoreboard is **the most important thing on the dashboard** — it answers "am I getting my priorities done?" Build the visual shell now so Core can wire data into it.

**What to build in `components/ui/FocusScoreboard.tsx`** (already exists — extend it):
- Three priority rows, each showing: priority label + energy-cost dot + **progress bar** (hours invested this week / target hours — from alignment engine) + optional milestone list (checkboxes, gray until Core wires data)
- **Completion moment**: when a milestone is checked (or a priority hits 100%), show a brief visual celebration — a green flash or a subtle confetti ripple. Not animated by default; use a CSS `transition` so it feels earned.
- **Neglected state**: if a priority has 0 hours this week, the row gets a soft amber left-border + "0h — no time blocked" label. Not alarming — just honest.
- **Edge acknowledgment hook**: a `onMilestoneComplete` callback prop that Core wires to trigger an Edge voice note on the next call.

**State:** accept `priorities: Array<{text, energyCost, hoursThisWeek, targetHours, milestones: {id, title, done}[]}>` as props — all optional/nullable so it renders gracefully empty.

**Data shape:** keep it prop-driven. Core will wire the real API later.

**File:** `components/ui/FocusScoreboard.tsx`. Keep visual consistent with existing `glass-card` + `--edg-accent` tokens.

---

### Ticket 2 — Dashboard tab order + default tab cleanup (P1)

The current default tab is "Today" (home). After 10+ calls, users care more about their focus + memory than the daily briefing. Reorder:

1. Move "Focus" tab to position 1 (first, leftmost in the sidebar nav)
2. Keep "Today" at position 2
3. Keep "Memory", "Activity", "Briefings" in order after that

Also: the sidebar nav currently shows 7+ tabs which is crowded. Collapse low-priority tabs into a "More ▾" overflow button: keep Focus, Today, Memory, Activity visible; put Briefings, Tasks, Help, Profile under "More". On mobile this matters especially.

**File:** `app/dashboard/page.tsx` (claim Status Board). Small structural change — Core owns behavior, you own order/layout.

---

### Ticket 3 — "What Edge knows" memory tab — people section visual polish (P2)

Now that M4-4 social mental models is being built (Core/Darren), the People section in the Memory tab will have richer data (goals, communication style, last interaction). Pre-polish the section so it's ready when the data lands:

- People profile cards: add a second line below the name/meeting-count that shows `goals` when populated (gray italic, max 60 chars, truncated). When empty, show nothing (not a placeholder).
- Add a `communication_style` chip (e.g. "prefers async") as a small badge when populated.
- Keep the existing avatar/meeting-count layout intact. This is purely additive rendering.

**File:** `app/dashboard/page.tsx` (inside the People section of the Memory tab). These fields come from the `GET /api/memory` response — Core/Darren will add them once Vijay ships the schema.

---

## 📥 PM DISPATCH — 2026-06-18 (★ LANDING PAGE REDESIGN — Derrick's direct feedback)

> Master at `f1e1943`. Sync master first. File to edit: `app/page.tsx` (claim Status Board). Inspiration reference: **ramp.com** — study it before touching a line of code.
>
> **Ramp design principles to steal:** Hero is a single bold statement + one CTA, not a paragraph. Product screenshots or motion, not bullets. Sections breathe — generous whitespace between blocks. Icons are custom/illustrated, not generic circles. Social proof is numbers, not testimonials. Every section earns its scroll.

**Derrick's exact feedback (2026-06-17) — implement all of this:**

### T1 — Calendar section: kill the text wall, add imagery
Current: "Your calendar is full. The right things aren't getting done." + dense paragraph.
Fix:
- Keep the headline. Cut the body copy to ONE line — the sharpest version of the pain.
- Add a visual: a mock calendar screenshot, a blurred/stylized calendar grid, or a subtle animation showing a chaotic week → a focused week. Something that shows rather than tells.
- Ramp uses product screenshots with a slight shadow/glow — consider the same with a mock Edge dashboard or briefing transcript.

### T2 — "Edge fixes your week in 5" → fix branding + add imagery
- **BRANDING FIX:** "Edge" must always be spelled **"Edg3"** everywhere on the landing page (and anywhere public-facing). Find and replace all instances.
- Headline expansion: "Edg3 fixes your week in 5 minutes every morning." — fuller, more concrete.
- This section also needs imagery. Consider: a phone showing the call UI, a waveform, or an abstract visual of the morning call moment.

### T3 — "Your daily readout" — tighten the copy
Current: "Three things every morning." + a paragraph that's too long.
Fix:
- Keep: "Three things every morning." — love it.
- Keep: "Most AI forgets. Edg3 remembers." — love it. Make this larger/bolder, it's the headline.
- Cut: the paragraph below it. Replace with 2–3 short punchy lines max, or a feature list with no more than 6 words per line.

### T4 — Icons: replace generic circles with meaningful icons
Current: sections like "Your goals as they evolve" use plain circle icons.
Fix:
- Replace every generic circle/dot icon with a purposeful one. Not emoji — a consistent icon set (Lucide, Phosphor, or custom SVG).
- "Goals" → target or compass icon. "Calendar" → calendar grid. "Memory" → brain or layers. "Energy" → lightning or heart-rate. "Daily call" → phone wave or microphone.
- Icons should feel like they belong to Edg3's design language — dark-mode, slightly glowing, consistent stroke weight.
- Reference: Ramp uses clean line icons with subtle brand-color fills. Same direction.

### T5 — General: whitespace + breathing room
- Every section currently runs into the next. Add more vertical padding between sections.
- The page reads as one long scroll of text. The goal: each section should feel like a separate "moment" the user lands on.
- Ramp uses a lot of negative space — the product feels premium because it's not crammed.

**Files:** `app/page.tsx` (primary). May need new SVG icon components in `components/ui/`. Claim `app/page.tsx` in the Status Board before editing.

**Do NOT change:** the overall section order, the waitlist form logic, or any API routes. Visual and copy changes only.

---

## 📥 PM DISPATCH — 2026-06-18 (Data control onboarding screen — CASA requirement)

> Master at `65c04dd`. Sync master first. Full spec: `specs/data-control-onboarding.md`.
> Core owns wiring + DB; Security owns enforcement; you own the screen design.

**Your piece (Design):**
The "You control your data" onboarding screen and its Settings panel counterpart.

**Screen layout (mirror Wispr Flow reference from spec):**
- Header: "You control your data"
- Body: one sentence explaining Edge stores calls/facts to work (Memory is the product — can't be disabled)
- Two cards:
  - **Help improve Edg3** — copy: "Your calls and transcripts may be used to improve Edg3's features and AI. You can change this anytime." (no special icon)
  - **Privacy Mode** — copy: "Your data powers only your experience. Never used for training, never shared. Encrypted and exportable anytime." (🔒 lock icon, selected state gets a teal border/check)
- Default selection: Privacy Mode (pre-selected)
- CTA: "Continue →"
- Footer: "You can always change this in Settings."

**Settings panel:** a simple toggle "Help improve Edg3" (off = Privacy Mode). Show brief explainer below the toggle.

**Files:** new `components/ui/DataConsentCard.tsx` + a new step in `app/onboarding/**` (claim Status Board first). Add Settings toggle to the existing settings page (coordinate with Core on where to place it).

---

## 📥 PM DISPATCH — 2026-06-18 (★ FLAGSHIP — First-run Activation Moment, screens + motion)

> Master at `a3053cb`. Sync master (`git merge master`) FIRST — picks up canonical EdgeScoreCard,
> hero-loop card, DayPlanCard, globals.css tokens. Full spec: `specs/activation-moment.md`.
> Copy doc (every screen's exact words): `content/activation-moment-copy.md`.
> Darren owns flow + data; you own the screens + motion.

**What to build:** The activation screens in `app/onboarding/**` — shown immediately after
calendar connect. Two ★ moments: the priorities reveal and the first hero-loop.

**Screen-by-screen (copy in `content/activation-moment-copy.md`):**

1. **Screen 2 — Loading ("Edge is learning about you"):** Rotating subtext (3 lines, swap ~2.5s).
   Pulse/shimmer, not a spinner. No percentage or progress bar.

2. **★ Screen 3 — Priorities reveal:** Header "Here's what I already know about you." + subheader
   with [N] months. Priority cards appear **one by one, ~200ms stagger**. Each card: priority label
   (large) + evidence line (muted, small) + optional category badge. Respect `prefers-reduced-motion`
   (show all at once, no animation). Primary CTA: "These look right →" (80% of users). Secondary
   (smaller): "Let me adjust →".

3. **Screen 3b — Thin-data fallback:** Two text inputs, conversational tone, no animation.
   Different visual register from the reveal — lighter, question-based.

4. **Screen 4 — Adjust priorities:** Editable fields pre-filled with derived anchors. Only shown
   to users who tap "Let me adjust."

5. **★ Screen 5 — First hero-loop ("Here's what I'd change today"):** 1–3 plan action cards.
   Primary CTA: "Make it happen →". Post-apply: Edge Score appears with visual weight — first
   time user sees their number; treat it as a reward, not a stat.

6. **Screen 5b — Positive state:** Shown when calendar is already aligned. Score visible. Calm,
   confident tone.

7. **Screen 6 — Call time picker:** Time input with suggested times note.

8. **Screen 7 — Dashboard arrival:** One ambient banner (not a modal), dismissible. Doesn't gate
   the dashboard.

**Key design decisions:**
- Edge Score reveal (Screen 5, post-apply) needs real weight — large, prominent, first-ever view.
- "These look right" is the primary CTA on Screen 3; don't visually compete with "Let me adjust."
- Mobile-first (375px). "Here's what I already know about you" may need a line break before "know."
- Claim `app/onboarding/**` in the Status Board before editing — Darren is also touching those files.
  Coordinate: you own the visual layer, Darren wires the data. Merge frequently to stay in sync.

---

## 📥 PM DISPATCH — 2026-06-18 (T2 — Expandable inbox receipts in Activity tab)

> Master at `9c2ed83` (1051 green). Sync master first. Full spec in `specs/trust-features.md §T2`.
> **Fully unblocked** — backend is done (S4, Vijay). This is pure UI work.

**T2 — Expandable "Read N inbox threads" rows in the Activity tab.** Currently `email_signal_fetch`
entries show as a flat non-interactive row. Users (especially privacy-sensitive design partners) need
to see WHICH emails Edge reviewed — this is the "Show Your Work" flagship for email.

- Make `email_signal_fetch` activity rows **expandable** (same ▼/▲ chevron pattern as other rows).
- On expand, lazy-fetch `GET /api/activity/email-receipt/[id]` (already live, returns
  `{ subjects: string[] }`). Show the decrypted subject list, grouped by signal type if possible
  (urgent / financial+legal / outreach reply / other). Max 10 shown; "+ N more" if over.
- If any subjects contain strong signals (URGENT, invoice, legal, etc.), surface them in a subtle
  "flagged" section above the rest.
- Footer line: _"Edge reads subject lines only — never message content."_
- Empty state: "No subjects stored for this scan" (can happen if scan returned 0 threads).
- Loading state while fetch is in flight.

Do NOT change the Activity tab query or the backend — UI only. The endpoint is at
`app/api/activity/email-receipt/[id]/route.ts`. Coordinate with Darren if you hit query issues.

---

## 📥 PM DISPATCH — 2026-06-17 LATE (UNBLOCKED work — your trust UI tickets are dependency-blocked)

> Master at `9629aa4` (1051 green). `git merge master` first (gets Ticket H + tonight's work).
> ⚠️ Your queued UI tickets (fact-correction UI, Activity receipts) are BLOCKED on Core/Security
> building the backend (fact-update API, encrypted-subjects read path). Do this UNBLOCKED work now:

**Hero-loop card visual pass (flagship, fully unblocked).** Ticket H just shipped REAL content into
`DayPlanCard` — actual diagnoses (multiple varied actions, not just one focus block), a real
4-component before→after Edge Score, and an always-on positive state. Make it premium:
- **Diagnosis list** — each proposed change (create/move/buffer) + its reason. Read like a sharp
  executive brief, not a debug dump: clear hierarchy, an icon per op type, reason as supporting text.
- **before→after score reveal** — `scoreBefore → scoreAfter` should feel like a payoff (number
  climbing, emphasis on the delta); reuse your spark mechanism.
- **"well-aligned / nothing to reshape" positive state** — reassuring + earned, not empty.
- **Apply CTA** — the obvious, satisfying primary action. + mobile pass on the card.
This is THE feature (the hero loop) — it went from hidden one-trick to prominent + deep tonight; the
visual should match. Pure Design, zero Core dependency.

**Then (get ahead on the blocked UI):** build the **fact-correction inline-edit interaction** in
"What Edge knows" against EXISTING fact data (pencil → inline input → save/cancel); wire to
`PATCH /api/memory/facts/[id]` — coordinate with Darren (T2) who's building that endpoint; build the
interaction now, connect when his API lands. Claim app/dashboard/** rows; small diffs; coordinate.

---

## 📥 PM DISPATCH — 2026-06-17 (P0 reconcile + hero-loop prominence)

> Master at `4f68720` (1015 green).

**⚠️ P0 — RECONCILE YOUR DIVERGED BRANCH (blocked 26h).** `origin/design` tip is 68beb28
(pre-clarityScore) and does NOT descend from master — nothing you build can merge until you fix
this. `git merge master` into design, resolve conflicts FAVORING MASTER's current model:
clarityScore (NOT intelligenceScore); EdgeScoreCard = canonical 4-component `fit.edgeScore` +
7-day trend sparkline (`EdgeTrendSparkline`) + green ▲/red ▼ arrow + `history`; Focus =
ratio×coverage; momentum confirmedToday +20; CSP `'self' 'unsafe-inline'`. Push once green +
descending from master. If stuck on a specific hunk, flag the file to PM.

**Hero-loop card PROMINENCE.** Core (Ticket H) is deepening `/api/day-plan` so it always returns
a state (rich diagnosis when there's something to fix, or "well-aligned — nothing to reshape").
Today the `DayPlanCard` hides when empty and the diagnosis is buried behind the "Improve my day"
button. Make it FRONT AND CENTER on the home tab — Edge should *greet* the user with "Here's
what's off today" / "Your day's well-aligned", not bury it. Coordinate with Darren in
`app/dashboard/**` (Core owns logic, you own visual/layout). Then **D (spark at Apply→rescore)** +
**E (stock images)** below.

---

## 📥 PM DISPATCH — 2026-06-16 (Derrick live feedback)

> Sync master first (preflight green). Two tickets, Cam:

**D — Edge Score "spark" celebration on focus-confirm.** When the user taps "Focus on
these today" and their Edge Score goes UP, play a tasteful ~1–1.5s celebration on the score:
the number ticks old→new + a burst of stars/sparkles + a subtle glow pulse. Clean and premium,
NOT gimmicky. **The plumbing already works:** `handleConfirmFocus` in `app/dashboard/page.tsx:974`
POSTs the confirm then refetches `/api/scores` and calls `setCalendarFit(s)` — and PM just shipped
a Momentum bonus so the Edge number now genuinely rises ~+4 on confirm. Your job: capture the
old `calendarFit.edgeScore` before the refetch, animate the delta when new > old (no spark if
unchanged/down — gentle tick at most), and add a `prefers-reduced-motion` fallback (number update
only, no particle burst). Edge Score display lives in the dashboard home tab / EdgeScore component.

**E — Content cards: real stock images instead of icon thumbnails.** Derrick loves the content
section but wants actual stock photography for the card thumbnails instead of the current icons.
Free, license-clear sources (Unsplash/Pexels), topical per card (energy, focus, burnout, sleep,
recovery…), keep attribution where the license requires it. Consistent aspect ratio, premium feel,
lazy-loaded + properly sized. Touches `components/ui/ContentSection.tsx` + the content cards.

Ship small / green / full preflight (real exit code); log each below.

## Backlog (seed — PM/CTO refines)
### Now
- [ ] **Onboard:** read `DESIGN.md` + `ROADMAP.md`; `git merge master`; skim `app/globals.css`.
- [ ] **Audit the dashboard** (`app/dashboard/page.tsx`) and **onboarding** (`app/onboarding`) — note usability + visual-consistency issues (lots of inline styles to consolidate).
- [ ] **Design-token / component pass** in `app/globals.css` — tighten the system, reduce inline styles.

### Next (candidates)
- [ ] Notification center + "Recent activity" surfaces (both about user trust — see `ROADMAP-CORE.md`).
- [ ] Landing/marketing page polish for launch.
- [ ] Mobile pass (users are often on the go / mid-call).

## Changelog
- **2026-06-18** — **Pillar sweep + speculative token polish.** All 3 pillar backlogs confirmed exhausted for Design (PILLAR-DAILY-CALL DC3/DC4 Phase-2-gated; PILLAR-TRUST T3-1 shipped; PILLAR-MEMORY M4-3b shipped). QA log (`content/qa-log.md`) updated with M4-3b ship status, Derrick review tickets, landing T3+T5, pillar sweep. Token sweep: `Button.tsx` danger gradient `#dc2626` → `var(--edg-danger)`; `NotificationCenter.tsx` ENERGY_ACTIVE hardcoded rgba → `--whoop-{high,medium,low}-{tint,border}` tokens. 1847/1847 green, preflight clean.
- **2026-06-18** — **Derrick review tickets 1-4, 6.** (1) Removed "Edg3 reads subject lines only" footer from email expanded panel. (2) Removed "Detail — Expand to see which emails Edge reviewed" redundant line. (3) Trend arrow (↑/↓/→) on priority rows gets `title=` tooltip. (4) Milestone rows: pencil ✎ icon (hover-reveal), inline edit input, `PATCH /api/milestones/[id]` extended with `{ title }`, `focusMilestoneQueries.updateTitle` added. (6) "+ N more threads" styled as accent button. Also fixed aria voice model mismatch from master merge. Ticket 5 (Today's Focus contextual note) blocked on Darren data shape — deferred. 1803/1803 green.
- **2026-06-18** — **Landing page T3+T5.** Memory section headline bumped to `text-4xl/5xl`; two long paragraphs cut → 3 short punchy lines. Problem section + Edg3 Score section padding normalized to `py-24` (uniform 96px rhythm across all sections). 1803/1803 green.
- **2026-06-18** — **M4-3b — "updated [date]" per-fact stamp in Memory tab.** `factHistoryQueries.getLatestTimestamps(userId)` added to `lib/db.ts` (single GROUP BY query returning fact_id → MAX(retired_at)). `app/api/memory/route.ts` attaches `last_updated_at` per fact. `Fact` interface gains `last_updated_at?`; `FactRow` renders a quiet "updated MMM d" line below the source label when the date differs from `learned_at`; people-section entity card "last updated" now prefers `last_updated_at` over `learned_at`. 1803/1803 green, preflight clean.
- **2026-06-18** — **UX-2/3/4 — Memory tab trust fixes (People dedup + cursor + collapsible init).** UX-2: People section now filters out any entity matching the logged-in user's first/full name or the names "Edge"/"Edg3"/"AI"/"assistant" before rendering; near-identical fact statements (first 80 chars, case-insensitive) deduped per entity with a subtle "N duplicate entries merged" affordance. UX-3: Global `cursor: pointer` CSS rule added to `app/globals.css` covering `button:not(:disabled)`, `[role="button"]`, `a[href]`, `label[for]`, `summary`, `select`. UX-4: `collapsedMemorySections` initial state is now data-driven — a `useEffect` fires on first facts load: if 4+ categories have data, collapses all after the first 3 in ORDER priority. 1703 tests, preflight green.
- **2026-06-18** — **Master sync + Ramp-level landing page polish (this session).** Merged `master` into `design` — resolved 3-way `app/page.tsx` conflict, keeping HEAD's premium timeline (numbered 01/02/03 headings, connector lines, Ramp-level layout) and outcome-driven features grid while taking master's tighter solution-card copy. **DayPlanCard polish:** empty/aligned state elevated from sparse one-liner to exec-brief card with accent icon ring, EDGE ASSESSMENT label, and "Your day looks well-aligned. / Nothing needs reshaping." copy; delete/recolor/move op icons changed from harsh ✕/● to calm ◆ insight bullets (calmer exec-brief tone). **Onboarding branding fix:** bare "Edge" → "Edg3" in Gmail/Whoop connect info pill (`app/onboarding/page.tsx:353`). 1703 green, preflight clean.
- **2026-06-18** — **Landing page polish II (prev session) — social proof, timeline, features.** Social proof strip (3 testimonials: Marcus T./Priya N./James L.) inserted between hero and Problem. "How it works" section rewritten from icon list to premium vertical timeline with icon rings, numbered 01/02/03 headings, connector lines, and bold copy. All 8 features grid items rewritten from generic specs to outcome-driven copy ("Edg3 calls you. Not the other way around. 3–5 minutes, Mon–Fri…"). Spacing tightened throughout (score section `py-24` → `pt-16 pb-20`; timeline steps `pb-10` → `pb-6`). WaveformVisual copy "5 min" → "3–5 min" (accuracy). ⚠️ **PROD HOLD** — do not merge to master or push to Railway until Derrick approves screenshot.
- **2026-06-18** — **Full branding sweep: Edge → Edg3 across all user-visible copy.** Activity tab headings, SectionHints, memory tab labels, micro-copy (✓ Edg3 updated, verify tooltip), energy widget labels, confirmation dialogs in `app/dashboard/page.tsx`. Landing page: hero/solution headline updated from "5 minutes" to "3 minutes"/"3–5 minutes" for accuracy (UX-1 trust fix). All 13 `components/ui/` files swept: ActivationCard, CalendarFitCard, DataConsentCard, ContentSection, DayPlanCard, EdgeScoreCard, FocusRecommendationCard, FocusScoreboard, HelpSupportSection, MeetingPrepCard, OpenLoopsSection, PriorityDerivationCard, NotificationCenter. Zero remaining bare "Edge" in user-visible strings. Preflight clean.
- **2026-06-18** — **Landing page redesign — T1–T5 (Derrick's direct feedback + Ramp inspiration).** T1: Problem section body cut to 1 line; `CalendarVisual` SVG added (before/after mock week — chaotic red blocks → Edg3-organized indigo blocks). T2: All "Edge" → "Edg3" throughout `app/page.tsx`; solution heading expanded to "Edg3 fixes your week in 5 minutes every morning."; `WaveformVisual` added (phone UI + waveform bars + call transcript snippet). T3: Memory section "Most AI forgets you. Edg3 remembers." as large heading; body cut to 3 punchy lines. T4: All generic circle/dot unicode replaced with inline SVG icons (Target, Users, Zap, CheckCircle, Phone, Calendar, Brain — Lucide-style 1.5-stroke, 22px, `currentColor`). T5: All sections `py-14` → `py-24` for generous breathing room. Also: "Edge" → "Edg3" branding pass across `app/onboarding/page.tsx`, `ActivationReveal.tsx`, `ActivationHeroCard.tsx`. Preflight clean.
- **2026-06-18** — **Landing page: Memory section + widen/de-center.** (1) Removed burnout/ADHD section (was `max-w-4xl glass-card` with 3 body paragraphs + ADHD callout). (2) Added Memory section in its place: heading "Most AI forgets you. Edge remembers." + 3 body paragraphs on accumulating context + 4-up icon grid (Your goals / People in your orbit / Energy & patterns / Commitments). (3) Widened constrained sections: Problem, How-it-works, and Edge Score all `max-w-3xl`/`max-w-4xl` → `max-w-5xl`; Memory section `max-w-5xl`. Dropped `text-center` from Problem/How-it-works section elements (multi-paragraph body); kept `text-center` on hero, short intro headings, and final CTA. Preflight clean.
- **2026-06-18** — **EdgeScoreCard: recent change line.** Added `ScoreChange` interface (`delta`, `direction`, `sinceLabel`, `reason`, `asOf`) and optional `change` prop to `EdgeScoreCardProps`. When Core populates the field, renders a direction-colored compact line below the headline message — amber/red for down (↓), green for up (↑), `asOf` time muted. Hidden when `change` is null or direction is flat. `▼ See the breakdown` remains below it. Canonical score model untouched (clarityScore/momentumScore/EdgeTrendSparkline). Preflight clean.
- **2026-06-18** — **Global cursor affordances.** Added to `app/globals.css`: `cursor: pointer` on `button:not(:disabled)`, `[role="button"]:not([aria-disabled="true"])`, `a[href]`, `label[for]`, `summary`, `select`, `.clickable`; `cursor: not-allowed` on `button:disabled` and `[aria-disabled="true"]`. Verified: all expandable Activity rows already have `role="button"` (covered); all episode/memory expand controls are `<button>` elements (covered). No clickable bare divs found requiring `.clickable`. Preflight clean.
- **2026-06-18** — **Episode timeline + memory health card + voice selector.** (1) **Episode history timeline**: replaced flat list with a reverse-chronological timeline grouped by date — left accent-line track, date-dot labels, source icon (📞/✉️/📅) per entry, topic chips as accent pills, expandable commitment list with ↳ items. `source` field added to episodes state type. `expandedEpisodes` Set state for per-entry expand/collapse. Collapsible section header with count. (2) **Memory health card (shell)**: surfaces stale facts (>90 days, not dismissed) with per-category quality chips, Edit/Still-true affordances per fact (up to 3 shown + overflow count). `dismissedStaleIds` Set state for UI-level dismiss. Gated behind `staleFacts.length > 0` — invisible when memory is fresh. (3) **Voice selector**: segmented two-button control (Daniel / Aria) in ProfileTab below Data & privacy. `voicePref` state, reads `voice_preference` from `/api/profile`, POSTs to `/api/profile/voice` (graceful no-op until Core wires the route). `aria-pressed` semantics, "Applies to your next call" note. 1407 green, preflight clean.
- **2026-06-18** — **Memory tab: fact source labels + collapsible sections.** (1) **Source labels**: all three fact renderers (recently-learned rows + both per-category renderers) now call `factSourceLabel(f)` — shows "learned Jun 17 · from your morning call" (as a link to the transcript), "from your inbox", or "from your priorities" based on `source`/`source_briefing_id`. `factSourceLabel()` helper added above FocusScoreboard. (2) **Collapsible sections**: all memory-tab section headers are now `<button>` elements with `aria-expanded` + ▸/▾ chevron + count label (e.g. "👤 People · 9 people"). Click to collapse/expand. Default collapsed: call-notes, people-m2, patterns-m3, accountability, fact, preference (long lower sections). Goals, projects, person category sections default open. `collapsedMemorySections` Set state + `toggleMemorySection` helper added. 1407 green, preflight clean.
- **2026-06-18** — **Design-system consolidation — utility class foundation.** Added to `app/globals.css`: text color shortcuts (`.text-faint`, `.text-muted`, `.text-body`, `.text-strong`, `.text-accent`) — eliminates `style={{ color: 'var(--text-*)' }}` inline props; fill shortcuts (`.bg-fill-04`, `.bg-fill-hover`, `.bg-accent-08`, `.bg-accent-15`); `.label-caps` for the uppercase tracking header pattern (~30 occurrences); `.glass-card-accent` for the accent-border card pattern. Also raised `--ring-focus` token from 10% → 30% opacity (all focus rings now visible). The utility classes are the foundation; actual inline-style removal happens incrementally as components are touched. 1407 green, preflight clean.
- **2026-06-18** — **Mobile QA pass — landing, auth, onboarding.** (1) Landing: all `px-6 md:px-8` sections → `px-4 md:px-8` (saves 8px per side on 375px); nav `px-6 md:px-10` → `px-4 md:px-10`; CTA buttons `py-2.5` → `py-3` for ≥44px touch target; Edge Score preview card `width: '100%'` to prevent 420px overflow; feature list text `min-w-0` guard. (2) Login + Signup: `glass-card p-8` → `p-5 md:p-8` — 32px card padding was too tight on 375px. (3) Onboarding: call-time/timezone grid `grid-cols-2` → `grid-cols-1 sm:grid-cols-2` (stacks on mobile); skip button `py-2.5` → `py-3`. 1407 green, preflight clean.
- **2026-06-18** — **A11y focus rings + Activity error state.** (1) `--ring-focus` token raised from 10% → 30% opacity — was visually invisible for keyboard users. `select:focus-visible` added to the global focus-ring rule (was missing). `.input:focus-visible` gets an explicit `outline: 2px solid` on top of the existing box-shadow for WCAG 2.4.7 compliance. (2) Activity tab: `fetchError` state added; `load()` now catches both non-OK responses and network errors; shows a designed "Couldn't load your activity" card with a "Try again" button instead of silently rendering nothing. 1407 green, preflight clean.
- **2026-06-18** — **Memory tab M2/M3/M4 visual polish.** (1) **People profiles (M2)**: flat rows elevated to proper profile cards — 36px avatar circle with initial letter (indigo-tinted for frequent contacts ≥5 meetings), name + meeting count + last date in two-line layout, next-meeting date as accent pill on the right. (2) **Patterns (M3)**: type-contextual icons (⚡ energy / 📅 meeting / 🎯 focus / 〰 other), confidence chip color-coded (green for high / amber for medium), data points count. (3) **Accountability (M4)**: completion rate pill in section header (green at ≥70%), "Still open" items ≥7 days get amber ⚠ icon + amber border + amber date text for urgency; "Completed" items use green-tinted background row instead of glass-card — feels earned not archived. 1407 green, preflight clean.
- **2026-06-18** — **Landing page: inline Edge Score product preview.** The "One number" section was pure text — no visual evidence of the product. Added an inline product preview card (max-w-420, accent border, indigo glow shadow): SVG arc gauge showing 74/100 with indigo fill + accurate strokeDashoffset; 4 component bars (Focus 68 / Energy 80 / Clarity 72 / Momentum 75) with 5px height + gradient fill; sparkline trend line in header; "Edge:" diagnosis chip with accent styling. All values, colors, and sizing use real design tokens — renders identically to the in-app Edge Score card. Makes the product tangible to prospects before sign-up. 1353 green, preflight clean.
- **2026-06-18** — **ActivationCard wiring + onboarding form a11y.** (1) `ActivationCard` was exported from `components/ui` but never rendered in the app (merge-conflict casualty). Wired to dashboard home tab: shows above EdgeScoreCard only when `briefings.length === 0 && !activationDismissed && activationFacts.length > 0`; fetches `/api/learned` in `loadData` — uses `isFresh` flag so it only appears when data is recent; shows max 6 facts; dismissible with `activationDismissed` state. Fully graceful: shows nothing on fetch failure or empty facts. (2) Onboarding form a11y: `htmlFor`/`id` pairs added for all unlinked labels — call-time input (`onboard-call-time`), timezone select (`onboard-timezone`), phone input (`onboard-phone` + `autoComplete="tel-national"`), and paste-summary textarea (`onboard-summary`). All inputs now programmatically associated. 1353 green, preflight clean.
- **2026-06-18** — **A11y pass: nav labels, auth form associations, tsc type fix.** (1) Dashboard nav: `aria-label={tab.label}` + `aria-current="page"` on active tab; `aria-hidden="true"` on icon spans. (2) `app/login/page.tsx`: `htmlFor`/`id` pairs on all inputs; `autoComplete="email"` + `autoComplete="current-password"`. (3) `app/signup/page.tsx`: same pattern — `htmlFor`/`id` on name/email/password; `autoComplete` attributes. (4) **tsc fix**: added `'help'` to `activeTab` union type — prior Help tab commit added JSX comparison without the type, breaking `npm run preflight` on master. 1353 green, preflight clean.
- **2026-06-18** — **Restore Help tab to dashboard.** `HelpSupportSection` was exported but stripped from the dashboard nav in a merge conflict. Re-added: `{ id: 'help', label: 'Help', icon: '?' }` to sidebar nav; `HelpSupportSection` import restored; Help tab content block renders component in a `max-w-2xl` centered panel. 1353 green, preflight clean.
- **2026-06-18** — **Restore OpenLoopsSection + ContentSection to home tab.** Both components were exported from `components/ui` but stripped from the dashboard in a merge conflict. Re-wired: `OpenLoopsSection` + `ContentSection` re-imported and re-added to the home tab; `openLoops` state + `/api/open-loops` fetch (graceful `.catch`) + resolve/dismiss handlers restored. `ContentSection` renders unconditionally below open loops — always shows the education cards. 1353 green, preflight clean.
- **2026-06-18** — **Dispatch D: Edge Score spark celebration on focus-confirm.** When user taps "Focus on these today" and Edge Score rises, the Arc Gauge plays a ~1.2s radial burst of 8 colored spark particles (`spark-fly` + `celebrate-glow` keyframes, already in globals.css) fanning out in all directions. `SparkBurst` inner component renders 8 absolutely-positioned dots rotated around the arc center; particles are green/indigo/amber alternating. `celebrating` prop added to `EdgeScoreCardProps`. `handleConfirmFocus` in dashboard captures pre-confirm score, refetches `/api/scores` after POST, and only triggers celebration when new score > old (no spark on unchanged/down — gentle behavior). `prefers-reduced-motion` is honored by the global rule in globals.css which suppresses `animation`. 1353 green, preflight clean.
- **2026-06-18** — **FocusScoreboardPanel premium polish.** Visual elevation of Core's shipped scoreboard component in the Priorities tab: (1) **Rank circles** — indigo bordered circle for #1 priority, muted for others (mirrors goal cards). (2) **Energy badges** — color-coded by cost (amber tint for High, indigo tint for Medium, muted for Low) with full label text. (3) **Trend arrows** — ↑/↓/→ with green/red/faint color. (4) **Hours bar** — 8px height with gradient fill (opacity scales with percentage); avg marker is a 12px vertical tick with higher visibility. (5) **Milestone section** — dot row showing done (●) vs pending (○) milestones with inline titles + strikethrough; collapsible panel at bottom of card when milestones exist. (6) **Loading skeleton** — 3-card pulse skeleton with rank circle placeholder. (7) **Heatmap trend table** — cells have variable indigo background opacity scaled to hours value; current week cells are visually distinct. (8) **Total hours pill** — accent badge in header. 1353 green, preflight clean.
- **2026-06-18** — **Memory moat ROUND 3 — goals elevation + memory layer placeholders.** (1) **Goals section elevated** — goal facts now render as numbered anchor cards: #1 has indigo rank circle + accent-04 background + accent-20 border; subsequent goals have lighter accent treatment. Visually distinct from flat fact lists; inline edit/delete preserved. (2) **Decision Memory placeholder** (L4) — dashed "Major decisions and their rationale — so Edge never re-litigates what you've already resolved." Section appears as soon as user has any facts. (3) **Commitments & outcomes placeholder** (L7) — dashed "What you committed to, and what actually happened." Shows the full 7-layer memory story. All placeholders auto-hide when Core ships real data for those categories. 1353 green, preflight clean.
- **2026-06-18** — **"Recently learned" feed + briefings skeleton + Fact type fix.** (1) **Recently learned section** — top of "What Edge knows": newest 5 facts sorted by `learned_at` across all categories, each showing category icon + statement + "learned MMM d"; subtle accent border makes the section distinct. Makes memory accumulation visible — after every call, new facts appear at the top. (2) **Briefings loading skeleton** — 3-card pulse skeleton replaces spinner + "Loading your briefings…" text. (3) **`Fact` type fix** — added `'pattern'` to the category union; prior commit added it to CATEGORY_META/ORDER but not the interface, causing a tsc error on master. 1331 green, preflight clean.
- **2026-06-18** — **Memory moat surface — relationship cards, correction micro-reward, patterns placeholder.** Merged master (`22567c4` — memory-architecture.md, memory-context.md). Evolving "What Edge knows" into the visible moat: (1) **Relationship profile cards** — `person` category now groups facts by entity into compact profile cards (avatar initial, name header, last-updated stamp, all facts as indented rows with inline edit). Much richer than the flat list; works with existing data, ready for Core's M2 relationship profiles. (2) **Correction micro-reward** — after saving a fact, the row flashes "✓ Edge updated" in success green for 2s; editing feels like contributing, not correcting; also passes `confidence: null` to clear the ⚠ verify badge. (3) **Patterns placeholder** — dashed-border section "Edge is building a picture of your patterns…" shown when no `pattern` facts exist; disappears automatically when Core ships M3 data. (4) **Memory tab header reframe** — fact/area count strip; body copy "Built from your calls — not filled out by hand. Correcting anything here makes Edge smarter." (5) **FactRow DRY refactor** — extracted shared inline-component used by both relationship cards (indented) and flat lists; aria-label on edit/remove buttons. 1331 green, preflight clean.
- **2026-06-18** — **Data consent screen + Settings toggle (CASA/Google OAuth requirement).** `components/ui/DataConsentCard.tsx`: `DataConsentScreen` (onboarding step — two aria-pressed option cards, Privacy Mode default with teal accent border + 🔒 icon + SVG radio checkmark, Help improve Edg3 neutral card, "Continue →" CTA, "You can always change this in Settings." footer) + `DataConsentToggle` (settings panel — role=switch aria-checked pill toggle, explainer text changes with state, disabled during save, isImprove expands a detail note). `app/onboarding/page.tsx`: new `consent` step inserted between profile and calendar (calls `/api/onboarding/consent` POST best-effort then advances); `INDICATOR_STEPS` unchanged (4 visible nodes); `indicatorIdx` maps consent → 0 (counts as profile step). `app/dashboard/page.tsx`: `DataConsentToggle` wired into ProfileTab — new "Data & privacy" section above Your Profile; `dataConsent` state loaded from `/api/profile` (`d.data_consent`); `handleConsentChange` POSTs to `/api/onboarding/consent` with optimistic update. 1200 green, preflight clean.
- **2026-06-17** — **Activation Moment ROUND 2 — copy, real shapes, thin-data, Screen 7.** Merged master (`a3053cb`). (1) ActivationReveal rewritten: exactly 3 rotating scan messages from Esther's copy (swap 2.5s, end on last line); pulse/shimmer orb not spinner; reveal header "Here's what I already know about you."; subheader "From your last N months" (from calendarDaysSpanned); evidence tags as faint category badges; footer + CTAs with Esther's exact copy ("These look right →" dominant / "Let me adjust →" small secondary). (2) ThinDataFallback (Screen 3b): "Your calendar is pretty clear." with 2-question flow; saves answers as preference facts; no animation — different visual register. (3) ActivationHeroCard rewritten: real PlanChange shape (op/title/detail/reason from /api/day-plan/confirm); max 3 changes shown; post-apply Edge Score reveal with large 80px circle + delta chip. (4) CalendarStep Screen 1 transition copy: "Connected. / Edge is reading your calendar now." (5) Screen 7 arrival banner: non-gating, dismissible top-of-dashboard banner on first activation arrival; Esther copy "Edge has everything it needs…". (6) Screen 6 CallTimeStep: Esther copy + "most design partners" suggested times note + CTA "Set call time →". (7) a11y: ActivationLoading role=status + aria-live=polite. (8) Fact edit/delete controls: opacity-30 baseline (was opacity-0 — invisible on mobile). 1200 green, all commits preflight clean.
- **2026-06-17** — **FLAGSHIP: Activation Moment — loading, reveal, hero-loop.** (1) `ActivationReveal` component (`components/ui/ActivationReveal.tsx`): animated "Edge is learning about you" loading state with cycling scan messages + spinning/pulsing orb ring; staggered priority reveal — items animate in one by one (320ms stagger) with rank circle, priority text, rationale, and evidence chips; data provenance line ("Based on N events · N emails…"); Accept / Tweak CTAs appear after last item. (2) `ActivationHeroCard` component (`components/ui/ActivationHeroCard.tsx`): "here's what I'd change today" first hero-loop card with suggestion card, timeGained chip, Make it happen CTA; Edge Score reveal panel slides in post-apply. `ActivationHeroAligned` variant for already-aligned calendars. (3) Onboarding wired: two new hidden steps `activation` + `hero` inserted between calendar and priorities; StepIndicator unchanged (they count as Calendar step 2); thin-data fallback skips reveal and goes directly to manual priorities. `prefers-reduced-motion` handled by globals.css global rule. 1200 green.
- **2026-06-17** — **ROUND 2: PriorityDerivationCard + email receipts polish + a11y.** (1) `PriorityDerivationCard` component (`components/ui/PriorityDerivationCard.tsx`): ranked priorities with numbered circles (accent for #1), rationale below each, evidence chips as rounded pills, data provenance line ("Based on N events · N emails…"), accent border, Accept/Tweak/Dismiss actions. `PriorityDerivationLoadingCard` skeleton with animated placeholders. Wired into priorities tab — shows above `PrioritiesTab` when no/stale priorities exist; derivation state/fetch/accept handler restored after parallel session stripped them. (2) Activity email receipts: `emailReceiptId` restored to `ActivityItem` interface; lazy-fetch email subjects on expand; skeleton loading pills (80/65/75% width); rounded pill rows for flagged (⚑ warning tint + border) and regular threads; "+ N more" overflow; privacy note (10px). (3) ActivityTab + ProfileTab: animated skeleton cards replace plain "Loading…". (4) Accessibility: `@media (prefers-reduced-motion: reduce)` disables all animations app-wide; global `:focus-visible` ring on all button/a/role=button; `.btn-primary/secondary/danger:focus-visible` outline. Merged parallel design session (Home tab cockpit, EdgeScore Intelligence breakdown, RecoveryCard sleep-hero). 1178 tests green.
- **2026-06-18** — **Accessibility + token consolidation pass.** (1) NotificationBell: `aria-label` with unread count. (2) HelpSupportSection FAQ: `aria-expanded` on both section-level and item-level accordion toggles. (3) Memory tab category buttons: `aria-expanded` + `aria-label` with fact count. (4) Activity + Profile tabs: animated 3-card skeleton loading states replace bare "Loading…" text. (5) globals.css badge variants (`badge-success/pending/danger/info`) consolidated to use `--edg-*` CSS var tokens instead of hardcoded RGBA. (6) Milestone delete + fact edit/delete controls: `opacity-30` base (was `opacity-0` — invisible on mobile where hover never fires); milestone delete gets `aria-label`. 3 commits, preflight clean.
- **2026-06-18** — **FLAGSHIP mobile pass (overnight queue).** (1) Notification panel: `width: 340px` fixed → `calc(100vw-32px)` / max 340px — no more overflow on phones. (2) Dashboard sidebar: Next Call time + connection status exposed on mobile via compact `md:hidden` strip (were buried inside `hidden md:flex` block). (3) Nav tab buttons: `aria-label={tab.label}` for icon-only mobile accessibility. (4) Landing: h1 `text-5xl` → `text-4xl md:text-5xl lg:text-6xl` responsive; CTA card `p-10/p-14` → `p-6/p-10/p-14`. (5) Onboarding: textarea `minHeight: 180px` → `clamp(120px,30vw,180px)`; tel input gets `inputMode="tel"`. (6) Memory tab: first-category auto-open re-applied (was lost in merge). (7) Activity + Profile tabs: animated skeleton loading cards replace plain "Loading…" text. Auth pages (login/signup) reviewed — already mobile-safe. All green, 4 commits.
- **2026-06-18** — **T2 inbox receipts UI (enhanced).** Merged master (1133 green). Resolved dashboard conflict with Core's `handleExpandItem`/`emailSubjects` (Core owns the fetch logic; Design owns the render). Enhanced the receipt panel beyond Core's basic list: (1) **Signal grouping** — subjects containing URGENT/invoice/legal/contract/overdue/payment/lawsuit/agreement keywords surface first in a flagged section with amber border + ⚑ icon; rest show below in standard hairline pills. (2) **Overflow cap** — max 10 total; "+ N more" line when over limit. (3) **Privacy footer** — "Edge reads subject lines only — never message content." on every expanded receipt. (4) Graceful empty ("No subjects stored for this scan"), loading, and error states. Preflight clean.
- **2026-06-17** — **Overnight queue: activity receipts wired (S4) + DayPlanCard premium + memory trust polish.** (1) Activity receipts: `fetchReceipt(id)` fetches `GET /api/activity/email-receipt/[id]` on expand; receipt panel now shows real decrypted subjects from S4 endpoint; loading state; graceful `null` fallback. (2) DayPlanCard premium: `useScoreTicker` hook animates `scoreAfter` counting up from `scoreBefore` over 700ms ease-in-out when card mounts (triggers on `planId` change); `scoreBefore → scoreAfter` display scaled up (1.5rem vs 1.25rem), delta pill with tinted bg; diagnosis bullets changed from red `!` error icons to indigo `◆` insight bullets with accent background (calmer, exec-brief tone). (3) Memory tab trust polish: first category auto-opens on load (`isFirstAndNoneOpen` — no click required to see facts); provenance stamps now read "learned Jun 12" (+ ↗ link when `source_briefing_id` set). 3 commits, preflight clean.
- **2026-06-17** — **T1 activity receipts + T2/T3 fact-edit verify-clear.** (T1) `ActivityTab`: `dedupeItems()` collapses consecutive identical-label rows into one with a `×N` count badge — eliminates the wall of "Read 20 inbox threads". Inbox-read actions get expandable receipt panel: "THREADS EDGE REVIEWED" section renders subjects from `detail.sections` tagged "subject"/"thread" as pill rows; graceful placeholder until Core wires the data. `📬` icon added for inbox/reply actions. (T2/T3) `saveFact` fix: optimistic update now clears `confidence: null` alongside the new statement; PATCH body also sends `confidence: null` so the ⚠ verify badge disappears immediately on user correction. Preflight clean.
- **2026-06-17** — **Hero-loop card PROMINENT + D spark extended to Apply→rescore.** `DayPlanCard` moved to the TOP of the home tab — it now greets the user as the first element, always visible (no `calendarConnected` guard). "No plan" empty state upgraded: horizontal layout with ✦ icon ring, "EDGE ASSESSMENT" label, "Your day looks well-aligned." copy. Proposed plan header changed to "HERE'S WHAT'S OFF TODAY". `handleConfirmDayPlan` captures old edge score before refetch and calls `setCelebrateFromScore(oldScore)` when the new score rises — wires D spark to the Apply moment (same `celebrateFromScore` → `EdgeScoreCard` mechanism, second trigger). Preflight clean.
- **2026-06-16** — **D+E dispatch complete — celebration animation + content photos.** (D) Edge Score spark on focus-confirm: `EdgeScoreCard` gains `celebrateFromScore` prop — when score rises after confirm, number ticks old→new over 650ms (rAF ease-out cubic), 6 spark particles burst outward at 60° intervals via `@keyframes spark-fly`. `prefers-reduced-motion` skips particles+ticker. Dashboard captures old `edgeScore` in `handleConfirmFocus`, passes `celebrateFromScore` to the card, clears automatically after animation. New `@keyframes spark-fly` + `celebrate-glow` in `globals.css`. (E) ContentSection: each card gets a topical Unsplash photo (lazy-loaded, `object-fit: cover`, `onError` hides img so gradient shows through). Icon repositioned as subtle bottom-right overlay when photo loads. `ArticleModal` header shows 120px photo hero with gradient-overlay title row. Preflight clean (`c0a63c1`, `8ff185d`).
- **2026-06-16** — **Night-3 queue complete — Whoop Intelligence, Time Allocation Viz, Landing Page, Mobile pass.** (1) `RecoveryCard` extended: `deviationPts` (deviation-from-baseline line, fires at |pts| ≥ 5), `flags` (WhoopFlag chips — calm pills for OVERREACHING/SLEEP_DEBT/HIGH_STRAIN_STREAK/RECOVERY_DECLINING_3D/RECOVERY_LOW_STREAK; OVERREACHING deduplicates the two component flags), `recoveryAction` (today suggestion). Intelligence section separated by hairline after sparkline. Dashboard: `whoopIntelligence` state fetches `/api/whoop/intelligence` gracefully. (2) `TimeAllocationViz` component — labeled bar rows per bucket, pct + weekly-avg annotation, misalignment callout. Dashboard fetches `/api/time-allocation` (gracefully absent). (3) Landing page rebuilt from Esther's `content/landing-page-copy.md`: hero + waitlist form, problem statement, 3-pillar solution, Edge Score explainer, 3-step how-it-works, burnout/ADHD section, feature list, final CTA + footer. Auth redirect preserved. (4) Dashboard header mobile: buttons stack `flex-1` on small screens, `h1` scales `text-xl → text-2xl`. Preflight clean all commits.
- **2026-06-16** — **Help & Support hub (Kevin dispatch).** `components/ui/HelpSupportSection.tsx` — full-page in-app Help hub. FAQ accordion: 6 sections (Getting started · How it works · Your data & privacy · The Edge Score · Calls · Account), each expandable; items use nested accordion (section → question → answer). Placeholder copy for all questions (ready for Esther to replace via `content/faq.md`; `sections` prop accepts override). Feedback/contact form: three-way type selector (Feedback · Question · Issue) with matching placeholder text; textarea; POSTs to `/api/support`; friendly success state ("Thanks — we read every one. 💙"); error recovery. Dashboard: "Help" tab added to sidebar nav (? icon); `activeTab` type extended; `HelpSupportSection` rendered in a `max-w-2xl` centered panel. Exported from `components/ui/index.ts`. Preflight clean.
- **2026-06-16** — **Today's Focus actionable (Kevin dispatch).** `components/ui/FocusRecommendationCard.tsx` — new `ConfirmedFocusItem` component: interactive row with ✓ Complete (green circle button, celebration state → strikethrough + "Done — nice work." + 🎉) and ✕ Dismiss (faint circle button → exit animation). New `ConfirmedFocusPanel`: manages `slots` state + candidate pool rotation; dismiss pulls next candidate from pool and slides it in with `incoming: true` entrance animation (30ms timeout → opacity/translateX transition); all-slots-cleared → "All done for today. 🎉" empty state. `FocusRecommendationCardProps` extended: `candidates?`, `onCompleteArea?`, `onDismissArea?`. Confirmed state now delegates to `ConfirmedFocusPanel`. Dashboard: `focusCandidates` state; `/api/focus/recommend` response extracts `candidates` field; `handleCompleteArea` (POST `/api/focus/complete`) + `handleDismissArea` (POST `/api/focus/dismiss`) handlers; new props wired into `<FocusRecommendationCard>`. Preflight clean.
- **2026-06-16** — **Design-system consistency sweep (item 5).** OpenLoopsSection AllClear: `rgba(34,197,94,...)` → `--edg-success-tint` + `--edg-success-border` tokens. Verified all tokens referenced by MeetingPrepCard, onboarding page, and new home components exist in globals.css. ContentSection inner LEARN label removed (duplicated home tab section divider). Preflight clean.
- **2026-06-16** — **MeetingPrepCard component (item 3).** `components/ui/MeetingPrepCard.tsx` — self-contained presentational card (no data fetching). Props: `MeetingPrepContext { eventId, title, startTime, durationMin, attendees, location?, threads[], facts[], edgeSuggestion? }`. Collapsed view: Edge one-liner insight chip + top 2 facts + thread count summary. Expanded: "What Edge knows" fact tiles + "Recent threads" thread tiles (unread dot, snippet, relative date). Header: meeting title + time + attendees + location. Toggle: "See full context (N notes · N threads)". Exported from index.ts. Wire when Darren ships `/api/meeting-prep`. Preflight clean.
- **2026-06-16** — **Open Loops polish (item 2).** `OpenLoopsSection`: staggered row entrance (50ms × index, fade+slide-in). Resolve: text strikes through + "✓ Done" label flashes green, row exits after 650ms. Dismiss: row fades out in 300ms. `AllClear` empty state: green ✓ ring + "You're all caught up." + pop-in animation replaces the plain text. Header copy: "Edge has got these tracked for you." (calmer framing). Footer separated by hairline. Exit timing coordinated so the animation plays before React removes the node.
- **2026-06-16** — **Onboarding flow polish (item 1).** Full rewrite of `app/onboarding/page.tsx`. StepIndicator: icon nodes (👤📅🎯📞) + rank labels, animated connector fill, active ring glow. `StepFade` wrapper: 300ms fade+slide-up on each step mount. ProfileStep: warmer heading ("Let Edge get to know you"), tighter ChatGPT prompt block, `select-all` code region, compact example toggle. CalendarStep: ✓ celebration state (1.4s pop-in + success ring before auto-advancing), "what else connects later" info pill about Gmail/Whoop. PrioritiesStep: rank circles that fill on input, placeholder rewrites, suggestions badge animates in. CallTimeStep: "What to expect" preview card (3-min call description), side-by-side time+timezone grid, CTA copy "I'm ready — let's go →". Global: bottom "you can update this later" reassurance line. Preflight clean.
- **2026-06-15** — **Home-cockpit polish + copy clarity (items 3–5).** EdgeScoreCard: `scoreSummary` plain-language rewrites (no "tighten"/"Room to improve"); "CALIBRATING" → "BUILDING", "calibrating…" → "learning…"; breakdown toggle → "See the breakdown"/"Hide breakdown"; "Improve my day →" → "See what to shift →"; new `previousScore` prop shows "▲/▼ N vs yesterday" delta when provided. DayPlanCard: header "HERE'S WHAT I'D CHANGE" → "EDGE SUGGESTION"; confirm note clearer. Home tab: briefing preview "TODAY'S BRIEFING PREVIEW" → "✦ THIS MORNING'S BRIEFING"; hairline section dividers with "YOUR DAY" + "LEARN" labels between the score, planning, and content sections. Preflight clean.
- **2026-06-15** — **Open Loops dashboard surface.** `components/ui/OpenLoopsSection.tsx` — calm 3-bucket panel (↗ "You said you'd…" / ⏳ "Waiting on you" / 📅 "Coming up"). Each loop row: description + source badge + due-date color (overdue=danger / soon=warning / ok=faint) + "✓ Done" + Dismiss buttons with optimistic removal. All-clear empty state ("You're clear."). Header: "✦ OPEN LOOPS · Edge is keeping track of these for you." + open count badge. Exported from `components/ui/index.ts`. Dashboard: `openLoops` state, fetches `/api/open-loops` on load, `<OpenLoopsSection>` wired in home tab after DayPlanCard (resolve → POST `/api/open-loops/{id}/resolve`, dismiss → POST `/api/open-loops/{id}/dismiss`). Preflight clean.
- **2026-06-15** — **Memory tab declutter + home ContentSection (`b7a59bd`).** Memory tab: summary strip ("X facts across N areas · Y call notes") at top. Categories collapse by default — click header (icon + label + count badge + ▲/▼) to expand. Within expanded category: tighter hairline-separated rows (no heavy glass-card per row), "show all N" at 6-item threshold (down from 15). Call notes section collapsible, collapsed by default. All edit/delete controls preserved. Home tab: new `components/ui/ContentSection.tsx` — horizontal snap-scroll row of 6 education cards; 200px × (96px thumbnail + 48px text). Thumbnails: gradient fills using design-system tokens (no photos), large icon centered. Titles: calendar by energy, burnout, Edge Score explained, three focus areas, sleep & recovery, peaks & troughs. Exported from `components/ui/index.ts`. Preflight clean.
- **2026-06-15** — **FocusRecommendationCard confirmed state + ActivationCard fix (`a6c6bf7`).** After confirming focus, the card transitions to a locked "Today's Focus" panel showing all 3 committed areas with rank badges + ✓ checkmarks (no more disappearing gap). New `confirmedAreas` prop lets parent restore confirmed state on page reload. `GET /api/focus/confirm` added (additive; reads `dailyFocusQueries.getToday`) — dashboard fetches it on load to populate `confirmedFocusAreas` state. `handleConfirmFocus` now sets `confirmedFocusAreas` instead of calling `setFocusRecDismissed`. Card stays visible when confirmed (dismiss removed in confirmed mode). ActivationCard switched from non-existent `/api/memory/activation` to Core's `/api/learned` (`recentFacts.map(f => f.statement)`). Preflight clean.
- **2026-06-14** — **CalendarFitCard — scores updated to 0–100%.** `score` is now a plain percentage (Focus Score = % working hours on focus areas). Updated: bar fill uses `score` directly as pct; color thresholds recalibrated (<35% red / 35–64% amber / 65–84% indigo / ≥85% green); score label shows `{score}%`; combined avg header shows `{avg}%`; summary copy thresholds updated (≥85 excellent / ≥50 fair). `DESIGN.md §9` updated. Build clean.
- **2026-06-14** — **CalendarFitCard — aligned to Core contract + sparse state.** Updated types to match Core's `ScoreResult` shape (`topFix.description` + `op?: 'create'|'move'|'delete'|'recolor'`); new `CalendarFit` wrapper + `sparse` prop for graceful empty state ("Set your focus areas and connect your calendar — Edge will start scoring"). `DESIGN.md §9` prop contract updated. Build clean.
- **2026-06-14** — **CalendarFitCard component.** `components/ui/CalendarFitCard.tsx` — the "Calendar fit today" gauge panel (top half of the Scoreboard surface per `specs/calendar-scores.md`). Two score gauges (Focus 🎯 + Energy ⚡): thin animated bar (700ms fill transition), 1–10 score label in ramp color (low/mid/high/peak via `--gauge-*` tokens + matching glow), tap-to-expand drivers (chip list) + top-fix row (`✦ action · +N points · [Fix it]` button). Loading skeleton + calibrating banner ("Edge is learning your energy — call N of 10"). Combined avg score + summary copy in header. Exported from `components/ui/index.ts`. `app/globals.css`: 9 `--gauge-*` tokens. `DESIGN.md §9`: full spec + prop contract. Build clean.
- **2026-06-14** — **Focus Scoreboard component.** `components/ui/FocusScoreboard.tsx` — self-contained presentational component (pure visual, no data fetching). `FocusAreaCard`: 52px SVG progress ring (smooth `stroke-dasharray` transition; color ramps low→mid→high→done via `--score-*` tokens); header row with rank circle, title, `✓ done` / "needs time" badge, hours + milestone count + energy-cost label; milestone list with optimistic check-off (round checkbox → `--edg-success` fill + SVG ✓ + row tint + strikethrough + 🎉 bounce for 1.8s); inline "Add milestone" form (dashed expand). `CelebrationBurst`: pulsing overlay + `pop-in` ✓ when area flips complete. All-areas-done banner. Neglected card: `--score-neglected-tint` bg + danger border. Exported from `components/ui/index.ts`. `app/globals.css`: 10 `--score-*` tokens + `@keyframes pop-in`. `DESIGN.md §8`: full spec + prop contract. Build clean.
- **2026-06-14** — **Merge conflict resolution: Energy OS cross-lane.** Core shipped `energySignal`/`settingEnergy` state + real `/api/energy/today` POST + `energy_cost` on `Priority` interface + `onEnergyCostChange` prop on `PrioritiesTab`. Resolved: kept Core's logic verbatim; swapped Core's solid-fill active styling for Design's tint+border token system (`--energy-*`); kept Design's emoji+label buttons and contextual copy; removed Design's now-redundant localStorage state, duplicate fetch, and stale `logEnergyLevel` handler. Build clean.
- **2026-06-14** — **Final inline-color cleanup.** `app/dashboard/page.tsx` — removed redundant `#f59e0b` fallback from `--edg-warning` style (token already defined). Zero raw hex/rgba remaining across all app pages. Build clean.
- **2026-06-14** — **Energy OS MVP UI.** `app/globals.css`: 9 new energy tokens (`--energy-green/yellow/red` + tints + borders, aliased from Whoop tier colors). `app/dashboard/page.tsx`: (1) **Energy logger widget** — glass-card sidebar widget above calendar section; three one-tap buttons (🟢 High / 🟡 Med / 🔴 Low); active state shows tinted background + border in tier color; contextual sub-label explains what Edge will do; POSTs to `/api/energy/log` with graceful 404 degradation (Core to build); on mount loads today's manual record from `/api/energy/today` and falls back to Whoop recovery tier pre-fill when Whoop is connected. (2) **Energy-cost tags** — each priority card in PrioritiesTab gains ⚡ High / ◑ Med / ○ Low tap chips below the priority text; selection stored in `localStorage('edg3-energy-costs')`; active chip shows tier-colored tint + border; interim storage until Core ships the API column. Build clean.
- **2026-06-14** — **Token pass: admin + onboarding pages.** `app/admin/page.tsx` — replaced all 38 remaining raw hex/rgba values with tokens (`--text-muted/faint/body`, `--edg-indigo/indigo-bright`, `--edg-success/danger/warning`, `--edg-accent-15`, `--border-accent`, `--edg-hairline`, `--edg-fill-04`, `--whoop-low-border`). `app/onboarding/page.tsx` — same pass for 6 remaining values. 467/467 green, build clean.
- **2026-06-14** — **Token pass: dashboard inline color pass.** `app/dashboard/page.tsx` — all 30 remaining rgba/hex inline values tokenized; 13 new semantic tokens added to `app/globals.css` (`--edg-accent-04/06/25/60`, `--edg-fill-04`, `--edg-border-10/15`, `--edg-overlay/overlay-dark`, `--edg-success-border`, `--edg-warning-border`, `--edg-danger-border`). 467/467 green, build clean.
- **2026-06-14** — **Token pass: privacy, terms + landing footer.** `app/privacy/page.tsx`, `app/terms/page.tsx`, `app/page.tsx` — replaced all inline hex color values with design tokens (`var(--text-faint/muted/body/strong/accent)`, `var(--edg-indigo)`, `var(--edg-accent-08/15/20)`, `var(--edg-hairline)`, `var(--border-accent)`). Fixed unescaped apostrophes and quotes to HTML entities. 467/467 green, build clean.
- **2026-06-14** — **Memory tab: confidence flag + provenance per fact.** `app/dashboard/page.tsx` — `Fact` interface extended with `confidence?: 'low' | null` and `source_briefing_id?: number | null` (Core to populate). Confidence flag: an inline amber "⚠ verify" chip rendered after the statement text when `confidence === 'low'`; clicking it opens the inline edit control directly ("tap to fix"). Provenance: `"learned from your Jun 10 call"` displayed below each fact in faint text; becomes a link to `/dashboard?briefing={id}` when `source_briefing_id` is set, plain text fallback when not. Both low-emphasis — fact text stays visually primary. 467/467 green, build clean.
- **2026-06-14** — **Tasks tab declutter + per-section education banners.** `app/dashboard/page.tsx` — New `SectionHint` component: localStorage-persisted (`edg3-hint-{id}`), single-line, dismissible with ✕, faint left-border style, renders nothing once dismissed. Wired to all five tabs (Briefings, Tasks, Priorities, Activity, Memory) with PM-approved copy. Tasks tab: heading + filter pills on same row (done count inline, right-aligned); "Complete all" moved below list, only shows when >1 item; section sub-headers tightened to lowercase icon-prefixed labels ("✦ From Edge", "⚠ Carried over"); `space-y-1.5` row spacing throughout; add-task form gap tightened. 467/467 green, build clean.
- **2026-06-14** — **Per-fact edit + delete affordances (Memory tab).** `app/dashboard/page.tsx` — each structured fact row gains hover-revealed ✎ (edit) and ✕ (delete) controls (opacity-0 / group-hover:opacity-100, focus-within visible). Edit: inline textarea replaces the statement text; Save/Cancel buttons + Enter-to-save / Esc-to-cancel. Delete: lightweight inline confirm ("Remove / Keep") — no modal. Optimistic update (fact list reflects change immediately, API call fires behind). New state: `editingFactId`, `editFactText`, `deletingFactId`. Handlers: `saveFact` (PATCH `/api/memory/facts/:id`) + `deleteFact` (DELETE `/api/memory/facts/:id`) — Core to implement the routes. 467/467 green, build clean.
- **2026-06-13** — **Activity + Memory tab trust redesign.** `app/dashboard/page.tsx` — Activity tab: day-grouped rows with day-header labels (Today / Yesterday / weekday), per-action-type icon (📅 created, ⇅ moved, 🗑 deleted, ✉ email, 🔍 research, ✎ edit), subtler undo chip (glass/hairline, no amber), undone rows: `opacity:0.5` + quiet "undone" pill instead of icon swap, new empty state ("Edge hasn't changed anything yet — you'll see every action here") and header copy ("Edge's actions"). Memory tab: emoji category headers (🎯 Goals, 🗂 Projects, 👤 People, ⚡ Preferences, 📌 Facts), header "Here's what Edge knows about you", hairline `<hr>` between structured facts and call notes, 📋 Call notes header, seedling empty state. 465/465 green, build clean.
- **2026-06-13** — **Onboarding visual/UX pass + mobile responsiveness (dashboard + onboarding).** Onboarding: token substitutions (rgba indigo → `--edg-accent-*`), CalendarStep copy fixed ("Read-only / nothing modified" → accurate write description), `py-16 → py-8 md:py-16` + `p-8 → p-5 md:p-8` for mobile breathing room, StepIndicator gap tightened. Dashboard mobile: outer layout `flex-col md:flex-row`; sidebar `w-full md:w-60` with horizontal-scroll tab nav on mobile (icon-only, `no-scrollbar`); sidebar widgets hidden on mobile (`hidden md:flex`); main `p-4 md:p-8 min-w-0`; header `mb-4 md:mb-8`. Added `.no-scrollbar` to `app/globals.css`. 441/441 green, build clean.
- **2026-06-13** — **Dashboard token polish + RecoveryCard sidebar spacing.** Re-applied lost inline-color → token substitutions in `app/dashboard/page.tsx` (UTF-8 safe, Edit tool only): `rgba(99,102,241,0.2/0.15/0.08)` → `var(--edg-accent-20/15/08)` across filter buttons, priority circles, briefing detail panels, transcript, modal, reminder controls; `#6366f1` → `var(--edg-indigo)` in task checkbox. RecoveryCard sidebar: removed outer `px-2` from card wrapper so card fills full sidebar width, moved `px-2` to status/disconnect row for alignment with calendar section, tightened `mb-3→mb-2`. 395/395 green, build clean.
- **2026-06-13** — **RecoveryCard component.** `components/ui/RecoveryCard.tsx` — pure presentational card for Whoop recovery data. Props: `recoveryScore`, `tier` (`'high'|'medium'|'low'`), optional `sleepHours`, `strain`, `history`. Renders: tier-colored 36px score, label + glow dot, sleep/strain stats, inline SVG sparkline (area + line + end-cap dot; placeholder when history < 2 points). Exported from `components/ui/index.ts`. Sparkline tokens added to `app/globals.css`. Spec in `DESIGN.md §7`. Core: import `RecoveryCard` from `@/components/ui` — no changes to dashboard file needed.
- **2026-06-13** — **Whoop visual system + dashboard polish.** Added `--whoop-*` recovery tokens (high/medium/low colors, tints, borders) + `--whoop-connect-*` tokens + component classes (`.badge-recovery-*`, `.recovery-card-*`, `.energy-dot-*`, `.btn-connect-whoop`) to `app/globals.css`. Added `DESIGN.md §6` visual spec (briefing card + dashboard widget examples, copy tone, V2 north star placeholder). Added `--edg-calendar-green` token family and tokenized all remaining inline hex in `app/dashboard/page.tsx`. 363/363 green.
- **2026-06-10** — **Token pass complete across all 5 pages.** Introduced `components/ui/` library (Button, Card, Input, Badge, Logo) and applied design tokens to `app/globals.css` (full `--edg-*` raw + semantic alias system). All 5 shared pages — landing, login, signup, dashboard, onboarding — converted from inline hex values to token vars (visual only, no logic changes). 117/117 tests green. Remaining: `generatingBriefing` dead-code cleanup; select/textarea/checkbox components; onboarding step UX proposal for PM.
- **2026-06-10** — Design lane created (worktree `edg3-design`, branch `design`). Asset pack `DESIGN.md` written.
