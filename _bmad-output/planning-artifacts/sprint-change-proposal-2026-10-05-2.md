# Sprint Change Proposal — 2026-10-05 (2)

**Project:** tui-back
**Author:** Max (via bmad-correct-course)
**Mode:** Incremental (C1, C2, C3 each approved individually)
**Status:** Approved by Max on 2026-10-05 — artifacts updated

---

## 1. Issue Summary

Three changes from day-to-day use after Story 7.2 (container-less services) landed on its unmerged story branch. C1 was approved for grafting onto Story 7.2 before its epic merge; C2 and C3 become new Epic 7 stories.

| # | Change | Category |
|---|--------|----------|
| C1 | **Logs third group + scoped Ctrl+A + always-visible health + explicit restarting.** Container-less services get an info-only "services without container" section (all registry services, greyed, unselectable, Tab-excluded); Ctrl+A toggles the focused list; health badges render on every row; the `restarting` state is made explicit. | New requirement (grows FR-29), grafted to 7.2 |
| C2 | **Per-service last-run detail in Update (session-only).** Merge vs already-up-to-date (+N/−M lines, F files), migrations ran vs none (+command/output excerpt), kept in memory and replaced by the next run. | New requirement (FR-30) |
| C3 | **Shared focus-navigation component.** Shift+Tab reverses Tab everywhere; each zone declares its mode (H/V arrows, Tab/Shift+Tab, Ctrl+N/P) through one primitive instead of hand-rolled handlers. Runs before 7.4 so alignment consumes it. | UX debt + new requirement |

**Evidence gathered (2026-10-05):**

- **C1:** `logs-zone.tsx:559` handles Ctrl+A only in the `edt-list` focus branch (`other-list` has none); only two lists exist (`logsEdtSelected`/`logsOtherSelected`); health badges render at the cursor/pane level, not per unselected row. Ctrl+A/Ctrl+Shift+A are indistinguishable on virtually every terminal (`logs-zone.logic.ts:291`), while Shift+Tab (`ESC[Z`) is distinguishable.
- **C2:** `GitPort.mergeBranch` returns `Result<void>` (`core/ports/git.ts:82`) — no merge stats exist; already-up-to-date is detectable via HEAD comparison without output parsing, but +/−/files need a new port method. `MigrationPort.run` returns `{output}` for a single per-service command — a generic per-file migration count does not exist (approved scope: ran/skipped + command + excerpt). Session-only approved, so 7.5's persisted datum is untouched.
- **C3:** `shared/keys/tab-navigation.ts` covers only Ctrl+→/Ctrl+N sub-tab stepping; every zone hand-rolls Tab focus handling. Overlaps 7.4 (consistency audit) — sequenced before its alignment phase.

---

## 2. Impact Analysis

### 2.1 Checklist results

| Item | Status | Notes |
|------|--------|-------|
| 1.1 Triggering story | [x] | Story 7.2 (container-less state exists, Logs presentation missing) + Update/UX gaps |
| 1.2 Core problem | [x] | See table above; all three are new requirements / UX debt, no story failure |
| 1.3 Evidence | [x] | Code anchors above |
| 2.1 Current epic | [x] | Epic 7 completes as planned + 2 stories; 7.2 reopens briefly |
| 2.2 Epic-level changes | [x] | No new epic; 7.2 amended, stories 7.7 + 7.8 added |
| 2.3 Remaining epics | [x] | Epics 2–6 unaffected; 7.3 notes Logs third-list compat (no rework) |
| 2.4 Obsolete/new epics | [x] | None obsoleted; none created |
| 2.5 Ordering | [x] | 7.2-graft → 7.8 (parallel OK) → 7.3 → 7.7 → 7.4 → 7.5/7.6 |
| 3.1 PRD | [!] | FR-29 amended; new FR-30 (C2) + FR-31 (C3) |
| 3.2 Architecture | [!] | GitPort extended (C2, AD-16); shared nav primitive (C3, 7.3-adjacent) |
| 3.3 UX | [!] | UX-DR22, UX-DR21 amended; UX-DR36 amended + nav contract |
| 3.4 Other artifacts | [!] | `sprint-status.yaml`; story-7.2 epic merge delayed |
| 4.1 Direct adjustment | Viable | Effort M/M/M–H; risk Low–Medium/Medium/Medium |
| 4.2 Rollback | Not viable | Nothing to revert |
| 4.3 MVP review | Not needed | Additive; MVP intact |
| 4.4 Path | [x] | **Direct Adjustment** (Option 1) |

### 2.2 Epic impact

- **Epic 7 (in-progress):** Story 7.2 reopens (`done` → `in-progress`, graft commits on `story-7-2-…`, epic merge delayed). New **Story 7.7** (shared navigation, before 7.4) and **Story 7.8** (Update last-run detail, parallelizable). 7.4's inventory is unchanged; its alignment phase adopts 7.7's primitive. 7.5 unchanged (C2 is session-only by explicit decision).

