# Trust Features — Build Specs
_Three priority trust builds. Approved by Derrick June 2026. Route to lanes via PM dispatch._

---

## T1 — Fact Correction UI

**Pillar:** Accuracy you can verify  
**Size:** Small — UI + one new API endpoint  
**Lanes:** Core (API), Design (UI)

### Problem
Every fact Edge learns is permanent and uncorrectable. STT mishears names (live example: "Onsi" stored as "Ansi"). Users who discover wrong information in "What Edge knows" have no way to fix it — a trust-killer with no escape hatch.

### What to build

**API — Core**

`PATCH /api/memory/facts/[id]`
- Auth-gated, user-scoped (`WHERE id = ? AND user_id = ?`)
- Body: `{ statement: string }` — replaces the fact's statement text
- Returns: `{ ok: true, fact: { id, category, entity, statement } }`
- Validation: statement must be non-empty string, max 500 chars
- Rate-limit: reuse existing memory rate limit key

`DELETE /api/memory/facts/[id]`
- Auth-gated, user-scoped
- Soft consideration: facts with `source='priority-sync'` should block deletion with a clear message ("This fact comes from your priorities — update them there instead")
- Returns: `{ ok: true }`

**UI — Design**

In the "What Edge knows" tab, each fact row gets:
- An edit icon (pencil) on hover/focus — opens an inline edit field pre-populated with the current statement text. Save on Enter or a ✓ button; cancel on Escape or ✗.
- A delete icon (trash) on hover/focus — shows a single confirmation: "Remove this fact? Edge won't remember it." Confirm → DELETE call → row removed.
- Both icons appear together on hover; don't clutter the default view.

**Copy:**
- Edit placeholder: "Correct this fact..."
- Delete confirm: "Remove this fact? Edge won't remember it."
- Success toast: "Updated." / "Removed."
- Priority-sync block: "This comes from your priorities — update them in the Priorities tab."

### Acceptance criteria
- [ ] User can edit any manually-learned fact statement inline
- [ ] User can delete any manually-learned fact
- [ ] Priority-sync facts (`source='priority-sync'`) cannot be deleted via this UI — blocked with clear message
- [ ] Changes are user-scoped — no cross-user edits possible
- [ ] Edit/delete reflected immediately in UI without page reload

---

## T2 — Expandable Inbox Receipts

**Pillar:** Show your work  
**Size:** UI-only — backend already ships subjects  
**Lanes:** Core (API route already exists), Design (Activity tab UI)

### Problem
The Activity tab shows `"Read 20 inbox threads"` repeatedly with no detail. This looks like surveillance. Users have no way to verify what Edge actually looked at. It erodes trust on the feature with the most privacy sensitivity.

### What's already built (do not rebuild)
- `getEmailSignalSubjects(userId, auditId)` in `lib/gmail.ts` — decrypts and returns the subject array for a given audit entry
- `GET /api/activity/email-receipt/[id]` — Core route that calls `getEmailSignalSubjects` and returns the subject list, user-scoped
- `audit_log.snapshot_after` — subjects stored AES-256-GCM encrypted at the time of each inbox scan

### What to build

**UI — Design (Activity tab)**

For `email_signal_fetch` action rows in the Activity tab:

**Collapsed state (default):**
> `📥 Read 12 inbox threads to inform your focus · [expand ▼]`

**Expanded state (on tap/click):**
```
📥 Read 12 inbox threads · Jun 16 at 9:04am
   ▲ collapse

   3 flagged as urgent:
   • CIBC — "Final notice: account overdue"
   • Rogers — "Your bill is ready"
   • Landlord — "Re: June rent"

   9 others reviewed:
   • Mom — "Weekend plans?"
   • Shopify — "Your payout is ready"
   • [+ 7 more]  ← expands to show all
```

**Fetch:** on expand, call `GET /api/activity/email-receipt/[auditId]` — lazy-load, not preloaded. Show a spinner while loading; degrade gracefully if subjects unavailable (show "Subject details unavailable for this scan").

**Urgent flagging:** re-use `isUrgentEmail` logic client-side OR have the API return `{ subjects: string[], urgentCount: number, urgentSubjects: string[] }` — PM/Core to decide.

**Copy:**
- Header: "Read N inbox thread[s] to inform your focus"
- Urgent section label: "N flagged as urgent:"
- Others label: "N others reviewed:"
- Overflow: "+ N more" expands inline
- Empty: "No subject details stored for this scan."
- Error: "Subject details unavailable."
- Footer note (small, muted): "Edge reads subject lines only — never message content."

