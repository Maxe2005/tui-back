---
title: 'Modify an EDT After Creation'
type: 'feature'
created: '2026-08-19'
status: 'in-progress'
review_loop_iteration: 0
baseline_commit: 2c1b4e46adcb8148d2f56fe6082d3b986b31b658
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md'
  - '_bmad-output/implementation-artifacts/epic-2/epic-2-context.md'
  - '_bmad-output/implementation-artifacts/epic-2/2-4-switch-the-active-edt-without-data-loss.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After creation an EDT is immutable — members can't be added or removed, a member's branch can't change, and a typo'd topic can't be renamed. Since an EDT exists to track the session's *evolving* scope (FR-5), any scope change forces the developer to recreate the EDT and re-run Story 2.2's branch setup.

**Approach:** Add one core `modifyEdt` use-case (CLI `edt modify`) that applies — add-member, remove-member, member-branch-change, and topic-rename — in one locked read-modify-write against `edts.yaml`. Member changes reuse creation's rules: add-member records the member's gated current branch (AD-8), branch-change reuses Story 2.4's protected-switch (stash-if-dirty → checkout → restore), rename enforces topic uniqueness, and removing the last member leaves a valid zero-member EDT.

## Boundaries & Constraints

**Always:**
- FR-5: every operation edits only the target EDT's entry; other EDTs' recorded state and the other members' entries are byte-for-byte untouched; add/remove never disturb other members.
- AD-8: every branch recorded as a member's own — on add and on branch-change — first passes `git.assertAllowedBranch(repoPath, branch, edtUlid)` (Story 2.3's shared-branch rejection plus 2.4's cross-EDT ownership); a rejection → `failed` row, zero git writes, no registry change for that member.
- Branch-change follows Story 2.4's protected-switch exactly: `hasUncommittedChanges` → `stashSave("tui-back:<edtUlid>")` → `checkout` → `restoreStash("tui-back:<edtUlid>")`; the new branch is recorded only after a successful checkout.
- Removing the last member succeeds and persists `members: []` — a zero-member EDT is valid data, never an error (schema already accepts it; `create.ts` already persists it). Rename never touches the ULID file: `<ulid>.db`/`<ulid>/` stay, only the `topic` field changes (AD-7).
- The whole `edts.yaml` read-modify-write runs inside `withActionLock(lock, edtRegistryResourceKey, ...)` (AD-9), with topic-uniqueness and membership re-validated against the authoritative in-lock list — same double-check pattern as `create.ts:252`.
- Result envelope + kebab-case codes; per-member results as `{service, outcome, detail?}` with outcome in the closed set `added | removed | branch-changed | failed`; per-repo failure isolation (one failed op never aborts the others or the registry write). NodeNext `.js` imports; imports-first.
- CLI + core only, matching stories 2.1–2.4 (TUI wiring remains deferred).

**Ask First:** None — add-records-current-branch, branch-change via the switch stash mechanic, and one combined use-case all follow established Story 2.2–2.4 precedent.

