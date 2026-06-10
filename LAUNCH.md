# Edg3 — Go-Live / Operations Runbook

The **how** behind the launch. The 30/60/90 plan sets the dates; this is the executable
playbook for actually shipping and running Edg3 with real users. Owned by PM/CTO.

---

## 0. Launch strategy (the key decision)
**Decouple the public launch from Google Gmail verification.** Launch the calendar +
daily-briefing **core** on the target date regardless. The Gmail features (email drafting,
reply tracking, notifications) roll out **"as verification clears"** — available to the
owner + test users until then. **Why:** Gmail restricted-scope verification + CASA is
Google-controlled and routinely runs 6–12+ weeks. Never gate the launch date on it.

---

## 1. Pre-launch checklist (all true before public launch)
- [ ] Core loop verified end-to-end (briefing call + calendar create/move/delete) on a real call.
- [ ] **Real phone number (Twilio) + Vapi on a PAID plan** sized for daily-call volume. *(The free Vapi number caps outbound calls/day — cannot serve real users.)*
- [ ] `DATA_ENCRYPTION_KEY` set on Railway **and backed up forever** *(lose it after data is encrypted = unrecoverable)*.
- [ ] `JWT_SECRET` is a real random secret on Railway (not unset).
- [ ] `VAPI_SECRET_ENFORCE=true` + `VAPI_SERVER_SECRET` set (webhook auth enforced).
- [ ] Off-box DB backup (Litestream/snapshot replication) running + **one restore drill done** *(SQLite single-volume = data-loss risk without it — open Security item #5)*.
- [ ] `npm run check:vapi` green + CI green on master.
- [ ] Privacy Policy + Terms accurate & live. ✅
- [ ] Gmail features either verified, or cleanly gated to test users with the "unverified app" path documented for them.

---

## 2. Production env vars (Railway)
| Var | Purpose | Notes |
|---|---|---|
| `DATA_ENCRYPTION_KEY` | at-rest encryption | 64-hex; **back up forever** |
| `JWT_SECRET` | session signing | real random secret |
| `VAPI_API_KEY` | Vapi calls + tools | |
| `VAPI_PHONE_NUMBER_ID` | outbound calls | the real/Twilio number |
| `VAPI_SERVER_SECRET` + `VAPI_SECRET_ENFORCE` | webhook auth | set enforce=`true` |
| `ANTHROPIC_API_KEY` | briefings + email compose + reply understanding | |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth | |
| `TWILIO_*` | SMS/voice | when SMS lands |

---

## 3. Deploy
- Push to `master` → Railway auto-builds + deploys (GitHub-connected). CI Action runs tsc + tests + build (+ `check:vapi` if secrets set).
- Before a risky deploy: `npm run preflight` (tsc + tests + build) **and** `npm run check:vapi`.
- A failed Railway build keeps the previous version live (no downtime).
- An env-var change triggers a **full rebuild** (~5–8 min on the current plan).

## 4. Rollback
- Railway → Deployments → last good deployment → Redeploy. Previous image is preserved.
- ⚠️ **Encryption caveat:** once `DATA_ENCRYPTION_KEY` is set and data is encrypted, do NOT roll back to a pre-encryption build or unset the key — encrypted rows become unreadable.

## 5. Post-deploy smoke test
- Homepage + `/privacy` + `/login` return 200.
- One real briefing call completes.
- `npm run check:vapi` green.
- Dashboard loads; a calendar action round-trips.

---

## 6. Capacity & cost (the plan needs this)
- **Vapi:** free number caps outbound calls/day — hard blocker for real users. Move to a Twilio number + paid Vapi plan before external users. Model: per-minute cost × users × daily calls.
- **Anthropic:** briefings + email compose + reply understanding are per-call token cost — budget at user scale.
- **DB/Railway:** single SQLite volume; fine for early scale, watch volume size + the durability item.

## 7. Incident playbook (things that have actually bitten us)
- **"All calls failing / anthropic-400-validation-failed":** a Vapi tool has a bad schema. Run `npm run check:vapi` — it pinpoints the tool. *(Past causes: a trailing space in a param key; an empty-string default on a boolean; a missing tool Server URL.)*
- **"Tool returns no result" mid-call:** that tool is missing its **Server URL** in Vapi.
- **Slow dashboard load:** it's client-side data fetching — already decoupled (renders on auth; the slow Google Calendar checks load async). If it regresses, check `/api/auth/me`.
- **"Edge can't use Gmail":** the user needs to reconnect Google (re-consent) — the read/draft scopes weren't granted.

## 8. Gmail verification
See `docs/google-verification.md` (scopes, justifications, demo-video shot-list, CASA notes).
Restricted scopes need Google verification + CASA (weeks). The owner can dogfood via the
"unverified app → Advanced → Continue" path meanwhile. **Start CASA ASAP — it's the long pole.**
