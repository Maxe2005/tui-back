---
date: 2026-08-19
trigger: Post-epic-2 functional audit (epics 1-2) + deliberate UX decision (navigation model)
mode: incremental
status: approved
---

# Sprint Change Proposal — TUI Parity & Navigation Corrections

## 1. Issue Summary

A functional audit of epics 1 and 2, run against the original planning intent (`epics.md`, `DESIGN.md`, `EXPERIENCE.md`, `ARCHITECTURE-SPINE.md`), found three gaps between the delivered TUI and its specified experience — all confirmed against the current codebase (branch `epic-2-edt-workspace-management`, commit `6266f1a`, after story 2.6 merged):

1. **No fullscreen rendering.** `src/bin/tui.ts` renders via Ink's default inline mode — no alternate-screen buffer, no binding to `process.stdout.rows`/`columns`. The app never takes over the terminal the way the k9s/lazygit register it's explicitly modeled on (`DESIGN.md` "Brand & Style") requires. This was never specified in `ARCHITECTURE-SPINE.md` or story 1.11 — a planning gap as much as an implementation one.

2. **EDTs zone: read-only view landed, mutation flows did not.** Story 2.6 (merged since the audit was drafted) wired a real branch/divergence display into `edts-zone.tsx`, including working `j`/`k` list navigation — the app's first genuine interactive list. But creating, switching, and modifying an EDT (stories 2.1, 2.4, 2.5) remain CLI-only (`adapters/driving/cli/subcommands.ts`); the TUI never calls `core/edt/create.ts` / `switch.ts` / `modify.ts` in-process. This breaks AD-2's parity guarantee ("a script run by hand and a script triggered from the TUI are provably the same call") in one direction.

3. **Navigation contract change: `j`/`k`/`g`/`G` retired in favor of arrows/Home/End.** Max judges the vim-style bindings impractical. This is a deliberate amendment to the canonical keybinding contract fixed in `EXPERIENCE.md` ("Interaction Primitives") and the AC of story 1.13 (`epics.md`) — not a bug fix. Concretely: `j`/`k` already drive list-cursor movement in `edts-zone.tsx` and the keybinding-help modal's scroll; `g`/`G` (jump to top/bottom) was documented in the footer hint but never implemented anywhere. `Tab` keeps its existing role (cycle between panes / form fields / splitter boundaries) — it does not become a list-movement key.

Discovery: an evidence-based audit (file:line references throughout), not an incident or user complaint mid-session.

## 2. Impact Analysis

**Epic impact.** Epic 1 is closed and already merged into `devlopment` (0 commits behind — reopening its branch would violate the one-branch-per-epic convention). Epic 2 (`epic-2-edt-workspace-management`) is functionally complete (6/6 stories `done`) but not yet merged into `devlopment` (52 commits ahead, PR pending) — still an open branch per `CLAUDE.md`. Epic 3 (`Group Update & Migrations`) is untouched, `backlog`.

→ All three corrections are scoped as **new stories appended to the still-open epic 2**, rather than reopening epic 1 or creating a new epic. Epic 2 merges to `devlopment` once these land; epic 3 starts from a clean base.

**Story impact.** No existing `done` story is rolled back. Story 1.13's AC text is corrected in place (see below) to match the new contract — a documentation correction, not a re-implementation of what 1.13 actually shipped (1.13 explicitly deferred list-navigation wiring to "Epic 2+" and never claimed to deliver it).

**Artifact conflicts.**
- PRD: none — the PRD does not specify keyboard bindings or rendering mode.
- Architecture (`ARCHITECTURE-SPINE.md`): no direct conflict; AD-2 (CLI/TUI parity) is the standing rule that item 2's fix satisfies — no AD needs to change, just the missing implementation.
- UX (`EXPERIENCE.md`, `DESIGN.md`): direct conflicts on the `j`/`k`/`g`/`G` contract (Interaction Primitives, Component Patterns, footer-hint example) — see edits below. `Responsive & Platform` gains a new bullet for fullscreen rendering (an addition, not a correction — the topic was simply undecided before).
- `epics.md`: story 1.13's AC needs the same key-contract correction as `EXPERIENCE.md`.
- No impact on deployment, IaC, CI/CD, or test strategy beyond the new stories' own test coverage.

## 3. Recommended Approach

**Selected approach: Option 1 — Direct Adjustment.** Three new stories appended to the open epic-2 branch; no rollback of completed work, no PRD/MVP scope change.

**Rationale:** all three items are bounded completions/corrections of already-scoped work (epic 2's own EDT-management promise, epic 1's keybinding contract, and a previously-undecided rendering detail) — not a strategic pivot. Effort: low–medium. Risk: low. Epic 2's branch being still open (not yet merged to `devlopment`) makes this the natural landing spot rather than a new epic or a reopened epic 1.

