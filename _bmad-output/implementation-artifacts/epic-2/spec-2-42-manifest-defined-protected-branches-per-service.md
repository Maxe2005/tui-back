---
title: 'Manifest-Defined Protected Branches per Service'
type: 'feature'
created: '2026-10-01'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: 'f47d56c9043423061f8e9c33429fcbc3bb9b332b'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** FR-7 protects a hardcoded `development`/`preprod`/`prod` set plus each repo's `sharedBranch` (`core/edt/shared-branches.ts`). That set fits no branching model exactly: it over-protects some services and under-protects others.

**Approach:** Each `.tui-back.yaml` declares an optional `protectedBranches: string[]`. A service's protected set becomes exactly `protectedBranches ∪ {sharedBranch}`. One core helper, `isProtectedBranch(name, manifest)`, replaces `SHARED_BRANCHES`/`isSharedBranch` everywhere, in the git gate and in every TUI advisory check.

## Boundaries & Constraints

**Always:**
- All ACs of Story 2.42 in `epics.md` are normative.
- Schema: `protectedBranches` is optional, an array of `z.string().trim().min(1)`, and duplicates are tolerated. A non-list value or an empty or blank entry is a schema error reported through the existing manifest-load error path (Story 1.4).
- `isProtectedBranch(name, manifest: Pick<Manifest,'sharedBranch'|'protectedBranches'>)` does an exact, case-sensitive match. It lives in `core/edt/shared-branches.ts`.
- The gate resolves the set from `loaded.data` at write time (AD-8). It covers `assertAllowedBranch`, and through it `createBranch`, `renameBranch` (both names) and `createTrackingBranch`. The error code stays `shared-branch-rejected`, and the message becomes `Branch "<name>" is protected by <service>'s manifest`.
- TUI inline messages name the branch and the service's manifest, in French (for example `« preprod » est protégée par le manifeste de svc-a`).
- `ServiceBranchDivergence` and `SwitchDirtyRepo` carry `protectedBranches` (an empty array when the manifest has none) next to `sharedBranch`.

**Ask First:** renaming the `shared-branch-rejected` error code; touching the `'development'` *default/base* literals (`DEFAULT_BASE_BRANCH`, the update-slice fallbacks, the CLI `base`, the schema default). Those are base defaults, not protection lists.

**Never:**
- Any hardcoded protected-branch list left in `src/`.
- An implicit `development`/`preprod`/`prod` protection.
- Editing existing users' `.tui-back.yaml` files (rollout is manual).
- Story 2.43's cross-EDT ownership work.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Listed branch | `protectedBranches: [preprod]`, write `preprod` | rejected | `shared-branch-rejected`, message names the branch and the service |
| Formerly implicit | no `protectedBranches`, `sharedBranch: main`, write `prod` | allowed | — |
| Shared branch always | `sharedBranch` defaulted to `development` | `development` rejected | — |
| Entry trimmed | `[" preprod "]` | `preprod` protected | — |
| Malformed | `protectedBranches: preprod` or `[""]` | manifest load fails | schema error, like any other |
| Duplicates | `[prod, prod]` | valid | — |
| Wizard row | target `preprod` on a service that lists it | row blocks `Ctrl+N` | inline message naming the manifest |
| Rename | old or new name protected | rejected before git runs | — |

</frozen-after-approval>

## Code Map

- `src/core/ports/manifest.ts` -- `Manifest` gains `protectedBranches?: string[]`.
- `src/adapters/driven/manifest/schema.ts:24` -- add the field. The `z.ZodType<Manifest>` annotation keeps the schema and the type in sync.
- `src/core/edt/shared-branches.ts` -- replace the whole file: export `BranchProtection` and `isProtectedBranch`, and delete `SHARED_BRANCHES`/`isSharedBranch`. Rewrite `shared-branches.test.ts`.
- `src/adapters/driven/git/index.ts:90` -- the gate uses the helper and the new message. Update the header comments (L2-5, L71) and `core/ports/git.ts:28-29,165-166`, which still mention the fixed set.
- `src/core/edt/switch.ts:432` -- `currentBranchShared` uses the helper. The row also gets `protectedBranches` (type at L90).
- `src/core/edt/list.ts:28-37,126,137-175` -- thread `protectedBranches` (`?? []`) through `readServiceDivergence`.
- `create-wizard/wizard.logic.ts`:
  - L168 `BranchCandidate` adds `'protectedBranches'`.
  - L172 `isProtectedTarget(name, protection: BranchProtection)`.
  - `checkPlan` (L257) and `buildRowView` (L332) take a protection object instead of a bare `sharedBranch` for the FR-7 checks. `resolveGlobalBase` keeps `sharedBranch`.
  - `buildStep3Rows` (L400) passes the candidate.
  - `ROW_ERRORS.protected` (L238) changes to the manifest wording.
- `create-wizard/override-box.logic.ts`:
  - `OverrideBoxContext` (L48) adds `protectedBranches`.
  - `protectedNameError`/`protectedSourceError`/`protectedExistingError` (L71+) take the service name.
  - `boxIssueMessage` (L136) threads the service through; its callers pass it.
