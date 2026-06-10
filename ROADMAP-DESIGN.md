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
- **2026-06-10** — **Token pass complete across all 5 pages.** Introduced `components/ui/` library (Button, Card, Input, Badge, Logo) and applied design tokens to `app/globals.css` (full `--edg-*` raw + semantic alias system). All 5 shared pages — landing, login, signup, dashboard, onboarding — converted from inline hex values to token vars (visual only, no logic changes). 117/117 tests green. Remaining: `generatingBriefing` dead-code cleanup; select/textarea/checkbox components; onboarding step UX proposal for PM.
- **2026-06-10** — Design lane created (worktree `edg3-design`, branch `design`). Asset pack `DESIGN.md` written.
