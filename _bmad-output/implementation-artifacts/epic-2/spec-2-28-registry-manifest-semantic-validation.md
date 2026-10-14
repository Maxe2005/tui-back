---
title: 'Registry — Manifest Semantic Validation'
type: 'feature'
created: '2026-10-14'
status: 'done'
review_loop_iteration: 0
baseline_commit: '0e22c8c1160f605d90af4d807628a3457b3d760e'
context:
  - `{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md`
  - `{project-root}/_bmad-output/implementation-artifacts/epic-2/spec-2-33-registry-deregister-stale-unreachable-or-unmanaged-repos.md`
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The manifest loader (Story 1.4) rejects schema-invalid `.tui-back.yaml`, but nothing checks that a schema-valid manifest's declared values are actually real — e.g. a typo'd `sharedBranch` that exists nowhere surfaces later as a confusing failure in create/switch/update instead of at the registry.

**Approach:** Add a read-only `validateRegistry` core use-case (one extensible check: `sharedBranch` exists locally or as a known `origin/` remote-tracking ref, never fetching), expose it as `tui-back registry validate` for CLI parity and as a `Ctrl+V` "Validate registered repos" action on the existing REPO REGISTRY screen.

## Boundaries & Constraints

**Always:**
- `Result<T>` with kebab-case codes throughout; never throw (dispatch maps throws to `internal-error`).
- Per-path isolation in registry-file order: one outcome row per path, one failure never blocks the others.
- Strictly read-only: no `LockPort`/`registryResourceKey`, no `fetch`/`pull`/write; per-repo order `exists()` → `load()` → `branchExistsLocally()` → `listRemoteBranches()` (remote only on local miss).
- Remote half anchored on `origin/` (`remotes.includes('origin/' + sharedBranch)` — the only remote the adapter fetches from).
- Loader failures surface with exact existing codes; missing `sharedBranch` → `shared-branch-missing` (`sharedBranch "<name>" not found locally nor on origin`); `exists()`/git-read errors → inconclusive bucket (never valid/invalid, never dropped).
- One-entry extensible check registry now (`sharedBranch` existence); a future check is an entry, not a rewrite.
- Flagless CLI (`registry validate`, zero args; excess → `invalid-argument` + usage; no `isTTY` gate — envelope owns TTY/JSON).
- TUI: `Ctrl+V` in `root-input` only (verified free); new strings match the screen's English; store action copies the `registrySessionId` guard.
- NodeNext `.js` imports first in every touched/new file (depcheck acorn fallback).

**Ask First:**
- If a repo turns out to use a remote other than `origin` for its `sharedBranch`, HALT — the `origin/` anchoring decision needs renegotiation, do not silently widen to `*/<branch>`.
- If placing the validate phases in `resolveRegistryScreenPhase` forces a change to clean's existing priority, HALT — clean's locked behavior (test at `repo-registry-screen.test.tsx:110-118`) must not move.