- `create-wizard/step-branches.tsx:34` `overrideBoxContextFor` fills `protectedBranches`. In `create-wizard/override-box.tsx:80-81,105,125`, the context and service are passed through.
- `switch-resolution/switch-resolution.logic.ts:260` -- `isProtectedTarget(name, repo)` and `protectedNameError(name, repo.service)`.
- `src/adapters/driving/tui/shared/repo-registry-screen.tsx:38-43` -- one guidance line about `protectedBranches`.
- Manifest-generator skill: `.claude/skills/manifest-generator/{SKILL.md,workflow.md,assets/template.md}` and the `.agents/skills/manifest-generator/` mirror. Add a field-table row and emit `protectedBranches: [development, preprod, prod]` in every example.
- `docs/tui-back-manifest.md` -- a new `### protectedBranches` section (in French) plus the rollout note.
- Fixtures:
  - `git/index.test.ts:129,296,1058` -- manifests that declare `protectedBranches`, plus a case where `prod` is allowed without the line.
  - `create.test.ts:87`, `modify.test.ts:72` -- local fake lists stay in tests but get renamed and commented as manifest fixtures.
  - `override-box.test.ts:157`.
  - `manifest/index.test.ts` -- schema cases.
  - Any test that builds a `ServiceBranchDivergence` or `SwitchDirtyRepo` literal (`tsc` finds them).

## Tasks & Acceptance

**Execution:**
- [x] `core/ports/manifest.ts`, `manifest/schema.ts` (+ test) -- the optional field and its validation.
- [x] `core/edt/shared-branches.ts` (+ test), `git/index.ts` (+ test), `core/ports/git.ts` comments -- the single helper and the gate on the manifest set.
- [x] `core/edt/list.ts`, `core/edt/switch.ts` (+ affected tests) -- carry `protectedBranches` and use the helper.
- [x] Wizard logic and views, the override box, the switch-resolution logic (+ tests) -- inline checks on each service's own set, with the manifest-naming message.
- [x] `repo-registry-screen.tsx`, the manifest-generator skill (both copies), `docs/tui-back-manifest.md` -- documentation and generator default.

**Acceptance Criteria:**
- Given the merged code, when grepping `src/` (tests excluded) for `'preprod'` or `SHARED_BRANCHES`, then nothing matches.
- Given a manifest with no `protectedBranches` and `sharedBranch: development`, when the gate checks `prod`, then it is allowed.
- `npm run typecheck && npm test && npm run depcheck` pass.

## Design Notes

`BranchProtection = Pick<Manifest,'sharedBranch'|'protectedBranches'>`. A `Manifest`, a `ServiceBranchDivergence` and a `SwitchDirtyRepo` whose `sharedBranch` is non-null all satisfy it structurally, so callers pass what they already hold.

## Verification

**Commands:**
- `npm run typecheck && npm test && npm run depcheck` -- expected: all green.
- `grep -rn "preprod\|SHARED_BRANCHES\|isSharedBranch" src --include=*.ts* | grep -v '\.test\.'` -- expected: no output.

## Suggested Review Order

**The rule (single source of truth)**

- Entry point: the protected set is exactly `protectedBranches ∪ {sharedBranch}`; nothing implicit.
  [`shared-branches.ts:14`](../../../src/core/edt/shared-branches.ts#L14)

- Structural protection type, so a Manifest, a candidate and a dirty row all fit.
  [`shared-branches.ts:11`](../../../src/core/edt/shared-branches.ts#L11)

**Manifest schema**

- Optional list of trimmed, non-empty names; malformed values fail through the usual load error.
  [`schema.ts:26`](../../../src/adapters/driven/manifest/schema.ts#L26)

**Authoritative git gate (AD-8)**

- Set resolved from `loaded.data` at write time; message names branch, manifest and repo.
  [`index.ts:91`](../../../src/adapters/driven/git/index.ts#L91)

**Data threaded to the TUI**

- `ServiceBranchDivergence` carries `protectedBranches` next to `sharedBranch`.
  [`list.ts:136`](../../../src/core/edt/list.ts#L136)

- Switch dirty rows flag the current branch with the same helper.
  [`switch.ts:436`](../../../src/core/edt/switch.ts#L436)

**Advisory TUI checks**

- Step 3 plan checks judge names against each service's own set.
  [`wizard.logic.ts:260`](../../../src/adapters/driving/tui/zones/edts/dialogs/create-wizard/wizard.logic.ts#L260)

- Short row wording; the service is already named by the row and prefix.
  [`wizard.logic.ts:241`](../../../src/adapters/driving/tui/zones/edts/dialogs/create-wizard/wizard.logic.ts#L241)

- Override box context carries the set and the single service-name source.
  [`step-branches.tsx:37`](../../../src/adapters/driving/tui/zones/edts/dialogs/create-wizard/step-branches.tsx#L37)

- Box messages name the service's manifest.
  [`override-box.logic.ts:76`](../../../src/adapters/driving/tui/zones/edts/dialogs/create-wizard/override-box.logic.ts#L76)

- Switch resolution adopt check uses the repo's own set.
  [`switch-resolution.logic.ts:261`](../../../src/adapters/driving/tui/zones/edts/dialogs/switch-resolution/switch-resolution.logic.ts#L261)

**Docs & generator**

- Field reference and manual rollout note.
  [`tui-back-manifest.md:82`](../../../docs/tui-back-manifest.md#L82)

- In-app guidance states what omitting the key means.
  [`repo-registry-screen.tsx:44`](../../../src/adapters/driving/tui/shared/repo-registry-screen.tsx#L44)

- Generator emits today's protection by default.
  [`SKILL.md:58`](../../../.claude/skills/manifest-generator/SKILL.md#L58)

**Tests**

- Helper: absent, empty, overlapping lists and case sensitivity.
  [`shared-branches.test.ts:16`](../../../src/core/edt/shared-branches.test.ts#L16)

- Real-loader gate: message wording and formerly implicit branches allowed.
  [`index.test.ts:152`](../../../src/adapters/driven/git/index.test.ts#L152)
