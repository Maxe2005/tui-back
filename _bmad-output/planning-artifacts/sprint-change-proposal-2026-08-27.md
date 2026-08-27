---
date: 2026-08-27
trigger: 'Post-implementation UX feedback on Story 2.18 (EDT zone active highlight / categorized services), still `review` and unmerged — plus kickoff of an ongoing bug-intake process for EDT management features never exercised in real conditions'
mode: incremental
epic_impact: 'Epic 2 (in-progress) — Story 2.18 amended in place (AC1 only, not reopened as done — branch never merged), 1 new story appended (2.21). No epic redefinition, no PRD/MVP change.'
scope_classification: minor
---

# Sprint Change Proposal — 2026-08-27

## 1. Issue Summary

Max used the EDTs zone as implemented by Story 2.18 (branch not yet merged into `epic-2`,
`sprint-status.yaml` still shows `review`) and raised three points:

1. **The active/selected coloring is confusing.** Story 2.18's `active` `list-row` state
   (accent+bold) is wired to the tool-wide active EDT (`entry.ulid === activeEdtUlid`). But the
   EDT SERVICES/OTHER SERVICES split is partitioned against the *selected* EDT
   (`focusedEdt = edtsRows[clampedEdtsSelected]`, which persists across pane focus). When the
   two differ, the strongly-highlighted row and the row whose members actually drive the panes
   below it are different rows — disorienting in practice.
