# Sprint Change Proposal — 2026-10-08

**Trigger:** `.tui-back.yaml` must survive an EDT switch untouched when it is dirty.
**Requested by:** Max · **Mode:** Batch · **Scope:** Moderate (one story added, no replan)

---

## 1. Issue Summary

`switchActiveEdt` (`src/core/edt/switch.ts`) auto-stashes the uncommitted work of the outgoing EDT's repos (`git stash push -u`, tag `tui-back:<ulid>`). When `.tui-back.yaml` is among the dirty files, it is stashed with the rest, and that breaks the switch:

- The target EDT's branch may carry a different version of the manifest, or none at all. The repo then runs with a compromised or missing manifest (service, container, `sharedBranch`, protected branches, migration command).
- The outgoing stash, popped on a later return, would overwrite whatever manifest is current at that moment.
- A repo that is dirty **only** because of the manifest (state 2/3) triggers a pointless adopt/discard resolution.
- `discardAll` (reset --hard + clean -fd) would destroy the manifest outright.
- A tracked manifest that differs between branches makes `git checkout` abort.

**Decision (Max):** `.tui-back.yaml` is the single exception to the stash rule. If it is dirty before a switch, it is found **as is** after the switch. Applies to the stash, adopt and discard paths (confirmed).

---

## 2. Impact Analysis

| Item | Status | Notes |
|------|--------|-------|
| Epics | [x] | Story 2.39 (switch core) gets a one-line pointer to the new rule; **new Story 7.10** in Epic 7 (confirmed placement) |
| Stories 2.40 / 2.41 (backlog / done) | [x] | 2.40 (CLI) and 2.41 (resolution dialog) only inherit the behaviour: the discard confirmation list must show the manifest as "kept", never as destroyed |
| PRD | [N/A] | Extra safety rule inside FR-6/FR-8; no new requirement |
| Architecture | [N/A] | Stays inside hexagonal rules: the new file I/O sits behind a port, `core/` imports no `node:fs` |
| UX | [!] | Resolution dialog (`switch-resolution`): manifest line marked "conserved, not part of the resolution" |
| Docs | [!] | `docs/tui-back-manifest.md`: short section "Behaviour during an EDT switch". The manifest schema is unchanged, so the `manifest-generator` skill needs no change |
| Code | [!] | `switch.ts`, `ports/git.ts`, `adapters/driven/git/index.ts`, a new carry port + adapter, `activate.ts` pre-flight (to verify) |
| Sprint status | [!] | + `7-10-…: backlog` |

---

## 3. Recommended Approach

