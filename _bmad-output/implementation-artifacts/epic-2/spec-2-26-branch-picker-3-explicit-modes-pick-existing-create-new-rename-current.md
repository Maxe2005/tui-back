---
title: 'Branch-Picker — 3 Explicit Modes (Pick Existing / Create New / Rename Current)'
type: 'feature'
created: '2026-09-14'
status: 'ready-for-dev'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every branch-entry point in the EDT zone outside EDT creation — Modify's per-member branch step, Service-actions "Change branch for this EDT", "Add to EDT" — is one free-text field (`BranchEditState`) the developer types a name into blind: no way to browse existing branches, no way to rename the current one, no sub-choice from branch names other members already use.

**Approach:** New shared `branch-picker.tsx`: a 3-way mode switch (Pick existing / Create new / Rename current, `Tab`-cycled like `cycleFormFocus`) replacing the plain `branchEdit` sub-dialog at those 3 entry points. `GitPort` gains `listBranches`/`renameBranch`; `modify.ts` gains a `renameBranches` pre-lock step mirroring `setBranches`'s shape.

## Boundaries & Constraints

**Always:**
- Mode switch defaults to **Create new**, pre-filled with the existing suggestion (2.22/2.24's `suggestBranchNameFromTopic`/`suggestBranchForNewMember`) — a developer who ignores the new modes sees unchanged behavior.
- **Create new**: base-branch field (default `development`) + name field, both backed by one new filterable-list sub-component fed by `listBranches(repoPath)` — reused for both base-branch candidates and Pick-existing's target candidates (two call sites, one widget). Filtering is case-insensitive prefix match, same convention as `matchCommands` (`commands.ts`). The name field also offers a sub-list of other EDT members' branch names (`target.members.map(m => m.branch)`, deduplicated) — picking one fills the field, still editable.
- **Pick existing**: the same filterable-list widget over `listBranches(repoPath)`; select+confirm sets that branch (`setBranches`), no branch created. Each row gets a secondary "rename" action (not a mode switch): choosing it opens a name field (`TextInputLine`) pre-filled with the selected branch, confirm renames it (`git.renameBranch`) then sets the renamed branch as target — one submit, not two.
- **Rename current**: only offered where the entry point already has a current member branch (Modify's per-member step, Service-actions) — never at Add-to-EDT (not-yet-member, nothing to rename). It's the exact pick-then-rename mechanism above, pre-selected onto that member's own registered branch, skipping the picking step.
- A repo where the picker's target branch doesn't exist yet (Create new, at any of the 3 entry points): create it first via a new thin core wrapper around `git.createBranch` (gated the same way `git.createBranch` already gates internally), then feed the result into the same `modifyEdtAction` call the entry point already makes (`setBranches` for an existing member, `addMembers`+`setBranches` for Add-to-EDT) — a creation failure folds into that same call's single result set, never a second error UI.
- `modifyEdt` gains `renameBranches?: Array<{ repoPath: string; newName: string }>` (mirrors `setBranches`). Pre-lock: for each entry, resolve the member's current registered branch as `oldName`, gate `assertAllowedBranch(resolved, newName, target.ulid)`, call `git.renameBranch(resolved, oldName, newName)`; on success push `{ repoPath: resolved, branch: newName }` into the **same** `branchChanges` array `setBranches` already populates — lock-time assembly already applies it, no new persistence path.
- `GitPort.renameBranch` internally: `assertAllowedBranch` (no `edtId`, mirrors `createBranch`) → if `newName` already exists locally, `err('branch-exists', ...)` (reuse `createBranch`'s exact code) → if `oldName` doesn't exist, a new `branch-missing` error → `git branch -m -- oldName newName`.
- Collision failures surface via 2.25's `FailedResultList`/`resolveAssistedAction`; this story adds a **second** registry entry, `branch-exists` → "try a different name" (reopens the picker's name/rename field pre-filled with the collided value, re-runs the same submit), alongside 2.25's existing `branch-owned-by-other-edt` → "try a different branch".

**Ask First:** If Stories 2.23 (`text-input-line`), 2.24 (`suggestBranchForNewMember`, deferred-add branch resolution), or 2.25 (`FailedResultRow`/`FailedResultList`/registry) haven't landed by implementation time, halt and confirm whether to block on them or proceed against today's plain-`<Text>`/joined-string conventions — no fallback strategy is designed here (epics.md sequences this story after all three).

**Never:** Touching the EDT-creation dialog (2.22) — it has no "current" branch to rename and its own suggested-default flow already covers the common case; extending it is a flagged follow-up, not required here. Remote-branch listing (`listBranches` stays local-only, mirrors `branchExistsLocally`). A second filterable-list *component* — one widget, two call sites.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Picker opens | Any of the 3 entry points | Create-new mode active, pre-filled suggestion; `Tab` cycles Pick existing → Create new → Rename current (skips Rename current when no current branch) | N/A |
| Pick existing, confirm | Branch selected from filtered list | `setBranches` entry with that branch; no git write beyond checkout | Existing per-repo isolation |
| Pick existing, inline rename | Row's rename action, new name confirmed | `git.renameBranch` then that name set as target — one submit | `branch-exists`/`branch-owned-by-other-edt` via `FailedResultList` |
| Create new, name not yet used | Base branch + name confirmed | Branch created (`git.createBranch`) then set as target via the entry point's existing submit path | `branch-exists` → "try a different name" |
| Create new, other-member sub-list | Name field, sub-list opened | Deduplicated `target.members` branch names shown; picking fills the field, still editable | N/A |
| Rename current | Entered at Modify/Service-actions with an existing member branch | Pre-selected onto that branch, skips picking, same rename flow | Same as inline rename |
| Rename current at Add-to-EDT | N/A | Mode not offered (no current branch in this EDT) | N/A |
| Branch-collision failure | `branch-owned-by-other-edt` or `branch-exists` | Per-repo row with the matching assisted action | Reopens the relevant field, re-submits |

</frozen-after-approval>

## Code Map

- `src/core/ports/git.ts` -- add `listBranches(repoPath): Promise<Result<string[]>>` (mirrors `branchExistsLocally`'s local-only scope) and `renameBranch(repoPath, oldName, newName): Promise<Result<void>>`.
- `src/adapters/driven/git/index.ts` -- `listBranches`: `git for-each-ref --format=%(refname:short) refs/heads/`, split/filter lines. `renameBranch`: `assertAllowedBranch(manifest, repoPath, newName)` (no `edtId`) → `showRef` on `newName` (exists → `branch-exists`, reusing `createBranch`'s L~117 error) → `showRef` on `oldName` (missing → new `branch-missing`) → `spawnSync('git', ['branch', '-m', '--', oldName, newName], ...)`. Wire both into `createGitPort` (L33-46).
- `src/core/edt/modify.ts` -- `ModifyEdtParams` (L36-45) gains `renameBranches?: Array<{ repoPath: string; newName: string }>`; new pre-lock step after "3. Set branches" (L186-260ish), one entry per rename: resolve `oldName` from `target.members`, gate with `target.ulid`, call `git.renameBranch`, push into the existing `branchChanges` array (L107, consumed at lock-time L~303-318) — no new registry-write logic. New exported `createMemberBranch({ git, repoPath, branchName, baseBranch }): Promise<Result<void>>` thin wrapper around `git.createBranch`, for the picker's Create-new pre-step at the 3 non-creation entry points (creation-only convenience, not part of `modifyEdt`'s own params).
- `src/adapters/driving/tui/store/app-store.ts` -- `ModifyEdtParams` (L92-97) gains `renameBranches`; `modifyEdt` action (L619-643) passes it through. New `listBranches(repoPath): Promise<Result<string[]>>` and `createMemberBranch(repoPath, branchName, baseBranch): Promise<Result<void>>` store actions wrapping the new core exports (keeps `deps.git` calls inside core, matching every existing use-case wiring — nothing in this codebase calls `deps.git` directly today).
- `src/adapters/driving/tui/shared/components/branch-picker.tsx` (new) -- `BranchPickerMode`, `cycleBranchPickerMode(mode, hasCurrentBranch)` (pure, mirrors `cycleFormFocus` L184), `matchBranchesByPrefix(query, branches)` (pure, mirrors `matchCommands` in `commands.ts` L49-55), the filterable-list sub-component (base-branch vs. target-branch candidates, two call sites), `BranchPickerOutcome = {kind:'set';branch} | {kind:'create';branchName;baseBranch} | {kind:'rename';oldName;newName}`, the `BranchPicker` component. Delegates name/rename fields to `TextInputLine` (2.23).
- `src/adapters/driving/tui/shared/components/failed-result-list.tsx` (2.25) -- registry gains a second entry: `branch-exists` → `{ label: 'try a different name', ... }`.
- `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- replace the 3 `BranchEditState`-based sub-dialogs with `<BranchPicker>`: Modify's `branchEdit`/`openBranchEdit`/`handleBranchEditInput` (L496-510, L980-1093ish) — its `branchEdits` map also needs a sibling `branchRenames: Record<string,string>` and `resolveModifyOps` (L446-474) gains a matching `renameBranches` derivation, same drop-if-unselected rule as `setBranches`; Service-actions' `branchEdit`/`openServiceActionsBranchEdit`/`submitServiceActionsBranchChange` (L526-532, L1177-1244); Add-to-EDT's `value` field/`submitAddToEdt` (L542-550, L1283-1330) — each submit function switches on `BranchPickerOutcome.kind` (`create` → `createMemberBranch` then the existing `setBranches`/`addMembers` call; `set`/`rename` → the existing call, `rename` also populating `renameBranches`).
- Tests: `src/core/edt/modify.test.ts` (renameBranches pre-lock step, `createMemberBranch`); `src/adapters/driven/git/index.test.ts` (`listBranches`, `renameBranch` incl. `branch-exists`/`branch-missing`); new `branch-picker.test.tsx` (mode cycling, filter, outcome resolution); `failed-result-list.test.tsx` (second registry entry); `edts-zone.test.tsx`/`.interaction.test.tsx` (3 swapped entry points).

## Tasks & Acceptance

**Execution:**
- [ ] `core/ports/git.ts` -- add `listBranches`/`renameBranch` to `GitPort` -- new capabilities the picker needs
- [ ] `adapters/driven/git/index.ts` -- implement both (for-each-ref; gate+exists-checks+`git branch -m`) -- backing git plumbing, reuses `branch-exists`
- [ ] `core/edt/modify.ts` -- `renameBranches` param + pre-lock step feeding `branchChanges`; `createMemberBranch` export -- rename-current/inline-rename support, create-new's pre-step
- [ ] `store/app-store.ts` -- `ModifyEdtParams.renameBranches` pass-through; `listBranches`/`createMemberBranch` store actions -- plumbing, keeps `deps.git` core-only
- [ ] `shared/components/branch-picker.tsx` -- new component: mode switch, filterable list (base-branch + pick-existing, one widget), other-members sub-list, inline rename -- the shared UI
- [ ] `shared/components/failed-result-list.tsx` -- register `branch-exists` → "try a different name" -- second assisted action
- [ ] `zones/edts/edts-zone.tsx` -- swap all 3 `branchEdit` sub-dialogs for `<BranchPicker>`, extend `resolveModifyOps`/each submit function for `BranchPickerOutcome` -- closes the 3 blind-free-text entry points
- [ ] Extend `modify.test.ts`, `adapters/driven/git/index.test.ts`, new `branch-picker.test.tsx`, `failed-result-list.test.tsx`, `edts-zone.test.tsx`/`.interaction.test.tsx` for the I/O matrix

**Acceptance Criteria:**
- Given any of the 3 entry points, when the branch step opens, then it shows the 3-way mode switch, `Tab`-cycled, defaulting to Create new with today's suggestion pre-filled.
- Given Create new, when active, then it shows a base-branch picker (default `development`) and a name field, both filterable via `listBranches`, plus a sub-list of other members' branch names.
- Given Pick existing, when a branch is selected and confirmed, then it's set as the target branch with no branch created.
- Given a selected row in Pick existing, when "rename" is chosen and a new name confirmed, then the branch is renamed then set as target in one submit.
- Given Rename current at Modify or Service-actions, when entered, then it's pre-selected onto that member's current branch, skipping the pick step; it's never offered at Add-to-EDT.
- Given any mode's confirmation fails with a name collision, then it surfaces via `FailedResultList` with the matching assisted action (`branch-owned-by-other-edt` or `branch-exists`).
- `npm test`, `npm run typecheck`, `npm run depcheck` all pass.

## Spec Change Log

## Design Notes

`createMemberBranch` deliberately stays outside `modifyEdt`'s own params — epics.md's Code Map for `modify.ts` only calls out `renameBranches`; branch *creation* has no membership semantics of its own, so it's a one-line wrapper the picker calls before the entry point's existing `setBranches`/`addMembers` submit, not a new orchestration step. This mirrors the codebase's one consistent rule found during investigation: `deps.git` is never called directly from the TUI layer today (`app-store.ts` only ever passes it into core use-cases) — the two new store actions preserve that.

Written assuming 2.23/2.24/2.25 have landed (epics.md sequences this story after all three); their real components/registry are referenced by name above rather than re-specified.

## Verification

**Commands:**
- `npm test` -- all suites green, including new `branch-picker.test.tsx` and updated `modify.test.ts`, `adapters/driven/git/index.test.ts`, `failed-result-list.test.tsx`, `edts-zone.*.test.tsx`
- `npm run typecheck` -- clean
- `npm run depcheck` -- no boundary violations

**Manual checks:**
- TUI: open each of the 3 entry points — mode switch defaults to Create new with a suggestion; `Tab` reaches Pick existing (filter narrows a real branch list) and Rename current (pre-selected, absent at Add-to-EDT); pick a branch and confirm; rename a picked branch and confirm; create a brand-new name and confirm; force a `branch-exists` and a `branch-owned-by-other-edt` collision — each shows its own assisted action and the retry re-submits correctly.
