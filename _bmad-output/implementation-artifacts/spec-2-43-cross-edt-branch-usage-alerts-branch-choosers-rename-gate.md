---
title: 'Story 2.43: Cross-EDT Branch Usage — Alerts in Branch Choosers & Rename Gate'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_commit: '71f25f90052f1940534053228eb1ce5dfeb06de7'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Branch choosers never show that another EDT already owns a branch, and `GitPort.renameBranch` only runs the FR-7 protected-branch gate — so renaming (or taking) a branch another EDT relies on silently breaks that EDT.

**Approach:** Make `renameBranch` reject `branch-owned-by-other-edt` (old or new name, before any `git` call, AD-8); add a pure `branchOwners` helper feeding `⚠ EDT « <topic> »` annotations in every branch chooser and inline refusals in the wizard box and `BranchPicker`.

## Boundaries & Constraints

**Always:** Owners come from the store's loaded `edts` (members carry `{repoPath, branch}`) — no new port. Paths compared after `resolve()`. The core/adapter failure and Story 2.25 assisted resolution stay unchanged. `BranchAutocompleteInput` stays EDT-agnostic (generic `annotations?: Record<branch, string>`). Annotation = glyph + warning color (never color alone). UI strings in French in the wizard box, English in `BranchPicker` as today.

**Ask First:** HALT if Story 2.37 is not `done` and merged into the epic branch (verified at planning: it is).

**Never:** No change to base-only usage (annotated, allowed). No new port or store fetch. No refusal for branches owned by the edited EDT itself.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Rename old owned | `renameBranch(R, old, new, edtId)`, `old` owned by EDT ≠ `edtId` | rejected before git | `branch-owned-by-other-edt` |
| Rename new owned | `new` owned by another EDT | rejected before git | `branch-owned-by-other-edt` |
| No `edtId` | any registered owner of `old`/`new` | rejected | `branch-owned-by-other-edt` |
| Own branch | owner is `edtId` itself | passes to FR-7 + git as today | N/A |
| Chooser listing | candidate owned by other EDT | `⚠ EDT « topic »` shown | N/A |
| Apply owned as existing (± rename), or rename a member branch another EDT owns | wizard box / `BranchPicker` | refused inline: `utilisée par l'EDT « topic » — la reprendre ou la renommer casserait cet EDT` | Step 3 row shows same error, `Ctrl+N` blocked |
| Owned as base only | create-new from owned base | annotated, allowed | N/A |

</frozen-after-approval>

## Code Map

