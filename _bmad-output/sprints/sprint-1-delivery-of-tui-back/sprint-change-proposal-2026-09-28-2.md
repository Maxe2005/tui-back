---
date: 2026-09-28
trigger: 'New capability requested by Max — bring Story 5.4''s filter-history arrow-recall to the `:` command bar, with the common logic of both features factored into one shared implementation to avoid duplication and ease future improvements.'
mode: incremental
epic_impact: 'Epic 5 (in-progress) — 1 new story appended (5.6). Stories 5.4/5.5 not reopened (5.6 refactors 5.4''s history code behavior-preservingly). No epic redefinition, no PRD change, no MVP change.'
scope_classification: moderate
---

# Sprint Change Proposal — 2026-09-28

## 1. Issue Summary

Max asked to add a history to the `:` command bar (UX-DR29, Stories 2.14/2.17), reusing part of
the Logs filter editor's history behavior (Story 5.4, `done`): while the cursor is in the text
field, `↑` saves the in-progress text as a draft and `↑`/`↓` then browse the last N commands,
with the same parameters as the filter history (duplicate suppression + configurable max size).
Max explicitly required that the logic common to both features be factored as much as possible,
to avoid repetition and make future improvements land in both at once.

Decisions taken with Max during this session:

- Command-history settings are **independent** from the filter-history ones
  (`commandPalette.historySize`, `commandPalette.historyDedup`), with shared range constants.
- `↓` from an untouched draft keeps its **existing** command-bar meaning (enter the autocomplete
  grid if visible) — no history grid browser for commands.
- Only **recognized** commands (exact match, actually run) are recorded — an unknown command is
  never stored.

This is not a bug or technical blocker — a new requirement from the product owner.

**Evidence from the code (factoring opportunity):**

- The pure recall logic already is generic in practice but lives in the Logs zone under
  filter-specific names: `pushFilterHistoryEntry`, `resolveHistoryBrowseUp/Down`,
  `FilterHistoryBrowseState` (`zones/logs/logs-zone.logic.ts`).
- The persisted-history store mechanics (hydrate-once, version guard, serialized save chain,
  await-in-flight-load before mutate — the product of two review fixes) are hard-wired to
  `filterHistory` in `store/slices/logs-slice.ts`.
- The snap-back-to-draft rule is inlined three times in `logs-zone.tsx`.
- In `command-bar.tsx`, `↑` is unused on input focus and `↓` only enters the grid — history can
  be wired in without key conflicts.

## 2. Impact Analysis

### Epic Impact

Epic 5 can still be completed as planned. **Story 5.6 — Command History Recall & Shared
Input-History Primitive** is appended after 5.5. It lives in Epic 5 rather than Epic 2 (command
bar territory) because its core work is extracting Story 5.4's code and Epic 5's branch is the
open one — same "ride the currently-open epic closest to the trigger" precedent as Stories 2.20
and 5.5. No other epic affected, no resequencing.

### Story Impact

- **Story 5.4 (done):** not reopened. Its code is refactored by 5.6 behavior-preservingly; its
  existing tests are the regression net and must pass unchanged.
- **Story 5.5 (review):** not reopened. 5.6 touches `logs-zone.tsx` again; 5.5 is already
  merged into the epic-5 branch (`36f2418`), so 5.6's branch can start from it directly.
- **Story 2.32 (review, Epic 2):** soft dependency — it plans to move the command bar onto
  `TextInputLine` with a cursor (not yet applied to `command-bar.tsx` on this branch). No key
  conflict (←/→ vs ↑/↓); whichever story lands second places the cursor at end-of-value on recall.
- **New Story 5.6:** see Section 4.

### Artifact Conflicts

- **PRD:** N/A — the command bar has no FR of its own (specified by UX-DR29/30 only). No MVP
  change.
- **Architecture:** no conflict. `state.json` (AD-7) already holds persisted non-preference
  state (`activeEdt`, `splitterRatios`, `filterHistory`); it gains a `commandHistory` field. No
  new AD.
