# Calendar Tool Reliability Audit (C1)

_Last updated: 2026-06-24 (Core / Darren). Scope: `app/api/vapi/tool-call/route.ts` —
the voice-call calendar tool handlers._

This is the audit deliverable for DISPATCH item **C1**. It documents, per tool, what a
successful call looks like, every failure mode, and how the handler guarantees Edge never
reports a failed action as done. The companion test matrix lives in
`app/api/vapi/tool-call/calendar-reliability.test.ts`.

## The honest-failure invariant (structural)

Every tool result flows through the POST dispatcher (`route.ts` ~line 2033):

```
try {
  result = await executeTool(tc.name, tc.args, ctx!);
  if (FAILURE_RE.test(result)) ok = false;        // ERR_* strings → ok=false
} catch (err) {
  result = friendlyError(err);                     // any throw → friendly ERROR string
  ok = false;
}
```

So **every** handler lands in exactly one of three buckets, and all three are safe:

1. **Returns an `ERR_*` constant** (`ERR_CREATE/DELETE/MOVE/EDIT`) — each begins with the
   token `ERROR` and an explicit "did NOT go through / do not say it's done." `FAILURE_RE`
   matches the leading `ERROR`, so `ok=false` and the activity log records the failure.
2. **Throws** — caught by the dispatcher, converted via `friendlyError(err)` (which maps
   403 / 404 / 410 / 429 / timeout / no-calendar to specific honest messages), `ok=false`.
3. **Returns a success string** — only reached after the Google response was validated
   (`if (!ins || !ins.data.id) return ERR_*`).

There is no fourth path. A handler cannot return a bare "Done" on a failed Google call
because the success return is guarded by a validated response id. This is the core trust
property: **Edge can never narrate success for an action that did not happen.**

## Per-tool audit

| Tool | Success looks like | Failure modes handled | Honest on every path? |
|---|---|---|---|
| `createEvent` | `insert` → `data.id` present → "Created and confirmed …" | API throw → `null` → `ERR_CREATE`; conflict → warning (no write); duplicate (live calendar + in-mem claim) → "already on your calendar"; missing title/time → ask | ✅ success gated on `data.id` |
| `createRecurringEvent` | `insert` → `data.id` → "Created recurring …" | API throw → dispatcher `friendlyError`; no `data.id` → explicit "couldn't confirm" | ✅ |
| `editEvent` | `patch` → `data.id` → "Updated and confirmed …" | read-only cal → honest; no field → ask; API throw → `null` → `ERR_EDIT` | ✅ success gated on `data.id` |
| `moveEvent` | `patch` → `data.id` → "Moved and confirmed … to {when}" | read-only cal; non-organizer → honest + draft offer; recurring scope → ask; bad tz fallback; API throw → `null` → `ERR_MOVE` | ✅ success gated on `data.id` |
| `deleteEvent` | per-event `delete` ok → "Deleted: …" | read-only cal; recurring scope gate; hard confirm-token gate; **404/410 → "already removed"** (C4 fix); other throw → `failedDel` → `ERR_DELETE` | ✅ |
| `cleanupDuplicates` | groups by title + minute, deletes extras → "removed N" | read-only filtered out; confirm-token gate; **404/410 → counted removed** (C4 fix); other throw → "couldn't remove" | ✅ |
| `cleanupEvents` | resolves each spec by exact time, batch delete | confirm-token gate; per-event resolve miss reported | ✅ |
| `researchToEvent` | web-search → `patch` notes | web-search throw → honest "do it manually"; NO_RESULTS → don't pollute notes; API throw → dispatcher | ✅ |
| `colorEvent` / `colorEventsByEnergy` | `patch` colorId | no match → reported; per-event catch | ✅ |

## Gaps found and fixed in C1

1. **404/410 "already deleted" reported as a hard failure** (also DISPATCH C4). `deleteEvent`
   and `cleanupDuplicates` lumped a Google 404 (`notFound`) / 410 (`Resource has been
   deleted`) into the generic failure bucket, so Edge would say "I couldn't remove that —
   it's still on your calendar" for an event that was *already gone*. Fixed with a pure,
   tested `isAlreadyGoneError(err)` helper in `lib/calendarToolErrors.ts`; both handlers now
   treat already-gone as the intended end state ("already removed" / counted toward removed).

## Verified non-gaps (already hardened in prior rounds)

- **createEvent always writes to `primary`** — the user's primary calendar is always writable,
  so the C2 "writable-calendar pre-check" concern doesn't apply to creates (it applies to
  edit/move/delete on *resolved* events, which already run an `isWritable` check). No
  read-only create path exists.
- **Confirm-token gate** on delete/cleanup prevents model self-confirmation (server-issued
  one-time token).
- **Duplicate suppression** on create checks the *live* calendar, not just the in-memory
  retry claim.
- **moveEvent organizer check** (`canUserReschedule`) prevents a misleading "couldn't move"
  on someone else's meeting.

## Test matrix

See `app/api/vapi/tool-call/calendar-reliability.test.ts` — happy path + each failure mode
per mutating tool, plus the new 404/410 already-gone behavior. The pre-existing
`mutation-errors.test.ts` covers the generic API-throw → `ERR_*` path.
