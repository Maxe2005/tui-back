---
title: 'edt switch CLI — Fail-Safe Dirty Handling & Explicit Flags'
type: 'feature'
created: '2026-10-14'
status: 'in-review'
review_loop_iteration: 0
context: []
---

## Intent

**Problem:** After story 2.39 a dirty repo that belongs to no outgoing member makes `edt switch` fail with `switch-dirty-services-unresolved`, but the CLI offers no way to say what to do with that work.

**Approach:** Two explicit-consent flags on `edt switch`, turned by the CLI into a `DirtyPolicy` that the core expands into per-repo `DirtyResolution`s after its own classification (the CLI never classifies repos).

## Design

- `--discard-dirty` → every dirty state-2/3 repo is resolved `discard`; paths audited in `detail.discardedPaths`.
- `--adopt-dirty [--adopt-branch <name>]` → dirty state-2/3 repo on a shared/protected branch adopts onto `<name>`; on a non-shared branch it keeps its current branch. A shared-branch repo with no `--adopt-branch` → `missing-argument`, zero writes. `--adopt-branch` without `--adopt-dirty` → `invalid-argument`.
- Both flags → `invalid-argument`. No outgoing EDT + adopt → `switch-adopt-without-outgoing` (core).
- `dirtyPolicy` skips the `onDirtyReposBeforeSwitch` seam; an explicit `dirtyResolutions` entry wins per repo.
- No flag: fail-safe default unchanged (`switch-dirty-services-unresolved`). The old silent stash-and-restore of these repos no longer exists.

## Tasks

- [x] `src/core/edt/switch.ts`: `DirtyPolicy` + `dirtyPolicy` param expanded in `resolveDirtyRepos`.
- [x] `src/adapters/driving/cli/subcommands.ts`: parse flags, usage string, pass `dirtyPolicy`.
- [x] Unit tests (`switch.test.ts`) and black-box e2e (`tui-back.e2e.test.ts`).

## Verification

`tsc --noEmit` clean; full vitest suite green (2704 passed).
