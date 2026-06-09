# 🛠️ EDG3 — Master Builder Lane

> Backlog for the **Edg3 Master Builder** session (features / product). Governed
> by the shared [`ROADMAP.md`](ROADMAP.md) constitution — read that first
> (ownership map, worktree isolation, merge protocol). Work on branch `builder`
> in `C:\Users\Derrick\edg3-builder`. Update this changelog in the same commit
> that ships work, and claim files in the constitution's Status Board before
> touching anything in the ⚠️ Shared list.

## Changelog
- **2026-06-09** — Lane created. Mandate set: ship new user-facing features for
  the Edg3 voice/calendar assistant. Backlog below is a **seed** — refine with
  real priorities before deep work.

---

## Mandate
Ship new **user-facing features** for the Edg3 voice + calendar assistant —
improving the dashboard, briefing, calendar, and onboarding experiences. Move
product value fast while staying inside the Builder ownership lane (constitution
§3); hand anything touching auth/secrets/infra to the Security lane.

## How priorities are ranked
By user-visible value shipped per day, inside the Builder-owned surface.

## Backlog (seed — confirm/re-rank with the user)
### Now
- [ ] _First feature — to be chosen with the user._

### Next (candidate ideas, not yet committed)
- [ ] Dashboard: surface "Recent activity" / what Edge did, so users can see and trust actions.
- [ ] Onboarding: smoother first-run (connect calendar → first briefing) flow.
- [ ] Briefing: richer briefing content / personalization controls.
- [ ] Calendar: better event review & edit UX from the dashboard.

### Later
- [ ] _…_

> These candidates are grounded in the existing app surface (`app/dashboard`,
> `app/onboarding`, `app/api/briefing`, `app/api/calendar`). They are starting
> points — replace with the user's actual priorities.

---

## Guardrails for this lane
- Stay in the Builder-owned files (constitution §3). For `lib/db.ts` schema
  changes, follow the Shared-file protocol (§5).
- New writes that create calendar events must be **idempotency-aware** — coordinate
  with Security's item #3 so features don't reintroduce duplicate-on-retry bugs.
- Don't weaken any destructive-action confirmation or undo behavior the Security
  lane has shipped.
