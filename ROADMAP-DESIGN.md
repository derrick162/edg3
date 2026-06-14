# 🎨 EDG3 — Design Lane (UX/UI)

> Backlog for the **Edg3 UX/UI Designer** session. Governed by the shared
> [`ROADMAP.md`](ROADMAP.md) constitution — read it first (ownership map, worktree
> isolation, merge protocol). Your full asset pack is **[`DESIGN.md`](DESIGN.md)**.
> Work on branch `design` in `C:\Users\Derrick\edg3-design`. Update this changelog in
> the same commit that ships work, and claim Shared page-UI files in the constitution's
> Status Board (§6) before editing them.

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
- **2026-06-13** — **Activity + Memory tab trust redesign.** `app/dashboard/page.tsx` — Activity tab: day-grouped rows with day-header labels (Today / Yesterday / weekday), per-action-type icon (📅 created, ⇅ moved, 🗑 deleted, ✉ email, 🔍 research, ✎ edit), subtler undo chip (glass/hairline, no amber), undone rows: `opacity:0.5` + quiet "undone" pill instead of icon swap, new empty state ("Edge hasn't changed anything yet — you'll see every action here") and header copy ("Edge's actions"). Memory tab: emoji category headers (🎯 Goals, 🗂 Projects, 👤 People, ⚡ Preferences, 📌 Facts), header "Here's what Edge knows about you", hairline `<hr>` between structured facts and call notes, 📋 Call notes header, seedling empty state. 465/465 green, build clean.
- **2026-06-13** — **Onboarding visual/UX pass + mobile responsiveness (dashboard + onboarding).** Onboarding: token substitutions (rgba indigo → `--edg-accent-*`), CalendarStep copy fixed ("Read-only / nothing modified" → accurate write description), `py-16 → py-8 md:py-16` + `p-8 → p-5 md:p-8` for mobile breathing room, StepIndicator gap tightened. Dashboard mobile: outer layout `flex-col md:flex-row`; sidebar `w-full md:w-60` with horizontal-scroll tab nav on mobile (icon-only, `no-scrollbar`); sidebar widgets hidden on mobile (`hidden md:flex`); main `p-4 md:p-8 min-w-0`; header `mb-4 md:mb-8`. Added `.no-scrollbar` to `app/globals.css`. 441/441 green, build clean.
- **2026-06-13** — **Dashboard token polish + RecoveryCard sidebar spacing.** Re-applied lost inline-color → token substitutions in `app/dashboard/page.tsx` (UTF-8 safe, Edit tool only): `rgba(99,102,241,0.2/0.15/0.08)` → `var(--edg-accent-20/15/08)` across filter buttons, priority circles, briefing detail panels, transcript, modal, reminder controls; `#6366f1` → `var(--edg-indigo)` in task checkbox. RecoveryCard sidebar: removed outer `px-2` from card wrapper so card fills full sidebar width, moved `px-2` to status/disconnect row for alignment with calendar section, tightened `mb-3→mb-2`. 395/395 green, build clean.
- **2026-06-13** — **RecoveryCard component.** `components/ui/RecoveryCard.tsx` — pure presentational card for Whoop recovery data. Props: `recoveryScore`, `tier` (`'high'|'medium'|'low'`), optional `sleepHours`, `strain`, `history`. Renders: tier-colored 36px score, label + glow dot, sleep/strain stats, inline SVG sparkline (area + line + end-cap dot; placeholder when history < 2 points). Exported from `components/ui/index.ts`. Sparkline tokens added to `app/globals.css`. Spec in `DESIGN.md §7`. Core: import `RecoveryCard` from `@/components/ui` — no changes to dashboard file needed.
- **2026-06-13** — **Whoop visual system + dashboard polish.** Added `--whoop-*` recovery tokens (high/medium/low colors, tints, borders) + `--whoop-connect-*` tokens + component classes (`.badge-recovery-*`, `.recovery-card-*`, `.energy-dot-*`, `.btn-connect-whoop`) to `app/globals.css`. Added `DESIGN.md §6` visual spec (briefing card + dashboard widget examples, copy tone, V2 north star placeholder). Added `--edg-calendar-green` token family and tokenized all remaining inline hex in `app/dashboard/page.tsx`. 363/363 green.
- **2026-06-10** — **Token pass complete across all 5 pages.** Introduced `components/ui/` library (Button, Card, Input, Badge, Logo) and applied design tokens to `app/globals.css` (full `--edg-*` raw + semantic alias system). All 5 shared pages — landing, login, signup, dashboard, onboarding — converted from inline hex values to token vars (visual only, no logic changes). 117/117 tests green. Remaining: `generatingBriefing` dead-code cleanup; select/textarea/checkbox components; onboarding step UX proposal for PM.
- **2026-06-10** — Design lane created (worktree `edg3-design`, branch `design`). Asset pack `DESIGN.md` written.
