# Cam Dispatch — UX Trust Fixes (UX-2 / UX-3 / UX-4)
_PM/CTO → Design. June 2026. Work in `edg3-design` worktree, branch `design`._

These are not feature work — they're trust destroyers that need to be eliminated before launch. Each one is something Derrick noticed in dogfooding. Ship them in order.

---

## UX-2 — No duplicate entries in "What Edge knows"

**The problem (Derrick's words):** "The whole People section is off — Jim appears twice, Pfizer appears twice, Edge itself appears as a contact, and Derrick works with Derrick Fung which is weird."

**What Cam owns (UI layer — not the extraction logic, which is Darren's):**

The "What Edge knows" tab in `app/dashboard/page.tsx` needs to:

1. **Collapse visually identical facts within a category.** If two facts in the same category have identical or near-identical text (case-insensitive, first 80 chars), show only one. Add a subtle "(2 entries — [merge])" affordance so Darren can see when the dedup filter is doing work.

2. **Filter out entity names that are clearly wrong** before rendering the People section:
   - Hide any People fact whose entity exactly matches the logged-in user's `profile.name` or `profile.firstName` (a person can't be their own contact)
   - Hide any People fact whose entity is "Edge", "Edg3", "AI", or "assistant" (the AI itself)
   - These are display-layer guards only — don't delete from DB, just filter in the render

3. **People section header clarity:** the current section shows raw entity names followed by a statement. Make the entity name the `<strong>` heading and the statement the supporting text. If entity is null/empty, render as a plain fact (no entity heading).

**Files to touch:** `app/dashboard/page.tsx` (Memory tab, People section render, ~line 450-520 area)

**Done when:** Opening "What Edge knows" → People section shows no self-references, no "Edge" entries, no obvious duplicates. Test with the real DB.

---

## UX-3 — Derrick's name is spelled correctly everywhere in the UI

**The problem:** STT mishears "Derrick" as "Derek." Dashboard might render STT-sourced name spellings.

**What Cam owns:**

Anywhere the dashboard renders a user's name or an entity name from a fact, it must come from `profile.name` (or `profile.firstName`), not from a fact statement.

1. In `app/dashboard/page.tsx`: wherever the user's name is rendered (greeting, "Good morning Derrick", etc.) — ensure it's `profile.firstName` from the API, not hardcoded or from a fact.

2. In any fact display that renders an entity name as a heading — add a `isSelf(entity, profile)` check: if the entity matches the user's name (case-insensitive, first-name match), skip rendering that fact in People (it belongs in Goals/Facts instead). This overlaps with UX-2 item above.

3. **Cursor fix (Cam's earlier open item):** ensure all interactive elements show `cursor: pointer`. Add the global rule to `app/globals.css` if not already there:
   ```css
   button:not(:disabled),
   [role="button"]:not([aria-disabled="true"]),
   a[href],
   label[for],
   summary,
   select { cursor: pointer; }
   button:disabled,
   [aria-disabled="true"] { cursor: not-allowed; }
   ```

**Files to touch:** `app/dashboard/page.tsx`, `app/globals.css`

**Done when:** Dashboard renders Derrick (not Derek), People section has no self-references, all clickable elements show the hand cursor.

---

## UX-4 — Collapsible sections in "What Edge knows"

**The problem (Derrick's words):** "The sections in the memory screen are also very long. I think we should be able to collapse them because right now they're very long and I have to scroll all the way down."

**What to build:**

Add a collapsible section pattern to every fact category in the "What Edge knows" tab. Each category section (Goals, Projects, People, Preferences, Facts, Patterns) should:

1. Have a header row that shows: category name + fact count badge + expand/collapse chevron (▼/▲)
2. Default: **first 3 categories expanded, rest collapsed** (or all expanded if fewer than 4 categories have data)
3. Clicking the header row toggles that category open/closed
4. When collapsed: show just the header + count. When expanded: show all facts.
5. The "Show all (N)" / "Show less" expander for categories with >15 items (already shipped) should still work inside the expanded section.

This is pure UI state — no API changes needed.

**Files to touch:** `app/dashboard/page.tsx` (Memory tab section rendering)

**Done when:** Memory tab loads fast, each category is collapsible, Derrick can find the category he wants without scrolling through 50 facts.

---

## After all three are done

- Run `npm run preflight` from `edg3-design`
- Commit with message `design(ux-trust): UX-2/3/4 — dedup display + name fix + collapsible memory sections`
- Merge to master
- Update your row in the ROADMAP.md Status Board

_Source: PILLAR-TRUST.md UX-2/UX-3/UX-4. PM/CTO: Kevin, June 2026._