### 2.3 Artifact conflicts

| Artifact | Section | Change |
|----------|---------|--------|
| PRD | FR-29 | +1 consequence (C1: info-only third group, scoped Ctrl+A, always-visible health, explicit restarting) |
| PRD | §new | **FR-30**: per-service last-run merge/migration detail, session-only |
| PRD | §new | **FR-31**: Shift+Tab reverses Tab everywhere; one configurable focus-navigation primitive |
| Architecture | AD-16/GitPort | New method (e.g. `diffStat`) for merge +/−/files; HEAD comparison for up-to-date detection |
| Architecture | TUI shared | Nav primitive contract + interface note with 7.3's layout contract |
| EXPERIENCE.md | State Patterns › Logs | Third-group row (greyed, unselectable, Tab-excluded) |
| EXPERIENCE.md | State Patterns › Update | Last-run detail rows (merged/up-to-date, migrations ran/none) |
| EXPERIENCE.md | Interaction Primitives | Shift+Tab rule + nav-component contract (UX-DR36 amendment) |
| epics.md | Epic 7 | 7.2 ACs appended; stories 7.7, 7.8; ordering note |
| sprint-status.yaml | — | 7.2 → `in-progress`; `7-7-shared-focus-navigation: backlog`; `7-8-update-per-service-last-run-detail: backlog` |

### 2.4 Technical impact

- **C1** touches the Logs zone lists, slice selection actions, and badge rendering — the same files 7.3 will migrate to the layout contract; graft now so 7.3 migrates once.
- **C2** changes a core port shape (`GitPort` + driven impl + fakes) and enriches `GroupUpdateRepoResult` details; the Update detail pane renders them from the in-memory last run.
- **C3** touches every zone's input handling; Ink receives Shift+Tab distinctly (`ESC[Z`), so no terminal-protocol risk.

---

## 3. Recommended Approach

**Direct Adjustment.** Amend one story, add two stories. No rollback, no MVP change.

**Sequencing:**

```
7.2-graft (C1: third group, scoped Ctrl+A, health everywhere, restarting) — first, delays epic merge
7.8 (C2: last-run detail) — parallelizable with the graft (core vs TUI-Logs, minimal overlap)
7.3 (layout contract — must compose with the Logs third list)
7.7 (C3: shared navigation component)
7.4 (audit unchanged; alignment adopts 7.7)
7.5 / 7.6 (unchanged)
```

**Effort and risk:**

