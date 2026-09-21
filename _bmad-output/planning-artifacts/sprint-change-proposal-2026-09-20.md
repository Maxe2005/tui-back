---
date: 2026-09-20
trigger: 'Rendering-corruption defect found and reproduced live by Claude Code while fixing a related Settings-tab bug on story-5-4-filter-history-recall — the Logs zone''s service lists, hints panel, and LogFilterEditor (including its Story 5.4 history-grid browser) render with no height cap, corrupting the display once content exceeds the terminal''s actual rows. Reported by Max as a crash ("lors de l''ouverture de 3 panes de logs et également si on visite la grille de l''historique des filtres").'
mode: incremental
epic_impact: 'Epic 5 (in-progress) — 1 new story appended (5.5). Also touches edts-zone.tsx (Epic 2 territory, same defect pattern) as part of Story 5.5, mirroring Story 2.20''s precedent of a bug fix riding the currently-open epic branch closest to the trigger. No epic redefinition, no PRD FR renumbering, no MVP change.'
scope_classification: minor
---

# Sprint Change Proposal — 2026-09-20

## 1. Issue Summary

While fixing an unrelated, already-reported bug in the Settings screen's Logs tab (the
`SETTINGS` title rendering as `--ttings`, filter-history-grid settings rows overlapping —
fixed earlier in this session by regrouping that tab, mirroring the EDTs tab's group-list
pattern), Max reported the same family of symptom elsewhere: **"l'outil crash lors de
l'ouverture de 3 panes de logs et également si on visite la grille de l'historique des
filtres."**

Claude Code reproduced this live against Max's real Docker services (`api-gateway`,
`micro-organizations`, `repo_3`), rather than guessing from the code:

- Opening the global filter editor (`/`) while 3 log panes were active corrupted the modal's
  own title — `GLOBAL LOG FILTER` rendered as `──OBAL LOG FILTER` — the exact same corruption
  pattern as the Settings bug, in a completely different, untouched component
  (`LogFilterEditor` in `logs-zone.tsx`).
- The Logs zone's **base screen** (zero panes, zero filter editor) already overflows at a
  100×30 terminal against Max's real registry (~9 services): checkbox glyphs vanish
  (`[  micro-organizations` instead of `[ ] micro-organizations`), hint lines merge or drop
  words entirely.
- No actual process crash was observed (the TUI stays alive) — but the display becomes
  unreadable/unusable, which is functionally a crash from Max's perspective and squarely hits
  the PRD's existing Trust — Usability guardrail ("navigation must never be confusing enough to
  cause outright rejection of the tool").

**Root cause:** `LogFilterEditor` is appended as a sibling *below* the Logs zone's full
content in the same column layout — not a true overlay (Ink has no absolute positioning) — and
the zone's service lists plus its 15-line keybinding-hints panel have no height cap or scroll,
unlike `keybinding-help.tsx`'s own `?`-triggered help overlay, which already solves this exact
problem correctly (`resolveHelpWindow`/`clampHelpOffset`, windowed + scrollable). `edts-zone.tsx`
has the identical unbounded-list pattern, confirmed by inspection, though no crash has been
reported there yet.

**Partial fix already shipped** (this session, on `story-5-4-filter-history-recall`): the
hints panel is now hidden while `LogFilterEditor` has input focus (its keybindings are
genuinely inert then), which resolved the specific filter-history-grid corruption Max hit.
This proposal generalizes that fix into a reusable primitive and closes the remaining gap (the
zero-pane base-screen overflow, and the EDTs zone's identical defect).

## 2. Impact Analysis

### Epic Impact

Epic 5 can still be completed exactly as planned — this is purely a defect fix, not a scope
change. **Story 5.5 — Bound List & Filter-Editor Height to the Terminal Window** is appended
to Epic 5, after 5.4. Story 5.5's implementation also touches `edts-zone.tsx` (Epic 2
territory) to apply the same fix there — Epic 2 is not reopened or resequenced; this mirrors
Story 2.20's own precedent (a bug fix touching a different epic's files, appended to whichever
epic's branch is currently open and closest to the trigger).

### Story Impact

- **Story 5.4 (review):** not reopened. Its own acceptance criteria are unaffected; the
  hint-panel-hidden-while-editing change already landed on its branch is retained as part of
  Story 5.5's broader fix, not undone.
- **New Story 5.5:** see Section 4.

### Artifact Conflicts

