# Sprint Change Proposal — 2026-10-01

**Project:** tui-back
**Author:** Max (via bmad-correct-course)
**Mode:** Batch
**Status:** Approved by Max on 2026-10-01 — artifacts updated

---

## 1. Issue Summary

Six changes came out of day-to-day use of the tool after Epics 2, 3, 5 and 6 reached functional completeness. None was triggered by a single failing story. They are new requirements and code-hygiene debt surfaced by the developer:

| # | Change | Category |
|---|--------|----------|
| C1 | **Code comment hygiene.** Source comments are dominated by story/AC/review-patch archaeology instead of explaining the code. | Technical debt |
| C2 | **`Ctrl+W` resize-mode in every zone**, which means rebuilding how zones declare their panes so every zone is resizable. | Incomplete requirement (UX-DR10) |
| C3 | **Build the Dashboard.** It is still a banner plus `ZonePlaceholder`; UX-DR19 was never implemented. | Incomplete requirement + new scope |
| C4 | **Harmonize shared commands and components**, for a consistent TUI and consistent navigation across zones. | Technical / UX debt |
| C5 | **Update: merge from another EDT.** When updating an EDT, choose a global merge source (shared branches, which is today's default, or another EDT), with per-service fallback. | New requirement |
| C6 | **Container-less services.** A managed service may have no Docker container (a library, a front build, `shared-types`, …). | New requirement |

**Evidence gathered (2026-10-01):**

- **C1:** `grep -E "story [0-9]|Story [0-9]|AC[0-9]|review patch|Boundaries:"` matches **1,828 lines in 211 of the 272 files** under `src/`. Typical examples:
  - `dashboard-zone.tsx` opens with a 13-line header narrating story 2.11 and 2.16 decisions.
  - `app-shell.tsx:85-89` quotes spec "Boundaries" text verbatim.
  - `edt-registry.ts:20` is a `// Story 2.4 (review patch): …` above a one-line type.
- **C2:** `app-shell.tsx:94` (`shouldEnterResizeMode`) hard-codes `activeZone === 'edts'`. Routes and Update already render a `listSplitterTargeted` prop and the navigation slice already stores ratios per zone, but the two can never be engaged. In Logs, `Ctrl+W` is already bound to "wrap all panes" (`logs-zone.logic.ts:356`, `isWrapAllLogsKey`), which is a direct conflict.
- **C3:** `dashboard-zone.tsx` renders `<LaunchBanner />`, then either the empty-registry prompt or `<ZonePlaceholder zoneId="dashboard" />`. Two prerequisites are missing:
  - No port persists the last group-update outcome, so "last group-update timestamp" (UX-DR19) has no data source.
  - Neither the cold-load, "no EDT yet" nor background-event-badge states exist.
- **C5:** `UpdateConfigDialog` (Story 3.7) offers one `sourceBranch` per row, pre-filled from the manifest `sharedBranch`. There is no bulk way to point the run at another EDT's branches. EDT members already carry a `{service, repoPath, branch}` triple (`EdtMember`), which is all the resolution needs.
- **C6:** `Manifest.container` is a required `string` (`core/ports/manifest.ts:8`, zod `z.string().trim().min(1)`). It is dereferenced unconditionally in:
  - `logs-slice.ts` (subscribe, health poll, restart)
  - `update-slice.ts` (health poll)
  - `group-update.ts` (`container.restart(containerName)`)
  - `list-repos.ts` and `cli/subcommands.ts`

  A repo without a container cannot be registered today.

---

## 2. Impact Analysis

### 2.1 Checklist results

| Item | Status | Notes |
|------|--------|-------|
| 1.1 Triggering story | [N/A] | Developer feedback, not a story failure |
| 1.2 Core problem | [x] | See table above |
| 1.3 Evidence | [x] | See evidence list above |
| 2.1 Current epic | [x] | Epic 2 is unaffected (no story reopened). Epic 3 gains Story 3.12. |
| 2.2 Epic-level changes | [x] | **New Epic 7** "TUI Consistency, Dashboard & Code Hygiene"; Epic 3 extended |
| 2.3 Remaining epics | [x] | Epic 4 (shared-types): C6 helps it, since `shared-types` is likely container-less. Epic 5 (Logs): C2 remaps `Ctrl+W`, C6 adds a "no container" pane state. Epic 6 (Routes): C2 makes its splitter live. |
| 2.4 Obsolete or new epics | [x] | No epic obsoleted; one new epic |
| 2.5 Ordering | [x] | 7.1 runs first, while no story branch is in flight (see §3) |
| 3.1 PRD | [!] | FR-25 amended; new FR-28 and FR-29 |
| 3.2 Architecture | [!] | AD-4 (manifest `container` optional); new AD-17 (comment convention) |
| 3.3 UX | [!] | UX-DR10, UX-DR19 and UX-DR21 amended; new UX-DR35 (zone layout contract) and UX-DR36 (interaction consistency contract); EXPERIENCE.md Dashboard and Update states |
| 3.4 Other artifacts | [!] | `AGENTS.md` (comment convention), `manifest-generator` skill (optional `container`), CLI usage (`update --from-edt`) |
| 4.1 Direct adjustment | Viable | Effort: High overall, split across 7 stories. Risk: Medium. |
| 4.2 Rollback | Not viable | Nothing to revert |
| 4.3 MVP review | Not needed | Additive; MVP intact |
| 4.4 Path | [x] | **Direct Adjustment** (Option 1) |

### 2.2 Epic impact

- **Epic 3 (in-progress, all stories done):** append **Story 3.12** (merge source from another EDT). It extends Story 3.7's configuration interface. Stories 3.7 and 3.11 are not reopened.
- **Epic 7 (new):** stories 7.1–7.6.
- **Epics 4, 5, 6:** no story text changes. The future stories inherit the conventions of 7.1, 7.3 and 7.4.

### 2.3 Artifact conflicts

| Artifact | Section | Change |
|----------|---------|--------|
| PRD | FR-25 | New consequence: global merge-source strategy (C5) |
| PRD | §4.3 | New **FR-28**: merge source from another EDT |
| PRD | §4.1 | New **FR-29**: container-less managed services |
| EXPERIENCE.md | Information Architecture: Dashboard row | Content list amended (C3) |
| Architecture | AD-4 | `container` becomes optional, and its consequences are spelled out (C6) |
| Architecture | New AD-17 | Source-comment convention (C1) |
| EXPERIENCE.md | splitter row, Interaction Primitives | "Every zone" made explicit; Logs wrap-all remapped (C2) |
| EXPERIENCE.md | State Patterns: Dashboard | Amended (C3) |
| EXPERIENCE.md | State Patterns: Update | New states for the merge-source strategy (C5) |
| epics.md | Requirements inventory, FR coverage map, Epic List | FR-28, FR-29, UX-DR35, UX-DR36; Epic 7 entry |
| AGENTS.md | Code conventions | Comment rule (C1) |
| `.claude/skills/manifest-generator` | Manifest fields | `container` optional (C6) |

### 2.4 Technical impact

- **C1** touches ~211 files, but only comments. The diff is huge but behavior-neutral, and the conflict risk is high for any in-flight branch. **No story is `in-progress` right now**, which makes this the cheapest moment.
- **C2** introduces one shared zone-layout primitive and migrates five zones to it. It touches `app-shell.tsx`, `navigation-slice.ts`, the state port (persisted ratios) and every zone file.
- **C6** changes the shape of a core port: `container?: string`. The TypeScript compiler will flag every dereference, so the blast radius is mechanically discoverable.
- **C3** needs one new persisted datum (the last group-update outcome). It goes in the state port alongside `activeEdt`, following the existing zod pattern.

---

## 3. Recommended Approach

**Direct Adjustment.** Add one new epic and one story to Epic 3. No rollback and no change to MVP scope.

**Sequencing:**

```
7.1 comment hygiene   (first: no branch in flight, minimizes merge pain; sets the rule for everything after)
7.2 container-less services   (core-level; the Dashboard and Logs need its "n/a" health state)
7.3 zone layout + Ctrl+W everywhere
7.4 interaction consistency audit & alignment   (builds on 7.3's layout primitive)
7.5 Dashboard — summary & last-update persistence
7.6 Dashboard — alerts, quick actions, operation indicator
3.12 update merge-from-EDT   (independent: can run any time, in parallel with Epic 7)
```

**Rationale:**

- 7.1 first. Every later story is then written under the new comment rule instead of adding 200 more story references to clean up later.
- 7.2 before 7.5 and 7.6, because the Dashboard's per-service status must show "no container" correctly from day one.
- 7.3 before 7.4, because the layout primitive is the biggest piece of shared structure the audit will rely on.

**Effort and risk:**

| Story | Effort | Risk |
|-------|--------|------|
| 7.1 | M | Low (behavior-neutral) |
| 7.2 | M | Medium (core port shape) |
| 7.3 | M–H | Medium |
| 7.4 | H | Medium |
| 7.5 | M | Low |
| 7.6 | M | Low |
| 3.12 | M | Low–Medium |

**Git:**

- Epic 7 gets its own branch, `epic-7-tui-consistency-dashboard-code-hygiene`, created from `devlopment`.
- Story 3.12 branches from the Epic 3 branch (`epic-3-group-update-migrations`). If that branch has already been folded into epic-2 and closed, branch from the epic-2 branch and note it in the story file.

---

## 4. Detailed Change Proposals

### 4.1 PRD (`prds/prd-tui-back-2026-08-10/prd.md`)

**4.1.a: FR-25, add a consequence**

OLD (last consequence bullet):
```
- The same configuration screen backs the EDT-scoped update, the all-repos update (still gated by its own explicit confirmation, FR-10), and a single-service update triggered directly from that service's row in the Update zone.
```
NEW (append after it):
```
- For an EDT-scoped update, the configuration screen also offers one global merge-source strategy — the services' shared branches (default) or another EDT's branches (FR-28) — applied to every row before per-service adjustment. (Amended 2026-10-01, Sprint Change Proposal.)
```

**4.1.b: New FR-28** (inserted after FR-27 in §4.3)
```
#### FR-28: Merge source from another EDT (added 2026-10-01, Sprint Change Proposal)

When configuring an EDT-scoped group update, a developer can set the merge source for all selected services at once: either each service's own `sharedBranch` (today's default) or another, named EDT. With another EDT chosen, every service of the EDT being updated that is also a member of the chosen EDT merges from the branch that EDT records for it; every service that is not a member of the chosen EDT is flagged as unresolved and must be given a source branch by hand (its `sharedBranch` offered as the default) before the run can start.

**Consequences (testable):**
- The chosen EDT can never be the EDT being updated.
- A service is resolved from the chosen EDT only when that EDT has a member with the same repoPath; its source branch is exactly that member's recorded branch.
- An unresolved selected service blocks the run start with an explicit, per-row message; deselecting it or choosing its branch by hand clears the block.
- A per-service manual choice survives later changes of the global strategy only until the developer resets it to the global rule.
- CLI parity (FR-1): `tui-back update --from-edt <topic>` applies the same resolution non-interactively and fails (no git write) listing every unresolved service.
```

**4.1.c: New FR-29** (inserted after FR-2 in §4.1)
```
#### FR-29: Container-less managed services (added 2026-10-01, Sprint Change Proposal)

A managed repo's manifest may omit its container: the service is still fully managed (EDT membership, branches, group update, migrations, clean-restart recipe) but has no Docker runtime.

**Consequences (testable):**
- A manifest without `container` validates and the repo registers like any other.
- A group update on a container-less service runs pull/merge and migrations, then the clean-restart recipe if the run asks for one and one is declared; otherwise the restart phase is reported as skipped ("no container"), never as a failure.
- Health surfaces (Update zone, Logs zone, Dashboard) show a distinct "no container" state (glyph + dim text), never "down".
- The Logs zone never subscribes a container-less service; selecting it shows an explicit "no container — no logs" pane state.
- Container-only actions (plain restart, logs restart control) are hidden or disabled with an explanation for such a service.
```

**4.1.d: Information Architecture, Dashboard row** (this table lives in `EXPERIENCE.md`, applied there)

OLD:
```
| Dashboard | Landing surface on launch: summarizes the active EDT, service health, and the last group-update outcome; offers to enter an EDT with the last-used one pre-selected as default. | (summary surface; draws on FR-9's branch/health visibility) |
```
NEW:
```
| Dashboard | Landing surface on launch: summarizes the active EDT — each member service's container status (up/down/restarting/no container), active branch and divergence from its shared branch, working-tree alerts (uncommitted changes, merge/rebase in progress) — the last group-update outcome, registry health, and any operation in progress; offers keyboard quick actions (enter last EDT, start group update, open Logs, switch EDT). (Amended 2026-10-01, Sprint Change Proposal.) | (summary surface; draws on FR-9, FR-18, FR-27, FR-29) |
```

### 4.2 Architecture (`ARCHITECTURE-SPINE.md`)

**4.2.a: AD-4 rule, `container` clause**

OLD:
```
declaring `service` (identity), `container` (docker-compose/container target name), optional `migrationCommand`
```
NEW:
```
declaring `service` (identity), optional `container` (docker-compose/container target name — absent means the service has no Docker runtime: no plain restart, no health, no log stream; amended 2026-10-01, FR-29), optional `migrationCommand`
```
Also append to AD-16's rule: *"A service with no `container` and no `restartCommands` skips the restart phase with an explicit `skipped: no container` detail; `ContainerPort` is never called with an empty name."*

**4.2.b: New AD-17, source-comment convention**
```
### AD-17 — Source comments explain the code, not its history (added 2026-10-01)

- **Prevents:** comments that narrate story numbers, AC ids, spec "Boundaries" quotes and review-patch history — information git log and the story files already hold, which rots and buries the few comments that matter.
- **Rule:** each source file may open with a header of at most 5 lines stating what the file is responsible for. Any other comment exists only to explain something difficult, surprising, or deliberately different from the obvious approach (a workaround, an invariant, a non-obvious constraint, a "don't change this because…"). No story/AC/review-patch references in `src/` (test names included — `describe('X (story 2.11)')` becomes `describe('X')`); traceability lives in commit messages and story files. Enforced by review, plus a test that greps `src/` for `\b[Ss]tory \d+\.\d+|\bAC\d+\b|review patch`.
```

### 4.3 UX (`ux-designs/ux-tui-back-2026-08-10/`)

**4.3.a: EXPERIENCE.md, splitter row (Component Patterns)**: append:
```
Available in **every** zone (amended 2026-10-01, Sprint Change Proposal): each zone declares its panes and boundaries through one shared zone-layout contract (UX-DR35); `Ctrl+W` engages resize-mode in whichever zone is active. The Logs zone's former `Ctrl+W` "wrap all panes" is remapped (key chosen in Story 7.3, listed in the footer and `?` help).
```

**4.3.b: EXPERIENCE.md, State Patterns › Dashboard**: replace the table with:
```
| State | Treatment |
|---|---|
| Cold load | Spinner while the summary assembles; each section fills independently (a slow docker probe never blocks the git sections). |
| Populated | Active EDT name + one row per member service: container status (glyph + text: up/down/restarting/no container), active branch, ahead/behind vs. its shared branch. Last group-update outcome (timestamp + updated/skipped/failed counts). Default highlighted action "enter [last EDT]". |
| Working-tree alerts | Member services with uncommitted changes or a merge/rebase in progress are flagged inline (warning glyph + reason). |
| Quick actions | Keyboard action row: enter last EDT, start group update, open Logs, switch EDT (quick-pick) — each with its key shown. |
| Registry health | Counts of registered repos, invalid manifests, unreachable repos and listing issues; shortcut to `:registry`. |
| Operation in progress | When an update/migration/switch holds a lock, a banner line names it and its progress; quick actions it would conflict with are disabled with the reason. |
| No EDT yet (first run) | Prompts to choose or create an EDT instead of showing a stale/empty summary. |
| No repos registered | Unchanged (Story 2.11). |
| Background-event badge | Unchanged. |
```

**4.3.c: EXPERIENCE.md, State Patterns › Update**: add rows:
```
| Merge source: shared branches | Default. Every row's source = its manifest `sharedBranch`. |
| Merge source: from EDT | Global strategy names another EDT; rows resolved from it show `← <edt>` next to the branch; rows not in that EDT show `✖ not in <edt>` (error color + glyph) and block the run until set by hand or deselected. |
```

**4.3.d: epics.md requirements inventory, new UX-DRs and amendments**
```
UX-DR35 (added 2026-10-01, Sprint Change Proposal, Story 7.3): Every zone builds its layout through one shared zone-layout contract declaring its panes and the boundaries between them (orientation, default ratio, min/max); the contract provides splitter rendering, accent recoloring when targeted, Ctrl+W resize-mode, Tab boundary cycling and per-zone persisted ratios — no zone hand-rolls a split.
UX-DR36 (added 2026-10-01, Sprint Change Proposal, Story 7.4): Interaction consistency contract — the same intent uses the same key, wording and component in every zone (list cursor, edit/commit/cancel, confirm dialogs, destructive-action confirmation, filter, footer hint format, modal titles, empty/error/loading states). Recorded as a table in EXPERIENCE.md; deviations require a documented reason.
UX-DR10 amended 2026-10-01: resize-mode is available in every zone (UX-DR35), not only the EDTs zone.
UX-DR19 amended 2026-10-01: see EXPERIENCE.md State Patterns › Dashboard (container status + branches + divergence per member, working-tree alerts, quick actions, registry health, operation in progress).
UX-DR21 amended 2026-10-01: adds the merge-source strategy states (FR-28).
```

### 4.4 Epics (`epics.md`)

**4.4.a: Requirements inventory**: append after FR-24:
```
FR-28 (added 2026-10-01, Sprint Change Proposal): Merge source from another EDT — global merge-source strategy (shared branches / another EDT) in the EDT-scoped update configuration, with per-service manual resolution for services absent from the chosen EDT.
FR-29 (added 2026-10-01, Sprint Change Proposal): Container-less managed services — `container` optional in the manifest; restart/health/logs degrade to an explicit "no container" state.
```
FR coverage map: `FR-28: Epic 3 - Merge source from another EDT (Story 3.12)` and `FR-29: Epic 7 - Container-less managed services (Story 7.2)`.

**4.4.b: Epic List**: append:
```
### Epic 7: TUI Consistency, Dashboard & Code Hygiene
A developer gets a Dashboard that actually summarizes their workspace, a TUI whose zones all behave the same way (one layout contract with Ctrl+W resize everywhere, one interaction vocabulary), support for services that have no container, and a codebase whose comments explain the code rather than its history.
**FRs covered:** FR-29 (plus completion of UX-DR10, UX-DR19)
**Implementation notes:** AD-17 (comment convention), AD-4 amendment, UX-DR35, UX-DR36. Story 7.1 runs first, while no other story branch is in flight.
```

**4.4.c: Story 3.12** (appended to Epic 3, after 3.11)
```
### Story 3.12: Update — Merge Source from Another EDT

> Added 2026-10-01 (Sprint Change Proposal). Extends Story 3.7's configuration interface (FR-25) with FR-28; mirrors the edt-create wizard's Step 3 two-panel pattern (Story 2.37) so the two screens read the same way.

As a developer,
I want to tell an EDT update to merge each service from another EDT's branch in one move,
So that I can bring a colleague's or a sibling EDT's work into mine without retyping every source branch — and still see and fix by hand the services that EDT doesn't cover.

**Acceptance Criteria:**

**Given** an EDT-scoped update's configuration interface **When** it opens **Then** it shows a **global merge-source panel** above the service table with two options: `(•) Shared branches` (default — today's behavior, every row = manifest `sharedBranch`) and `( ) From EDT: <none>`; `Tab` moves focus between the panel and the table (same panel/table navigation as Story 2.37's Step 3).

**Given** "From EDT" is selected **When** the developer activates its field **Then** the EDT quick-pick (Story 2.30's filterable list) opens, listing every EDT **except the one being updated**; picking one applies it.

**Given** a chosen merge EDT **When** rows re-resolve **Then** each service whose repoPath is a member of the chosen EDT gets that member's recorded branch as source, marked `← <edt topic>`; each service not a member of the chosen EDT shows a red `✖ not in <edt topic>` (glyph + color, UX-DR26) and an empty source.

**Given** a resolved branch from the chosen EDT **When** that branch no longer exists locally or on `origin` for that repo **Then** the row shows `✖ branch not found` instead, same blocking treatment.

**Given** an unresolved row **When** the developer presses `Enter` on it **Then** the per-service branch editor opens (the existing `BranchAutocompleteInput` over that repo's branches) **pre-filled with the service's manifest `sharedBranch`**; committing sets the row to a manual override (`[Manual]`), clearing its error.

**Given** any row in `[Manual]` **When** the global strategy changes **Then** the manual row keeps its branch; a documented key (same as Story 2.37's "back to global strategy", `Ctrl+R`) resets it to follow the global strategy.

**Given** at least one **selected** row carries an error **When** the developer tries to start the run (`y`) **Then** start is rejected with a message naming the unresolved services; deselected rows never block.

**Given** the strategy is switched back to "Shared branches" **When** rows re-resolve **Then** every non-manual row returns to its `sharedBranch` and all from-EDT errors clear.

**Given** an all-repos or single-service update **When** its configuration opens **Then** the global merge-source panel is not shown (FR-28 is EDT-scoped); behavior is unchanged from Story 3.7.

**Given** the CLI **When** `tui-back update --from-edt <topic>` runs **Then** it applies the same resolution; if any member service is unresolved it fails with `update-source-unresolved` listing them, with no git write; an unknown topic or the active EDT's own topic fails with `invalid-argument`. `UPDATE_USAGE` documents the flag.

**Implementation notes:** pure resolution helper in core (e.g. `resolveMergeSourcesFromEdt(targetMembers, sourceEdt, branchesByRepo) → rows with {source, origin: 'shared'|'edt'|'manual', error?}`) so the TUI and the CLI share it (FR-1). Draft gains `strategy: {kind:'shared'} | {kind:'edt', ulid, topic}` and per-row `origin`. Reuse `BranchPlanTable`-style row rendering where it fits instead of a new table. Branch lists are already loaded per row by Story 3.7.
```

**4.4.d: Epic 7 stories**
```
## Epic 7: TUI Consistency, Dashboard & Code Hygiene

### Story 7.1: Source Comment Hygiene (AD-17)

As a developer reading the code, I want comments that explain only what is hard, surprising or deliberately different, so that the code is readable and the useful comments stand out.

**Acceptance Criteria:**

**Given** any file under `src/` **When** the story is done **Then** it opens with at most a 5-line header describing the file's responsibility (or none for a trivially named file such as an `index.ts` barrel).

**Given** a comment that narrates history (story/AC references, "review patch", spec "Boundaries"/"Design Notes" quotes, "previously…", "story X supersedes…") **When** encountered **Then** it is removed; if it carried a real reason (an invariant, a workaround, a "don't change this because…"), that reason is rewritten as a short present-tense comment without the history.

**Given** a non-obvious piece of code with no comment (a workaround, an ordering constraint, a library quirk like Ink's ctrl+letter parsing or depcruise's import-ordering constraint) **When** found during the sweep **Then** a short explanatory comment is added.

**Given** test files **When** swept **Then** story/AC suffixes are removed from `describe`/`it` names and from comments, same rule.

**Given** the sweep **When** done **Then** a guard test asserts `src/` contains no match for `\b[Ss]tory \d+\.\d+|\bAC\d+\b|review patch` (allow-list empty), and `AGENTS.md` › Code conventions states the AD-17 rule in two lines.

**Given** the change **When** reviewed **Then** it is behavior-neutral: `npm test && npm run typecheck && npm run depcheck` pass with zero code changes besides comments, test names and the guard test; commits are split per layer (core, adapters/driven, adapters/driving/cli, adapters/driving/tui per zone, bin) for reviewable diffs.

**Implementation notes:** must start while no other story branch is open. Do not remove the `dependency-cruiser` import-ordering explanation or other comments `AGENTS.md` points at — rewrite them shorter.

### Story 7.2: Container-less Managed Services (FR-29)

As a developer, I want to register and manage a service that has no Docker container, so that libraries and non-dockerized repos (e.g. `shared-types`) are first-class members of my EDTs and updates.

**Acceptance Criteria:**

**Given** a manifest without `container` **When** loaded **Then** it validates (`Manifest.container?: string`; an empty string is still rejected) and the repo registers.

**Given** a group update (any scope) including a container-less service **When** the restart phase is reached **Then** the clean-restart recipe runs if the run asks for it and `restartCommands` is declared; otherwise the phase is reported `skipped` with detail `no container` — never `failed`, and `ContainerPort.restart` is never called.

**Given** the Update zone, the Logs zone or any health badge **When** showing a container-less service **Then** it shows a distinct "no container" state (dim glyph + text) and never polls docker for it.

**Given** the Logs zone **When** a container-less service is selected **Then** no subscription is made and the pane shows "No container — no logs for this service"; the restart control is absent.

**Given** per-service actions (Update/EDT zones) **When** offered for a container-less service **Then** plain "restart" is hidden; "clean restart" is offered only if `restartCommands` is declared.

**Given** the CLI (`repos list`, `service-restart`) **When** a container-less service is involved **Then** `list` shows `container: null` in JSON / `—` on a TTY, and `service-restart` fails with `no-container` unless a clean restart is requested and declared.

**Given** the `manifest-generator` skill **When** run on a repo with no docker-compose service for it **Then** it omits `container` instead of guessing one.

**Implementation notes:** make the type optional first and let `tsc` enumerate every dereference. Architecture AD-4/AD-16 amendments in this proposal apply.

### Story 7.3: Shared Zone Layout Contract & `Ctrl+W` Resize in Every Zone (UX-DR35)

As a developer, I want to resize the panes of whichever zone I'm in with `Ctrl+W`, and have every zone built from the same layout contract, so that resizing works everywhere and new panes get it for free.

**Acceptance Criteria:**

**Given** the TUI **When** the story is done **Then** a shared zone-layout primitive exists (e.g. `ZoneLayout` + a declarative pane/boundary spec: orientation, default ratio, min/max) that renders panes and `Splitter`s, recolors the targeted boundary, and reads/writes ratios from the store; **every** zone (Dashboard, EDTs, Update, Logs, Routes, shared-types) builds its split through it — no zone hand-rolls a split.

**Given** any zone, no overlay open **When** `Ctrl+W` is pressed **Then** resize-mode engages on that zone's boundary 0; `Tab` cycles that zone's boundaries; arrows move the targeted one per its orientation; `Enter`/`Esc` exit — the existing Story 2.21 behavior, generalized (`shouldEnterResizeMode` no longer checks `activeZone === 'edts'`).

**Given** a zone with a single pane (no boundary) **When** `Ctrl+W` is pressed **Then** it is a no-op and the footer never advertises `Ctrl+W` there.

**Given** ratios moved in any zone **When** the app restarts **Then** they are restored per zone (persisted through the state port as today); a persisted ratio array of the wrong length for a zone (layout changed between versions) is replaced by that zone's defaults, never crashes.

**Given** the Logs zone **When** the story is done **Then** "wrap all panes" moves off `Ctrl+W` to a new key (chosen here, no collision with any canonical binding), updated in the footer, the `?` help screen and the Logs keybinding list; the single-pane `w` is unchanged.

**Given** the EDTs zone **When** migrated **Then** its existing 3-boundary behavior and persisted ratios are preserved (no user-visible change).

**Implementation notes:** Routes and Update already pass `listSplitterTargeted` — fold that into the primitive. The Dashboard's pane spec is defined here as a placeholder and filled by 7.5.

### Story 7.4: Interaction Consistency Audit & Alignment (UX-DR36)

As a developer, I want every zone to use the same keys, wording and components for the same intent, so that I never have to remember which zone does what differently.

**Acceptance Criteria:**

**Given** the story starts **When** the audit runs **Then** it produces an inventory (table, committed under `_bmad-output/implementation-artifacts/epic-7/`) of every zone's and dialog's bindings and components per intent: list cursor/jump, enter/activate, edit-commit-cancel, toggle, confirm/cancel dialog, destructive-action confirmation, filter, refresh/retry, footer hint wording and order, modal title casing/language, empty/loading/error state components, text input (TextInputLine), pick lists (FilterablePickList), branch inputs (BranchAutocompleteInput).

**Given** the inventory **When** divergences are found **Then** one canonical choice per intent is recorded as the UX-DR36 table in EXPERIENCE.md (Interaction Primitives), and the developer validates that table before the alignment work starts.

**Given** the validated table **When** alignment is done **Then** every zone and dialog conforms; duplicated ad-hoc implementations (hand-rolled lists, confirm prompts, footer strings, input handling) are replaced by the shared components; any intentional deviation is listed in the table with its reason.

**Given** UI language **When** audited **Then** mixed French/English labels in the TUI are flagged and unified to the language chosen in the table.

**Given** the footer and `?` help screen **When** rendered in any context **Then** they are generated from the same keybinding declarations (no hand-written duplicate hint strings).

**Given** the result **When** reviewed **Then** existing tests are updated only where a binding or wording deliberately changed, and each such change is listed in the story file.

**Implementation notes:** if the alignment list proves larger than one story, split the remainder into follow-up stories (7.4b…) from the validated table rather than growing this one.

### Story 7.5: Dashboard — Workspace Summary & Last-Update Persistence (UX-DR19)

As a developer, I want the Dashboard to show me my active EDT at a glance — each service's container status, active branch and divergence, and how the last update went — so that I know the state of my workspace the moment I open the tool.

**Acceptance Criteria:**

**Given** the app launches **When** the Dashboard renders **Then** the banner stays (Story 2.16), followed by a cold-load spinner per section while data assembles; sections fill independently.

**Given** an active EDT **When** the summary is ready **Then** it lists each member service with: container status (up/down/restarting/no container — glyph + text, FR-29), current branch, and ahead/behind vs. its `sharedBranch` (FR-9's existing computation, reused), plus the EDT name.

**Given** any group update finishes (any scope, TUI or CLI) **When** it ends **Then** its outcome (finished-at timestamp, scope, updated/skipped/failed counts) is persisted through the state port; the Dashboard shows the latest one ("Last update: <relative time> — 3 updated, 1 failed"), or "No update run yet".

**Given** no EDT exists **When** the Dashboard renders **Then** it prompts to create or choose an EDT instead of an empty summary; with an empty registry the Story 2.11 prompt keeps precedence.

**Given** the Dashboard **When** displayed **Then** the default highlighted action is "Enter [last EDT]" (switches to the EDTs zone with that EDT selected).

**Given** docker or git probes fail for a service **When** rendered **Then** that row shows an explicit error state for that field; other rows and sections are unaffected.

**Implementation notes:** uses Story 7.3's layout contract. The container-status poll reuses the Update zone's health-poll slice logic rather than a third copy.

### Story 7.6: Dashboard — Alerts, Quick Actions, Registry Health & Operation Indicator

As a developer, I want the Dashboard to warn me about anything needing attention and to launch common actions from it, so that it is a real starting point, not just a status page.

**Acceptance Criteria:**

**Given** active-EDT members **When** a member has uncommitted changes or a merge/rebase in progress **Then** it is flagged inline (warning glyph + reason) in the summary.

**Given** the Dashboard **When** focused **Then** a quick-action row offers: enter last EDT, start group update (opens Story 3.7's configuration), open Logs, switch EDT (Story 2.30's quick-pick) — each with its key shown in the row and footer, keys consistent with UX-DR36.

**Given** the registry **When** summarized **Then** a section shows registered-repo count and counts of invalid manifests, unreachable repos and listing issues (Story 2.34's classification), with a shortcut to `:registry`; all-clear shows a single success line.

**Given** an operation holds a lock (update, migration, switch, …) **When** the Dashboard renders **Then** a line names the operation and its progress, and quick actions that would conflict are disabled with the reason.

**Given** a zone has a pending background event **When** on the Dashboard **Then** its tab shows the counter badge (UX-DR19 background-event state).
```

### 4.5 Other artifacts

- **AGENTS.md › Code conventions**: add: *"Comments (AD-17): at most a 5-line file header saying what the file does; otherwise comment only what is hard, surprising or deliberately unusual. Never reference stories, ACs or review patches in `src/`."*
- **`.claude/skills/manifest-generator`**: `container` is documented as optional (done in Story 7.2).
- **sprint-status.yaml**: add the following entries.
  ```yaml
  3-12-update-merge-source-from-another-edt: backlog          # under epic-3
  epic-7: backlog
  7-1-source-comment-hygiene: backlog
  7-2-container-less-managed-services: backlog
  7-3-shared-zone-layout-contract-ctrl-w-resize-in-every-zone: backlog
  7-4-interaction-consistency-audit-alignment: backlog
  7-5-dashboard-workspace-summary-last-update-persistence: backlog
  7-6-dashboard-alerts-quick-actions-registry-health-operation-indicator: backlog
  epic-7-retrospective: optional
  ```

---

## 5. Implementation Handoff

**Scope classification: Moderate.** This adds a new epic and a story to an existing epic. The PRD, architecture and UX amendments are additive, with no replan.

| Role | Responsibility |
|------|----------------|
| Developer agent (correct-course, now) | On approval, apply §4.1–4.5 to the PRD, ARCHITECTURE-SPINE.md, EXPERIENCE.md, epics.md, AGENTS.md and sprint-status.yaml |
| Developer (Max) | Create the `epic-7-tui-consistency-dashboard-code-hygiene` branch from `devlopment`; run **7.1 first** via `bmad-build`; validate 7.4's consistency table before its alignment phase; choose the Logs wrap-all key in 7.3 |
| Developer agent (bmad-build) | Stories 7.1 → 7.6 in order; 3.12 in parallel on the Epic 3 line |

**Success criteria:**

- 7.1: the guard test is green and grep finds no story references in `src/`. Test, typecheck and depcheck are green with a comments-only diff.
- 7.2: a manifest without `container` registers. Update, Logs and the Dashboard show "no container" and never fail on it.
- 7.3: `Ctrl+W` resizes in every multi-pane zone, and ratios persist per zone. Logs wrap-all is on its new key.
- 7.4: a validated UX-DR36 table in EXPERIENCE.md, and every zone conforms to it.
- 7.5 and 7.6: the Dashboard shows the full EXPERIENCE.md state table, and the last-update outcome survives a restart.
- 3.12: an EDT update can merge from another EDT. Unresolved services block until fixed by hand. `update --from-edt` works in the CLI.
