# Sprint Change Proposal — 2026-10-12

**Trigger:** a batch of usability gaps found while using the TUI day to day (arrow keys leaking through overlays, Dashboard that summarises nothing actionable, hard-coded defaults, no IDE shortcut) plus a redefinition of the business expectation of Story 4.6 (declared-version drift → `shared-types` version history library).
**Requested by:** Max · **Mode:** Batch · **Scope:** Moderate (6 stories added, 2 rewritten in backlog, 1 FR replaced, no completed story reverted)

---

## 1. Issue Summary

Nine requests, grouped into five themes.

| # | Request (Max) | Nature |
|---|---------------|--------|
| A1 | Setting on **Logs**: `[R]` is a simple restart or a clean restart | New requirement |
| A2 | Setting on **st**: which options are ticked by default | New requirement |
| A3 | Setting on **Update**: default global settings | New requirement |
| B | Like the Update tab, **st tab title shows a glyph while working** (publishing or distributing) | Consistency gap |
| C | **Bug** — with the `:settings` screen open over st, ↑/↓ also move the st zone's own cursor. Same defect with the `?` help panel (KEYBINDINGS) over Update, EDT, Logs, Routes and st | Defect (UX-DR36 not enforced) |
| D | **Dashboard**'s main function = overview of the active EDT's services: state (up/down/restarting…), active branch, and every possible action on a service (open IDE, simple/clean restart, more to come) | Misunderstanding of 7.5/7.6 (they describe a *status page* + a separate quick-action row) |
| E | **Logs**: a shortcut that opens the IDE on the focused service | New requirement |
| F | **Story 4.6 redefined**: a real-time library searching branches and commits to show the `shared-types` version history | Strategic re-scope |

### Evidence (checked in the code)

- **C — root cause.** `app-shell.tsx` already gates every *global* shortcut on `!helpOpen && !settingsScreenOpen && …`. The leak is in the zones' own handlers:
  - `update-zone.tsx:869`, `logs-zone.tsx:775`, `edts-zone.tsx:818`, `routes-zone.tsx:1686` gate their `useInput` on `commandBarOpen / registryScreenOpen / settingsScreenOpen / resetScreenOpen / resizeMode` — **but none gates on `helpOpen`**.
  - `shared-types-zone.tsx:146` has **no `isActive` gate at all**: it reacts under the settings screen, the registry screen, the command bar and the help panel.
  - Each zone re-lists the overlay flags by hand, so every new overlay (e.g. `resetScreenOpen`) has to be added in five places and one is always forgotten. The fix is one shared predicate, not five more edits.
- **B.** `ZoneTabBar` takes `updateRunning` + `updateIncidents` and only applies them to `zone.id === 'update'`; `resolveZoneTabState(…, busy, …)` already renders the badge, so st only needs its own busy signal (`publish.status` / `run.status === 'running'`).
- **D.** `dashboard-zone.tsx` is 54 lines: banner + empty-registry prompt + `ZonePlaceholder`. Story 7.5 (backlog) lists services read-only; Story 7.6 (backlog) adds a *generic* quick-action row (enter EDT, group update, logs, switch EDT). Neither mentions per-service actions.
- **A1 / E.** `logs-zone.tsx:563,758` map `R` to `restartLogsPane` (Docker restart only). The clean-restart recipe exists (Story 3.8, manifest) and is already used by Update (3.9) and st (4.2) but is not reachable from Logs. `launchEditor(repoPath, editorCommand)` exists only inside the Update zone (`update-zone.logic.ts:226`, used for blocked repos); `general.editorCommand` is its setting.
- **A3.** The Update global panel today has `source / edt / migrations / cleanRestart / start` (`update-config-panels.logic.ts:48`); `runMigrations` and `cleanRestart` are re-initialised on every run, while only `update.concurrency` is in `Settings`.
- **A2.** st option defaults are hard-coded: `{ install: true, cleanRestart: false, commit: true }` (`shared-types-zone.logic.ts:35`).
- **F.** `GitPort` has no commit-history capability (no `log`, no file-at-revision read). `SharedTypesPort.readOwnVersion` only reads the working-tree `package.json`.

