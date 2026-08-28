---
date: 2026-08-28
trigger: 'Real-usage review of Story 2.19 (Global Settings Screen), still `review`/unmerged — a keybinding-leakage bug (fixed directly) plus a captured-intent gap on the "EDTs" tab'
mode: incremental
epic_impact: 'Epic 2 (in-progress) — Story 2.19 amended in place (branch unmerged, same precedent as Story 2.18's 2026-08-27 AC1 amendment). No new story, no epic redefinition, no PRD/MVP change.'
scope_classification: minor
---

# Sprint Change Proposal — 2026-08-28

## 1. Issue Summary

Max exercised Story 2.19's settings screen in real conditions (branch `story-2-19-global-settings-screen`, not yet merged into `epic-2`) and raised two points:

1. **Keybinding leakage.** With the EDTs zone active and the settings (or registry) popup open on top of it, `Left`/`Right`/`Tab`/arrow keys meant only for the popup also silently drove `EdtsZone`'s own list selection/pane focus underneath it — Ink dispatches every keypress to every mounted `useInput` hook regardless of z-order, and `EdtsZone`'s `isActive` gate only ever checked `!commandBarOpen`. This exact gap had already been flagged as deferred work during 2.19's code review (`deferred-work.md`) but wasn't hit in practice until now. **Not a spec problem** — fixed directly in code (commit `6c8505b`), with two new regression tests, and the deferred-work entry closed out. No change proposed here for this point.

2. **Captured-intent gap on the "EDTs" tab.** The tab's actual original ask was never fully captured upstream — `epics.md`'s Story 2.19 AC and this spec's frozen Intent/Code Map (which faithfully implemented what was written) only ever described per-pane action-hint visibility (Story 2.18). Max's real intent for this tab also included filtering which action *types* (`create`/`switch`/`modify`, Story 2.15) show in the EDT detail pane's "Recent actions" log — e.g. hiding `modify` and/or `create` entries. This was never written down anywhere before this review, so it is a genuine captured-intent gap, not an implementation defect.

## 2. Impact Analysis

### Epic Impact

