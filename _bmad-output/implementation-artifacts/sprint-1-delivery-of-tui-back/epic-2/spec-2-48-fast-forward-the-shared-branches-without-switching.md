---
title: 'Story 2.48: Fast-Forward the Shared Branches Without Switching'
type: 'feature'
created: '2026-11-18'
status: 'done'
baseline_commit: 'e269465c067a1dd1b5293a025f6e963b74cdb64f'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-1-delivery-of-tui-back/epic-2/spec-2-46-shared-branches-edt-model-guards-setting-switch-and-update.md'
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-1-delivery-of-tui-back/epic-2/spec-2-47-shared-branches-edt-in-the-edts-zone-and-the-settings-screen.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Updating the shared-branches EDT runs fast-forward plus migrations and requires switching to it. When only speed matters, there is no way to bring the local shared branches up to date without leaving the current EDT.

**Approach:** Add a quick-action use case `fastForwardShared`, exposed as a key on the system EDT row, `tui-back edt fast-forward-shared` and an MCP `write` tool. It fast-forwards each managed service's local shared branch from `origin`. It never touches the active EDT, other branches or worktrees, and runs no migration or restart.

## Boundaries & Constraints

**Always:** Per-service outcome is one of `fast-forwarded` / `up-to-date` / `skipped` (reason `dirty` | `diverged`) / `failed`. Checked-out shared branch and clean worktree: `pull` (ff-only). Not checked out: `GitPort.fetch(repoPath, sharedBranch)` (creates the branch if absent). Detect divergence via `fetchRemote` then `listUnpushedCommits`. Results go in the AD-3 envelope and an AD-19 `BoundedList` (glyph plus text). Any `failed` row gives a non-zero exit, with rows still in the envelope data. Setting off gives `edt-not-found`, found by looking up the system EDT in `edtRegistry.list()`. New keys are declared in `footer-contexts.ts`. Core stays free of adapter imports.

**Ask First:** Any new `GitPort` method, if `fetchRemote` + `listUnpushedCommits` proves insufficient.

**Never:** No checkout, stash, force, migration or restart. No write on a protected branch other than ff from its own `origin` counterpart. No change to the update flow of story 2.46.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Behind, not checked out | shared branch behind origin | `fast-forwarded` via `fetch` | N/A |
| Checked out, clean | behind origin | `fast-forwarded` via `pull` | N/A |
| Checked out, dirty | uncommitted changes | `skipped (dirty)` | none, never stashed |
| Diverged | local commits not on origin | `skipped (diverged)` | none |
| Equal to origin | no change | `up-to-date` | N/A |
| Absent locally | no local shared branch | fetched into a new local branch, `fast-forwarded` | N/A |
| Origin unreachable | fetch fails | `failed` for that service only, others continue | exit non-zero |
| Setting off | no system EDT in registry | refused | `edt-not-found` (TUI: action unavailable) |

</frozen-after-approval>

## Code Map

- `src/core/edt/shared-edt.ts` -- system EDT model (`isSystemEdt`, `SharedEdtRepo`, `manifest.sharedBranch`).
- `src/core/edt/switch.ts`, `checkout-expected.ts` -- models for not-found lookup and `memberTargetSpec` (2.46 carve-out).
- `src/core/ports/git.ts` -- `fetch`, `fetchRemote`, `listUnpushedCommits`, `pull`, `currentBranch`, `hasUncommittedChanges`, `branchExistsLocally`.
- `src/adapters/driven/git/remote.ts`, `gate.ts` -- fetch/pull carry no gate call; document the second carve-out here.
- `src/adapters/driving/cli/commands/edt.ts` -- verb dispatch + `EDT_USAGE` (keep `tui-back edt <verb>` format for `completion-spec.ts`). `edt-list.ts` -- simplest analogue; `edt-switch.ts` ~l.200 -- `err(code, msg, data)` pattern.
- `src/adapters/driving/mcp/tool-registry.ts` -- add `edt-fast-forward-shared` (copy `edt-switch`, `safety: 'write'`); `README.md` l.78 tool list.
- `src/adapters/driving/tui/zones/edts/edts-zone.tsx` (`useInput` ~l.846, `focusedIsSystem` l.343), `edts-zone.logic.ts` (`formatAvailableActionsHint`, dialog union), `edts-footer-context.ts`, `keybindings/footer-contexts.ts` l.426 (`edts-system-switch`), `dialogs/switch-restart-report.tsx` (report model), `store/slices/edt-slice.ts` (`switchEdt` ~l.452).

## Tasks & Acceptance

**Execution:**
- [ ] `src/core/edt/fast-forward-shared.ts` + `.test.ts` -- use case, per-service rows, all matrix cases, assert no checkout/stash/migrate calls -- core behavior.
- [ ] `src/adapters/driven/git/gate.ts`/`remote.ts` + `index.test.ts` -- document carve-out; real-git test that ff of a shared branch passes while commit/merge/delete/push stay rejected.
- [ ] `src/adapters/driving/cli/commands/edt.ts` (+ new `edt-fast-forward-shared.ts`) + `dispatch.test.ts`, `completion-spec.test.ts` -- CLI verb, strict args, `fast-forward-failed` error carrying rows.
- [ ] `src/adapters/driving/mcp/tool-registry.ts` + `tool-registry.test.ts`, `README.md` -- MCP write tool.
- [ ] TUI: store action with in-progress guard, key on the system row (proposed `f`, verify no conflict), results dialog with `BoundedList`, footer/hints/keybindings declarations and tests (incl. bounded-rendering guard).

**Acceptance Criteria:**
- Given the setting is on, when the quick action runs from TUI, CLI or MCP, then each service's local shared branch is fast-forwarded per the matrix, with the active EDT, worktrees and checked-out branches untouched.
- Given the run ends, then per-service rows appear in a bounded list and the AD-3 envelope, with no migration or restart; exit is non-zero if any row `failed`.
- Given the setting is off, then the TUI hides the action and CLI/MCP return `edt-not-found`.
- Given the AD-8 gate, then only ff of a shared branch from its own `origin` counterpart is allowed.

## Spec Change Log

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors
- `npm test` -- expected: all pass
- `npm run lint` -- expected: clean

## Suggested Review Order

**Core behavior**

- Entry point: per-service decision (absent / diverged / up-to-date / dirty / pull / fetch).
  [`fast-forward-shared.ts:100`](../../../../../src/core/edt/fast-forward-shared.ts#L100)

**AD-8 carve-out**

- Fetch/pull of a shared branch stay ungated; the rest stays rejected.
  [`remote.ts:11`](../../../../../src/adapters/driven/git/remote.ts#L11)

**Surfaces**

- CLI verb, non-zero exit when any row failed.
  [`edt.ts:10`](../../../../../src/adapters/driving/cli/commands/edt.ts#L10)

- MCP write tool.
  [`tool-registry.ts:187`](../../../../../src/adapters/driving/mcp/tool-registry.ts#L187)

- Store action with in-progress guard.
  [`edt-slice.ts:465`](../../../../../src/adapters/driving/tui/store/slices/edt-slice.ts#L465)

- `f` key handler, rejection-safe and unmount-safe.
  [`edts-zone.tsx:733`](../../../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L733)

- Bounded results dialog, glyph plus text.
  [`fast-forward-dialog.tsx:16`](../../../../../src/adapters/driving/tui/zones/edts/dialogs/fast-forward-dialog.tsx#L16)

**Tests**

- Real-git run of the use case pins the ref argument order.
  [`index.test.ts:1372`](../../../../../src/adapters/driven/git/index.test.ts#L1372)
