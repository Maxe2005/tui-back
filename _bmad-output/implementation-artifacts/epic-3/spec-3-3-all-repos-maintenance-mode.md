---
title: 'All-Repos Maintenance Mode'
type: 'feature'
created: '2026-09-17'
status: 'done'
baseline_commit: '7a9219a5b3ee0c5de85bb332c775b2f11ea9655d'
review_loop_iteration: 0
context: [_bmad-output/implementation-artifacts/epic-3-context.md]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The periodic sweep across every managed repo (today's hand-run `update-services.sh`) has no tool equivalent; the EDT-scoped update only touches active members.

**Approach:** Add an explicit all-repos mode to the group-update use-case running the same pull/merge → migrate → restart flow against every managed repo, behind a confirmation gate with cross-scope second-run blocking.

## Boundaries & Constraints

**Always:** `Result<T>` with kebab-case codes (AD-3). Core never imports adapters (AD-1); `.js` suffix, imports-first. Every managed repo appears in `data.results` (`updated`/`skipped`/`failed`). `git merge`, never rebase. One failure never blocks others. Global `GROUP_UPDATE_LOCK_KEY` serializes both scopes (`update-already-running` on contention).

**Ask First:** If enumeration needs more than `registry.list()` + `manifest.load()` per path, HALT and ask.

**Never:** No change to bare-`update` EDT behavior. No confirmation logic in core (driving concern). No dirty/conflict handling change (3.4). No per-service re-trigger (3.5). No AI-copilot behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| All-repos run | `update --all --yes` | Same per-service flow for every managed repo; each in `results` | N/A |
| Confirmation missing | `update --all` w/o `--yes` | No run; `confirmation-required` naming the flag | Exit 1, one JSON line |
| Bare update | `update` | EDT-scoped run as 3.1/3.2; `--all` never implied | N/A |
| Unknown flags | `update --foo` | `invalid-argument` | Never ignored |
| Empty registry | Zero managed repos | No-op success with explicit note | Never silent |
| Second run | Either scope running | Other scope rejected `update-already-running` | Cross-scope |
| Unmanaged path | Registry path w/o manifest | Skipped like `list-repos` | Never fatal |
| Per-repo failure | Dirty/conflict/migrate/restart fail | Row keeps its code; others continue | Same codes as 3.1/3.2 |

</frozen-after-approval>

## Code Map

- `src/core/scripts/group-update.ts:36-66` — add `scope?: 'edt'|'all'` (default `'edt'`) + `registry: RegistryPort` to params; all-scope skips active-EDT resolution, acquires the global lock only (no `edt:<ulid>` key).
- `src/core/scripts/group-update.ts:154-278` — reuse `updateMember()` unchanged; all-scope has no recorded `member.branch`, so it operates on `currentBranch` as-is (`==sharedBranch` → `pull`, else `fetch` + `assertAllowedBranch` without edtId + `mergeBranch`).
- `src/core/scripts/group-update.ts:42-54` — add `scope: 'edt'|'all'` to `GroupUpdateData`; all-scope sets `ulid: 'all'`, `topic: 'all-repos'`.
- `src/core/ports/registry.ts:7-13` + `src/core/scripts/list-repos.ts:35-72` — `registry.list()` enumeration with the `manifest-not-found` skip pattern; dedupe by `resolve(repoPath)` as the EDT path does.
- `src/adapters/driving/cli/subcommands.ts:133-153` — `update` parses `[]` (EDT) vs `['--all','--yes']` (all, order-insensitive) vs `['--all']` → `confirmation-required`; `src/bin/main.ts` + `src/bin/tui.ts` pass `registry` + `scope` (registry already instantiated for `list-repos`).
- `src/adapters/driving/tui/store/slices/update-slice.ts:51-112` + `zones/update/update-zone.tsx:147-223` — thread `scope` through the in-process call; separate all-repos trigger with a `modal-dialog` confirm gate (`Esc`/`Enter`) before `runGroupUpdate('all')`; reuse `updateErrorCode` message, `formatUpdateRow`/`formatUpdateSummary` with an all-repos title variant.
- Tests: `src/core/scripts/group-update.test.ts` (fake matrix + new `fakeRegistry`) and `src/bin/tui-back.e2e.test.ts` (`--all --yes` success, `--all`-alone confirmation, cross-scope block, empty-registry no-op).

## Tasks & Acceptance

**Execution:**
- [x] `src/core/scripts/group-update.ts` (+ `group-update.test.ts`) -- scope/registry params, all-scope enumeration, shared per-service flow, shape + locks; unit-test every matrix row.
- [x] `src/adapters/driving/cli/subcommands.ts` (+ `src/bin/main.ts`, `src/bin/tui.ts`, `src/bin/tui-back.e2e.test.ts`) -- flag parsing, confirmation code, wiring, black-box cases.
- [x] `src/adapters/driving/tui/store/slices/update-slice.ts` (+ `update-zone.tsx`) -- scope threading, modal confirm gate, summary variant.

**Acceptance Criteria:**
- Given managed repos, when `tui-back update --all --yes` runs non-TTY, then every repo is in `data.results` with its own outcome, exit 0.
- Given `tui-back update --all` without `--yes`, when run, then nothing starts and the result is `confirmation-required`, exit 1.
- Given a run in either scope, when the other scope triggers, then it is rejected `update-already-running`.
- Given an empty registry, when all-repos runs, then it succeeds with an explicit no-op note.

## Design Notes

Branch once at the top of `groupUpdate()`: all-scope skips `readActiveEdt()`/`edtRegistry` and builds targets from `registry.list()` + `manifest.load()`. Confirmation stays out of core — the CLI maps `--all`-alone to `confirmation-required` pre-call, the TUI gates behind a modal pre-invoke.

## Verification

**Commands:**
- `npm test && npm run typecheck && npm run depcheck` -- expected: all green (AGENTS.md order).
- `node src/bin/tui-back.mjs update --all` (pipe) -- expected: one JSON line, `confirmation-required`, exit 1.

## Suggested Review Order

**Core branching and shared per-service flow**

- Top-of-function scope branch plus global-only locking for all-repos
  [`group-update.ts:73`](../../src/core/scripts/group-update.ts#L73)

- Registry enumeration with dedupe, blank guard, and explicit no-op notes
  [`group-update.ts:80`](../../src/core/scripts/group-update.ts#L80)

- Ungated merge gate on currentBranch as-is in the shared flow
  [`group-update.ts:334`](../../src/core/scripts/group-update.ts#L334)

**Confirmation stays out of core (driving concern)**

- Flag parsing with order-insensitive --all --yes and confirmation-required
  [`subcommands.ts:136`](../../src/adapters/driving/cli/subcommands.ts#L136)

- Scope threading through the in-process TUI run plus all-run interrupt bypass
  [`update-slice.ts:56`](../../src/adapters/driving/tui/store/slices/update-slice.ts#L56)

**TUI confirm gate and all-scope rendering**

- Separate [A] trigger with modal confirm gate before runGroupUpdate('all')
  [`update-zone.tsx:162`](../../src/adapters/driving/tui/zones/update/update-zone.tsx#L162)

- All-confirm dialog, idle affordance, and scope-aware quit copy
  [`update-zone.tsx:264`](../../src/adapters/driving/tui/zones/update/update-zone.tsx#L264)

**Tests per matrix row**

- All-scope unit matrix with fake registry and ownership-gate proof
  [`group-update.test.ts:962`](../../src/core/scripts/group-update.test.ts#L962)

- CLI flag matrix plus black-box all-repos, confirmation, and cross-scope cases
  [`tui-back.e2e.test.ts:1575`](../../src/bin/tui-back.e2e.test.ts#L1575)

- Slice scope threading and zone helpers with all-scope rendering
  [`update-zone.test.tsx:145`](../../src/adapters/driving/tui/zones/update/update-zone.test.tsx#L145)
