---
title: 'Create Dev Branches at EDT Creation'
type: 'feature'
created: '2026-08-18'
status: 'in-progress'
baseline_commit: 9a1cdeb503bfb97928435c1443aac36daee9b075
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `tui-back edt create` (Story 2.1) takes no topic, no member-service selection, and creates no per-service branches — it writes a single `branch: edt-<ulid>` placeholder that matches neither FR-3 ("topic + manually selected member services") nor the tool's real per-service branch semantics (Story 2.1's AC3/Task 3 was deferred here). A developer still creates dev branches by hand.

**Approach:** Extend `edt create` to take a topic and a manually selected set of member services drawn from the managed-repo registry; optionally create a dev branch in each member (default base `development`, naming mode grouped=one shared name / individual=one name per member, or disabled=reuse the existing branch); report per-service failures without aborting the batch; record each member's branch as its EDT branch. Add the first real git adapter (`adapters/driven/git`) whose branch-creation surface rejects shared branches (`development`/`preprod`/`prod` + the manifest's `sharedBranch`) before any `git` invocation.

## Boundaries & Constraints

**Always:**
- AD-8: every git write goes through `adapters/driven/git`. Branch creation rejects a target name in the shared-branch set (`development`, `preprod`, `prod`, or the repo's manifest `sharedBranch`) before invoking `git`; the adapter resolves `sharedBranch` itself from the manifest at write time — never trusts the caller-supplied name. This is the seed gate; Story 2.3 owns the full per-EDT self-resolving gate.
- AD-1: `core/edt` consumes the new `GitPort` plus existing `RegistryPort`/`ManifestPort`/`EdtRegistryPort`/`LockPort`; no `adapters/` import in `core/`.
- AD-7: topic + member branches live in the EDT's `edts.yaml` entry (schema evolves in place); the file name stays the ULID.
- AD-9: the EDT-registry write stays under `withActionLock(lock, edtRegistryResourceKey, …)`.
- Per-service failure isolation: one member's branch failure (base missing, name collision, shared-branch target, git error) never aborts the other members and never fails EDT creation.
- Zero-member and duplicate-topic rejections happen before any file write; at least one member is required.
- Result envelope + kebab-case error codes (AD-3); per-service outcomes in `data.results: {service, outcome, detail?}[]` with a closed outcome set (`created` / `existing-branch` / `failed`).
- NodeNext `.js` relative imports; imports are the first statements in a file (depcruise acorn-fallback landmine).

**Ask First:**
- Story 2.1 merged without topic + member-selection (its FR-3 half, deferred here). This story folds in the topic + member-selection creation UX. Flagged at checkpoint for explicit approval.

**Never:**
- Don't build Story 2.3's full gate (reject any write not to the current EDT's own registered branch for that service, across all use-cases).
- Don't switch the working tree / check out the created branch — creating the ref is the deliverable; moving repos onto it is Story 2.4's protected-switch.
- Don't touch `state.json` or the SQLite DB schema (stays empty), and don't touch `src/adapters/driving/tui/**` (the EDTs zone is a later story).
- No new npm dependencies — git shells via `node:child_process`.
- Don't "fix" the unanchored `to: { path: 'adapters(/|$)' }` depcruise rule.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Grouped branch creation | `--topic t --member A --member B --create-branches --branch-name x --base development` | Both repos get branch `x` from `development`; `results` shows `created` for both; entry records `x` per member | per-member `failed` + detail, others proceed |
| Individual branch creation | `--branch-mode individual --branch-name A=foo --branch-name B=bar` | Repo A gets `foo`, repo B gets `bar`, both recorded | per-member `failed` + detail |
| Branch creation disabled | `--member A` (no `--create-branches`) | No branch created; A's current branch recorded; outcome `existing-branch` | — |
| Zero members | `--topic t` only | Rejected `invalid-member` before any write | exit 1 |
| Duplicate topic | existing EDT with topic `t` | Rejected `edt-topic-exists` before any write | exit 1 |
| Member not a managed repo | `--member /not/registered` | Rejected `invalid-member` before any write | exit 1 |
| Name collision | branch `x` already exists in repo A | A `failed` (`branch-exists`), B proceeds | per-member |
| Base branch missing | `--base nope` absent in repo A | A `failed` (`base-branch-missing`), B proceeds | per-member |
| Shared-branch target | `--branch-name development` | A `failed` (`shared-branch-rejected`), no `git` invocation | per-member |

## Code Map

- `src/core/edt/create.ts` — `createEdt` (lines 41-129): add `topic`, `members` (repo paths), `branchOptions`, `registry`, `git` to `CreateEdtParams`; validate uniqueness + membership first; per-service branch loop; registry write under lock; return `CreateEdtData` (`{ulid, topic, results[]}`) instead of `string`.
- `src/core/ports/git.ts` — new port: `GitPort { createBranch(repoPath, branchName, baseBranch): Result<void>; currentBranch(repoPath): Result<string> }`.
- `src/core/ports/edt-registry.ts` — `EdtRegistryEntry` gains `topic: string` and `members: {service, repoPath, branch}[]`, drops `branch`; port gains `list(): Promise<Result<EdtRegistryEntry[]>>`.
- `src/adapters/driven/edt-registry/schema.ts` — entry schema to `{ulid, topic, createdAt, status, members:[{service,repoPath,branch}]}`, `.strict()`.
- `src/adapters/driven/edt-registry/index.ts` — expose `list()` (private `listEdtRegistry` at lines 37-73); write new shape in `addEdtRegistryEntry` (lines 75-93).
- `src/adapters/driven/git/index.ts` — new adapter: `createGitPort(manifest: ManifestPort)`; `createBranch` gate (shared-branch set resolved via `manifest.load`, then existence/base checks, then `git branch <name> <base>` via `spawnSync`); `currentBranch` via `git rev-parse --abbrev-ref HEAD`. Factory pattern: `src/adapters/driven/lock/index.ts:41-49`.
- `src/adapters/driving/cli/subcommands.ts` — extend the `edt` handler (lines 76-94): hand-rolled flag parsing following `register --reset` (lines 37-42): `--topic`, repeatable `--member`, `--create-branches`, `--base` (default `development`), `--branch-mode` (default `grouped`), `--branch-name` (grouped: one; individual: one `<path>=<name>` per member).
- `src/bin/main.ts` — add `createGitPort({ load: loadManifest })` and pass `git` into `buildSubcommands` deps (lines 36-44).
- `src/bin/tui-back.e2e.test.ts` — update the `edt create` skeleton test (lines 463-491, new schema), the racing test (493-507), add a `makeGitRepo` fixture (git init + commit + `development`) and branch-creation black-box cases.
- `src/core/edt/create.test.ts` — new unit tests with fake ports (pattern: `src/core/scripts/list-repos.test.ts`; AD-13 core layer).
- `src/adapters/driven/git/index.test.ts` — new integration tests against a real temp git repo (git init, local identity, initial commit, `development` branch).

## Tasks & Acceptance

**Execution:**
- [ ] `src/core/ports/git.ts` -- add `GitPort` interface -- core contract for the new adapter.
- [ ] `src/adapters/driven/git/index.ts` -- `createGitPort(manifest)` with shared-branch gate + existence/base checks + `git branch`/`git rev-parse` via spawnSync -- AD-8 seed, single git touchpoint.
- [ ] `src/core/ports/edt-registry.ts` -- topic+members entry shape, `list()` -- per-service branch storage feeds Story 2.6.
- [ ] `src/adapters/driven/edt-registry/schema.ts` -- entry schema: `{ulid, topic, createdAt, status, members}` -- strict shape for edts.yaml.
- [ ] `src/adapters/driven/edt-registry/index.ts` -- expose `list()`, write new entry shape -- adapter keeps filesystem ownership.
- [ ] `src/core/edt/create.ts` -- topic/member/branch-options params; uniqueness + membership + zero-member validation before writes; per-service branch loop with isolation; registry write under lock -- core use-case.
- [ ] `src/adapters/driving/cli/subcommands.ts` -- `edt create` flag parsing and validation -- CLI parity for the use-case.
- [ ] `src/bin/main.ts` -- wire `createGitPort` into `buildSubcommands` deps -- composition root.
- [ ] `src/core/edt/create.test.ts` -- unit tests of every I/O-matrix row with fake ports -- AD-13 core layer.
- [ ] `src/adapters/driven/git/index.test.ts` -- real-git integration tests (create, collision, base-missing, shared-branch rejection, currentBranch) -- AD-13 driven layer.
- [ ] `src/bin/tui-back.e2e.test.ts` -- update skeleton/racing tests to new schema; add git-backed branch-creation e2e cases -- black-box parity.
- [ ] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- flip story 2.2 to `in-progress` then `done` -- status tracking.

**Acceptance Criteria:**
- Given branch-creation enabled, when a developer creates an EDT with a topic, ≥1 member, a base branch (default `development`) and a naming mode, then a working branch is created in each selected member accordingly — grouped = one identical name everywhere, individual = one name per member — and registered as that member's EDT branch (feeds Story 2.6).
- Given branch-creation disabled, when the EDT is created, then no branch is created and each member's existing branch is recorded.
- Given one member's branch creation fails (base branch missing, name collision), when the batch runs, then the failure is reported per-service and does not abort the others.
- Given a member's branch name is a shared branch (`development`/`preprod`/`prod`/`sharedBranch`), when branch creation is attempted, then the git adapter rejects it before any `git` invocation.
- Given a duplicate topic or zero members, when creation is attempted, then it is rejected with a clear error before any file write.
- Given the EDT is created, when its edts.yaml entry is read, then it carries the topic and one branch per member service, and the ULID file name is unchanged.

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

## Design Notes

- Branch creation runs `git branch <name> <base>` (creates a ref, no checkout): the ref is the "working branch created" deliverable; moving a repo's working tree onto it is Story 2.4's protected-switch, which owns data preservation. A checkout here would be the first hidden working-tree mutation before Story 2.4 exists.
- The 2.1 `branch: edt-<ulid>` placeholder is replaced by per-member `members[].branch` — "each EDT independently tracks its own branch for a service", feeding Story 2.6's divergence view.
- Per-service outcome vocabulary (`created` / `existing-branch` / `failed` + detail) follows the shared `data.results: {service, outcome, detail?}[]` convention.
- The full per-EDT self-resolving gate (any write must target the EDT's registered branch, resolved from EDT state) is Story 2.3's scope, per the epics.md story titles.

## Verification

**Commands:**
- `npm test` -- expected: all suites green (new `create.test.ts`, `adapters/driven/git/index.test.ts`, updated e2e).
- `npm run typecheck` -- expected: clean (`tsc --noEmit`).
- `npm run depcheck` -- expected: `no dependency violations found` (AD-1 holds with the new core port + git adapter).

**Manual checks (if no CLI):**
- `tui-back edt create --topic demo --member <repo> --create-branches --branch-name feat/demo` against a real git repo → branch `feat/demo` exists and the edts.yaml entry carries the topic + member branch.