**Never:**
- Never fetch, pull, create, rename or delete any branch — validation is side-effect-free (`show-ref` + `for-each-ref` reads only).
- Never re-implement schema validation — loader owns it; this story only adds semantic checks on top of an already-loadable manifest.
- Never auto-fix, auto-remove or pre-check any removal — pruning is Story 2.33's territory; validate lists, it never writes.
- Never import `FailedResultList` into the registry screen — it hand-rolls its lists (`CheckboxListItem` + cursor glyph); mirror the `clean-results` render blocks, not the EDT-dialog component.
- Never add a new top-level command or screen — this extends the `registry` screen and the `registry` CLI verb (UX-DR29 amendment).
- Never gate on `isTTY` in the CLI wrapper — read-only output has no prompt path (same as clean's zero-candidate path).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| sharedBranch local | manifest ok, `branchExistsLocally` true | row `valid` | N/A |
| sharedBranch remote-only | local false, `origin/<sharedBranch>` in `listRemoteBranches` | row `valid` | N/A |
| sharedBranch nowhere | local false, no `origin/<sharedBranch>` | row `invalid`, code `shared-branch-missing` | N/A |
| unreachable path | `registry.exists()` false | row `unreachable` | N/A |
| load failure | `manifest.load()` err (any of the 5 codes) | row `invalid` with the loader's exact code + message | N/A |
| inconclusive git/fs | `exists()` / `branchExistsLocally` / `listRemoteBranches` err | row in inconclusive bucket with exact code | N/A |
| empty registry | zero registered paths | explicit "no registered repos" outcome, exit 0 | N/A |
| CLI excess args | `registry validate <anything>` | `invalid-argument` + `Usage: tui-back registry validate` | exit 1, single JSON line off-TTY |

</frozen-after-approval>

## Code Map

- `src/core/scripts/clean-registry.ts:60-115` — `classifyStaleRegistry` + `classifyOne`: loop/bucket/fail-fast pattern to reuse; note `:114` inverts here (non-`manifest-not-found` load errors are validation outcomes, not healthy).
- `src/core/scripts/list-repos.ts:44-70` — per-path bucket loop in registry-file order.
- `src/core/ports/git.ts:93,172` + `src/adapters/driven/git/index.ts:431-437,800-819` — `branchExistsLocally` (`show-ref`, `git-branch-check-error`) and `listRemoteBranches` (`for-each-ref`, `origin/HEAD` excluded, `git-list-remote-branches-error`); read-only, never fetch. Composition to copy: `src/core/edt/create.ts:526-568` (local first, remote only on miss).
- `src/adapters/driven/manifest/index.ts:26-64` — the five exact loader codes; `schema.ts:24,26` — `sharedBranch` defaults to `development`, `protectedBranches` optional (protected names need not exist: no check).
- `src/adapters/driving/cli/subcommands.ts:49-51,98-101,224-236,713-839` — `registry` verb dispatch + help strings to extend, `list-repos` zero-flag arity pattern, `runRegistryClean` parity precedent; `git` dep available (`:61`, wired `src/bin/main.ts:37,75-83`).
- `src/adapters/driving/tui/store/slices/registry-slice.ts:31-87,116-123,221-259,300-314` — clean triplet fields/actions, `registrySessionId` guard, all-or-nothing reset to extend.
- `src/adapters/driving/tui/shared/repo-registry-screen.tsx:49-110,224-232,383-463` — phase union + priority chain (validate slots below `cleaning`, above `results`), `Ctrl+L` trigger precedent, `clean-results` renders to mirror; locked priority test at `repo-registry-screen.test.tsx:110-118`.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/scripts/validate-registry.ts` -- new read-only use-case `validateRegistry({registry, manifest, git})` with one-entry check registry (`checkSharedBranchExists`), per-repo outcome rows (`valid` / `invalid` + code/message / `unreachable` / `inconclusive`), registry-order stable -- the semantic core.
- [x] `src/core/scripts/validate-registry.test.ts` -- fake-port matrix covering every I/O row (local hit, remote-only hit, missing, unreachable, all five loader codes, all three inconclusive codes, empty registry, per-path isolation) -- locks the contract.
- [x] `src/adapters/driving/cli/subcommands.ts` -- add `validate` branch to the `registry` verb (zero-arg, `invalid-argument` + usage on excess), extend help usage, wire `{registry, manifest, git}` -- CLI parity with no new top-level command.
- [x] `src/adapters/driving/cli/dispatch.test.ts` -- unit cases: healthy/invalid/unreachable/load-error/inconclusive shapes, excess-arg rejection, zero-candidate exit 0 -- mirrors the clean describe blocks minus prompt tests.
- [x] `src/bin/tui-back.e2e.test.ts` -- black-box `registry validate` cases (healthy vs missing-branch vs invalid-manifest repos, single-line JSON, exit codes) -- non-TTY envelope proof.
- [x] `src/adapters/driving/tui/store/slices/registry-slice.ts` -- `registryValidateStatus`/`registryValidateError`/`registryValidateResults` + `runRegistryValidate()` with session guard; extend `resetRegistryScreen` -- store half of the TUI action.
- [x] `src/adapters/driving/tui/shared/repo-registry-screen.tsx` -- `validating` + `validate-results` phases (priority below `cleaning`, above `results`), `Ctrl+V` trigger in `root-input`, results render mirroring `clean-results` rows with valid/invalid/inconclusive coloring -- TUI half.
- [x] `src/adapters/driving/tui/shared/repo-registry-screen.test.tsx` -- phase-priority (validate below clean, above scan results), `Ctrl+V` trigger, loading/error/empty/rows renders -- locks screen behavior without pty.

**Acceptance Criteria:**
- Given the REPO REGISTRY screen open at root input, when `Ctrl+V` is pressed, then validation runs over every path in `registry.yaml` and each repo shows a per-repo outcome row (valid / invalid + reason / unreachable / inconclusive).
- Given `tui-back registry validate` run with no flags, when it completes, then stdout carries the same per-repo outcomes (human text on TTY, exactly one JSON line otherwise) with exit 0.
- Given a repo whose manifest declares `sharedBranch: "release"`, when neither `refs/heads/release` nor `origin/release` exists, then its row is `invalid` with code `shared-branch-missing`.
- Given a repo whose manifest fails to load, when validation runs, then its row carries the loader's exact existing code and message — schema validation is never re-implemented.
- Given a future second semantic check, when added, then it is a new entry in the check registry — no rewrite of the loop, bucketing, CLI or screen wiring.

## Spec Change Log

## Verification

**Commands:**
- `npx vitest run src/core/scripts/validate-registry.test.ts` -- expected: all fake-port matrix cases pass
- `npm test` -- expected: full suite green (no regressions in clean/scan/register/dispatch/screen tests)
- `npm run typecheck` -- expected: `tsc --noEmit` clean (NodeNext `.js` imports, `Manifest` shape)
- `npm run depcheck` -- expected: boundary rule holds (imports first in file, core never imports adapters)

## Suggested Review Order

**Semantic core**

- Read-only per-path loop with isolation and registry-file ordering.
  [`validate-registry.ts:75`](../../../src/core/scripts/validate-registry.ts#L75)

- sharedBranch check: local first, `origin/` only on miss.
  [`validate-registry.ts:47`](../../../src/core/scripts/validate-registry.ts#L47)

**CLI parity**

- `registry validate` branch: zero-arg, excess rejected.
  [`subcommands.ts:850`](../../../src/adapters/driving/cli/subcommands.ts#L850)

**TUI**

- Store action with session guard.
  [`registry-slice.ts:315`](../../../src/adapters/driving/tui/store/slices/registry-slice.ts#L315)

- Phases slot below clean, above scan results.
  [`repo-registry-screen.tsx:93`](../../../src/adapters/driving/tui/shared/repo-registry-screen.tsx#L93)

- Ctrl+V trigger at root input.
  [`repo-registry-screen.tsx:271`](../../../src/adapters/driving/tui/shared/repo-registry-screen.tsx#L271)

**Tests**

- Fake-port matrix covering every I/O row.
  [`validate-registry.test.ts:1`](../../../src/core/scripts/validate-registry.test.ts#L1)

- Black-box CLI cases.
  [`tui-back.e2e.test.ts:423`](../../../src/bin/tui-back.e2e.test.ts#L423)
