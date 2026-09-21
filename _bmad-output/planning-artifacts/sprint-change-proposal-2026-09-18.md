---
date: 2026-09-18
trigger: 'New capability requested by Max while reviewing Epic 5 backlog (checking Story 5.3''s relevance) — a filter history/recall system for the Logs zone''s text/regex filter editor (Story 5.2, done)'
mode: incremental
epic_impact: 'Epic 5 (in-progress) — 1 new story appended (5.4). Story 5.3 stays as-is, in backlog. No epic redefinition, no PRD FR renumbering, no MVP change.'
scope_classification: moderate
---

# Sprint Change Proposal — 2026-09-18

## 1. Issue Summary

While reviewing Epic 5's backlog, Max asked to be reminded what Story 5.3 ("Inline Service
Health & Restart Control") does, unsure whether it's still needed. Confirmed: Story 5.3 is
still required — it's the story that activates the "Restart" action Story 2.15 already shipped
disabled (annotated "Available with Epic 5"), plus the inline health badge. Max chose to keep
it as-is and instead use this session to propose an unrelated, additive capability: a **filter
history/recall system** for the Logs zone's filter editor (Story 5.2, `done`).

**Requested capability, in Max's words:** the filter editor (global or per-service, text or
regex) should remember the last N filters used, N configurable in settings, with a separate
history per scope (global vs. each service). Navigating history: `↑` from a draft recalls the
most recent entry, replacing the draft (which is preserved); further `↑` walks older entries up
to N; `↓` walks back toward the draft. Typing while browsing snaps back to the draft. `↓` from
the draft itself (not browsing) opens the same grid-browser UI the command palette uses,
listing the full history. The Logs settings tab should also gain a way to clear this history,
globally or per service.

This is not a bug or a technical blocker — it's a new requirement surfaced directly by Max, the
product owner, outside of any specific story's review.

## 2. Impact Analysis

### Epic Impact

Epic 5 can still be completed exactly as originally planned; nothing about this request
invalidates Story 5.1, 5.2, or 5.3. It's purely additive: **Story 5.4 — Filter History Recall**
is appended to Epic 5, after 5.3. No other epic (past or future) is affected, no resequencing
needed.

### Story Impact

- **Story 5.2 (done):** not reopened. Its filter-editor mechanics stay exactly as shipped; 5.4
  builds on top of `FilterEditorState`/`useInput` without changing 5.2's own acceptance
  criteria.
- **Story 5.3 (backlog):** unaffected, confirmed still necessary (see Issue Summary). No change.
- **New Story 5.4:** see Section 4 for the full story.

### Artifact Conflicts

