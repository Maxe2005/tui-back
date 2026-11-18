---
title: 'Story 2.46: Shared-Branches EDT — Model, Guards, Setting, Switch & Update'
type: 'feature'
created: '2026-11-18'
status: 'done'
baseline_commit: 'efc3491a9d0b8819ca688cf95f59683dbb12ff73'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-1-delivery-of-tui-back/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-1-delivery-of-tui-back/epic-2/spec-2-45-edt-switch-restart-only-services-whose-checkout-moved.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Refreshing every shared branch requires creating and maintaining an EDT by hand. FR-53 wants a preconfigured, settings-enabled EDT that puts every managed service on its manifest `sharedBranch` and updates them together.

**Approach:** Add `edts.sharedBranchesEdtEnabled` (default `false`). When on, the EDT registry synthesizes a read-only entry (topic `Shared branches`, `kind: "system-shared"`, constant ulid) from the managed repos and their manifests; it is never written to `edts.yaml`. The existing switch and group-update cores run on it unchanged, plus a narrow AD-8 carve-out, a no-adopt rule, and skip-if-not-on-shared in the update.

## Boundaries & Constraints

**Always:** Follow the AC of Story 2.46 in `epics.md`. Build order, one commit per step: setting + schema → pure `core/edt/shared-edt.ts` builder → registry synthesis + `edt-system-readonly` guards → AD-8 carve-out + tests → switch no-adopt rule → update skip-if-not-on-shared → CLI `edt list` field/rejections → MCP schema (additive). Core stays free of adapter imports. Error codes are bare kebab-case strings (`edt-system-readonly`, `switch-adopt-unavailable`).

**Ask First:** Any change to the on-disk `edts.yaml` zod schema (it must stay untouched).

**Never:** Write the system EDT to `edts.yaml`; widen the carve-out to commit/merge/rename/delete/push; let an ordinary EDT checkout a shared branch; list the system EDT as a "user" of a shared branch in `branchOwners` or the gate's cross-EDT check; build any TUI UI (Story 2.47) or the quick fast-forward (2.48).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Setting off | `edt switch shared-branches` | No entry in any listing | `edt-not-found` |
| Mutate system EDT | modify / rename / member edit / delete / create same topic | Rejected before any write | `edt-system-readonly` |
| Switch from system EDT, dirty repo | `--adopt-dirty` / `--adopt-branch` | Rejected before touching anything; dialog flow stash/discard only | `switch-adopt-unavailable` |
| Update, service off its shared branch | system EDT active | Row reported `skipped` (not on shared branch), never switched | N/A |
| Setting turned off while system EDT active | settings change | Refused, message names the switch to make first | refusal message |
| Startup, pointer = system EDT, setting off | app start | Active EDT = none + warning; nothing written | N/A |

</frozen-after-approval>

## Code Map

Paths under `src/`.
- `core/ports/settings.ts` (`edts` type ~l.56, `DEFAULT_SETTINGS` ~l.148) + `adapters/driven/settings/schema.ts` (`z.boolean().optional().default(...)` in `edts` block) + `index.test.ts` (asserts full defaults) -- setting.
- `core/ports/edt-registry.ts` -- add optional `kind?: 'system-shared'` to `EdtRegistryEntry`; `adapters/driven/edt-registry/index.ts` (`list` ~l.46, `update`/`remove`/`setStatus`) -- synthesize in `list()`, `setStatus` no-op for the synthetic ulid, readonly guard on update/remove. `schema.ts` there stays untouched.
- `core/edt/shared-edt.ts` (new) -- pure builder `(repos+manifests) → EdtRegistryEntry`; `SHARED_EDT_ULID`, `SHARED_EDT_TOPIC`, `isSystemEdt()`.
- `core/edt/{modify,create,delete}.ts` -- `edt-system-readonly` guards (create: topic equal to `Shared branches`, trimmed, case-insensitive).
- `core/edt/checkout-expected.ts` (`resolveTargetBranch` ~l.25) + `core/edt/switch.ts` (`switchMemberRepo` ~l.834) -- carve-out: system EDT members use the ungated `shared` target spec (fetch if absent locally). `adapters/driven/git/gate.ts` stays rejecting everything else.
- `core/edt/switch.ts` (`resolveDirtyRepos` l.367, `planDirtyWork` l.550) -- reject adopt when outgoing is system; stash/discard only.
- `core/scripts/group-update.ts` (`unexpected-branch` guard ~l.929) -- system EDT: skipped outcome instead of failed.
- `core/edt/branch-owners.ts` and `adapters/driven/git/gate.ts` l.38-48 -- exclude `kind==='system-shared'`.
- `adapters/driving/cli/commands/edt.ts`, `edt-switch.ts` (flags l.60-120), `basic.ts` (`edts`), `adapters/driving/mcp/tool-registry.ts` -- `edt list` verb with `kind`, flag rejection, additive MCP field.
- `bin/tui.ts` (settings + state built ~l.114) -- startup fallback for a stale active pointer; `tui/store/slices/settings-slice.ts` or a core helper -- setting-off refusal when system EDT active.
- Tests: co-located `*.test.ts` (`core/edt/shared-edt.test.ts` new, `switch`, `checkout-expected`, `group-update`, `branch-owners`, registry/settings adapters, `dispatch.test.ts`).