2. **The detail-pane redesign from Story 2.18 doesn't read well; wants a bmad-loop-tui-style
   pane separation instead** — fixed, visible straight-line borders between panels, movable via
   `Ctrl+W` + arrow, `Tab` cycling which border is targeted, and the resulting positions
   persisted as this page's settings.
   - **Investigation finding:** this is not new scope. `epics.md`'s `UX-DR10`/`UX-DR16`/
     `UX-DR18`/`UX-DR27` (Epic 1, Stories 1.9/1.10) already specify exactly this — a `splitter`
     component with `Ctrl+W` keyboard resize-mode, `Tab`-cycled boundaries, `Enter`/`Esc` exit,
     and per-zone persistence — and the keybinding-help screen (`?`) already documents it. It
     was never implemented: `deferred-work.md:237-238` flags it explicitly, including a known
     gate integration point (`app-shell.tsx`'s `resolveZoneArrowSwitch`). `app-store.ts` already
     carries an unused `splitterRatios`/`setSplitterRatio` slice and `Splitter` already has a
     dead `onResize` prop from Story 1.10/1.11. This proposal completes that deferred scope,
     applied first to the EDT zone as Story 2.7's already-anticipated "multi-splitter zone."
3. **A debugging campaign for EDT management is needed** — these features were never really
   exercised end-to-end. Max will report issues as he hits them; no evidence exists yet for this
   point, so it is handled as an ongoing intake process rather than a scoped change today.

## 2. Impact Analysis

### Epic Impact

- **Epic 2** (`in-progress`) absorbs one new story, **2.21**, and one in-place amendment to
  **2.18**'s AC1 — 2.18's branch has not merged, so this is a direct edit, not a reopening of
  `done` work. No other epic affected; Story 2.19 (`backlog`, Global Settings Screen) is
  explicitly **not** a dependency here — pane-ratio persistence goes through the existing
  `StatePort`/`state.json` (AD-7, already used for `activeEdt`), not the future `SettingsPort`.

### Story Impact

- **Story 2.18** — AC1 amended (see §4). No other AC affected; the categorized-services split,
  per-service actions, and fixed detail-pane width all stay as shipped on the branch.
- **Story 2.21** (new) — EDT Zone multi-splitter layout + `Ctrl+W` keyboard resize-mode.
- No other story touched.

### Artifact Conflicts

- **PRD:** no conflict — refinement within existing scope, no MVP change.
- **Architecture:** `core/ports/state.ts` gains new methods (splitter ratios), additive to the
  existing `StatePort` contract — no new port, no `core → adapters` boundary risk (AD-1).
  `adapters/driven/state` extends its zod validation the same way `activeEdt` already works.
- **UX (`epics.md`):** `UX-DR5`, `UX-DR10`, `UX-DR16`, `UX-DR18`, `UX-DR20` amended (text
  corrections, see §4 table); no UX-DR removed.
- **Tests:** new unit tests for the 3-boundary resize pure functions, interaction tests for
  `Ctrl+W`/`Tab`/arrow/`Enter`/`Esc` in resize-mode, and a regression test for the
  `resolveZoneArrowSwitch` gate exclusion (closes the `deferred-work.md` item).
- **`deferred-work.md`:** the `Ctrl+W` resize-mode gate item gets a `Tracked by: Story 2.21`
  pointer, not removed (not resolved until implemented).

### Technical Impact

- No Docker/process-control adapter, no new core use-case, no schema change to any EDT/global
  SQLite store. `state.json`'s shape grows additively (new top-level key), same pattern as
  `activeEdt`.

## 3. Recommended Approach

**Direct Adjustment (Option 1) — viable, effort Medium, risk Low-Medium.**

- Amend Story 2.18's AC1 in place (cheap — branch unmerged).
- Add Story 2.21 to complete deferred UX-DR10/16/18/27 scope, scoped to the EDT zone first.
- Handle the debugging campaign as a standing intake log, not a scoped story, until real
  evidence accumulates.

Rollback was not considered viable: the work already on the 2.18 branch (categorization,
per-service actions, `ListRow`'s new prop) is correct and is a prerequisite for Story 2.21, not
something to revert. MVP/PRD review was not needed — no scope or goal change, only a UX
correction and the completion of already-approved-but-deferred scope.

## 4. Detailed Change Proposals

### Story 2.18 — AC1 amendment

**OLD:**
> **Given** the EDT selector list **When** rendered **Then** the active EDT's row renders its
> label in `{colors.accent}`, bold — independently of whether that row is also the keyboard
> cursor's current position — so it stays visually distinct even when a different row is
> highlighted (extends `list-row`'s existing `selected` prop with a new `active` prop; never
> removes the existing accent-bar+`›`-marker cursor treatment)

**NEW:**
> **Given** the EDT selector list **When** rendered **Then** the row whose membership currently
> drives the EDT SERVICES/OTHER SERVICES split (`entry.ulid === focusedEdt.ulid`, i.e.
> `index === clampedEdtsSelected` — persists across all three panes, not just while
> `paneFocus === 'edts'`) renders its label in `{colors.accent}`, bold, via a new `emphasized`
> prop; independently, the tool-wide active EDT's row (`entry.ulid === activeEdtUlid`) carries a
> discreet `{colors.info}` `" active"` suffix next to its meta text via the existing `active`
> prop (repurposed) — the two indicators are decoupled and can land on the same row or different
> rows

**Implementation notes (amended):**
- `list-row.tsx`: `active` prop changes role — renders only the discreet `" active"` suffix in
  `colors.info` (not bold), appended after `meta`. New `emphasized?: boolean` prop takes over
  the previous accent+bold label treatment (composable with `selected`, exactly as `active`
  was).
- `edts-zone.tsx`: EDT selector passes `emphasized={index === clampedEdtsSelected}` and
  `active={entry.ulid === activeEdtUlid}` (rendering changes, trigger condition for `active`
  unchanged).
- `formatEdtRowMeta`: simplified — no longer builds the `"— active"` string; `ListRow` renders
  it itself via `active` so it can be colored independently of the rest of `meta`.

**Rationale:** the strong highlight should always be the row explaining what's shown in the
panes below it; "this is also the tool-wide active EDT" stays visible but recedes, so it never
competes visually with the row that matters for what's on screen.

---

### Story 2.21: EDT Zone — Multi-Splitter Layout with Keyboard Resize-Mode (`Ctrl+W`)

> Added 2026-08-27 (Sprint Change Proposal): completes deferred scope from `UX-DR10`/`UX-DR16`/
> `UX-DR18`/`UX-DR27` (Epic 1, Stories 1.9/1.10 — `splitter` component with `Ctrl+W`
> keyboard resize-mode, never implemented; flagged in `deferred-work.md`). Extends the EDT zone
> into a "multi-splitter zone" (Story 2.7's already-anticipated concept): the three panes
> stacked on the list side since Story 2.18 (EDT selector / EDT SERVICES / OTHER SERVICES) gain
> visible, fixed-but-movable borders, in addition to the existing list↔detail split. Appended to
> Epic 2 (branch still open) though the underlying components (`splitter.tsx`, `app-store.ts`'s
> `splitterRatios` slice) are Epic 1 territory, following the precedent of Stories 2.10/2.11/
> 2.12/2.13/2.16/2.20.

As a developer, I want to see fixed but movable borders between the EDT zone's panes, and to be
able to resize them from the keyboard, So that I can adjust how much room each pane gets based
on what I'm looking at, and have that adjustment survive across sessions.

**Acceptance Criteria:**

- **Given** the EDT zone **When** it renders **Then** 4 regions are visible with a fixed border
  between each: EDT selector / EDT SERVICES / OTHER SERVICES (stacked, left column) and Detail
  (right column) — 3 boundaries total
- **Given** the EDT zone, no dialog open **When** `Ctrl+W` is pressed **Then** resize-mode
  engages: the currently targeted boundary recolors to accent (per Story 1.10's original spec);
  global shortcuts that would otherwise fire on the same keys (zone-switch via `←`/`→`, list
  navigation) are inert while the mode is active — closes the `deferred-work.md` gate item by
  adding resize-mode to `resolveZoneArrowSwitch`'s existing exclusion gate
  (`!helpOpen && !filterOpen && !registryScreenOpen`)
- **Given** resize-mode is active **When** `Tab` is pressed **Then** the targeted boundary
  advances to the next one (cycles across the 3 boundaries)
- **Given** resize-mode is active, a horizontal boundary targeted **When** `↑`/`↓` is pressed
  **Then** the boundary moves one step, clamped (bounds generalize `MIN_LIST_RATIO`/
  `MAX_LIST_RATIO` to the 3 sub-panes); **given** the vertical (list↔detail) boundary targeted
  **when** `←`/`→` **then** likewise
- **Given** resize-mode is active **When** `Enter` or `Esc` is pressed **Then** the mode exits
  (both do, per the keybinding-help text already shipped); no separate save step — every move is
  already applied live
- **Given** a boundary has been moved **When** the app restarts **Then** the EDT zone's ratios
  are read back from `state.json` and reapplied — persisted per zone, independent of other
  zones, per `UX-DR10`

**Implementation notes:**
- `core/ports/state.ts`: extends `StatePort` with splitter-ratio read/write (exact shape —
  dedicated methods vs. a single `UiState` object alongside `activeEdt` — decided at
  implementation time); `adapters/driven/state` follows the same zod-validation pattern as
  `activeEdt` (`state-invalid-json`/`state-invalid-format`).
- `app-store.ts`: new `resizeMode: { zone: ZoneId; targetBoundary: number } | null` slice;
  `splitterRatios` widens from one ratio per zone to a shape that can carry multiple boundaries
  (EDT zone needs 3; other zones keep 1 for now).
- `splitter.tsx`: wires the previously-dead `onResize` prop; adds accent recoloring when
  targeted in resize-mode.
- `app-shell.tsx`: `resolveZoneArrowSwitch` gains `resizeMode` in its exclusion gate, alongside
  `helpOpen`/`filterOpen`/`registryScreenOpen` — closes the flagged deferred-work item.
- `edts-zone.tsx`: the list-side column (EDT selector/EDT SERVICES/OTHER SERVICES) changes from
  a flat stack to 3 sub-`Box`es separated by `Splitter`, each driven by its own ratio.
- **Scope explicitly limited to the EDT zone** for this story — other zones keep their single,
  non-resizable list/detail split for now. The mechanism (resize-mode, gate, persistence) is
  built generic enough to extend to other zones later without rework.
- Mouse-drag resize (mentioned in `UX-DR10`/`UX-DR27`) stays out of scope — Ink has no mouse
  support; `Ctrl+W` is the already-acknowledged "confirmed-safe fallback" (`UX-DR27`).

---

### Amendments to Existing Text (superseding notes, not reopenings)

| Document | Location | Change |
|---|---|---|
| `epics.md` | `UX-DR5` | `active` state redefined: accent+bold now marks the row whose membership drives the EDT SERVICES/OTHER SERVICES split (new `emphasized` prop), not the tool-wide active EDT; `active` (repurposed) now renders a discreet `colors.info` suffix instead. Amended 2026-08-27 (Story 2.18/2.21). |
| `epics.md` | `UX-DR10` | Adds: pane-size persistence implemented by Story 2.21, via `StatePort`/`state.json` (AD-7), not the future `SettingsPort` (Story 2.19). |
| `epics.md` | `UX-DR16` | Adds: `Enter` and `Esc` both exit resize-mode (Story 2.21). |
| `epics.md` | `UX-DR18` | Adds: the EDT zone becomes the first "multi-splitter zone" (Story 2.7) — 3 internal boundaries in addition to the list/detail split (Story 2.21). |
| `epics.md` | `UX-DR20` | Adds: fixed, resizable borders between EDT selector/EDT SERVICES/OTHER SERVICES (Story 2.21), on top of the 2026-08-26 categorization amendment. |
| `epics.md` | `UX-DR27` | No content change — notes the confirmed-safe keyboard fallback is now delivered by Story 2.21. |
| `deferred-work.md` | line 237-238 (`Ctrl+W` resize-mode gate item) | Adds `Tracked by: Story 2.21` pointer; item stays open until implemented. |

### Debug-log process (point 3 — not a scoped change)

New file `_bmad-output/implementation-artifacts/epic-2/edt-management-debug-log.md`, separate
from `deferred-work.md` (known/accepted debt) since these are unsorted reports. Entries record
what was tested, expected vs. observed behavior, and a status (`à trier` / `story ouverte` /
`pas un bug` / `corrigé`), filled in as Max reports issues from real usage. No story is created
from it until entries accumulate and are triaged together.

## 5. Implementation Handoff

**Scope classification: Minor.** One in-place AC amendment to an unmerged story branch, one new
story completing already-approved-but-deferred scope, no new port beyond an additive `StatePort`
extension, no PRD/MVP/epic redefinition.

**Routed to: Developer agent (`bmad-build` / `bmad-agent-dev`), direct implementation.**

- Amend Story 2.18 in place on its current branch (`story-2-18-...`) before it merges into
  `epic-2-edt-workspace-management` — this is a same-branch correction, not a new PR.
- Implement Story 2.21 on its own story branch off `epic-2-edt-workspace-management`, per this
  repo's one-branch-per-story convention, after 2.18 merges (2.21 extends the pane layout 2.18
  ships).
- `sprint-status.yaml` and `epics.md` amendments applied directly as part of this proposal (see
  below).

**Success criteria:** Story 2.18's amended AC1 and Story 2.21's ACs (above) pass; `npm test` /
`npm run typecheck` / `npm run depcheck` stay green; no core/port change beyond the additive
`StatePort` extension; the `deferred-work.md` gate item is verified closed once 2.21 lands.

**Explicitly out of scope (by Max's decision during this session):**
- Persisting pane ratios via the future `SettingsPort`/Story 2.19 — uses the existing
  `StatePort` instead, no dependency on 2.19.
- Mouse-drag resize — Ink has no mouse support; `Ctrl+W` is the confirmed fallback.
- Any concrete fix for point 3 (debugging campaign) — intake only, until real reports arrive.
