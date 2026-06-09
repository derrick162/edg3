# EDG3 — Coordination Constitution (read me first)

> **This file is the shared constitution for every EDG3 session.** It is
> auto-loaded into every session via `CLAUDE.md`. It does **not** hold the task
> backlog — it defines *how the parallel lanes work together without colliding*.
> The product manager routes feedback into the right lane; engineers build only
> in their lane. The work lives in two lane roadmaps:
>
> - 🛠️ **[`ROADMAP-CORE.md`](ROADMAP-CORE.md)** — the Core (features/product) lane.
> - 🔒 **[`ROADMAP-SECURITY.md`](ROADMAP-SECURITY.md)** — the Security & Reliability lane.
>
> Read this constitution, then read **only your own lane's roadmap**. Do not plan
> from memory or from `docs/EDG3-Roadmap.xlsx` — **that spreadsheet is deprecated.**

We optimize for **speed through isolation**: each lane runs flat-out in its own
worktree and branch, and integrates to `master` in small, frequent merges.

---

## 0. Roles
- **Product Manager (you + the Chief-of-Staff session)** — takes product feedback
  from the user, decides which engineer/lane owns it, writes it into that lane's
  roadmap, and keeps the lanes from colliding. Does not write feature code.
- **Core Engineer** — builds user-facing product (see `ROADMAP-CORE.md`).
- **Security & Reliability Engineer** — builds trust/secrets/infra (see `ROADMAP-SECURITY.md`).

## 1. Who am I? (pick your lane)
| If your session is… | Lane | Roadmap | Branch | Worktree folder |
|---|---|---|---|---|
| **Edg3 Engineer (Core)** | 🛠️ Core | `ROADMAP-CORE.md` | `core` | `C:\Users\Derrick\edg3-core` |
| **Edg3 Engineer (Security & Reliability)** | 🔒 Security | `ROADMAP-SECURITY.md` | `security` | `C:\Users\Derrick\edg3-security` |
| **Product Manager / coordinator** | — | this file | `master` | `C:\Users\Derrick\edg3` |

If you don't know which you are, **stop and ask the user** before editing anything.

---

## 2. Isolation — git worktrees (the #1 rule)
**Never run two lanes in the same working directory.** Each lane gets its own
worktree (separate folder, separate branch, one underlying repo). One-time setup,
run from `C:\Users\Derrick\edg3`:

```powershell
git worktree add ../edg3-core     -b core
git worktree add ../edg3-security -b security
```

Then point each desktop-app session at its own folder. After that, a lane only
ever edits files inside **its own** worktree folder.

## 3. Ownership map (who owns which files)
Stay in your lane's files — this is what makes parallel work conflict-free.

**🛠️ Core owns** — the product / feature surface:
- `lib/calendar.ts`, `lib/briefing.ts`, `lib/eventMatch.ts`, `lib/time.ts`
- `lib/outreach.ts` — email **composition** (body, availability formatting, recipient filtering); calls Security's `lib/gmail.ts` to actually create the draft.
- `app/dashboard/**`, `app/onboarding/**`
- `app/api/briefing/**`, `app/api/calendar/**`, `app/api/memory/**`, `app/api/profile/**`, `app/api/tasks/**`, `app/api/onboarding/**`, `app/api/undo/**` (the *user-facing* side)
- New UI, new product flows

**🔒 Security & Reliability owns** — the trust / secrets / infra surface:
- `lib/auth.ts`, `lib/crypto.ts`, `lib/vapi.ts`, `lib/scheduler.ts`, `lib/undo.ts` (the *recording* side)
- `lib/gmail.ts` + `lib/google-auth.ts` — Gmail **access primitive** (guarded `createDraft`, scope authority, rate limit, audit). Core composes; Security executes the send/draft. _(Resolves the 2026-06-09 dual-`gmail.ts` collision.)_
- `app/api/auth/**`, `app/api/admin/**`, `app/api/vapi/**`
- `app/login/**`, `app/admin-login/**`, `app/signup/**`
- Cross-cutting: rate limiting, encryption-at-rest, audit logging, idempotency, backups/durability

**⚠️ Shared — coordinate before touching** (see §5):
- `lib/db.ts` (schema — both lanes add tables/columns)
- `app/api/vapi/tool-call/route.ts` and `lib/vapi.ts` — **Core owns the calendar tool *behavior*** (the `createEvent`/`moveEvent`/etc. handlers + the tool/system-prompt guidance); **Security owns the *auth/secret + webhook integrity*** of these same files.
- `CLAUDE.md`, `AGENTS.md`, this `ROADMAP.md`, both lane roadmaps' structure
- Anything not clearly in one lane above

## 4. Integration — small, frequent, direct merges
1. Commit **small** and often on your own branch.
2. Before merging up, sync down (`git merge master` into your branch) so conflicts surface while they're tiny.
3. Merge your branch to `master` **as soon as a unit of work is green** — don't batch a day's work into one giant merge. Small batches = trivial conflicts.
4. `master` is the source of truth. If your branch and `master` disagree, `master` wins; rebase/merge on it.
5. Update **your lane roadmap's changelog** in the same commit that ships the work.