**Direct Adjustment.** Add Story 7.10 to Epic 7, branch `story-7-10-…` from `epic-7-tui-consistency-dashboard-code-hygiene`. Effort: Medium. Risk: Low-Medium (touches the switch's data-safety path; covered by real-git integration tests). No impact on completed work.

**Mechanism: capture, exclude, restore** (per repo, inside `switch.ts`):

1. **Pre-flight**: `.tui-back.yaml` is filtered out of the dirtiness computation (`hasUncommittedChanges` / `listDirtyPaths` consumers). A repo dirty only through the manifest needs no resolution and no stash.
2. **Capture**: before any git write on that repo, record the manifest's exact bytes, or "absent" if it was deleted. Persist a safety copy under the XDG state dir. The copy is deleted after a successful restore and kept, and named in the error, if the restore fails.
3. **Stash without it**: `GitPort.stashSave` gains an optional exclusion (`-- . ':(exclude).tui-back.yaml'`), so the manifest never enters a stash and a later pop cannot overwrite it. Legacy stashes that already contain it: the final rewrite (step 5) wins.
4. **Clear the way**: `git.discardPaths` on the manifest alone so `checkout` is not blocked. `discardAll` (discard resolution) is preceded by the same capture.
5. **Checkout → pop the target-tagged stash → rewrite the captured bytes** (or delete the file if it was captured as absent). Ordering guarantees the carried version wins.
6. **Rollback**: if the checkout fails after step 4, rewrite the captured file and report the failure, in line with the existing `restoreAndFail`.

In the new EDT the manifest shows as modified against the target branch's HEAD. That is the intended meaning of "found as is".

---

## 4. Detailed Change Proposals

### 4.1 `epics.md` — Story 2.39 (pointer only)

**Section:** end of Acceptance Criteria

OLD: *(none)*

NEW:
> **Given** `.tui-back.yaml` is dirty in a repo **When** it is switched **Then** it is exempt from stash, adopt and discard and is carried over unchanged — see Story 7.10.

Rationale: keeps the 2.39 contract readable without duplicating the rules.

### 4.2 `epics.md` — new Story 7.10 (after 7.9)

```
### Story 7.10: Switch — Carry a Dirty `.tui-back.yaml` Across the EDT Switch

> Added 2026-10-08 (Sprint Change Proposal `sprint-change-proposal-2026-10-08.md`). Relates to Stories 2.39 (switch core), 2.40 (CLI) and 2.41 (resolution dialog).

As a developer, I want my local `.tui-back.yaml` changes to stay exactly as they are when I switch EDT, so that the tool never runs on a manifest that the target branch overwrote, emptied or removed.

**Acceptance Criteria:**

**Given** a switch where a repo's `.tui-back.yaml` is dirty (modified, untracked or deleted) **When** the switch completes **Then** the file in the working tree is byte-for-byte what it was before (or still absent if it was deleted), whatever the target branch holds for that path.

**Given** a dirty state-1 repo **When** it is stashed **Then** the stash contains every dirty path except `.tui-back.yaml` (`GitPort.stashSave` takes an optional `excludePaths`), and a later switch back into the EDT never overwrites the manifest.

**Given** a state-2/3 repo whose only dirty path is `.tui-back.yaml` **When** the pre-flight runs **Then** it is not a row needing a resolution, the `onDirtyReposBeforeSwitch` seam is not invoked for it, and `switch-dirty-services-unresolved` is never raised for it.

**Given** an `adopt` or `discard` resolution on a repo that also has a dirty manifest **When** executed **Then** the manifest is captured first and restored last; `discardAll` never destroys it; `detail.discardedPaths` and `dirtyPaths` omit it.

**Given** the manifest is tracked and differs between the source and target branches, or exists only on one of them **When** the switch runs **Then** the checkout does not abort because of it.

**Given** any failure between capture and restore **When** it occurs **Then** the manifest is rewritten (rollback) when the checkout failed; when the restore itself fails, the row is `failed`, names the safety-copy path, and the copy is kept.

**Given** the resolution dialog (2.41) **When** a repo has a dirty manifest **Then** it is shown as "conserved" and is not part of the discard confirmation list.

**Given** `activateEdt` **When** a manifest is dirty **Then** its "would be overwritten" pre-flight does not require consent for it (verified in this story; patched if needed).

**Given** the docs **When** updated **Then** `docs/tui-back-manifest.md` states the carry-over rule.

**Implementation notes:** file I/O goes through a small port (`ManifestCarryPort`: `capture`, `restore`, `release`) with an `adapters/driven/` implementation; `core/` imports no `node:fs`. Tests: fake ports for ordering and rollback (AD-13), plus real-git integration tests (tracked-modified, untracked, deleted, tracked-and-different-on-target, absent-on-target, alongside other dirty files, adopt, discard). Commits split: port + adapter → `stashSave` exclusion → switch pre-flight → carry in stash/adopt/discard paths → dialog/docs.
```

### 4.3 `sprint-status.yaml`

- Add `7-10-switch-carry-a-dirty-tui-back-yaml-across-the-edt-switch: backlog` after the 7.9 entry.
- Execution-order comment: 7.10 is independent of 7.4–7.6 and can run right after 7.9.

### 4.4 `docs/tui-back-manifest.md`

Add a short section "Behaviour during an EDT switch": a dirty `.tui-back.yaml` is never stashed, adopted or discarded; it is carried over unchanged.

---

## 5. Implementation Handoff

**Scope: Moderate.**

| Role | Responsibility |
|------|----------------|
| Max | Approve this proposal |
| PO / sprint-status | Add the 7.10 entry (4.3) |
| Developer agent (`bmad-build`) | Story 7.10 on its own branch from the Epic 7 branch; merge with `--no-ff` once reviewed |

**Success criteria:** a dirty manifest is identical before and after the switch in every scenario of 4.2; no resolution is requested for a manifest-only dirty repo; `npm test && npm run typecheck && npm run depcheck` are green.