- `src/core/ports/git.ts:167` -- `renameBranch` gains optional `edtId` (doc: no `edtId` → any owner blocks).
- `src/adapters/driven/git/index.ts:65,750` -- `renameBranch` wiring + body; needs the registry (`createGitPort(manifest, edtRegistry?)`); `assertAllowedBranch` (l.78) already does the owner check only when `edtId` is set.
- `src/core/edt/modify.ts:423,600` -- `resolveBranchRenames` (`target.ulid`) and `renameMemberBranch` (needs the target EDT's ulid param).
- `src/core/edt/create.ts:336,543` -- rollback and existing+rename callers (`edtUlid`).
- `src/adapters/driving/tui/store/slices/edt-slice.ts:198,466` -- store `renameBranch` action: add the target ulid.
- `src/adapters/driving/tui/zones/edts/dialogs/{add-to-edt,modify,service-actions}-dialog.tsx` -- the 3 `BranchPicker` hosts; `modify-dialog.tsx:212` and `add-to-edt-dialog.tsx:45` call `renameBranch`.
- `src/adapters/driving/tui/shared/components/branch-picker.tsx` -- `handleBranchPickerKey` (pick-existing submit l.~330, rename subs), `FilterableBranchList`, `BranchAutocompleteInput` usage.
- `src/adapters/driving/tui/shared/components/branch-autocomplete-input.tsx` -- dropdown rows → annotation suffix.
- `src/adapters/driving/tui/zones/edts/dialogs/create-wizard/{override-box.logic,override-box,wizard.logic,step-branches}.ts*` -- `OverrideBoxContext`, `validateOverrideBox`, `checkPlan`/`PlanIssue`/`rowIssueMessage`, `buildRowView`/`buildStep3Rows` (rows block `Ctrl+N` through `plan: null`), `overrideBoxContextFor`.
- New: `src/core/edt/branch-owners.ts` (+ test) -- `branchOwners(edts, repoPath, branch, excludeUlid?)` → topics; reused by the adapter.

## Tasks & Acceptance

**Execution:**
- [ ] `src/core/edt/branch-owners.ts` -- pure `branchOwners` (resolve()-normalised, excludes `excludeUlid`) + test -- single source for adapter and UI
- [ ] `src/core/ports/git.ts`, `src/adapters/driven/git/index.ts` -- `renameBranch(..., edtId?)` checks old and new name via the registry before any git call; adapter tests (old/new, with/without `edtId`, own EDT)
- [ ] `src/core/edt/{modify,create}.ts`, `edt-slice.ts`, dialogs -- pass the caller's EDT ulid (modify target, `renameMemberBranch` target, create existing+rename and rollback) + core tests
- [ ] `branch-autocomplete-input.tsx` -- optional `annotations` prop rendered `⚠ <text>` in warning color; tests
- [ ] `wizard.logic.ts`, `override-box.logic.ts/.tsx`, `step-branches.tsx` -- context carries owners; new `PlanIssue` `owned-by-other-edt` for an existing plan (± rename, source owned), annotations on existing/base fields (base-only never refused); row error blocks `Ctrl+N`; tests
- [ ] `branch-picker.tsx` + the 3 dialogs -- owner annotations on pick-existing and create-new base lists; refuse pick-existing set/rename of an owned branch and Rename-current of an owned member branch inline; tests

**Acceptance Criteria:**
- Given another EDT owns `old` or `new`, when `renameBranch` runs, then it fails with `branch-owned-by-other-edt` and `git` is never invoked.
- Given a chooser lists a branch owned by another EDT, when rendered, then it carries `⚠ EDT « <topic> »`; branches owned by the edited EDT carry none.
- Given an owned branch is applied as existing (± rename), when applying in the box or `BranchPicker`, then the French refusal shows inline and a Step 3 row carrying it blocks `Ctrl+N`.
- Given an owned branch is only a base, then it is annotated and accepted.

## Spec Change Log

## Design Notes

`branchOwners` returns topics in registry order. Adapter: `renameBranch` runs the owner check (registry list, `resolve()` both sides) after the existing FR-7 gates and before `showRef`; without a registry it is skipped, as `assertAllowedBranch` today. Annotations map is built per repo by the host (`branchOwners` over `edts` for each listed candidate), then passed down — pickers/inputs never import `edts`.

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors
- `npx vitest run` -- expected: all tests pass

## Suggested Review Order

**Ownership rule (core)**

- Single pure source of "who owns this branch", reused by adapter and UI.
  [`branch-owners.ts:8`](../../src/core/edt/branch-owners.ts#L8)

- Per-candidate map feeding every chooser's annotations.
  [`branch-owners.ts:27`](../../src/core/edt/branch-owners.ts#L27)

**Rename gate (AD-8)**

- Old and new names rejected before any git call; own EDT exempt.
  [`index.ts:771`](../../src/adapters/driven/git/index.ts#L771)

- Callers forward their EDT: modify target, rename-member wrapper, create and rollback.
  [`modify.ts:423`](../../src/core/edt/modify.ts#L423)
  [`create.ts:543`](../../src/core/edt/create.ts#L543)

**Choosers: annotations and inline refusals**

- Generic, EDT-agnostic annotation prop on the shared input.
  [`branch-autocomplete-input.tsx:188`](../../src/adapters/driving/tui/shared/components/branch-autocomplete-input.tsx#L188)

- BranchPicker refuses owned set/rename; bases stay allowed.
  [`branch-picker.tsx:210`](../../src/adapters/driving/tui/shared/components/branch-picker.tsx#L210)

- Wizard `checkPlan` issue that blocks the Step 3 row and Ctrl+N.
  [`wizard.logic.ts:289`](../../src/adapters/driving/tui/zones/edts/dialogs/create-wizard/wizard.logic.ts#L289)

- Hosts compute owners once, excluding the edited EDT.
  [`edts-zone.tsx:423`](../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L423)
  [`create-wizard.tsx:297`](../../src/adapters/driving/tui/zones/edts/dialogs/create-wizard/create-wizard.tsx#L297)

**Tests**

- Host-level wiring and edtId passthrough.
  [`edts-zone.interaction.test.tsx`](../../src/adapters/driving/tui/zones/edts/edts-zone.interaction.test.tsx)