**PRD** (`prd.md`): FR-17 ("Filter the aggregated stream") covers filter *mechanics*
(service/text/regex/level, non-interrupting, inline regex-error rejection) but not recall of
past filters — this is a genuine elaboration, not a contradiction. No MVP scope change; FR-17
gets an amendment note (not a new FR number), consistent with how prior Sprint Change Proposals
amended existing FRs (e.g. FR-16/FR-9's testable-consequence amendments) rather than
renumbering.

**Architecture / boundaries — the one real conflict found:** Story 5.2's frozen spec
(`spec-5-2-filter-the-aggregated-stream.md:35`) states, under **Never**: *"Persist any filter to
`settings.ts` or disk — ephemeral UI state only, like 5.1's visibility/wrap flags."* Filter
history necessarily requires disk persistence (a history that resets every session isn't a
history). This is **not actually a contradiction** — 5.2's rule is about the *live, active*
filter state; history is a distinct concept (a record of past commits, not current state) — but
it must be called out explicitly so a future reviewer doesn't flag 5.4 against 5.2's boundary by
mistake. The natural home for the persisted data is `StatePort`/`state.json` (AD-7, AD-10) —
the same durable-state mechanism already used for `activeEdt` and per-zone splitter ratios — not
`SettingsPort`/`settings.yaml`, which holds developer *preferences* (like the new history-size
and grid-rows settings), not history *data*.

**UI/UX** (`DESIGN.md`/`EXPERIENCE.md`, and the UX-DR list in `epics.md`):
- `UX-DR22` (Logs zone states) needs a new state: filter-history browsing (arrow-recall +
  grid-browser).
- `UX-DR30` (the `command-grid` component, built for the command bar) is **generalized and
  reused** for the filter-history grid browser — same column-major/arrow-nav/truncation
  mechanism, second independent instance, its own `gridMaxRows`-equivalent setting.
- `UX-DR31` (settings screen) needs an amendment: the Logs tab, which currently has **no row
  cursor** (`Up`/`Down` is claimed exclusively by `bufferSize`, `Space` by `startWithHistory` —
  an existing code comment says as much), grows to 4 fields plus history-clear actions and must
  gain a row-cursor navigation model, mirroring the EDTs tab's group-list idiom.
- A new `UX-DR32` is added for the filter-history recall interaction itself (arrow-browse +
  draft-preservation + grid-browser entry point).

**Other artifacts:** no CI/CD, deployment, or IaC impact — this is entirely within the TUI
adapter and the existing settings/state persistence adapters. Test files
(`logs-zone.logic.test.ts`, `logs-zone.test.tsx`, `logs-zone.interaction.test.tsx`,
`settings-screen.test.tsx`, plus new coverage for the generalized grid primitive and the
`state`/`settings` adapters) will need new cases, per the project's existing per-story testing
convention — no new tooling required.

## 3. Recommended Approach

**Selected: Option 1 — Direct Adjustment.** Add Story 5.4 to Epic 5's existing branch structure
(its own `story-5-4-...` branch off `epic-5-aggregated-log-observability`, per this repo's
git workflow convention). No rollback, no PRD/MVP scope reduction.

- **Effort estimate:** Medium. It touches four layers (a new persisted-state concept, two new
  settings fields, a generalized reusable grid component, and a settings-tab UI model rework)
  but every one of them has a direct, established precedent already in the codebase
  (`StatePort`, `commandPalette.gridMaxRows`, `command-bar.tsx`'s grid primitives, the EDTs
  tab's row-cursor/drill-down model) — this is assembly of known patterns, not new architecture.
- **Risk:** Low-Medium. The one nontrivial risk is scope creep inside the Logs settings tab
  rework (introducing a row cursor touches two already-shipped fields, `bufferSize` and
  `startWithHistory`) — flagged explicitly in the story's acceptance criteria so it isn't
  discovered mid-implementation.
- **Rationale:** The request is well-specified (Max described the exact interaction model),
  additive, and self-contained within Epic 5's existing territory (same zone, same settings
  screen). Bundling it as one story matches this project's own precedent (e.g. Story 2.19 folded
  multiple settings-tab concerns into one story) and Max's explicit preference, expressed during
  this session, to keep it as a single story rather than splitting the settings-UI rework out.

## 4. Detailed Change Proposals

### New Story (Epic 5)

#### Story 5.4: Filter History Recall

> Added 2026-09-18 (Sprint Change Proposal): new capability for the filter editor (Story 5.2) —
> recall the last N text/regex filters used, per scope (global / per-service), instead of
> retyping them. Introduces the first *persisted* data tied to filters — Story 5.2's "ephemeral,
> never persisted" boundary continues to apply to the live/active filter state; history is a
> distinct concept (a record of past commits) and is explicitly exempted. Also reworks the Logs
> tab of `:settings` to a row-cursor navigation model to accommodate the new fields and
> history-clear actions.

As a developer, I want the filter editor to remember and let me recall the recent text/regex
filters I've used, So that I don't have to retype filters I've already used, across services and
across sessions.

**Acceptance Criteria:**

- **Given** a filter editor (global or per-service) **When** a filter is committed (`Enter`,
  compiles successfully, non-empty query) **Then** it's pushed to the front of that exact
  scope+mode's history (global vs. that specific service; text vs. regex — two independent
  lists per scope), moved-to-front instead of duplicated if identical to the current top entry,
  trimmed to the configured maximum size N
- **Given** the developer is typing a fresh draft in the editor **When** `↑` is pressed **Then**
  the input is replaced by the most recent entry of that exact scope+mode's history, and the
  in-progress draft is preserved for later
- **Given** the developer is browsing history via `↑` **When** `↑` is pressed again **Then** it
  moves to the next-older entry, up to the oldest (position N); `↑` at the oldest entry is a
  no-op
- **Given** the developer is browsing history via `↑`/`↓` **When** `↓` is pressed **Then** it
  moves toward more recent entries, and one more `↓` from the most-recent entry restores the
  original draft exactly as it stood before browsing began
- **Given** the developer is browsing history (arrow-recall or the grid below) **When** a
  printable character or Backspace is pressed **Then** browsing stops, the original draft is
  restored, and that keypress is applied on top of it (same one-key resume as if it had never
  left the draft)
- **Given** the developer is on their own draft (not browsing) **When** `↓` is pressed **Then**
  the same column-major, arrow-navigable grid browser used by the command palette
  (`command-bar.tsx`, UX-DR30) opens, listing every entry of that scope+mode's history, its
  rows-per-column governed by its own setting (below) — not `commandPalette.gridMaxRows`;
  `Enter` recalls the highlighted entry into the input, `Esc` closes the bar entirely