- **UI/UX (`epics.md` UX-DR list):** UX-DR29 (command bar gains recall), UX-DR31 (Command Palette
  settings tab grows to 3 fields + clear action and needs a row cursor), UX-DR32 (recall
  generalized into a shared pattern with two consumers).
- **Other:** no CI/CD, deployment or IaC impact. New tests for the shared primitive, the
  generalized store factory, the state adapter's new field, the command bar and the settings tab.

## 3. Recommended Approach

**Selected: Option 1 — Direct Adjustment.** New Story 5.6 in Epic 5, own `story-5-6-...` branch
off `epic-5-aggregated-log-observability` (5.5 already merged there). No rollback, no MVP review.

- **Effort:** Medium — a behavior-preserving extraction (pure logic + store factory) plus a
  second consumer and a settings-tab rework, all with direct in-repo precedents (5.4's Logs-tab
  row-cursor rework, the state adapter's read-merge-write helper).
- **Risk:** Low–Medium — the one delicate point is generalizing logs-slice's filter-history
  persistence without regressing its concurrency review fixes; 5.4's unchanged tests guard it.
- **Rationale:** Max's explicit factoring requirement makes this the right moment: a second
  consumer is appearing, and extracting now avoids a copy that would drift.

## 4. Detailed Change Proposals

### 4.1 New Story (Epic 5) — `epics.md`, after Story 5.5

#### Story 5.6: Command History Recall & Shared Input-History Primitive

> Added 2026-09-28 (Sprint Change Proposal): brings Story 5.4's arrow-recall history to the
> `:` command bar (UX-DR29), and — as a first-class goal, not a side effect — extracts the
> recall logic both features share into one reusable primitive so neither re-implements it.

As a developer, I want the `:` command bar to remember the commands I've run and let me recall
them with ↑/↓, So that I don't retype frequent commands — and I want this and the filter
history to share one implementation, so future history improvements land in both at once.

**Acceptance Criteria:**

- **Given** the `:` bar with focus on the input **When** a command is run (Enter on an exact,
  recognized match) **Then** the submitted query is pushed to the front of the command history,
  deduplicated per `settings.commandPalette.historyDedup` (same semantics as
  `logs.filterHistoryDedup`: move-to-front everywhere when on, top-only when off), trimmed to
  `settings.commandPalette.historySize`. An unknown command is never recorded.
- **Given** the developer is typing a draft **When** ↑ is pressed **Then** the input shows the
  most recent entry and the draft is preserved; further ↑ walks older entries (no-op at the
  oldest); ↓ walks back, and one ↓ past the most recent entry restores the draft exactly.
  Entries equal to the draft are skipped, exactly as in Story 5.4.
- **Given** the developer is on their own draft (not browsing) **When** ↓ is pressed **Then**
  the existing behavior is unchanged (enters the autocomplete grid if visible, otherwise
  no-op) — no history grid browser for commands.
- **Given** the developer is browsing **When** a printable character or Backspace is pressed
  **Then** browsing ends, the draft is restored, and the keypress is applied on top of it
  (Story 5.4's snap-back). **When** Enter is pressed **Then** the displayed (recalled) command
  runs. **When** Tab is pressed **Then** the recalled text is adopted as the new draft
  (browsing ends) and Tab behaves as usual on it.
- **Given** the app is restarted **When** `:` is opened **Then** previous command history is
  still available (persisted in `state.json`, `commandHistory`, alongside `filterHistory`).
- **Given** the `:settings` Command Palette tab **When** the developer adjusts "command history
  size" or toggles "deduplicate command history" **Then** it applies and persists immediately;
  a "clear command history" action empties it. The tab gains a row cursor (Up/Down moves
  between rows, mirroring the Logs tab's Story 5.4 rework) since Up/Down no longer belongs
  exclusively to gridMaxRows.
- **Given** the refactor **When** this story lands **Then** the history push/dedup/trim, the
  arrow-browse state machine (up/down/skip-equal-to-draft), the snap-back-to-draft rule, and
  the persisted history store mechanics (hydrate-once, version guard against stale reads,
  serialized save chain, await-in-flight-load before mutate) each exist exactly once in the
  codebase and are consumed by both the Logs filter editor and the command bar. Story 5.4's
  existing tests pass unchanged (behavior-preserving extraction); the shared primitive gets
  its own tests.

**Implementation notes:** new pure module `tui/shared/input-history/` (generic
`pushHistoryEntry`, `HistoryBrowseState`, `resolveHistoryBrowseUp/Down`, a snap-back helper) —
`logs-zone.logic.ts` keeps only its Logs-specific key encoding (`FilterHistoryKey`/
`filterHistoryKeyString`); a generic persisted-history store factory extracted from
`logs-slice.ts`'s filterHistory machinery, instantiated for filter history (keyed map) and
command history (single list); `StatePort` gains `readCommandHistory`/`writeCommandHistory`
sharing the state adapter's existing read-merge-write helper; new settings
`commandPalette.historySize` (default 20) and `commandPalette.historyDedup` (default true) — the
size range constants are generalized to shared `MIN/MAX_INPUT_HISTORY_SIZE` (1..200) used by
both history settings. Coordinate with Story 2.32 (TextInputLine adoption in the command bar):
whichever lands second places the cursor at end-of-value on recall.

### 4.2 Amendments to Existing Text (superseding notes, not reopenings) — `epics.md`

**UX-DR29** — append:

> Amended 2026-09-28 (Sprint Change Proposal, Story 5.6): adds command-history recall — `↑`
> from the input browses previously run (recognized) commands with draft preservation, per the
> shared input-history recall pattern (UX-DR32); `↓` from an untouched draft keeps its existing
> grid-entry meaning (no history grid for commands).

**UX-DR32** — append:

> Amended 2026-09-28 (Sprint Change Proposal, Story 5.6): generalized into a shared
> input-history recall pattern with two consumers — the Logs filter editor (above, scope+mode-
> keyed lists, with the `↓`-from-draft grid browser) and the `:` command bar (UX-DR29, a single
> command list, no grid browser). The push/dedup/trim rules, arrow-browse with draft
> preservation and skip-equal-to-draft, and snap-back-on-keypress behavior are one
> implementation shared by both; each consumer only supplies its own history list(s) and its
> own size/dedup settings.

**UX-DR31** — append:

> Amended 2026-09-28 (Sprint Change Proposal, Story 5.6): the Command Palette tab grows from its
> single flat field (`gridMaxRows`, which owned `Up`/`Down`) to three fields — grid max rows,
> command history size, deduplicate command history — plus a "clear command history" action,
> and gains the same row-cursor navigation model the Logs tab adopted in Story 5.4.

### 4.3 `sprint-status.yaml`

New entry `5-6-command-history-recall-shared-input-history-primitive: backlog` after 5-5, plus a
dated header note; `last_updated: 2026-09-28`.

## 5. Implementation Handoff

**Scope classification: Moderate** — backlog reorganization (new story appended) plus a
cross-feature refactor.

- **Product Owner / Developer (this session, on approval):** apply the `epics.md` edits (new
  Story 5.6, UX-DR29/31/32 amendments) and the `sprint-status.yaml` entry.
- **Developer agent (future `bmad-build` session):** create `story-5-6-...` off the epic-5 branch, write `spec-5-6-...md`, implement in atomic commits
  (suggested order: extract pure input-history module → extract store factory → state adapter
  `commandHistory` → settings + Command Palette tab row cursor → command bar wiring), each
  keeping `npm test && npm run typecheck && npm run depcheck` green.

**Success criteria:** Story 5.6 appears in `epics.md` under Epic 5 with the acceptance criteria
above; UX-DR29/31/32 carry their amendment notes; `sprint-status.yaml` carries the `backlog`
entry; once implemented, the shared recall logic exists exactly once and Story 5.4's tests pass
unchanged.
