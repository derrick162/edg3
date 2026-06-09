# 🔒 EDG3 — Security & Reliability Lane

> Backlog for the **Edg3 Security & Reliability** session. Governed by the shared
> [`ROADMAP.md`](ROADMAP.md) constitution — read that first (ownership map,
> worktree isolation, merge protocol). Work on branch `security` in
> `C:\Users\Derrick\edg3-security`. Update this changelog in the same commit that
> ships work, and claim files in the constitution's Status Board before touching
> anything in the ⚠️ Shared list.

## Changelog
- **2026-06-09** — Shipped **#6 Undo** (commit `28f364d`): every mutation records
  inverse ops in a new `undo_log`; reversible by voice (`undoLastAction`) and
  dashboard. H3 now ✅. Defused **#1 JWT fallback** in code (`lib/auth.ts` fails
  closed — throws if `JWT_SECRET` unset, no public default). **Ops follow-up
  still open:** rotate `JWT_SECRET` on Railway (invalidates existing sessions).
- **2026-06-09** — Roadmap re-derived from a verified code audit (not the
  spreadsheet). Re-ranked around trust + cost-to-fix. Added the JWT fallback
  landmine as the new #1 (previously unlisted). Confirmed H6 done, C2 mitigated,
  M4 mostly handled.

---

## How priorities are ranked
By (a) armed landmines that are cheap to defuse, (b) highest-frequency real
user-trust failure, then (c) genuine gaps. Effort is rough dev-days.

## Verified status of prior audit findings
| ID | Item | Verified state |
|----|------|----------------|
| C1 | Vapi webhook auth | ⚠️ Built but **fail-open** — `checkVapiSecret` accepts mismatches unless `VAPI_SECRET_ENFORCE=true`. See `lib/vapi.ts:36`. |
| C2 | Unauthorized/cross-user mutation | ✅ Mitigated — user is bound server-side via `call.id → briefing.user_id`. Model can't pick the user. |
| C3 | Idempotency on writes | ❌ Absent — `createEvent` inserts directly. Retries/double-calls duplicate. |
| H1 | Token encryption | ❌ Plaintext `calendar_tokens` (`lib/db.ts:75`). |
| H2 | Action audit log | ⚠️ Partial — `tool_actions` JSON exists but mutable, capped 50, no before/after snapshots. |
| H3 | Undo last action | ✅ Done (`28f364d`) — `undo_log` records inverse ops on every mutation; reversible via `undoLastAction` (voice) + dashboard banner. |
| H4 | Rate limiting | ❌ Absent on all endpoints. |
| H5 | Backups / PITR | ❌ SQLite single volume; needs Litestream/snapshots (not RDS-PITR). |
| H6 | Destructive confirmation | ✅ Done (`tool-call/route.ts:350`); soft spot: model could self-confirm. |
| M4 | Timezone/recurring | ✅ Mostly handled — IANA passed + validated everywhere. |
| — | **JWT fallback secret** | ✅ Fixed in code — `lib/auth.ts` fails closed (throws if `JWT_SECRET` unset, no public default). ⚠️ **Ops:** still rotate the secret on Railway. |
| — | Transcript PII | 🔴 `briefings.transcript` stored plaintext — bigger surface than tokens. |
| — | Retry reliability | ⚠️ `retryCall` uses in-process `setTimeout(10m)` — lost on deploy/restart. |

---

## 30-Day plan

### Week 1 — Defuse landmines (cheap, catastrophic if left)
- [x] **1. Remove JWT fallback** → code fails closed (throws if `JWT_SECRET` unset). _Ops follow-up: rotate the secret on Railway._ _½d_
- [ ] **2. Enforce Vapi secret** — confirm Vapi sends `x-vapi-secret`, then set `VAPI_SECRET_ENFORCE=true` (keep fail-open log 24h first). _½d_
- [ ] **3. Idempotency** on `createEvent` / `createRecurringEvent` / `copyDayEvents` — dedupe key per (user, title-hash, start-minute) + TTL. _1–2d_
  - ⚠️ **Coupled to Core's multi-day all-day rewrite** (`ROADMAP-CORE.md` ticket #1): that change rewrites the event-creation path. Land idempotency alongside it so the new all-day/span logic can't duplicate-on-retry. Coordinate before either side merges `tool-call/route.ts`.

### Week 2 — Protect data at rest
- [ ] **4. Encrypt** `calendar_tokens` **and** `transcripts` (envelope encryption, decrypt in-memory). _2–3d_
- [ ] **5. SQLite durability** — Litestream continuous replication + one real restore drill. _1d + drill_

### Week 3 — Finish half-built trust features
- [x] **6. Wire the undo_log** — done (`28f364d`): inverse ops recorded on every mutation; "undo last action" in dashboard + voice. _1.5–2d_
- [ ] **7. Harden audit log** — before/after snapshots, own append-only table (drop the 50-cap), "Recent activity" view. _2d_
  - 🤝 **Backbone for Core's "Recent activity" surface** (`ROADMAP-CORE.md`, Next): this append-only table is the data source Core's dashboard feed reads. Build the table + snapshots here; Core builds the UI on top.

### Week 4 — Abuse + correctness hardening
- [ ] **8. Rate-limit** auth/signup, admin trigger-call, per-user mutations/min ceiling. _1–2d_
- [ ] **9. Hard delete-confirm** — server issues one-time confirm token; model can't self-confirm. _1d_
- [ ] **10. Harden admin auth** — `trigger-call/route.ts:7` compares cookie to plaintext password; hash + constant-time. _½d_

### Closed / deprioritized (do not re-open without reason)
- H6 confirmation gate — **done**.
- C2 cross-user mutation — **mitigated** (server-side user binding); monitor only.
- M4 timezone — **mostly handled**; only add explicit recurring-scope read-back if gaps surface.

---

## Production env vars to verify (cannot be checked from code)
On Railway, confirm both are set correctly — these are the difference between
the landmines being armed or defused:
- `JWT_SECRET` — must be a real random secret (not unset → fallback).
  **2026-06-09: fresh secret generated; rotate on Railway (set + redeploy).**
  Logs out all sessions once — that's expected. Confirm here once saved.
- `VAPI_SECRET_ENFORCE=true` — and `VAPI_SERVER_SECRET` set.