- **Given** the `:settings` Logs tab **When** the developer adjusts "filter history size"
  (`settings.logs.filterHistorySize`, mirrors `logs.bufferSize`'s clamp/adjust idiom) **Then** a
  history already at that size drops its oldest entry on the next new one
- **Given** the `:settings` Logs tab **When** the developer adjusts "filter history grid rows"
  (`settings.logs.filterHistoryGridMaxRows`, mirrors `commandPalette.gridMaxRows` exactly but as
  its own independent value) **Then** the history grid browser's rows-per-column follows it
- **Given** the `:settings` Logs tab **When** the developer wants to clear history **Then** they
  can clear the global filter history, or a specific service's filter history, independently —
  never clearing more than what's targeted
- **Given** the Logs tab now has 4+ fields plus history-clear actions **When** the tab is
  navigated **Then** it gains a row cursor (`Up`/`Down` moves between fields, mirrors the EDTs
  tab's group-list idiom) — `bufferSize`/`startWithHistory`'s existing no-row-cursor scheme is
  reworked so every field stays reachable unambiguously
- **Given** the app is restarted **When** the filter editor is reopened **Then** previously
  recorded history is still available — persisted to disk (unlike the live filter state itself,
  which stays ephemeral per Story 5.2's boundary)

**Implementation notes:** new persisted state (likely `StatePort`, alongside `activeEdt`/
`splitterRatios` in `state.json` — never `settings.ts` itself, which holds preferences, not
history data); new `settings.logs.filterHistorySize` and `settings.logs.filterHistoryGridMaxRows`
preferences (own `MIN`/`MAX` constants, same single-source-of-truth convention as
`MIN_GRID_MAX_ROWS`/`MIN_LOG_BUFFER_SIZE`); reuses `command-bar.tsx`'s grid-browser primitives
(`groupCommandsByColumn`/`layoutCommandGrid`/grid cursor movement) generalized beyond
`Command[]`; extends `logs-zone.tsx`'s `FilterEditorState`/`useInput` (draft-vs-browsing state
machine, mirrors `TabPressState`'s "stamped state, not a timer" idiom); reworks the Logs
settings tab's input model to a row cursor (breaking its current
Up/Down-is-bufferSize-only scheme).

### Amendments to Existing Text (superseding notes, not reopenings)

**PRD, FR-17** ("Filter the aggregated stream") — add a note (not a new FR number): filter
history/recall (Story 5.4, Epic 5) is an elaboration of this FR, covering recall of previously
used filters rather than new filtering mechanics.

**`epics.md`, UX-DR22** (Logs zone states) — amend to add: filter-history browsing (arrow-recall
and grid-browser) as a new named state (Story 5.4).

**`epics.md`, UX-DR30** (`command-grid` component) — amend to note: the component is generalized
and reused by Story 5.4 for the filter-history grid browser, a second independent instance with
its own `gridMaxRows`-equivalent setting.

**`epics.md`, UX-DR31** (settings screen) — amend to note: the Logs tab (Story 5.4) grows past
its current flat/no-row-cursor model and gains a row cursor, alongside the EDTs tab's own
group-list precedent.

**`epics.md`, new UX-DR32** — Implement filter-history recall: `↑`/`↓` arrow-browse over a
scope+mode-specific history with draft preservation, any printable/Backspace keypress while
browsing snapping back to the draft with that keypress applied, and a `↓`-from-draft entry point
into the (reused) grid browser (Story 5.4).

## 5. Implementation Handoff

**Scope classification: Moderate.** Backlog reorganization (new story appended, no epic
redefinition) plus direct implementation once picked up — routed to:

- **Product Owner / Developer (this session, on approval):** apply the artifact edits below
  directly — `epics.md` (new Story 5.4, UX-DR22/30/31 amendments, new UX-DR32),
  `sprint-status.yaml` (new `5-4-filter-history-recall: backlog` entry).
- **Developer agent (future `bmad-build`/`bmad-spec` session, when Story 5.4 is picked up):**
  turn this story into a full spec (`spec-5-4-filter-history-recall.md`) and implement it,
  following this repo's one-branch-per-story convention off the `epic-5-...` branch.

**Success criteria:** Story 5.4 appears in `epics.md` under Epic 5 with the acceptance criteria
above, `sprint-status.yaml` carries a `backlog` entry for it, and Story 5.3 is confirmed
unchanged/still necessary.
