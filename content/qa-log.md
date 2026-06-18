# EDG3 QA Log
_Run the checklists in PILLAR-DAILY-CALL.md → PILLAR-MEMORY.md → PILLAR-TRUST.md after each release. Log results here. If a test fails, open a ticket in the appropriate pillar doc._

---

## How to run
1. Read the QA checklist at the bottom of each pillar doc
2. Work through each item manually — unit tests do not substitute for this
3. Log the result below: date, what passed, what failed, notes
4. Any FAIL → add a bug entry to the relevant pillar doc's bug log and route to the owning lane

---

## 2026-06-18 — Pre-launch baseline (PM/Kevin)

**Status: PARTIAL** — automated test suite green (1703 tests); manual end-to-end QA not yet run. Items marked ✅ were verified via code review or automated tests; items marked ⬜ are pending live-call verification.

### PILLAR-TRUST QA

**Memory pipeline**
- ⬜ Make a call → transcript stored in briefings within 5 min
- ⬜ Make a call, say something new → appears in "What Edge knows" by next call
- ⬜ Contradict an existing fact → old fact retired, new fact active
- ⬜ After every call: episode record exists
- ⬜ Sleep-time consolidation ran after last call (check Railway logs)

**Accuracy**
- ⬜ Open "What Edge knows" → every fact accurate (manual review)
- ⬜ Make a call where Edge references a fact → stated accurately
- ⬜ Force tool failure → Edge gives honest explanation
- ⬜ Last 5 briefings → no false claims

**Data protection**
- ✅ Connect Google → calendar + Gmail work (verified in dogfooding)
- ⬜ Disconnect Google → tokens removed from DB
- ✅ Audit log after calendar mutation → action logged with correct userId (code review)
- ✅ Another user's data via direct API call → 404 (code review: every query has AND user_id = ?)

**Reliability**
- ⬜ Railway logs last 24h → any 500 errors?
- ⬜ Vapi dashboard → all scheduled calls connected?
- ⬜ failed_webhooks table → any entries?
- ⬜ health_log table → 6am digest ran? Status: OK or DEGRADED?
- ⬜ **Restore drill** — restore from backup snapshot, verify app reads correctly. NEVER DONE YET.
- ✅ npm run preflight → 1703 green (2026-06-18)

**Transparency**
- ⬜ Activity tab → shows every action from last 7 days
- ⬜ "What Edge knows" → can see, edit, and delete every fact
- ⬜ Settings → Account → Export → export contains all data
- ⬜ Settings → Privacy → consent setting displayed correctly

**★ End-to-end smoke test**
- ✅ `tests/e2e/call-to-briefing.test.ts` exists and passes (T0-3 shipped 6bec403)
- ⬜ Live 7am path: trigger call → transcript stored within 5 min → fact extracted → next briefing references it
- ⬜ Correction path: say "actually X is Y" → next briefing has corrected fact
- ⬜ Rollback path: find fact in fact_history, roll back, verify previous version active

---

### PILLAR-DAILY-CALL QA

**Flywheel integrity**
- ⬜ Complete a call → within 30 min: episode exists, ≥1 fact extracted, any commitment in tasks
- ⬜ Complete a call at 10pm → facts appear in NEXT MORNING's briefing
- ⬜ Make a commitment on a call → it opens the next call before anything else

**Connection reliability**
- ⬜ call_attempts log → every scheduled call in last 7 days connected?
- ⬜ Any failed calls → user receive notification?
- ⬜ Schedule test call 2 min from now → fires within 60 seconds?

**Briefing quality**
- ⬜ Last 3 briefings → each opened with something the user needed Edge to know?
- ⬜ How long did each run? Under 5 minutes?
- ⬜ ≥3 user-specific facts per briefing (not generic calendar)?
- ⬜ Outstanding commitments from yesterday opened the briefing?

**Call experience**
- ⬜ Edge sounds consistent call-to-call? Same energy, anchor phrases?
- ⬜ Pause 15 seconds mid-call → Edge checks in warmly rather than timing out?
- ⬜ Force tool failure → Edge gives honest explanation?

**★ End-to-end flywheel test**
- ⬜ Call 1: say "my new priority is X" → Call 2: Edge references X in briefing
- ⬜ Call 2: commit "I'll do Y today" → Call 3: Edge opens by asking if Y happened

---

### PILLAR-MEMORY QA

**Storage**
- ⬜ Complete call → within 1 hr: episode exists, ≥3 facts, transcript in briefings
- ⬜ Tell Edge something new → appears in correct category in "What Edge knows"
- ⬜ Contradict known fact → old fact retired (valid_until set), new one active
- ⬜ fact_history after fact update → old value preserved
- ⬜ Row count in episodes = number of calls made

**Learning**
- ⬜ Railway logs → sleep-time consolidation ran after last call? How many facts updated?
- ⬜ Mid-call correction ("actually X is Y") → corrected by NEXT call
- ⬜ After 7+ calls → facts table has pattern-category rows?
- ⬜ briefing_context_packs table → pack for today's date?

**Retrieval**
- ⬜ Ask Edge "what do you know about my gym schedule?" → answers correctly
- ⬜ Ask Edge "what did I say about fundraising?" → surfaces right history
- ⬜ Outstanding commitments in FIRST section of briefing
- ⬜ No facts older than 90 days stated as current truth without hedging

**Compounding**
- ⬜ Fact not confirmed in 60+ days → Edge hedges it in next briefing
- ⬜ Commit 3 calls in a row, don't complete → Edge's language softens
- ⬜ If 30+ calls: facts table has category='semantic' rows?
- ✅ npm run preflight → 1703 green (2026-06-18)

---

_Template: PILLAR-TRUST.md, PILLAR-DAILY-CALL.md, PILLAR-MEMORY.md QA sections._
_Next full manual QA run: schedule for first week with 5 design partners on the product._