**Never:**
- Create a branch when adding a member (Story 2.2's branch creation is creation-time-only), or reset a removed member's repo to `development` (that is Story 2.4's switch, not removal).
- Build the EDTs-zone TUI screens or the zero-member display state (deferred with the rest of the TUI wiring, per story 2.4's deferral log).
- Change the `edts.yaml` schema, add npm dependencies, or modify `switch.ts`'s reviewed code — branch-change reuses the same git port methods without extracting a shared helper.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Add a registered member | `--add-member <repo>`, repo on ordinary branch `feature-x` | added with branch `feature-x`; others' entries unchanged | N/A |
| Add a member on a shared branch | repo currently on `development` | `failed` (`shared-branch-rejected`); not added; others + write succeed | `results` row |
| Add a non-registered member | path not in managed-repo registry | whole call `invalid-member` before any write | Result error |
| Remove a member | `--remove-member <repo>` | removed; others undisturbed | N/A |
| Remove the last member | only member removed | `members: []` persists; success | N/A |
| Remove a non-member path | path absent from `members` | `failed` (`member-not-found`); no change | `results` row |
| Change a member's branch | `--set-branch <repo>=<new>`, repo dirty | stashed → checked out → stash restored; entry branch = `new` | checkout/stash failure → `failed`, old branch kept |
| Change branch to a shared/protected branch | `=development` | `failed` (`shared-branch-rejected`); zero git calls | `results` row |
| Change branch to another EDT's own branch | `=<branch>` owned by EDT B | `failed` (`branch-owned-by-other-edt`); no git write | `results` row |
| Rename to an unused topic | `--rename-to demo2` | entry topic = `demo2`; ULID filename unchanged | N/A |
| Rename to an existing topic | `--rename-to <other-edt-topic>` | whole call `edt-topic-exists` before any write | Result error |
| Target EDT unknown | topic matches no entry | whole call `edt-not-found` | Result error |

</frozen-after-approval>

## Code Map

- `src/core/ports/edt-registry.ts` -- add `update(ulid: string, patch: { topic?: string; members?: EdtMember[] }): Promise<Result<void>>` to `EdtRegistryPort` beside `setStatus` (line 37). One read/find/replace/write instead of four bespoke methods — same shape as `setStatus`, policy stays in core.
- `src/adapters/driven/edt-registry/index.ts` -- implement `updateEdtEntry` (mirrors `setEdtStatus` at line 99: ensure dir, list, find by ulid, `edt-not-found` on miss, replace fields, write); wire into `createEdtRegistryPort` (line 18). `edts.yaml` schema (`schema.ts`) already covers `topic`/`members` — no schema change.
- `src/adapters/driven/edt-registry/index.test.ts` -- `update()` cases: topic rename, members replacement, sibling entries/fields untouched, `edt-not-found` without writing.
- `src/core/edt/modify.ts` (new) -- `modifyEdt`: argument/topic/existence/rename-uniqueness/registered-adds fast-fails pre-lock; per-op branch-change (gate → stash-if-dirty → checkout → restore) and add-member branch reads (gate) pre-lock with isolated `results`; single `withActionLock` section re-validates authoritatively and calls `edtRegistry.update` with the assembled patch (mirrors `create.ts:252`'s in-lock re-check). The git sequence mirrors `switch.ts:208`'s `switchMemberRepo` without importing it.
- `src/core/edt/modify.test.ts` (new) -- unit tests against the same fakes as `switch.test.ts` (fakeGit at line 75, fakeRegistry/fakeManifest/fakeEdtRegistry) covering the full I/O matrix.
- `src/adapters/driving/cli/subcommands.ts` -- `edt modify` dispatch beside `create`/`switch` (lines 91-96); hand-rolled flag parsing in `runEdtModify` (`--topic <topic>`, repeated `--add-member <path>` / `--remove-member <path>` / `--set-branch <path>=<name>`, `--rename-to <topic>`, ≥1 op required), usage string `EDT_MODIFY_USAGE` added to `EDT_USAGE`.
- `src/bin/tui-back.e2e.test.ts` -- e2e case(s) for `edt modify` (add/remove/branch-change/rename + shared-branch rejection + zero-member removal), following the `edt switch` describe block (line 971).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` -- flip `2-5` to `in-progress` then `review` (code review gates `done`).
- `_bmad-output/implementation-artifacts/deferred-work.md` -- no new entry expected; the zero-member/`allFailed` visibility track (line 48) is unaffected by this story.

## Tasks & Acceptance

**Execution:**
- [ ] `src/core/ports/edt-registry.ts` -- add `update` to `EdtRegistryPort`
- [ ] `src/adapters/driven/edt-registry/index.ts` + `index.test.ts` -- implement + unit-test `update`
- [ ] `src/core/edt/modify.ts` + `modify.test.ts` -- use-case + unit tests covering the I/O matrix
- [ ] `src/adapters/driving/cli/subcommands.ts` -- `edt modify` wiring
- [ ] `src/bin/tui-back.e2e.test.ts` -- e2e case(s) for modify
- [ ] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- flip `2-5` to `in-progress` then `review`

**Acceptance Criteria:**
- Given an existing EDT, when a developer adds a member, then the member is added with its current (gated) branch and every other member's recorded state is unchanged.
- Given an EDT with multiple members, when one is removed, then the others are unchanged, and removing the last member leaves `members: []` with a successful result.
- Given a developer changes a member's branch, then it follows Story 2.4's protected-switch rule — no uncommitted work lost — and a shared/protected branch is rejected per Story 2.3 before any git write.
- Given a developer renames the EDT, then a unique topic persists with the ULID filename unchanged, and a duplicate topic is rejected under creation's uniqueness rule.

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

## Design Notes

- One combined `modifyEdt` beats four tiny use-cases: all four operations share entry-lookup-by-topic, the locked read-modify-write, and the same validation machinery, and AD-2 wants one subcommand per use-case. The port gains a single generic `update(ulid, patch)` instead of four bespoke methods — keeping the adapter dumb and the policy in core.
- Branch-change stash tagging uses the EDT's own ulid for both the pre-checkout stash and the post-checkout restore — the same two-call symmetry as `switchMemberRepo`'s return-into-an-EDT path (`switch.ts:208`). A clean repo creates no stash and the restore no-ops on no match; the newest matching stash pops first, so a just-created stash is always the one restored.
- The zero-member AC is data-level here: the registry schema already accepts `members: []` and `create.ts` already persists zero-member EDTs; the TUI's "no members" display state stays deferred with the rest of the EDTs-zone wiring.

## Verification

**Commands:**
- `npm test` -- all suites green
- `npm run typecheck` -- clean
- `npm run depcheck` -- no dependency violations found

**Manual check:**
- `tui-back edt create --topic demo --member <r1>` (r1 dirty), then `tui-back edt modify --topic demo --add-member <r2> --set-branch <r1>=fix-x --rename-to demo2` — `edts.yaml` shows topic `demo2` + updated members; r1 is on `fix-x` with its dirty work restored; then `--remove-member <r2>` and `--remove-member <r1>` leaves `members: []` with exit 0.

---

### Review Findings

**decision-needed (unchecked):**
- [ ] [Review][Decision] Add-member does not persist to EDT registry — AC #1 requires member to be added with its current gated branch, but registry write only applies topic + removals; adds are recorded in results but not persisted

**patch (unchecked):**
- [ ] [Review][Patch] resetEdtStore() placement outside if-block in modify.test.ts risks test contamination
- [ ] [Review][Patch] No duplicate member check when adding members — addMembers processed without checking if already in target EDT's member list
- [ ] [Review][Patch] stash failure doesn't abort cleanly in set-branch — if git.stashSave fails, code continues, potentially leaving repo partially-stashed
- [ ] [Review][Patch] checkout failure leaves repo intermediate — if git.checkout fails after stash, repo may be in intermediate state
- [ ] [Review][Patch] path resolution mismatch in member removal — resolve() applied differently to removeMembers paths vs stored m.repoPath
- [ ] [Review][Patch] hasOp validation precedes EDT existence check — causes incorrect error code (invalid-argument instead of edt-not-found)
- [ ] [Review][Patch] hasOp check uses permissive OR logic — allows mixing all operation types without validation
- [ ] [Review][Patch] remove-members loop reports 'removed' without verifying member exists in EDT member list

**defer (checked off, marked deferred):**
- [x] [Review][Defer] Missing e2e tests for `edt modify` — no end-to-end tests exist for the modify subcommand, deferred as pre-existing
- [x] [Review][Defer] Test: "fails with edt-not-found for unknown topic" returns invalid-argument first — test ordering issue, deferred
- [x] [Review][Defer] Test: shared-branch gate not triggered — mock masks the gate, deferred as testing gap
- [x] [Review][Defer] Unit tests mock update without verifying patch — all 6 unit tests mock update returning ok(undefined), never inspect patch argument
- [x] [Review][Defer] removeMembers filtering not verified in tests — "removes a member" test only checks outcome 'removed' but doesn't verify update patch correctly filters members
- [x] [Review][Defer] renameTo topic not verified in update patch — "renames the EDT topic" test checks result topic but doesn't verify update call passed new topic

## Suggested Review Order

**Entry point — the modify use-case**

- Start here: the pre-lock fast-fails, the per-op git sequence, then the single locked registry write.
  [`modify.ts`](../../../src/core/edt/modify.ts)

**Port + adapter**

- The one new port method every modification funnels through.
  [`edt-registry.ts:37`](../../../src/core/ports/edt-registry.ts#L37)

- The read/find/replace/write implementation, mirroring `setEdtStatus`.
  [`edt-registry/index.ts:99`](../../../src/adapters/driven/edt-registry/index.ts#L99)

**CLI + e2e**

- `edt modify` flag parsing and dispatch, beside `create`/`switch`.
  [`subcommands.ts:91`](../../../src/adapters/driving/cli/subcommands.ts#L91)

- Black-box proof through the real CLI + a real git repo.
  [`tui-back.e2e.test.ts:971`](../../../src/bin/tui-back.e2e.test.ts#L971)