---

## 2. Impact Analysis

| Item | Status | Notes |
|------|--------|-------|
| Epic 7 | [!] | + **7.11** (overlay input ownership), + **7.12** (shared service actions), **7.5 rewritten**, 7.6 amended. 7.9 (bounded rendering, review) and 7.4/7.4b (done) are untouched. UX-DR36 gains an explicit rule |
| Epic 5 | [!] | + **5.7** (Logs: restart-mode setting + open-IDE shortcut). Stories 5.1–5.6 untouched |
| Epic 3 | [!] | + **3.20** (Update global-defaults settings). 3.18/3.19 (review) untouched |
| Epic 4 | [!] | **4.6 rewritten** (history library), + **4.7** (st default options + busy tab glyph). 4.1–4.3 untouched; 4.4/4.5 unchanged |
| PRD | [!] | **FR-14 replaced** (drift → version history library); amend FR-16/FR-18 (Logs restart mode, open IDE); add FR-35 (service actions), FR-36 (configurable defaults); SM-4 wording; UX-DR19 amended |
| Architecture | [!] | New **AD-21** (service action registry: one definition per action, consumed by Logs and Dashboard). GitPort gains read-only history capabilities (AD-16 extension). Hexagonal rules intact |
| UX | [!] | UX-DR36 amended (overlay owns arrows); UX-DR19 amended (Dashboard = services console); new component "service-actions row"; st zone gets a History view |
| Code | [!] | See §4 |
| Sprint status | [!] | + 5 keys, 2 keys renamed (backlog, no branch exists yet) |

### Risks worth naming

- **4.6 cost.** Walking `git log` over a large repo on every keystroke would freeze the TUI. Mitigated by: results stream in, search is cancellable and debounced, the walk uses `git log -G` (git filters server-side) and is capped by a setting (see story), no persistent cache (consistent with FR-14's "nothing is cached" principle).
- **4.6 meaning of "published".** Git history cannot prove a version reached the npm registry. Assumption: *a commit that changes the `"version"` line of the source repo's `package.json` is the publication marker* (that is what the release script `npm run v` produces, pushed by Story 4.3's flow). The result is labelled "bumped in" not "published on"; an optional registry check (`verifyPublished`, already available) can confirm per row.
- **Clean restart without a recipe.** A service with no manifest clean-restart recipe cannot do `clean`. Rule chosen: fall back to a simple restart and say so in the notice (never a silent no-op, never a failure).
- **Dashboard size.** 7.5 grows. Mitigated by 7.12 shipping the actions first, so 7.5 only composes them.

---

## 3. Recommended Approach

**Direct Adjustment.** All changes fit the existing epics; nothing is rolled back.

Suggested order:

1. **7.11** first — it is a bug, small, independent, and makes every later zone change safer.
2. **7.12** → then **5.7** and **7.5** (both consume it) → **7.6**.
3. **3.20** and **4.7** are independent of the rest (4.7 after 4.3 is merged: it edits the same zone).
4. **4.6** last: after 4.3 merged and 4.7 done (reuses the st zone shell and the new `sharedTypes` settings group). It does **not** depend on 7.5/7.6, so the Epic 4 prerequisite "Epic 7 done" is relaxed to "7.3, 7.4 done" (already satisfied).

Effort: 7.11 S · 7.12 M · 5.7 S · 7.5 L (was M) · 3.20 S · 4.7 S · 4.6 L. Risk: Medium on 4.6 and 7.5, Low elsewhere.

---

## 4. Detailed Change Proposals

### 4.1 Epics — new Story 7.11 (bug fix, Epic 7)

### Story 7.11: Overlay Owns the Arrow Keys — Settings Screen & Help Panel (UX-DR36)

