---
title: 'Repo Registry Screen & Manifest Onboarding Guidance (Story 2.11)'
type: 'feature'
created: '2026-08-24'
status: 'in-review'
review_loop_iteration: 0
baseline_commit: '45be09e2b13a9f698bc210b930a8a1763bdebbf9'
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-24-2.md'
  - '_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The repo registry can only be populated via the CLI's `scan`/`register` subcommands today — a developer working entirely in the TUI has no way to discover or register manifest-carrying repos, and gets no guidance on creating a manifest for repos that don't have one yet.

**Approach:** Add a TUI overlay screen — reachable via the `:` command palette and auto-offered from Dashboard when the registry is empty — that scans a root path, lets the developer multi-select candidates via `checkbox-list-item`, registers them with per-path outcome reporting, and always shows static manifest-creation guidance. Reuses Story 1.5's existing `scan`/`register` core use-cases as-is; no new port/adapter.

## Boundaries & Constraints

**Always:**
- Reuse `scanRepos` (`src/core/scripts/scan.ts`) and `registerRepo` (`src/core/scripts/register.ts`) exactly as-is — no new core logic, port, or adapter.
- Screen is an overlay in the same family as the existing command/filter/help `ModalDialog` overlays — it is NOT a new `ZoneId`/tab; the closed 6-entry union in `zones.ts` stays unchanged.
- Every action reachable by keyboard only: `Space` toggles a candidate, `Enter` confirms the selection, per `checkbox-list-item`'s existing semantics (`keybindings.ts:26-33`).
- Static guidance (manual `.tui-back.yaml` per Story 1.4's schema, or the `/manifest-generator` skill run in the target repo) is always shown alongside scan/register controls — never gated to first launch only.
- Because `registry.add`/`registerRepo` is idempotent and never signals new-vs-existing, classify each selected path's outcome (`registered` / `already-registered` / `failed`) by snapshotting `registry.list()` before registering and diffing against it — not from `registerRepo`'s return value alone.
- An empty scan result is a distinct "no manifest-carrying repos found here" state, never rendered the same as a scan failure.
- Dashboard: when `registry.list()` is empty, show a "no repos registered yet" prompt offering to open the registry screen, checked before any other Dashboard content.
- Extend `AppStoreDeps` (`src/adapters/driving/tui/store/app-store.ts`) and `src/bin/tui.ts`'s composition root with a `LockPort` + `registryResourceKey`, mirroring `src/bin/main.ts:39-44` — `registerRepo` requires both for `withActionLock`.

**Ask First:** none identified — investigation resolved all open questions (see Design Notes for the Dashboard-chaining decision).

**Never:**
- Never build the PRD-deferred guided onboarding wizard or AI-assisted manifest bootstrapping — static guidance text only.
- Never build Story 2.1/2.9's "no EDT yet" Dashboard state — that state doesn't exist in code yet and is out of scope here; when the registry is non-empty, Dashboard keeps its current fallback content unchanged.
- Never add a general-purpose command-language/registry to the `:` palette — only wire the one new command that opens the registry screen; the palette's broader dispatch mechanism stays future work.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Zero repos registered | Dashboard renders, `registry.list()` empty | "No repos registered yet" prompt, offer to open registry screen | N/A |
| Registry non-empty | `registry.list()` has entries | Dashboard shows its existing (unchanged) content — no registry prompt | N/A |
| Scan a root path | Valid root containing manifest-carrying subdirs | `checkbox-list-item` list of candidates, multi-selectable | N/A |
| Scan finds nothing | Root has no `.tui-back.yaml` anywhere below it | Distinct "no manifest-carrying repos found here" state | Never rendered as/conflated with a scan failure |
| Register selected candidates | 1+ candidates selected, confirmed | Per-path outcome row: `registered` / `already-registered` / `failed` | A failed path shows its error detail; does not block the remaining paths |
| Candidate already in registry | Selected path is already present in `registry.list()` pre-register | Outcome classified `already-registered` via pre-register snapshot diff | N/A |
| `registerRepo` returns an error (e.g. lock contention) | `Result` is `err` | Outcome `failed` with detail from the error | Remaining selected paths still processed |

</frozen-after-approval>

## Code Map

- `src/core/scripts/scan.ts` -- `scanRepos(registry, root)`, reused as-is
- `src/core/scripts/register.ts` -- `registerRepo(registry, lock, resourceKey, path)`, reused as-is; single-path only, loop client-side for multi-select
- `src/core/ports/registry.ts` -- `RegistryPort.list()/scan()/add()` signatures consumed by the screen
- `src/adapters/driven/registry/index.ts:78-98` -- `add()` is idempotent, no add-vs-exists signal — confirms the snapshot-diff requirement above
- `src/adapters/driven/manifest/schema.ts` -- manifest field reference (`service`, `container`, `migrationCommand`, `modules`) for the static guidance text
- `src/bin/main.ts:39-44` -- reference composition wiring for `lock`/`registryResourceKey` to mirror in `bin/tui.ts`
- `src/bin/tui.ts:56-68` -- `AppStoreDeps` composition root; currently missing `LockPort` — extend here
- `src/adapters/driving/tui/store/app-store.ts` -- `AppStoreDeps` type to extend with `lock`/`registryResourceKey`
- `src/adapters/driving/tui/app-shell.tsx:48-144` -- `:` command-palette stub (`shouldOpenCommand`, `commandOpen` state, placeholder `ModalDialog`) — wire to open the new screen
- `src/adapters/driving/tui/app-shell.test.tsx:137-139` -- existing `shouldOpenCommand` coverage to extend
- `src/adapters/driving/tui/zones/dashboard/dashboard-zone.tsx` -- add the empty-registry prompt branch ahead of existing content
- `src/adapters/driving/tui/zones/zones.ts` -- closed `ZoneId` union; confirms the screen must NOT be registered here
- `src/adapters/driving/tui/shared/components/checkbox-list-item.tsx` -- reused for candidate multi-select
- `src/adapters/driving/tui/shared/components/index.ts` -- barrel exporting `ListDetailSplit`, `ModalDialog`, `Footer`, `DetailPane`, `ListRow`, `Spinner`, `DimAnnotation` for screen layout/states
- `src/adapters/driving/tui/shared/components/render-to-string.tsx` -- `renderToString()` smoke-test harness to follow (repo convention: pure functions for key handling, tested directly; `useInput` never simulated)
- `src/adapters/driving/tui/shared/repo-registry-screen.tsx` (NEW) -- the screen itself

## Tasks & Acceptance

**Execution:**
- [x] `src/bin/tui.ts` -- wire `LockPort` + `registryResourceKey` into `AppStoreDeps` composition, mirroring `bin/main.ts:39-44` -- `registerRepo` needs both
- [x] `src/adapters/driving/tui/store/app-store.ts` -- extend `AppStoreDeps` type with `lock`/`registryResourceKey`
- [x] `src/adapters/driving/tui/shared/repo-registry-screen.tsx` (NEW) -- root-path scan trigger, `checkbox-list-item` candidate multi-select, per-path outcome list, empty-scan state, static guidance text -- core AC surface
- [x] `src/adapters/driving/tui/shared/repo-registry-screen.test.tsx` (NEW) -- pure key-handling functions plus `renderToString` smoke tests per visual state -- covers the I/O matrix
- [x] `src/adapters/driving/tui/app-shell.tsx` -- replace the `:` command-palette placeholder body with a real command opening the registry screen
- [x] `src/adapters/driving/tui/app-shell.test.tsx` -- extend command-palette coverage for the open-registry-screen path
- [x] `src/adapters/driving/tui/zones/dashboard/dashboard-zone.tsx` -- add the "no repos registered yet" prompt branch, checked before existing content
- [x] `src/adapters/driving/tui/zones/dashboard/dashboard-zone.test.tsx` -- cover empty-registry vs. populated-registry Dashboard states

**Acceptance Criteria:**
- [x] Given the registry screen is opened, when rendered, then static manifest-creation guidance is shown alongside the scan/register controls regardless of whether this is the first launch.
- [x] Given the screen is exercised via keyboard only, when navigating/selecting/confirming, then every action is reachable without a mouse (Story 1.9 standing rule).
- [x] Given the registry screen is closed (`Esc`, or after a register run), when Dashboard is shown again, then the empty-registry prompt reflects the current registry state rather than a stale cached one.

## Design Notes

**Dashboard chaining decision:** the epics.md AC describes chaining before Story 2.1/UX-DR19's "no EDT yet" prompt, but that state isn't implemented in the codebase yet (Dashboard currently falls through to a generic `ZonePlaceholder`). This spec only adds the registry-empty branch; when the registry is non-empty, Dashboard's existing (placeholder) content is left untouched. The "chains before" ordering is satisfied by construction — the registry check runs first — without requiring the not-yet-built EDT-empty state as a prerequisite.

**Already-registered classification example:**
```ts
const before = await registry.list(); // Result<string[]>
// ...call registerRepo(path) for each selected candidate...
const outcome = before.data.includes(canonicalPath) ? 'already-registered' : 'registered';
```

## Verification

**Commands:**
- `npm test` -- expected: all suites green, including new `repo-registry-screen` and `dashboard-zone` tests
- `npm run typecheck` -- expected: `tsc --noEmit` clean
- `npm run depcheck` -- expected: no boundary violations (changes confined to `adapters/driving/tui` plus `bin/tui.ts` composition wiring)

**Manual checks (if no CLI):**
- Launch the TUI with an empty `registry.yaml`: Dashboard shows the "no repos registered yet" prompt; opening the registry screen and scanning a root containing manifest-carrying directories shows checkbox candidates; selecting and confirming registers them and reports per-path outcomes; relaunching shows Dashboard's normal (non-empty) content.