**PRD** (`prd.md`): no FR conflict — this is a correctness/reliability concern, not new
filtering/observability functionality (FR-16/17/18 unaffected). The Cross-Cutting NFRs list has
no existing bullet covering "content must fit the terminal," which is a genuine gap surfaced by
this defect — closed with a new **NFR-7 — Rendering correctness** bullet, appended at the end
of the list (never renumbering existing NFRs, per this project's established convention).

**Architecture** (`ARCHITECTURE-SPINE.md`): no AD conflict. AD-12 (performance budget) is
adjacent but concerns re-render batching/frequency, not layout-height correctness — no
amendment needed there. No new AD required; the fix reuses an already-correct in-repo pattern
(`keybinding-help.tsx`) rather than introducing new architecture.

**UI/UX** (`epics.md`'s UX-DR list):
- `UX-DR22` (Logs zone states) needs an amendment: service lists, hints panel, and
  `LogFilterEditor` now render within a bounded/scrollable window.
- `UX-DR20` (EDTs zone states) needs an amendment: its EDT SERVICES/OTHER SERVICES lists adopt
  the same primitive.
- A new `UX-DR33` is added for the extracted `bounded-list` component itself.

**Other artifacts:** no CI/CD, deployment, or IaC impact — entirely within the TUI adapter.
Test files (`logs-zone.test.tsx`, `logs-zone.interaction.test.tsx`, `edts-zone.test.tsx`, plus
new coverage for the extracted `bounded-list` primitive and `keybinding-help.tsx` itself, whose
windowing logic is being extracted rather than duplicated) will need new/updated cases, per the
project's existing per-story testing convention.

## 3. Recommended Approach

**Selected: Option 1 — Direct Adjustment.** Add Story 5.5 to Epic 5's existing branch structure
(its own `story-5-5-...` branch off `epic-5-aggregated-log-observability`, per this repo's git
workflow convention). No rollback, no PRD/MVP scope reduction.

- **Effort estimate:** Medium. Extracting `keybinding-help.tsx`'s windowing logic into a shared
  primitive and applying it in two zones is mechanical (the pattern is already proven and
  tested in this codebase), but touches two zones' render trees plus a new shared component.
- **Risk:** Low. The primitive being extracted is already shipped, correct, and tested — this
  is reuse, not new design. The one thing to watch: Story 5.5's acceptance criteria explicitly
  require zero visible-behavior change on terminals large enough that nothing currently
  overflows, so this must not regress the (already correct) common case.
- **Rationale:** Max explicitly chose (this session) to bundle the Logs-zone fix and the
  EDTs-zone fix into one story rather than split them, on the basis that they're the same
  underlying defect and mechanism — extracting one reusable primitive now avoids re-doing this
  investigation later when the EDTs zone's dormant instance of the same bug eventually surfaces
  on its own.

## 4. Detailed Change Proposals

### New Story (Epic 5)

#### Story 5.5: Bound List & Filter-Editor Height to the Terminal Window

> Added 2026-09-20 (Sprint Change Proposal): fixes a rendering-correctness defect surfaced
> while reviewing Story 5.4 — the Logs zone's service lists, always-visible keybinding hints
> panel, and LogFilterEditor (including its Story 5.4 history-grid browser) render with no
> height cap. When their combined content exceeds the terminal's actual row count, Ink's
> diff-render desyncs from the real terminal cursor and corrupts already-painted lines (glyphs
> vanish, lines merge/disappear) — reproduced live against real Docker services with 3 active
> panes and the filter-history grid open. A partial fix (hiding the hint panel while the filter
> editor has input focus, since its keybindings are inert then) already landed on
> story-5-4-filter-history-recall; this story generalizes it into a reusable bounded/scrollable
> list primitive and applies it everywhere the same defect exists — including the EDTs zone
> (Epic 2 territory, same unbounded-list pattern, no crash reported there yet but confirmed by
> inspection). Appended to Epic 5 (branch still open, where the defect was found and partly
> fixed) even though it also touches `edts-zone.tsx` — same "bug fix riding the currently-open
> epic branch" precedent as Story 2.20.

As a developer, I want every list and modal panel in the Logs and EDTs zones to stay within my
terminal's actual size, scrolling instead of overflowing, So that the tool never corrupts its
own display regardless of how many services I have registered or how small my terminal is.

**Acceptance Criteria:**

- **Given** the Logs zone's service lists (ACTIVE EDT MEMBERS / OTHER SERVICES) and its
  always-visible keybinding hints panel **When** their combined content would exceed the
  terminal's available rows **Then** they render within a bounded, scrollable window instead of
  overflowing and corrupting the display — reusing the windowing pattern already proven in
  `keybinding-help.tsx` (`resolveHelpWindow`/`clampHelpOffset`), extracted into a shared
  primitive rather than duplicated
- **Given** the EDTs zone's EDT SERVICES / OTHER SERVICES lists **When** the same overflow
  condition applies **Then** they adopt the same bounded/scrollable list primitive — no separate
  ad hoc fix between the two zones
- **Given** `LogFilterEditor` is open (global or per-service, with or without the Story 5.4
  history-grid browser) **When** the zone's other content (service lists, hint panel, pane grid)
  is still rendered behind it **Then** the combined content never exceeds the terminal's row
  count — this story's bounded-list primitive is one part of the mechanism; the
  hint-panel-hidden-while-editing fix already shipped on story-5-4-filter-history-recall is
  retained, not undone
- **Given** the filter-history grid browser has more entries than fit vertically **When** it's
  rendered **Then** it scrolls/paginates within the available height rather than growing past it
  (mirrors `command-grid`'s existing horizontal truncation/scroll, UX-DR30, now applied
  vertically too)
- **Given** a bounded list is scrolled away from its start or end **When** rendered **Then** a
  subtle indicator shows there is more content above/below — never a silent, undiscoverable
  cutoff
- **Given** any bounded list or panel **When** the terminal is resized **Then** its visible
  window recalculates live off `useWindowSize()` — never a stale window computed only at mount
- **Given** a terminal large enough that nothing currently overflows **When** the Logs or EDTs
  zone is used **Then** visible behavior is unchanged from before this story — this is a defect
  fix and a reusable primitive, not a redesign

**Implementation notes:** extract a `bounded-list`/scrollable-window primitive out of
`keybinding-help.tsx`'s `resolveHelpWindow`/`clampHelpOffset` (already correct, already tested)
into `tui/shared/`; apply it to `logs-zone.tsx`'s two service lists, its hints panel, and
`LogFilterEditor`'s body (including the history grid); apply the same primitive to
`edts-zone.tsx`'s EDT SERVICES/OTHER SERVICES lists. New shared component per Atelier
convention (UX-DR33, see below). No change to `ModalDialog` itself required — the fix is
bounding what's rendered *inside* each panel, not the panel chrome.

### Amendments to Existing Text (superseding notes, not reopenings)

**PRD, Cross-Cutting NFRs** — new bullet appended at the end of the list (no renumbering of
existing NFRs):

> **NFR-7 — Rendering correctness.** No panel or list may render content taller than the
> terminal's actual available rows — Ink has no true scroll/overlay mechanism, so overflow
> desyncs its diff-render from the real terminal cursor and corrupts already-painted lines. Any
> zone with a data-dependent or user-configurable list length must bound/scroll it rather than
> assume it fits.

**`epics.md`, UX-DR22** (Logs zone states) — amend to add:

> Amended 2026-09-20 (Sprint Change Proposal, Story 5.5): service lists, the hints panel, and
> `LogFilterEditor` (including its history-grid browser) now render within a bounded, scrollable
> window rather than unconditionally, preventing terminal-overflow rendering corruption.

**`epics.md`, UX-DR20** (EDTs zone states) — amend to add:

> Amended 2026-09-20 (Sprint Change Proposal, Story 5.5): EDT SERVICES/OTHER SERVICES lists
> adopt the same bounded/scrollable list primitive as the Logs zone, for the same reason.

**`epics.md`, new UX-DR33**:

> UX-DR33 (added 2026-09-20, Sprint Change Proposal, Story 5.5): Implement the `bounded-list`
> component — a scrollable window over any list or panel whose content can exceed the
> terminal's available rows, extracted from `keybinding-help.tsx`'s
> `resolveHelpWindow`/`clampHelpOffset`; shows a subtle more-above/below indicator when
> scrolled away from either end, recalculates live off `useWindowSize()`. Reused by the Logs
> zone (service lists, hints panel, `LogFilterEditor`) and the EDTs zone (EDT SERVICES/OTHER
> SERVICES lists).

## 5. Implementation Handoff

**Scope classification: Minor.** Direct implementation, no backlog reorganization beyond
appending one story — routed to:

- **Product Owner / Developer (this session, on approval):** apply the artifact edits directly
  — `epics.md` (new Story 5.5, UX-DR20/22 amendments, new UX-DR33), `prd.md` (new NFR-7),
  `sprint-status.yaml` (new `5-5-bound-list-filter-editor-height-to-the-terminal-window:
  backlog` entry).
- **Developer agent (future `bmad-build`/`bmad-spec` session, when Story 5.5 is picked up):**
  turn this story into a full spec (`spec-5-5-...md`) and implement it, following this repo's
  one-branch-per-story convention off the `epic-5-...` branch.

**Success criteria:** Story 5.5 appears in `epics.md` under Epic 5 with the acceptance criteria
above, `sprint-status.yaml` carries a `backlog` entry for it, and the PRD/epics amendments above
are applied verbatim.