## 5. Shared-file protocol
For anything in the ⚠️ Shared list:
1. **Claim it** in the Status Board (§6) before editing.
2. Prefer **additive** changes (new column, new function) over rewrites.
3. Merge to `master` **immediately** after, then have the PM tell the other lane to sync down.
4. Tie-breaks: Security wins on security-sensitive files; Core wins on feature files; the PM breaks any remaining tie.

## 6. Status Board (live — keep it current)
Each lane edits **only its own row** when it starts/stops a unit of work, so the
other lane and the PM can see live ownership claims.

| Lane | Branch | Now working on | Touching files | Updated |
|---|---|---|---|---|
| 🛠️ Core | `core` | _(idle — ✅ `draftEmail` MERGED to master & green (61/61). Email feature is code-complete. Remaining = go-live config, not code: deploy + create the `draftEmail` Vapi tool + user re-consents Google.)_ | — | 2026-06-09 |
| 🔒 Security | `security` | _(idle — Gmail primitive + encryption + backups all merged to master & green. Next: #2 Vapi secret.)_ | — | 2026-06-09 |

> **★ Email feature go-live checklist (code done — these remain):**
> 1. Set `DATA_ENCRYPTION_KEY` on Railway (activates at-rest encryption; no-op until set).
> 2. Deploy master to production.
> 3. Create the `draftEmail` tool in the Vapi dashboard (params below) + add its tool ID in `lib/vapi.ts:188`.
> 4. User re-consents Google (reconnect account → grants Gmail).
> 5. `draftEmail` Vapi params: `recipients` (array of {name, email}), `ask` (string), `proposeAvailability` (boolean), `startDate` (string/date), `endDate` (string/date), `subject` (string, optional).

---

## Changelog
- **2026-06-09** — **INCIDENT (resolved in ~15 min): all calls failing** with
  `anthropic-400-bad-request-validation-failed` right after adding the `draftEmail`
  Vapi tool. Cause: the Vapi tool editor injected `"default": ""` on every param,
  including a `boolean` (`proposeAvailability`) — an empty-string default on a
  boolean is an invalid input_schema, and since all tools are sent to the model
  every call, one bad tool broke every call. Fix: stripped the `default` fields
  from the tool via the Vapi API (no redeploy). **Learning / potential Core hardening:**
  any tool authored in the Vapi editor carries `default:""` cruft — sanitize tool
  schemas (strip empty/`type`-mismatched defaults) before they reach Anthropic.
- **2026-06-09** — **Email feature DEPLOYED.** Pushed master to production (Railway)
  and wired the `draftEmail` Vapi tool ID (`e62078db…`) into `lib/vapi.ts`. Also
  set `DATA_ENCRYPTION_KEY` on Railway (encryption now active). **Remaining for the
  user:** reconnect Google (grant Gmail) + test on a call.
  ⚠️ **NEW Core ticket — privacy policy is inaccurate & blocks Gmail verification:**
  `app/privacy/page.tsx:45` claims calendar access is "read-only" and Edge "never
  modifies/deletes" events — but the app has `calendar.events` write scope and
  creates/moves/deletes events. It also says nothing about **Gmail**. Must be
  corrected to reflect actual calendar read-write use + Gmail draft creation
  (required for Google OAuth verification + basic accuracy). Route to Core.
- **2026-06-09** — **Email drafting feature is code-complete & merged to master,
  green (61/61, tsc clean).** Full pipeline: Core composition (`lib/outreach.ts`)
  → Security guarded draft-only `createDraft` (`lib/gmail.ts` + `lib/google-auth.ts`)
  → `draftEmail` tool wired in `tool-call/route.ts` + `lib/vapi.ts`, undo via
  `deleteDraft`. Resolved the dual-`gmail.ts` collision (Security owns the access
  primitive; Core owns composition in `lib/outreach.ts`). Remaining = go-live
  config (see checklist above): deploy, create the Vapi `draftEmail` tool, user
  re-consents Google.
- **2026-06-09** — User added the all-day tool params (`endDate` on createEvent;
  `newStartDate`/`newEndDate` on moveEvent) in the Vapi dashboard → the multi-day
  all-day fix is now **fully live**, pending a confirming voice-call test.
- **2026-06-09** — Core's first two tickets (multi-day all-day + research-replace)
  **merged to master & verified green** (tsc clean, 33/33 tests). One external
  step remains for the user: add the new tool params (`endDate` on createEvent,
  `newStartDate`/`newEndDate` on moveEvent) in the **Vapi dashboard** — they live
  there, not in the repo. Route degrades safely until then. Email drafting is the
  new top priority (Security Gmail scope gates it).
- **2026-06-09** — Established the PM + two-engineer model. Renamed the features
  lane to **Core** (branch `core`, folder `edg3-core`, `ROADMAP-CORE.md`).
- **2026-06-09** — Split the single roadmap into two lanes governed by this
  constitution. Adopted git-worktree isolation (one folder + branch per lane) and
  small/frequent direct merges to `master`.