## Tasks & Acceptance

**Execution:**
- [ ] `settings` port + schema + tests -- add `edts.sharedBranchesEdtEnabled` default false -- AC 1
- [ ] `core/edt/shared-edt.ts` + test -- pure builder and identity helpers -- AC 2
- [ ] edt-registry adapter + core mutation guards + tests -- synthesis, `edt-system-readonly` -- AC 2-4
- [ ] checkout-expected / switch + gate tests -- carve-out, still rejected for ordinary EDTs and for commit/merge/rename/delete/push -- AC 5, 9
- [ ] switch no-adopt rule (core + CLI flags) + tests -- AC 6
- [ ] group-update skip-if-not-on-shared + tests -- AC 7
- [ ] branch-owners + gate exclusion + tests -- Story 2.43 invariant
- [ ] setting-off refusal + startup fallback + tests -- AC 8, 9
- [ ] CLI `edt list` `kind` field + MCP additive schema + tests -- AC 2

**Acceptance Criteria:**
- Given the AC of Story 2.46, when `npm test`, typecheck and lint run, then everything passes and `edts.yaml` is never written for the system EDT.

## Design Notes

`tui-back edt list` does not exist today (only the `edts` divergence command and MCP `edts`); add a `list` verb to `edt.ts` that emits entries with `kind` (`"user"` for ordinary EDTs). The constant ulid is a valid 26-char Crockford string, e.g. `01SHAREDBRANCHES00000000000` (check against any ulid validation). With the system EDT outgoing, every repo is a state-1 member and would be auto-stashed: confirm this satisfies "stash or discard only".

## Verification

**Commands:**
- `npm test` -- expected: all green
- `npx tsc --noEmit` and `npm run lint` -- expected: no errors

## Suggested Review Order

**Model and synthesis**

- Pure identity helpers and builder: the one place that defines the system EDT.
  [`shared-edt.ts:11`](../../../../../src/core/edt/shared-edt.ts#L11)

- Registry synthesizes the entry on read, never writing `edts.yaml`.
  [`index.ts:58`](../../../../../src/adapters/driven/edt-registry/index.ts#L58)

- Setting wiring into the real CLI/MCP process.
  [`composition.ts:43`](../../../../../src/bin/composition.ts#L43)

**AD-8 carve-out and switch rules**

- Narrow carve-out: system EDT members use the ungated shared spec.
  [`checkout-expected.ts:17`](../../../../../src/core/edt/checkout-expected.ts#L17)

- Adopt refused before any write when the outgoing EDT is the system one.
  [`switch.ts:422`](../../../../../src/core/edt/switch.ts#L422)

- System EDT never counts as a branch owner.
  [`branch-owners.ts:9`](../../../../../src/core/edt/branch-owners.ts#L9)

**Update**

- Off-shared-branch services are skipped, never switched silently.
  [`group-update.ts:939`](../../../../../src/core/scripts/group-update.ts#L939)

**Setting-off refusal and stale pointer**

- Disabling the setting is refused while the system EDT is active.
  [`settings-slice.ts:78`](../../../../../src/adapters/driving/tui/store/slices/settings-slice.ts#L78)

- Startup falls back to no active EDT, writing nothing.
  [`edt-slice.ts:312`](../../../../../src/adapters/driving/tui/store/slices/edt-slice.ts#L312)

**CLI and MCP**

- `edt list` exposes `kind` and the real active status.
  [`edt-list.ts:19`](../../../../../src/adapters/driving/cli/commands/edt-list.ts#L19)

- Additive read-only MCP tool `edt-list`.
  [`tool-registry.ts:420`](../../../../../src/adapters/driving/mcp/tool-registry.ts#L420)
