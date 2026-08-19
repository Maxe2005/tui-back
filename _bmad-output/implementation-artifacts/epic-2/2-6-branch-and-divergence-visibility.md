---
title: 'Branch and Divergence Visibility'
type: 'feature'
created: '2026-08-19'
status: 'done'
baseline_commit: '63d056486a20f41c5466950408a31d933896a191'
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A developer has no built-in way to see which branch each managed service is on, or how far that branch has diverged from its upstream. Every action requires a manual `git status` or `git log` in each repo to check the current branch and ahead/behind status. This is frictionful and error-prone, especially when managing multiple EDTs and services.

**Approach:** Extend the EDTs zone and related displays to show, for every managed repo (member or not, including services kept on `development` per Story 2.4), the current branch name and both ahead/behind counts relative to the configured upstream. Services with no upstream show an explicit "no upstream" state. When offline, show "unknown (offline)" rather than stale or zero values. The branch/divergence data feeds uniformly across all zones that list services (EDTs zone, Dashboard, Update, Logs, Routes, shared-types), always using the same source of truth (the manifest + git adapter).

## Boundaries & Constraints

**Always:**
- AD-8: every git write goes through `adapters/driven/git`; branch/divergence reads use the same git adapter's `currentBranch` and `aheadBehind` methods — never raw `git` invocation outside the adapter.
- AD-1: `core/edt`/`core/scripts`/`core/logs`/`core/routes` consume the new `GitPort` plus existing `ManifestPort`/`RegistryPort`; no `adapters/` import in `core/`.
- AD-7: branch/divergence data lives in the EDT's SQLite entry (per-service branch) and is refreshed on-demand; the ULID filename stays unchanged.
- AD-9: the EDT-registry write stays under `withActionLock(lock, edtRegistryResourceKey, …)`.
- Per-service outcome vocabulary follows the shared `data.results: {service, outcome, detail?}[]` convention where applicable.
- NodeNext `.js` relative imports; imports are the first statements in a file (depcruise acorn-fallback landmine).
- Manifest module ids are kebab-case, matched 1:1 against the compiled-in module registry.

**Ask First:**
- How divergence is computed (fetch upstream refs vs. cached values) — this affects the git adapter and the refresh budget.

**Never:**
- Don't compute ahead/behind without a configured upstream — always surface "no upstream" or "unknown (offline)" explicitly.
- Don't write any branch name or divergence data to `state.json` — only to the per-EDT SQLite entry.
- Don't "fix" the unanchored `to: { path: 'adapters(/|$)' }` depcruise rule.
- Don't expose raw stderr/stack traces in the divergence view — keep them one action away (UX-DR17).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Service with upstream | repo has `remote.origin.url` configured | shows branch name + ahead count + behind count (e.g., `main +2/-0`) | git error → show "unknown (offline)" or detail in dim-annotation |
| Service with no upstream | repo has no remote configured | explicit "no upstream" state, not a numeric value | — |
| Tool is offline | no network available | "unknown (offline)" state, not stale/zero values | — |
| EDT member service | service is a member of the active EDT | branch + divergence shown uniformly with non-members | — |
| Non-member service | service is managed but not in active EDT | branch + divergence shown uniformly with members | — |
| Service kept on `development` | per Story 2.4 rule | branch = `development` + divergence from its upstream | — |
| Divergence computed mid-run | during a group update | shown in the update zone's per-service outcome summary | — |
| Branch name very long | branch name exceeds display width | truncate with ellipsis, full name available on hover/focus | — |

</frozen-after-approval>

## Code Map

- `src/core/ports/git.ts` — new methods: `aheadBehind(repoPath): Result<{ ahead: number; behind: number }>`; `currentBranch(repoPath): Result<string>`.
- `src/adapters/driven/git/index.ts` — implement `aheadBehind` via `git rev-parse --abbrev-ref HEAD` + `git log --count --left-only {upstream}...{current}`; `currentBranch` via `git rev-parse --abbrev-ref HEAD`. Factory pattern from `load: loadManifest`.
- `src/core/edt/registry.ts` — extend the EDT registry entry shape to include per-service branch + divergence ref (the `members[].branch` field already established in Story 2.2; add `members[].upstream` if not already in manifest).
- `src/adapters/driven/edt-registry/index.ts` — ensure the schema exposes branch + divergence data to core use-cases.
- `src/core/edt/list.ts` — new use-case: `listEdtBranchesDivergence` that queries each member service's branch and ahead/behind, returning `{service, branch, ahead, behind, upstream?, status}` per service; status in `{current, no-upstream, unknown-offline}`.
- `src/adapters/driving/cli/subcommands.ts` — extend the `edts` handler to include branch/divergence data in the JSON line output (non-TTY) or human-readable text (TTY).
- `src/bin/main.ts` — wire `aheadBehind` and `currentBranch` into the git port deps consumed by EDT list use-case.
- `src/core/edt/list.test.ts` — unit tests with fake ports (pattern: `src/core/scripts/list-repos.test.ts`; AD-13 core layer).
- `src/adapters/driven/git/index.test.ts` — integration tests against a real temp git repo with an upstream configured (ahead/behind computation) + no-upstream cases.