**Sequencing** (dependency-driven, not arbitrary):
1. **Story 2.7 — Canonical navigation contract** (arrows/Home/End/Tab, retire `j`/`k`/`g`/`G`) first — it's a contained refactor of code that already exists (`edts-zone.tsx`, `keybinding-help.tsx`, `footer.tsx`, `keybindings.ts`).
2. **Story 2.8 — Fullscreen TUI rendering** — independent, no dependency on the other two, can run in parallel with either.
3. **Story 2.9 — EDTs zone: create/switch/modify** — deliberately last, so its new forms are built directly against the finalized navigation contract from 2.7 rather than against the retired one.

## 4. Detailed Change Proposals

### 4.1 Story 2.7 — Canonical Navigation Contract (arrows / Home / End / Tab)

**`EXPERIENCE.md` — Interaction Primitives (lines 164-165)**
```diff
- `j` / `k` — move highlight down/up within a list (vim-style).
- `g` / `G` — jump to top/bottom of the current list (vim-style). Reserved for this purpose
  specifically — never zone-switching (see the zone-mnemonic entry below for why that
  distinction matters).
+ `↑` / `↓` — move highlight down/up within a list.
+ `Home` / `End` — jump to top/bottom of the current list.
```
Rationale: vim-style bindings dropped as impractical (Max's product decision). The "never zone-switching" caveat tied to `g`/`G` no longer applies — no collision risk once the vim-style namespace is gone.

**`EXPERIENCE.md` — Component Patterns, `list-row` row**
```diff
- `j`/`k` or arrow keys move the highlight; `g`/`G` jump to top/bottom; `Enter` (or a click)
  activates the highlighted row — same effect regardless of trigger method.
+ Arrow keys move the highlight; `Home`/`End` jump to top/bottom; `Enter` (or a click)
  activates the highlighted row — same effect regardless of trigger method.
```

**`DESIGN.md` — footer-hint example (line 169)**
```diff
- e.g. `[j/k] move  [enter] open  [space] select  [d] dashboard  [q] quit  ^W resize`
+ e.g. `[↑↓] move  [enter] open  [space] select  [d] dashboard  [q] quit  ^W resize`
```

**`epics.md` — Story 1.13 Acceptance Criteria**
```diff
  **Given** any list pane
- **When** `j`/`k` (or arrows) are pressed
+ **When** arrow keys are pressed
  **Then** the highlight moves
- **And When** `g`/`G` are pressed
+ **And When** `Home`/`End` are pressed
  **Then** it jumps to top/bottom — never switching zones
```

**New story 2.7 (sketch — expanded to full dev-ready spec at build time):**

As a developer, I want arrows/Home/End/Tab as the sole list-navigation contract, with no `j`/`k`/`g`/`G` anywhere, so that navigation doesn't require vim familiarity.

- `↑`/`↓` move the cursor within the focused list; `Home`/`End` jump to top/bottom.
- `Tab` keeps its existing role (cycle list/detail pane or splitter boundaries) — unchanged, not repurposed as a list-movement key.
- `j`/`k`/`g`/`G` trigger nothing anywhere in the app after this story.

Code touched: `edts-zone.tsx` (`resolveSelectionDirection` reads `key.upArrow`/`key.downArrow`/`key.home`?/`key.end`? instead of `input==='j'/'k'`), `keybinding-help.tsx` (`resolveHelpScroll` same swap for modal scrolling), `footer.tsx` (`DEFAULT_FOOTER_HINTS`), `keybindings.ts` (`KEYBINDINGS` — `?`-modal labels).

Open technical note for the build: Ink's `useInput` `key` object does not natively expose `key.home`/`key.end` — verify/map the raw ANSI sequences during implementation.

### 4.2 Story 2.8 — Fullscreen TUI Rendering

No contradicting text existed — this is an addition to a previously undecided topic, not a correction.

**`EXPERIENCE.md` — Responsive & Platform, new bullet after the terminal-width one**
```diff
  - **Terminal width/resize.** No specific minimum-width behavior (e.g. a hard floor, a
    reflow breakpoint, or a "too narrow" message) is decided — deferred, non-blocking.
    Not designed now; revisit only if narrow-terminal use (e.g. a cramped tmux pane)
    becomes a real problem in daily use. See Open Questions.
+ - **Terminal fullscreen rendering.** On launch, the TUI takes over the full terminal via
+   the alternate-screen buffer, sized to the terminal's current rows/columns rather than
+   growing inline with scrollback — consistent with the k9s/lazygit register (see Brand
+   & Style). The original screen content is restored on quit, Ctrl+C, or a crash — no
+   leftover TUI output pollutes the shell afterward. Distinct from the still-deferred
+   narrow-terminal minimum-width question above: this decides *that* the app fills the
+   screen, not *how narrow is too narrow*.
```

**New story 2.8 (sketch):**

As a developer, I want the TUI to take over the full terminal on launch, like k9s/lazygit, so that the permanent chrome (top bar/tabs/footer) is always visible without scroll artifacts.

- On launch in a TTY, the TUI enters the alternate-screen buffer and the app shell fills exactly the terminal's current dimensions.
- A terminal resize while the TUI is running triggers a re-render with no visual artifact.
- On exit (`q`, Ctrl+C, crash), the alternate-screen buffer is restored — the terminal returns to its prior content, no TUI output remains stuck to the shell.

Code touched: `src/bin/tui.ts` (enter/exit alt-screen, `SIGINT`/`SIGTERM`/crash handlers), `app-shell.tsx` (size via `process.stdout.rows`/`columns`, listen for the `resize` event).

### 4.3 Story 2.9 — EDTs Zone: Create / Switch / Modify

No text contradiction in `EXPERIENCE.md` (UJ-1 already describes the `checkbox-list-item` creation flow) — this closes an implementation gap. One tension flagged for build time: `EXPERIENCE.md`'s EDTs-zone "Populated" state describes a list grouped **by EDT** with member services nested underneath; story 2.6 (already shipped) instead built a **flat list of every managed service** (member or not), per its own AC4. Recommended resolution — not finalized here: keep 2.6's flat list as the zone's default view, and layer an EDT selector (create/switch/modify) above it that groups/filters the same list by EDT rather than replacing it with a separate view.

**New story 2.9 (sketch):**

As a developer, I want to create, switch, and modify EDTs directly from the TUI's EDTs zone, so that I no longer need the CLI for day-to-day EDT management.

- Given no EDT exists, when the EDTs zone opens, an explicit prompt offers to create one (already required by story 2.1's AC, never wired into the TUI) — topic input + member selection via `checkbox-list-item`, calling `core/edt/create.ts` in-process (AD-2 parity with the CLI).
- Given existing EDTs, when the developer selects a different one, `switchActiveEdt` runs in-process with story 2.4's protected-switch behavior (uncommitted work preserved, locked-action block/prompt).
- Given an existing EDT, when the developer edits members/branch/topic, `modifyEdt` runs in-process under story 2.5's constraints (protected-branch rejection, topic uniqueness).
- All three flows are built directly on story 2.7's navigation contract (arrows/Home/End/Tab) — not on the retired `j`/`k`/`g`/`G`.
- Story 2.6's service/divergence list stays visible alongside the EDT selector (exact composition resolved at build time — see tension note above).

Code touched: `edts-zone.tsx` (major extension), new form components reusing `checkbox-list-item`/`modal-dialog`, `app-store.ts` (create/edit form state). No change to `core/edt/*` (logic already exists) or the CLI.

## 5. Implementation Handoff

**Scope classification: Moderate** — backlog reorganization (3 new stories inserted into `sprint-status.yaml` under epic 2) plus planning-artifact edits (`EXPERIENCE.md`, `DESIGN.md`, `epics.md`), then direct implementation per story.

**Handoff:**
1. **Product Owner / sprint-status maintainer** — apply the `epics.md` edits above (story 1.13 AC correction, three new story entries under Epic 2), then run `bmad-sprint-planning` to register stories `2-7-canonical-navigation-contract`, `2-8-fullscreen-tui-rendering`, `2-9-edts-zone-create-switch-modify` in `sprint-status.yaml` (status `backlog`), preserving the 2.7 → 2.8 → 2.9 sequencing note.
2. **Developer agent (`bmad-build`)** — implement each story on its own branch off `epic-2-edt-workspace-management`, per `CLAUDE.md`'s git workflow (one branch per story, `git merge --no-ff` back into epic-2, conventional commits carrying the story number).
3. Once 2.7/2.8/2.9 are `done`, merge `epic-2-edt-workspace-management` into `devlopment` via PR, then start Epic 3.

**Success criteria:** `EXPERIENCE.md`/`DESIGN.md`/`epics.md` edits applied exactly as specified above; `j`/`k`/`g`/`G` absent from the running app; TUI fills the terminal on launch and restores it on exit; EDTs zone supports create/switch/modify calling the same `core/edt/*` use-cases as the CLI (AD-2 parity restored).

---
*Produced by the `bmad-correct-course` workflow. All three proposals (§4.1–4.3) were reviewed and approved individually in incremental mode.*