> Added 2026-10-12 (Sprint Change Proposal). Fixes a defect: ↑/↓ moved both an overlay and the zone behind it.

As a developer, I want the screen or panel I opened on top of a zone to be the only thing that reacts to my keys, so that navigating `:settings` or `?` help never moves a cursor behind it.

**Acceptance Criteria:**

**Given** the `:settings` screen is open over any zone (Dashboard, EDTs, Update, Logs, Routes, st) **When** ↑/↓/←/→/Enter/letters are pressed **Then** only the settings screen reacts; no zone cursor, selection, form field or pane focus changes behind it.

**Given** the `?` help panel is open over Update, EDTs, Logs, Routes or st **When** ↑/↓ (scroll) or any other key is pressed **Then** only the help panel reacts, and closing it restores the zone exactly as it was.

**Given** the registry screen, reset screen and command bar **When** open **Then** the same rule holds (they are already gated in four zones; st is not — it is brought in line).

**Given** the shared-types zone **When** any overlay is open **Then** its `useInput` is inactive (today it has no gate).

**Implementation notes:** introduce one predicate, e.g. `useZoneInputActive(useStore)` in `tui/shared/hooks`, returning `!commandBarOpen && !registryScreenOpen && !settingsScreenOpen && !resetScreenOpen && !helpOpen && !resizeMode`; every zone's `useInput` uses it instead of its hand-written list (the five lists disappear). Add a regression guard test alongside the bounded-rendering guard: for each zone, mount it, open each overlay, send ↑/↓, assert the zone's store/state did not change. A future overlay is registered in the predicate only.

### 4.2 Epics — new Story 7.12 (Epic 7)

### Story 7.12: Shared Service Actions — Open in IDE, Simple/Clean Restart (AD-21)

> Added 2026-10-12. Foundation for Stories 5.7 and 7.5.

As a developer, I want one definition of "what I can do to a service", so that Logs and Dashboard offer the same actions with the same behaviour and new actions are added once.

**Acceptance Criteria:**

**Given** a service **When** an action is requested **Then** it goes through a service-action registry exposing `openInIde(service)` and `restart(service, mode: 'simple' | 'clean')`, each returning a `Result` and reporting availability (e.g. restart unavailable for a container-less service, clean unavailable without a manifest recipe).

**Given** `openInIde` **When** run **Then** it uses `general.editorCommand` with the existing `<repo>` placeholder / append-path rule, falling back to `$EDITOR` then `vi` (the logic currently private to the Update zone is extracted and the Update zone uses the extracted version; behaviour unchanged, existing tests pass).

**Given** `restart` with `simple` **When** run **Then** it is the existing Docker restart (Story 5.3); with `clean` **Then** it runs the manifest clean-restart recipe (Story 3.8). A container-less service (Story 7.2) offers no restart, as today.

**Given** `clean` is requested for a service **without** a recipe **When** run **Then** it falls back to a simple restart and returns a notice saying so.

**Given** the registry **When** a future action is added **Then** it is a new entry, with no change to its consumers' layout logic (consumers render whatever the registry lists for the service, with its key and availability).

**Implementation notes:** the registry lives in `core/` (pure, ports injected: container, restart, manifest); the TUI-side `ServiceActionsRow` component renders the available actions with their keys. Hexagonal rule: no `child_process` in the TUI layer — the editor launcher becomes a driven adapter behind a port (the existing launcher is moved, not rewritten).

### 4.3 Epics — new Story 5.7 (Epic 5)

### Story 5.7: Logs — Restart Mode Setting & Open-IDE Shortcut

> Added 2026-10-12. Builds on Story 5.3 and Story 7.12.

As a developer, I want `[R]` in Logs to do the restart I usually want, and a key that opens my IDE on the service I'm reading, so that I can go from a log line to the code without leaving the TUI.

**Acceptance Criteria:**