### Acceptance criteria
- [ ] `email_signal_fetch` rows in Activity tab are expandable
- [ ] Expansion lazy-loads subjects from `/api/activity/email-receipt/[id]`
- [ ] Urgent subjects shown separately and labeled
- [ ] Graceful degradation when subjects unavailable
- [ ] "Edge reads subject lines only — never message content" footer visible in expanded state
- [ ] No subjects shown for other users' audit entries (user-scoped enforced at API)

---

## T3 — Post-Apply Undo Toast + Score Changelog

**Pillar:** Predictability + (light Reversibility)  
**Size:** Small — UI additions to existing Apply flow  
**Lanes:** Core (score delta API), Design (toast + changelog UI)

### Problem
The hero loop Apply is the product's biggest moment. Right now:
1. The score changes silently — no explanation of what moved
2. Undo exists but is buried in the Activity tab — users don't know it's there
3. The result feels like a black box: "something happened to my calendar"

### What to build

**Score changelog — Core + Design**

After Apply, the `/api/day-plan/confirm` response already returns `{ ok, newScore, count }`. Extend it to also return:
```typescript
{
  ok: true,
  newScore: number,        // already exists
  scoreBefore: number,     // add: the score before apply (pass from /api/day-plan)
  count: number,           // already exists
  changeLines: string[]    // add: 1-3 plain-English lines explaining what moved
}
```

`changeLines` examples (generated deterministically from the applied actions, no LLM):
- `"Added a 90-min focus block for 'Extend runway' (+Focus)"`
- `"Moved 'Strategy planning' out of your low-energy window (+Energy)"`
- `"Inserted buffer between back-to-back meetings (+Focus)"`

Rule: max 3 lines. One line per action type, not per action. If 2 focus blocks were added, say "Added 2 focus blocks for 'Extend runway' (+Focus)" — not two lines.

**UI — Design**

**Score delta display** (on the EdgeScoreCard, immediately after Apply refetch):
```
Edge Score  71  ▲ +7
────────────────────────
↑ Added a 90-min focus block for 'Extend runway'
↑ Moved 'Strategy planning' to tomorrow
```
Animate: old score ticks up to new score (existing spark animation from Design D). The changelog lines fade in beneath. Disappear after 8 seconds or on next interaction — don't persist permanently.

**Undo toast** (separate from the score card):
```
┌──────────────────────────────────────────────┐
│  Day reshaped — 3 changes applied.   [Undo]  │
└──────────────────────────────────────────────┘
```
- Appears at bottom of screen immediately after Apply succeeds
- Stays visible for 30 seconds, then fades
- [Undo] button calls the existing undo-plan endpoint
- On undo success: toast updates to "Reshape undone." + score reverts
- `prefers-reduced-motion`: show toast without animation; no score tick animation
- Do NOT show if Apply returned 0 changes

**Copy:**
- Toast: "Day reshaped — N change[s] applied. · Undo"
- Undo success: "Reshape undone."
- Undo fail: "Couldn't undo — changes may have been modified in Google Calendar."
- Score delta label: "+N" in green with ▲ / "−N" in muted if score dropped
- Changelog prefix: "↑" for improvements

### Acceptance criteria
- [ ] Toast appears within 500ms of Apply success
- [ ] Toast shows correct count of changes applied
- [ ] Toast [Undo] button successfully reverts the plan as a unit
- [ ] Toast disappears after 30 seconds if not interacted with
- [ ] Score delta (before → after) visible on EdgeScoreCard after Apply
- [ ] 1–3 changelog lines visible explaining what moved
- [ ] No toast shown when Apply returns 0 changes
- [ ] `prefers-reduced-motion` respected (no animation, functionality intact)
- [ ] `scoreBefore` passed correctly from `/api/day-plan` through to confirm response

---

## Routing summary for PM dispatch

| Feature | Core work | Design work | Security work | Blocked on |
|---|---|---|---|---|
| T1 Fact correction | `PATCH/DELETE /api/memory/facts/[id]` | Edit/delete UI on fact rows | None | Nothing |
| T2 Inbox receipts | Verify `/api/activity/email-receipt/[id]` works end-to-end | Expandable row in Activity tab | None (already built) | Nothing |
| T3 Undo toast + changelog | `changeLines` + `scoreBefore` in confirm response | Toast + score delta UI | None | Ticket H (real score projection) should land first so `scoreBefore`/`newScore` are accurate |

_T1 and T2 are fully unblocked. T3 UI can be built speculatively but should not be wired until Ticket H lands (otherwise `scoreBefore` and `newScore` will be inaccurate)._
