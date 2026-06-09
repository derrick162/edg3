# 🛠️ EDG3 — Core Lane (features / product)

> Backlog for the **Edg3 Engineer (Core)** session. Governed by the shared
> [`ROADMAP.md`](ROADMAP.md) constitution — read that first (ownership map,
> worktree isolation, merge protocol). Work on branch `core` in
> `C:\Users\Derrick\edg3-core`. Update this changelog in the same commit that
> ships work, and claim files in the constitution's Status Board before touching
> anything in the ⚠️ Shared list. The PM routes new product feedback into the
> backlog below.

## Changelog
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
- [ ] **Multi-day all-day events + ability to edit/fix them** — _from a real user call, 2026-06-09._
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
- [ ] **Research notes should replace, not pile up** — _from a real user call, 2026-06-09 (Hong Kong gyms w/ sauna)._
  - **Symptom:** Re-running research on an event stacks the new findings on top of the old research. Notes should show only the newest / most relevant, not an accumulating pile.
  - **Root cause:** `researchToEvent` (`app/api/vapi/tool-call/route.ts:268`) always appends — `description: e.description ? \`${e.description}\n\n${block}\` : block`. No replace/dedupe of prior research.
  - **Fix:** Wrap each research block in a recognizable delimiter (e.g. a marker header). On every research call, strip any prior research block(s) and write only the fresh findings, while **preserving the user's own (non-research) notes** in the description. Keep the existing "most relevant first, up to 6" prompt.
  - **Acceptance:** Researching the same event twice → description shows only the latest research plus any user-typed notes; no duplicated/stacked piles.
  - **Coordination:** same Shared file as the all-day ticket (`tool-call/route.ts`) — batch them; both touch event description/creation logic.

### Next (decided)
- [ ] **"Recent activity" review surface** — _PM decision 2026-06-09. Root-cause fix for the recurring "Edge's edits are messy" trust problem._
  - **Why:** The user keeps discovering messy calendar edits mid-call (duplicate all-day events, piled-up research). A dashboard feed of what Edge did — with one-tap undo/correct — turns silent frustration into something visible and fixable.
  - **Scope:** Dashboard view listing recent actions Edge took (newest first): what changed, when, on which event, with an **Undo** affordance per row (reuse the existing `undo_log` inverse ops shipped in `28f364d`).
  - **Dependency (cross-lane):** wants a clean, append-only activity feed as its data source → **Security item #7 (harden audit log: before/after snapshots, append-only table)**. Two-phase: Security #7 builds the backbone, Core builds the view on top. A quick v0 can read the current `undo_log` if we want something shippable before #7 lands.
  - **Acceptance:** From the dashboard the user can see the last N actions Edge took and undo any one of them without a voice call.

- [ ] **Travel price lookup (flights + hotels) → trip event** — _PM decision 2026-06-09, user request._
  - **Goal:** On a call, Edge looks up **real** flight/hotel prices and saves the options to a calendar trip event. Voice flow: "What are flights to Hong Kong on June 25?" → Edge fetches options → reads them back → attaches them to a trip event.
  - **Data source (decided):** a real travel-pricing API, **not** web search — fares must be quotable with confidence. Candidate: **Amadeus Self-Service** (flight offers search + hotel search, free test tier). Wrap in a new `lib/travel.ts`.
  - **New tool:** `researchTravel` in `tool-call/route.ts` — params: `type` (flight|hotel), `origin`, `destination`, `departDate` (YYYY-MM-DD), `returnDate?`, `passengers?`, `nights?`. Format results as clean plain-text (reuse the `researchToEvent` note-cleaning), then patch onto a trip event (create one if none exists) via the same `recordUndo` path.
  - **Trust:** only quote prices the API returned — keep the "NEVER INVENT TRAVEL FACTS" guardrail (now Edge can cite the API). Include currency and a "fetched <date>" stamp since fares change. Follows the research-replace rule (don't pile up stale quotes).
  - **Coordination (Security):** introduces a new external API credential (`AMADEUS_*`) → **Security owns provisioning + securing the secret, env config, and a rate-limit/cost guardrail** (these calls cost money / are rate-limited). Coordinate before merging. Also touches the Shared `tool-call/route.ts`.
  - **Acceptance:** "Find flights to Hong Kong June 25 returning July 2" → Edge returns real fare options sourced from the API, timestamped, saved to a HK trip event. Re-running replaces stale quotes rather than stacking them.
  - **Effort:** ~2–4d.

### Later / candidates (not yet committed)
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