- **Epic 2** (`in-progress`) absorbs one in-place amendment to **Story 2.19** — its branch has not merged, so this is a direct edit, not a reopening of `done` work (same precedent as Story 2.18's AC1 amendment on 2026-08-27). No new story: unlike Story 2.21 (genuinely separate, deferred Epic-1 scope), this corrects what the *same* story was already meant to deliver, in the *same* still-open files.

### Story Impact

- **Story 2.19** — Intent, Boundaries, I/O matrix, Code Map, and Tasks & Acceptance amended (see §4). Everything already shipped in the first round (port/adapter/schema, store slice with its serialized-save/stale-load-guard patches, the `settings` command, General/Command Palette tabs, `command-bar.tsx`'s live read, the existing hint-visibility feature, `app-shell.tsx` wiring, the composition root, and the `useInput` overlay-gating fix) is explicitly KEPT, not reopened.
- No other story touched.

### Artifact Conflicts

- **PRD:** no conflict — refinement within existing scope, no MVP change.
- **Architecture:** `core/ports/settings.ts` gains one additive field (`edts.hiddenActionTypes: string[]`) on the existing `Settings` model — no new port, no `core → adapters` boundary risk (AD-1). `adapters/driven/settings/schema.ts` extends its zod schema the same way `hiddenActionHints` already works.
- **UX (`epics.md`):** `UX-DR31` and Story 2.19's own AC/implementation-notes section amended (see §4 table). No UX-DR removed.
- **Tests:** new unit tests for the EDTs tab's group-list drill-in/out pure functions, the action-type filter in `formatEdtActionHistory`, and an interaction-level regression confirming a hidden action type disappears from the rendered log.
- **`deferred-work.md`:** no new entries from this proposal (the keybinding-leakage entry was already closed out ahead of this proposal, see §1).

### Technical Impact

- No new core use-case, no schema change to any EDT/global SQLite store, no CLI surface change. `settings.yaml`'s shape grows additively (one new array field under `edts`), same pattern as `hiddenActionHints` itself.

## 3. Recommended Approach

**Direct Adjustment (Option 1) — viable, effort Medium, risk Low-Medium.**

- Amend Story 2.19's spec in place (cheap — branch unmerged, same files still open).
- No rollback considered: the first round's port/adapter/store-slice/wiring is correct and is a prerequisite for this amendment, not something to revert.
- No MVP/PRD review needed — no scope or goal change, only a captured-intent correction plus completion of the originally-intended EDTs-tab scope.

## 4. Detailed Change Proposals

### `epics.md` — UX-DR31

**OLD (tail):** "...a tab with zero settings renders validly, never as an error."

**NEW:** appends — "Amended 2026-08-28 (Sprint Change Proposal, Story 2.19): a tab may itself hold more than one distinct settings group (first case: the "EDTs" tab) — such a tab opens on an Up/Down-navigable group list, `Enter` drills into a group's own `checkbox-list-item` list, and `Esc` steps back up one level (out of a group, then — one more `Esc` — closing the whole screen); a tab with a single flat list (Command Palette) is unaffected, no group level."

### `epics.md` — Story 2.19 section

- Header note: adds a 2026-08-28 amendment paragraph explaining the captured-intent gap and what it corrects (KEEP everything else).
- "EDTs tab" AC (previously one AC) replaced by three: group list on first open → `Enter` drills into "Hint visibility" or "Recent action types" → `Esc` steps back up one level.
- Global "`Esc` closes" AC scoped to "no tab-internal group drilled into."
- Implementation notes: appends the `hiddenActionTypes` field, the `formatEdtActionHistory` filter, and the settings-screen group-list level.

### `spec-2-19-global-settings-screen.md`

Amended in place (branch unmerged — no `-2` file needed, mirrors the Story 2.18 AC1 precedent):

- **Frontmatter:** `status: 'done'` → `'in-progress'`; `baseline_commit` moved to `6c8505b` (current HEAD, so the next review diff only shows this round's changes).
- **Intent:** Problem statement now names three tunables (was two).
- **Boundaries:** new paragraph on the EDTs tab's group-list/drill-down and `Esc`'s tab-aware meaning.
- **I/O & Edge-Case Matrix:** three new rows (enter a group, toggle hidden action type, step back out of a group).
- **Code Map:** split into "delivered, KEEP" vs. "new work" — new work covers the `Settings.edts.hiddenActionTypes` field, the zod schema field, `formatEdtActionHistory`'s new filter parameter, and the settings-screen group-list state.
- **Tasks & Acceptance:** first round's tasks marked done (including the `useInput` gating fix); 4 new unchecked tasks; two new ACs (AC5: action-type filter behavior, AC6: group-list/drill-down navigation); AC1 annotated to scope tab-cycling to when no group is drilled in.
- **Spec Change Log:** first real entry — trigger, what was amended, known-bad state avoided, KEEP list.
- **Design Notes:** two new notes — why a group-list-then-drill-in design was chosen over a flat combined list or a nested sub-tab strip (rejected: risks recreating the keybinding-leakage bug class *inside* the popup), and why the action-type list is a hardcoded closed set (`create`/`switch`/`modify`), not derived from `edtActionLog` at runtime.

## 5. Implementation Handoff

**Scope classification: Minor.** One in-place spec amendment to an unmerged story branch, one additive settings field, no new port, no epic/PRD/MVP redefinition.

**Routed to: Developer agent (`bmad-build`), direct implementation.**

- Implement the new tasks on the existing branch `story-2-19-global-settings-screen` (no new branch — same story, still open).
- `epics.md` and `spec-2-19-global-settings-screen.md` amendments already applied as part of this proposal (see above). `sprint-status.yaml`'s `2-19-global-settings-screen` moved back to `in-progress`.

**Success criteria:** Spec 2.19's AC5/AC6 pass; `npm test`/`npm run typecheck`/`npm run depcheck` stay green; no core/port change beyond the additive `Settings.edts.hiddenActionTypes` field; the existing `hiddenActionHints` feature and every other first-round behavior stays exactly as shipped.

**Explicitly out of scope (by Max's decision during this session):**
- The keybinding-leakage bug — already fixed directly, not part of this proposal's implementation scope.
- Any settings-screen redesign beyond the EDTs tab's group-list level (General and Command Palette tabs unaffected).