**TUI display (added after matrix-coverage audit — human-approved scope extension, see Spec Change Log):** the EDTs zone is the only zone with real content to attach this data to today — Dashboard/Update/Logs/Routes/shared-types are all still `ZonePlaceholder` stubs with no per-service listing to extend (confirmed: none render any use-case data yet), so this pass covers the EDTs zone only.

- `src/bin/tui.ts` — composition root: build the same `registry`/`manifest`/`edtRegistry`/`git`/`state` ports `src/bin/main.ts` builds (mirror that wiring) and pass them into `createAppStore(deps)`.
- `src/adapters/driving/tui/store/app-store.ts` — `createAppStore` takes an optional `deps` param (the ports above); add `edtsBranches: ServiceBranchDivergence[] | null`, `edtsBranchesStatus: 'idle' | 'loading' | 'error'`, `edtsBranchesError: string | null`, and a `loadEdtsBranches(): Promise<void>` action that calls `listEdtBranchesDivergence` and updates this state. Keeps `ZoneScreenProps` (`{ useStore?: AppStore }`, shared by the `ZONE_SCREENS` registry in `zones/index.ts`) unchanged for every zone — deps are closed over inside the store, never prop-drilled.
- `src/adapters/driving/tui/zones/edts/edts-zone.tsx` — replace the `ZonePlaceholder` with a real list: call `loadEdtsBranches` on mount; render each service via the existing `ListRow`/`ListDetailSplit`/`DetailPane`/`DimAnnotation` components (Story 1.9) showing branch + `+ahead/-behind`, an explicit "no upstream" state, an explicit "unknown (offline)" state; a `detail.message` (git-error case) surfaces via `DimAnnotation`/`DetailPane` only, never inlined into the row (UX-DR17). Branch-name truncation: a small pure helper (`truncateBranchLabel(branch, maxWidth)`, unit-testable without a real terminal) ellipsizes past a fixed max width; the untruncated name is always shown in `DetailPane` when the row is focused.
- `src/adapters/driving/tui/store/app-store.test.ts` — tests for the new state fields/action.
- `src/adapters/driving/tui/zones/edts/edts-zone.test.tsx` (new) — render tests covering matrix rows: upstream/no-upstream/offline/member/non-member/kept-on-development/long-branch-truncation.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/ports/git.ts` -- add `aheadBehind` and `currentBranch` methods -- core contract for the new adapter reads.
- [x] `src/adapters/driven/git/index.ts` -- implement `aheadBehind` via git config + rev-parse @{u} + rev-list --left-right --count; `currentBranch` via git rev-parse --abbrev-ref HEAD -- AD-8 read-only gate.
- [x] `src/core/edt/list.ts` -- `listEdtBranchesDivergence` use-case: query each service's branch + ahead/behind, return per-service result with status enum. (Deliberate deviation: no `members[].upstream` field added to the EDT registry schema -- divergence is resolved live from git's own tracking config every call, per the Intent's "always using the same source of truth (the manifest + git adapter)"; nothing needed storing. `src/core/edt/registry.ts` and `src/adapters/driven/edt-registry/index.ts` were left untouched.)
- [x] `src/adapters/driving/cli/subcommands.ts` -- `edts` handler branch/divergence output -- CLI parity for the use-case.
- [x] `src/bin/main.ts` -- wire new git port methods into composition root. (No change needed: `deps.git`/`deps.state` etc. were already threaded into `buildSubcommands`.)
- [x] `src/core/edt/list.test.ts` -- unit tests of every I/O-matrix row with fake ports -- AD-13 core layer.
- [x] `src/adapters/driven/git/index.test.ts` -- real-git integration tests (currentBranch, aheadBehind with upstream, no-upstream case) -- AD-13 driven layer.
- [x] `src/bin/tui.ts` -- composition root: build the same ports `main.ts` builds and pass them into `createAppStore(deps)`.
- [x] `src/adapters/driving/tui/store/app-store.ts` -- `edtsBranches`/`edtsBranchesStatus`/`edtsBranchesError` state + `loadEdtsBranches()` action. (`createAppStore(deps?)`: deps optional so every pre-2.6 call site, including the module-level `useAppStore` default and existing tests, keeps working unwired; `loadEdtsBranches` degrades to an explicit `error` status rather than throwing when unwired, and guards against a duplicate concurrent fetch.)
- [x] `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- real list view: branch + ahead/behind, no-upstream, unknown-offline, truncated branch names with full name on focus, error detail one action away. (`truncateBranchLabel`/`formatServiceMeta`/`formatServiceDetail` exported as pure, terminal-free-testable helpers. A per-service `detail.message` renders as a `DimAnnotation` *sibling* of `DetailPane`, never nested inside it -- `DetailPane` wraps its `children` in one Ink `<Text>` internally, so only Text-safe content goes through it.)
- [x] `src/adapters/driving/tui/store/app-store.test.ts` -- tests for the new state/action.
- [x] `src/adapters/driving/tui/zones/edts/edts-zone.test.tsx` -- render tests covering every I/O-matrix row reachable from the TUI. (Found and fixed a latent non-determinism bug in the shared `render-to-string.ts` test helper while writing these: without an explicit `columns`/`rows` on the fake stdout, Ink's `getWindowSize()` falls through to a real terminal-size probe of the test process, making any wrap-sensitive assertion flaky across environments -- pinned to 120x40.)

**Acceptance Criteria:**
- Given a service with a configured upstream, when displayed, then it shows the branch name and both ahead/behind counts.
- Given a service with no configured upstream, when displayed, then it shows an explicit "no upstream" state, not a numeric value.
- Given the tool is offline, when divergence is displayed, then it shows an explicit "unknown (offline)" state, not a stale/zero value.
- Given any managed service — EDT member or not (including ones kept on `development` per Story 2.4), when the EDTs zone is viewed, then its branch/divergence is shown uniformly.

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

- **2026-08-19 (step-03 matrix audit):** the core/CLI implementation (backend) landed clean, but the Matrix Test Audit found 2 of 8 I/O-matrix rows uncovered by any test: "Divergence computed mid-run" (update zone) and "Branch name very long" (display truncation) — because the original Code Map only listed core/CLI/git-adapter files, no TUI files, despite the frozen Intent requiring display in "the EDTs zone and related displays". Investigation found every non-EDTs zone (Dashboard/Update/Logs/Routes/shared-types) is still a `ZonePlaceholder` stub with no per-service listing to extend, and no TUI composition-root wiring for core use-cases exists anywhere yet (this would be the first). Asked the human: extend the Code Map now to cover TUI display, defer it, or do the EDTs zone only. **Decision: extend now.** Code Map/Tasks updated to add EDTs-zone real rendering (`src/bin/tui.ts`, `store/app-store.ts`, `zones/edts/edts-zone.tsx` + tests). Scope stays EDTs-zone-only per the placeholder-stub constraint above — Dashboard/Update/Logs/Routes/shared-types display and the "mid-run update" matrix row are logged to `deferred-work.md` (no zone exists yet to attach them to).

## Design Notes

- The `aheadBehind` computation uses `git rev-parse --abbrev-ref HEAD` for the current branch and `git log --count --left-only {upstream}..{current}` for ahead/behind counts. If the upstream ref cannot be resolved, status becomes `no-upstream` or `unknown-offline` depending on network availability.
- Divergence data is refreshed on-demand (zone render, explicit refresh action) — not cached indefinitely. This keeps the data fresh without imposing a continuous background process.
- The status enum `{current, no-upstream, unknown-offline}` is shared across all zones that display service branch information, ensuring uniform treatment.
- Per-service outcome vocabulary during group updates (`updated`/`skipped`/`failed`) remains separate from branch/divergence display, but both consume the same `GitPort` under the hood.

## Verification

**Commands:**
- `npm test` -- expected: all suites green (new `list.test.ts`, `adapters/driven/git/index.test.ts`, updated e2e).
- `npm run typecheck` -- expected: clean (`tsc --noEmit`).
- `npm run depcheck` -- expected: `no dependency violations found` (AD-1 holds with the new core port + git adapter read methods).

**Manual checks (if no CLI):**
- Against a real git repo with an upstream: `tui-back edts` → shows branch name + ahead/behind counts.
- Against a repo with no remote: `tui-back edts` → shows "no upstream" state.
- Offline mode: disconnect network, `tui-back edts` → shows "unknown (offline)" state.

## Suggested Review Order

**Divergence contract & computation**

- Entry point: the `GitPort` contract this whole story hangs off — three-way Result shape (`ok` / `no-upstream` / `unknown-offline`), never a fabricated value.
  [`git.ts:49`](../../../src/core/ports/git.ts#L49)

- The real implementation: three-step read (branch → upstream-configured? → rev-list counts), local-only, never fetches.
  [`git/index.ts:202`](../../../src/adapters/driven/git/index.ts#L202)

- Review-patch fix: distinguishes "upstream genuinely unset" from a real git/spawn failure on the config read, so an environment error is never silently reported as `no-upstream`.
  [`git/index.ts:278`](../../../src/adapters/driven/git/index.ts#L278)

**Use-case: listing branch/divergence uniformly**

- Turns every managed repo (member or not) into a branch/divergence result, reading membership fresh from the active EDT each call.
  [`list.ts:64`](../../../src/core/edt/list.ts#L64)

- Per-service read: folds any git error (including a detached-HEAD `currentBranch` failure) into the same `unknown-offline` treatment the matrix requires.
  [`list.ts:127`](../../../src/core/edt/list.ts#L127)

**CLI surface**

- `tui-back edts`: thin wrapper handing the same use-case straight to JSON/text output — CLI/TUI parity by construction.
  [`subcommands.ts:92`](../../../src/adapters/driving/cli/subcommands.ts#L92)

**TUI composition root & store wiring**

- Scope-extension entry point: the composition root that wires core ports into the TUI for the first time (mirrors `main.ts`'s CLI wiring exactly).
  [`tui.ts:54`](../../../src/bin/tui.ts#L54)

- The ports the store closes over — kept optional so every pre-2.6 `createAppStore()` call site stays unwired-but-usable.
  [`app-store.ts:29`](../../../src/adapters/driving/tui/store/app-store.ts#L29)

- `loadEdtsBranches`: the async action bridging the use-case into Zustand state — status/error/unreachable/errors all reset together on each load.
  [`app-store.ts:122`](../../../src/adapters/driving/tui/store/app-store.ts#L122)

**TUI EDTs zone rendering**

- The zone itself: replaces the `ZonePlaceholder` stub with a real list+detail view driven entirely by store state.
  [`edts-zone.tsx:119`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L119)

- Review-patch fix: an error state now shows *only* the error — never a stale row list left over from a prior successful load.
  [`edts-zone.tsx:142`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L142)

- Review-patch fix: `unreachable`/`errors` counts (previously silently dropped) now surface as a one-line summary.
  [`edts-zone.tsx:80`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L80)

- Review-patch fix: `j`/`k` row-selection extracted into pure, directly-unit-testable functions (the `useInput` callback itself can't be exercised by the test harness).
  [`edts-zone.tsx:101`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L101) · [`edts-zone.tsx:111`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L111)

**Peripherals**

- Shared test-infra fix found along the way: pins a fake terminal size so any wrap-sensitive Ink render assertion is deterministic across environments.
  [`render-to-string.ts:31`](../../../src/adapters/driving/tui/shared/components/render-to-string.ts#L31)

- Core unit tests (every I/O-matrix row against fake ports): [`list.test.ts`](../../../src/core/edt/list.test.ts)
- Driven-adapter integration tests (real clone/origin pairs, upstream config-failure shim): [`git/index.test.ts`](../../../src/adapters/driven/git/index.test.ts)
- TUI render tests (loading/error/stale-on-error/issues-summary/truncation/selection): [`edts-zone.test.tsx`](../../../src/adapters/driving/tui/zones/edts/edts-zone.test.tsx)
- Store tests (load/error/concurrent-fetch-guard/unwired-degrade): [`app-store.test.ts`](../../../src/adapters/driving/tui/store/app-store.test.ts)
- Black-box e2e (`tui-back edts` against real git repos): [`tui-back.e2e.test.ts`](../../../src/bin/tui-back.e2e.test.ts)