**Given** `:settings` → Logs tab **When** the developer picks the restart mode **Then** `logs.restartMode` is `simple` (default, today's behaviour) or `clean`, persisted and applied live.

**Given** the grid focus or the fullscreen pane **When** `R` is pressed **Then** the service restarts using `logs.restartMode` through Story 7.12's registry; the pane shows the existing "restarting" state; the footer hint names the active mode (`[R] restart (clean)`).

**Given** mode `clean` and a service without a recipe **When** `R` is pressed **Then** it restarts simply and the pane notice says "no clean-restart recipe — simple restart".

**Given** the grid focus or the fullscreen pane **When** the IDE key is pressed **Then** the IDE opens on the focused service's repo through `openInIde`; failure shows an explicit one-line notice. The key is chosen under UX-DR36 (proposal: `o`; it must not collide with the filter, scroll or fullscreen keys) and is listed in the footer and `?` help.

**Given** a container-less service **When** the IDE key is pressed **Then** it works (it needs no container); only restart is unavailable.

### 4.4 Epics — Story 7.5 rewritten, Story 7.6 amended (Epic 7)

**Story 7.5 — OLD title:** *Dashboard — Workspace Summary & Last-Update Persistence (UX-DR19)*
**NEW title:** *Dashboard — Active-EDT Services Console & Last-Update Persistence (UX-DR19)* (sprint key renamed, still backlog)

OLD story statement:

> As a developer, I want the Dashboard to show me my active EDT at a glance — each service's container status, active branch and divergence, and how the last update went …

NEW:

> As a developer, I want the Dashboard to be the console of my active EDT — every service with its state and branch, and every action I can take on it — so that I can see the workspace and act on a service without leaving the first screen.

OLD ACs kept: banner + per-section cold-load spinners, service list (status glyph + text, branch, ahead/behind vs `sharedBranch`, EDT name), last-update persistence (finished-at, scope, counts) and "No update run yet", no-EDT prompt (registry-empty precedence), default action "Enter [last EDT]", per-field error states.

NEW / CHANGED ACs:

**Given** the active EDT **When** the Dashboard renders **Then** the services list is the main body of the screen (it takes the space the banner and last-update line do not need), one row per service: state (up / down / restarting / no container — glyph + text), active branch, ahead/behind, and a one-glyph issue marker (dirty / merge in progress, absorbed from 7.6).

**Given** a service row is focused (↑/↓, shared focus-navigation Story 7.7) **When** shown **Then** its available actions are listed (key + label) from Story 7.12's registry: **open in IDE**, **restart (simple)**, **restart (clean)** — each disabled with a reason when unavailable (e.g. no container, no recipe); further actions are added by registering them.

**Given** a service action is triggered from the Dashboard **When** it runs **Then** the row shows its progress and result inline (e.g. "restarting…" then the new status); an action that conflicts with a held operation lock (update, migration, switch) is disabled with the lock's name (Story 3.16 semantics).

**Given** the service states **When** displayed **Then** they refresh live with the container-health poll (reusing the Update zone's slice logic, not a third copy), and a `restarting` state caused by the Logs zone or Update shows up here too.

**Given** Story 7.11 **When** an overlay is open over the Dashboard **Then** the services list does not react to keys.

**Rationale:** the earlier text treated the Dashboard as a status page; the intent is an action console. Per-service actions are now the primary content, the generic quick-action row is secondary (7.6).

**Story 7.6 — amendments** (Alerts, Quick Actions, Registry Health & Operation Indicator):

- OLD: *"a member has uncommitted changes … is flagged inline (warning glyph + reason) in the summary"* → NEW: the flag is the issue marker already on the 7.5 row; 7.6 only adds the **reason** line on the focused row.
- OLD: *quick-action row offers enter last EDT, group update, Logs, switch EDT* → NEW: unchanged, but explicitly an **EDT-level** row, distinct from the **per-service** actions of 7.5; keys must not collide with 7.12's service-action keys.
- Registry-health section and operation indicator: unchanged.

### 4.5 Epics — new Story 3.20 (Epic 3)

### Story 3.20: Update — Configurable Global Defaults

> Added 2026-10-12. Complements Story 3.7 (pre-run configuration).

As a developer, I want to choose in `:settings` the defaults the Update configuration screen starts with, so that I stop re-ticking the same global options at every run.

**Acceptance Criteria:**

**Given** `:settings` → Update tab **When** opened **Then** it offers, besides `concurrency`: *run migrations* (default on), *clean restart* (default off), *start services*, and — when the EDT layout shows them — *merge source* (default: shared branches). Values persisted in `settings.yaml` with zod defaults equal to today's hard-coded ones, so a missing key changes nothing.

**Given** the Update configuration screen (3.7) **When** opened **Then** its global panel is pre-filled from these settings; the developer can still change them for this run only (a per-run change is never written back to settings).

**Given** a per-service exception already set in the table **When** defaults change **Then** only rows that follow the global parameters are affected (Story 3.9's "follow global" semantics); the CLI `update` commands (Story 3.11) honour the same defaults unless an explicit flag overrides them.

**Given** an invalid value in a hand-edited `settings.yaml` **When** loaded **Then** the existing warn-and-fall-back-to-default behaviour applies.

### 4.6 Epics — new Story 4.7 (Epic 4)

### Story 4.7: `shared-types` Zone — Configurable Default Options & Busy Tab Indicator

> Added 2026-10-12. Edits the zone introduced by Stories 4.2/4.3, so build it after 4.3 is merged.

As a developer, I want the st zone's option checkboxes to start the way I like, and the tab to tell me when st is busy, so that I don't re-tick options each time or forget a run in progress.

**Acceptance Criteria:**

**Given** `:settings` → a new **st** tab (`sharedTypes` group) **When** opened **Then** it also hosts `historyDepth` and `maxCommitsScanned` (Story 4.6) and offers the default state of each option — `Run npm i`, `Clean restart`, `Commit package.json + package-lock.json` — and a *propagate after publish* default if that choice exists in the publish-done step. Hard-coded defaults today (`install: on, cleanRestart: off, commit: on`) become the zod defaults, so nothing changes until the developer edits them.

**Given** the st zone **When** the options step is shown **Then** the toggles are pre-set from settings; changing them in the zone affects only that run.

**Given** the st zone is publishing (4.3) or distributing/propagating (4.2) **When** the tab bar renders **Then** the st tab title carries the same busy badge as the Update tab (same glyph, same colour, shown even while st is the active tab); it disappears when the run finishes or is blocked awaiting input.

**Given** the busy state **When** a run blocks (publish `blocked`) **Then** the tab shows the attention state the Update tab shows for incidents, if that component supports it; otherwise no badge.

**Implementation notes:** the busy signal is lifted from the zone's local state into a store flag (`sharedTypesBusy`) so the shell can pass it to `ZoneTabBar`, mirroring `updateRunning`; `ZoneTabBar`'s `updateRunning` prop becomes a generic per-zone `busy` map (Update keeps its incident count).

### 4.7 Epics — Story 4.6 replaced (Epic 4)

**OLD:**

> ### Story 4.6: Declared-Version Drift View *(niche, optional)*
> As a developer, I want to see which consumers declare a different `shared-types` version from my EDT's `shared-types` branch, so that I spot stale services at a glance.
> - Compares each consumer's declared version with the one declared by the source repo's `package.json` on the EDT's branch; no git-ancestry walk, no caching.
> - Consumers on the same version are marked in sync; others show both values and offer a one-key jump into Story 4.2 with the source version pre-filled.
> - Explicit "no members" state when the EDT has none.

**NEW:**

### Story 4.6: `shared-types` Version History Library (real-time branch & commit search)

> Redefined 2026-10-12 (Sprint Change Proposal) — replaces the declared-version drift view. Replaces FR-14.

As a developer, I want to search the `shared-types` source repo's branches and commits in real time to see which versions each branch carried and when, so that I can answer "which version is on my branch?" and "where was 0.1.3770 released?" without digging through git by hand.

**Acceptance Criteria:**

**Given** the active EDT includes the `shared-types-source` repo (Story 2.13 gating) **When** the st zone's **History** view is opened **Then** a search bar offers two modes, switchable with a key shown in the footer: **by branch** and **by version**. Without the source repo the view is unavailable with the usual disabled reason.

**Search by branch**

**Given** by-branch mode **When** the developer picks a branch (shared `BranchAutocompleteInput`, local + remote branches) **Then** the tool walks that branch's commits, newest first, and for each commit that **changes the `"version": "x.y.z",` line of the source repo's `package.json`** adds an entry `{version, commit, author date, branch}` to the displayed history.

**Given** the walk **When** it runs **Then** it stops once `n` versions have been collected, `n` = `sharedTypes.historyDepth` (settings, default 20, range 1–200), or when the branch is exhausted, or when `sharedTypes.maxCommitsScanned` commits have been scanned (settings, default 1 000, range 100–20 000); the list says which of the two ended it.

**Given** results arrive **When** the walk is in progress **Then** entries appear as they are found (streamed, spinner on the header), `Esc` cancels the walk, and changing the branch cancels the previous walk before starting the new one.

**Search by version**

**Given** by-version mode **When** the developer types a version **Then** it is validated as `MAJOR.MINOR.PATCH` (digits only) before any search; an invalid value shows an inline message and runs nothing.

**Given** a valid version **When** submitted **Then** the tool finds the commit(s) that set the `"version"` line to that value, and shows for each the **branch(es) containing it** and the **date** of that commit (bumped-in date); results stream in; "not found on any branch" is an explicit state; if several branches contain it, the earliest-introducing one is flagged.

**Common**

**Given** any result row **When** `Enter` is pressed **Then** the st form opens (Story 4.2) with that version pre-filled — only if it exists on the registry (the existing verify step still applies).

**Given** the data **When** displayed **Then** nothing is cached between searches (consistent with the no-cache rule of the former FR-14) and nothing in the repo is modified: the whole feature is read-only git.

**Given** a git failure (unknown ref, shallow clone, git not reachable) **When** it occurs **Then** the view shows the explicit error and stays usable for the next search.

**Given** `?` help or `:settings` is open over the view **When** keys are pressed **Then** the view is inert (Story 7.11).

**Implementation notes:**
- `GitPort` gains read-only capabilities (the `maxScanned` bound is passed down from `sharedTypes.maxCommitsScanned`), fully faked in tests: `listVersionBumpCommits(repoPath, ref, { limit, maxScanned })` (an async iterator or callback stream; implementation `git log <ref> -G'"version"\s*:' --format=… -p -- package.json`, parsing the added `+  "version": "…"` line) and `listBranchesContaining(repoPath, commit)` (`git branch -a --contains`). The by-version search uses `git log --all -S'"version": "X"' -- package.json` to find the commit(s), then `listBranchesContaining`.
- The core use-case (`core/shared-types/version-history.ts`) is pure orchestration over the port, cancellable via `AbortSignal`; the zone only renders.
- Reuse `FilterablePickList` for result rows, `BranchAutocompleteInput` for the branch, the shared text-input line for the version, and `bounded-rendering` rules (UX-DR37): a scrolling window over the result list, tested in the guard.
- "Published" caveat: the date shown is the commit date of the version bump (the release script's marker); an optional per-row registry check via `SharedTypesPort.verifyPublished` is out of scope here and may follow.

### 4.8 PRD

- **FR-14** — OLD: *"See declared-version drift"* (declared version of consumers vs source on the EDT branch; niche) → NEW: **FR-14: Search the `shared-types` version history** — real-time search of the source repo's branches and commits for the history of the `package.json` `"version"` line, by branch (last `n` versions, `n` configurable) or by version (branch(es) and date). Read-only, uncached, `n` in settings. Marked superseded: the 2026-10-05 drift definition.
- **FR-16 / FR-18** — add: Logs `R` restart honours `logs.restartMode` (simple | clean); an "open IDE" shortcut acts on the focused service.
- **FR-35 (new): Service actions** — a single set of per-service actions (open IDE, simple restart, clean restart, extensible) available from Logs and the Dashboard; unavailable actions are shown disabled with a reason.
- **FR-36 (new): Configurable defaults** — defaults of the Update global parameters, the st option toggles and the Logs restart mode are settings; per-run changes never write back.
- **SM-4** — replace "(FR-14 is niche)" with "FR-14 answers *which version/where/when* from git".
- **UX-DR19** (Dashboard) — amend as in §4.4. **UX-DR36** — add: *an open overlay (settings, help, registry, reset, command bar) is the sole consumer of keys; zones are inert behind it, enforced by one shared predicate and a regression guard.*

### 4.9 Architecture

- **AD-21 (new): Service action registry.** Per-service actions are declared once in `core/` with availability rules and consumed by any driving adapter (Logs, Dashboard, a future CLI). Editor launching moves behind a port.
- **AD-16 extension:** `GitPort` read-only history capabilities (`listVersionBumpCommits`, `listBranchesContaining`) — streaming and cancellable, no write.
- **Settings model:** new `sharedTypes` group (`historyDepth`, `maxCommitsScanned`, option defaults), `logs.restartMode`, `update` global defaults; all with zod defaults equal to current behaviour.

### 4.10 Sprint status (`sprint-status.yaml`)

```
epic-3:  + 3-20-update-configurable-global-defaults: backlog
epic-4:  - 4-6-declared-version-drift-view: backlog
         + 4-6-shared-types-version-history-library: backlog     # rewritten 2026-10-12
         + 4-7-shared-types-zone-configurable-default-options-busy-tab-indicator: backlog
epic-5:  + 5-7-logs-restart-mode-setting-open-ide-shortcut: backlog
epic-7:  + 7-11-overlay-owns-the-arrow-keys-settings-screen-help-panel: backlog
         + 7-12-shared-service-actions-open-in-ide-simple-clean-restart: backlog
         - 7-5-dashboard-workspace-summary-last-update-persistence: backlog
         + 7-5-dashboard-active-edt-services-console-last-update-persistence: backlog
# Order: 7-11 first (bug). 7-12 -> 5-7, 7-5 -> 7-6. 3-20 and 4-7 independent (4-7 after 4-3 merged). 4-6 after 4-3 + 4-7.
```

Epic 7 "Execution order" note is updated to put 7.11 first and 7.12 before 7.5/7.6; Epic 4 note: "Prerequisites: 7.3, 7.4 done" for 4.6/4.7.

---

## 5. Implementation Handoff

**Scope: Moderate** — backlog reorganisation across four epics, one FR replaced, one new AD. No replan of the MVP.

| Recipient | Responsibility |
|-----------|----------------|
| PO / SM (this workflow's follow-up) | Apply §4.1–4.10 to `epics.md`, the PRD, the architecture spine, UX docs and `sprint-status.yaml`; re-plan the order above |
| Developer agent | Implement per story, one branch per story from its epic branch (CLAUDE.md git workflow). Start with 7.11 |

**Success criteria**

- 7.11: no zone state changes while any overlay is open (guard test green for all six zones × five overlays).
- 7.12 / 5.7 / 7.5: the same service gets the same action result from Logs and the Dashboard; clean-without-recipe is a visible fallback.
- 3.20 / 4.7: with untouched settings, behaviour is byte-for-byte today's.
- 4.6: both search modes stream results, are cancellable, validate the version before searching, never write to the repo, and stay responsive on the real `shared-types` repo.

**Decisions (Max, 2026-10-12):** (1) the history reads the source repo's root `package.json`; (2) the scanned-commit cap is a setting (`sharedTypes.maxCommitsScanned`, default 1 000); (3) the Logs IDE key is `o`. Proposal approved.