| Story | Effort | Risk |
|-------|--------|------|
| 7.2-graft (C1) | M | Low–Medium |
| 7.8 (C2) | M | Medium (port shape) |
| 7.7 (C3) | M–H | Medium (all zones' input) |

**Git:**

- Graft commits land on `story-7-2-container-less-managed-services` (still unmerged — no new branch).
- 7.7 and 7.8 each get their own `story-7-N-…` branch from `epic-7-tui-consistency-dashboard-code-hygiene` after the 7.2 merge.
- `sprint-status.yaml`: 7.2 back to `in-progress` on approval; new backlog entries for 7.7/7.8.

---

## 4. Detailed Change Proposals

### 4.1 PRD

**4.1.a: FR-29, append consequence (C1)**

```
- In the Logs zone, services without a container appear in an info-only "services
  without container" section covering every such registry service (members included):
  greyed, unselectable, excluded from Tab order and from Ctrl+A. Ctrl+A toggles the
  focused list only (active EDT members / other services). Every service row shows its
  health badge (up/down/restarting/no container) whether or not the cursor is on it,
  and a restarting service states explicitly that a restart was requested and the
  container state is being re-verified. (Amended 2026-10-05, Sprint Change Proposal.)
```

**4.1.b: New FR-30 (C2)**

```
#### FR-30: Per-service last-run detail in Update (added 2026-10-05, Sprint Change Proposal)

After a group update, the Update zone's detail pane reports per service what really
happened: a successful merge that advanced the branch shows +N/−M lines and F files;
a successful merge with an unchanged HEAD shows "already up to date"; the migrate phase
shows "ran (<command>)" with an output excerpt, or "none" when absent/disabled.
The detail lives in memory only — the next run replaces it, a restart drops it.

**Consequences (testable):**
- HEAD-unchanged-after-merge ⇒ "already up to date", never a diffstat.
- Advanced merge ⇒ +N/−M lines and F files via the GitPort diff capability.
- Migration ran ⇒ command + excerpt; absent/disabled ⇒ "migrations: none".
- CLI parity (FR-1): the same details ride the JSON line additively.
```

**4.1.c: New FR-31 (C3)**

```
#### FR-31: Reversible, unified focus navigation (added 2026-10-05, Sprint Change Proposal)

Wherever Tab advances focus, Shift+Tab moves it back. Every zone declares its focus
movement through one shared navigation primitive (configurable per zone: H/V arrows,
Tab/Shift+Tab, Ctrl+N/P) instead of hand-rolled handlers; the footer and `?` help
reflect the active bindings.
```

### 4.2 Architecture

- **AD-16/GitPort:** add a diff capability (e.g. `diffStat(repoPath, from, to): Result<{files, insertions, deletions}>`) used to render merge +/−/files; up-to-date detection compares HEAD before/after a successful merge (no output parsing). Fakes updated; `ContainerPort`-style "never called with empty" discipline applies to new methods.
- **TUI shared:** new focus-navigation primitive (`resolveFocusStep` + per-zone mode declaration) living beside `shared/keys/tab-navigation.ts`; interface note: it composes with 7.3's zone-layout contract (layout owns panes, nav owns focus order).

### 4.3 UX

- **EXPERIENCE.md › State Patterns › Logs:** add row — `| Without-container group | All registry services without a container (members included), greyed, unselectable, skipped by Tab and Ctrl+A; info only. |`
- **EXPERIENCE.md › State Patterns › Update:** add rows — merged/up-to-date/migrations-ran/migrations-none per §4.1.b.
- **EXPERIENCE.md › Interaction Primitives + UX-DR36:** Shift+Tab rule (always reverses Tab) and the nav-component contract (mode declaration per zone; deviations documented).

### 4.4 Epics (`epics.md`)

**4.4.a: Story 7.2 — append ACs (C1 graft)**

```
- Given the Logs zone listing services, when rendered, then an info-only
  "services without container" section groups every container-less registry
  service (members included): greyed, unselectable, excluded from Tab order
  and Ctrl+A.
- Given focus on "active edt members" or "other services", when Ctrl+A, then
  the select-all toggle applies to the focused list only.
- Given any service row with known health, when rendered, then its
  up/down/restarting/no-container badge is visible with or without cursor.
- Given a restarting service, when displayed, then the state explicitly
  reports "restart requested → container state re-verified" (exact treatment
  at spec: post-restart poll + label), not the bare `restarting` badge.
```

**4.4.b: New Story 7.7 — Shared Focus-Navigation Component (C3, before 7.4)**

```
As a developer, I want one shared navigation primitive so Tab/Shift+Tab move
focus the same way in every zone, with Shift+Tab always reversing Tab.

ACs:
- Given the `focus-navigation` primitive, when Tab advances, then Shift+Tab
  retreats everywhere Tab navigates (lists, sub-zones, panes).
- Given the per-zone mode declaration, when configured, then each zone uses
  H/V arrows, Tab/Shift+Tab, or Ctrl+N/P with no ad-hoc Tab handler left.
- Given all zones migrated, when rendered, then footer and `?` reflect the
  active bindings from the same declarations.
```

**4.4.c: New Story 7.8 — Update Per-Service Last-Run Detail (C2, parallelizable)**

```
As a developer, after a group update I want the detail pane to report per
service what really happened, so I trust the run without re-checking by hand.

ACs:
- Given a successful merge with unchanged HEAD, when shown, then
  "already up to date", never a diffstat.
- Given an advancing merge, when shown, then +N/−M lines and F files.
- Given the migrate phase ran, when shown, then "ran (<command>)" plus an
  output excerpt; when absent/disabled, then "migrations: none".
- Given a new run finishes, when it lands, then it replaces the previous
  detail (session-only, never persisted).
- Given the CLI, when a run ends, then the same details ride the JSON line.
```

### 4.5 Other artifacts

- **`sprint-status.yaml`:** `7-2-container-less-managed-services: in-progress`; add `7-7-shared-focus-navigation: backlog`, `7-8-update-per-service-last-run-detail: backlog` (+ execution-order note update).
- **Git:** story-7.2 epic merge stays pending until the graft lands.

---

## 5. Implementation Handoff

**Scope classification: Moderate.** One story amended pre-merge, two stories added, additive PRD/architecture/UX amendments, no replan.

| Role | Responsibility |
|------|----------------|
| Developer agent (bmad-build) | 7.2 graft first on the open story branch; then 7.8; then 7.3 → 7.7 → 7.4 → 7.5/7.6 |
| Developer (Max) | Approve this proposal; merge story-7.2 into epic-7 after the graft; validate 7.7's mode table before zone migration |
| PO (sprint-status) | Status flips + new entries on approval |

**Success criteria:**

- C1: third group renders info-only; Ctrl+A is focus-scoped; health on every row; restarting is explicit.
- C2: up-to-date vs merged + diffstat + migrations ran/none per service, session-only, CLI parity.
- C3: Shift+Tab reverses Tab everywhere; zero hand-rolled Tab handlers; footer/`?` generated from declarations.
- Green `npm test && npm run typecheck && npm run depcheck` throughout.
