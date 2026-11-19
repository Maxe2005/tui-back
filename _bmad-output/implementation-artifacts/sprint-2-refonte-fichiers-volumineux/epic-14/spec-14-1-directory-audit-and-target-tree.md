---
title: 'Directory audit and target tree'
type: 'chore'
created: '2026-11-19'
status: 'done'
baseline_commit: '012b9465a2229fe14e1f8a948076dd18d49ff4cb'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-2-refonte-fichiers-volumineux/epic-14-context.md'
  - '{project-root}/.dependency-cruiser.cjs'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After epics 12 and 13, many `src/` directories remain crowded (up to 66 files in one folder). Stories 14.2–14.5 would move files with no validated plan.

**Approach:** Produce a documentation-only audit: an inventory of every `src/` directory with >10 files or >10 subdirectories, a split/keep verdict each, and for each split a target sub-folder and file-to-folder mapping. The user approves it before 14.2 starts.

## Boundaries & Constraints

**Always:** Respect hexagonal layering and the dependency-cruiser rules (no-core-to-adapters, no-tui-leak-outside-driving-tui, no-child-process-outside-driven-adapters). Keep `<name>.logic.ts` / `<name>.test.ts` co-located with their source file. Count from the actual tree (`git ls-files`), tests included. Mapping must name every file of each split directory, and assign each to the story (14.2–14.5) that will move it.

**Ask First:** Any directory the audit proposes to keep flat despite the counts; any renaming (as opposed to pure moves); any port/import path that would change a public name.

**Never:** Move, rename or edit any file under `src/`; change dependency-cruiser config; start implementing 14.2+. No barrel/re-export shims proposed to hide moves.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Crowded dir | >10 files or >10 subdirs | Listed with counts, verdict, target tree | N/A |
| Test/logic pair | `x.tsx`, `x.logic.ts`, `x.test.ts` | Mapped to the same folder | N/A |
| Dir split by multiple stories | e.g. `tui/zones/*` vs `tui/shared` | Each file assigned to exactly one story | Flag overlap to user |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/shared/components` -- 66 files, 1 subdir (14.2)
- `src/adapters/driving/tui/shared` -- 28 files, 10 subdirs; `shared/settings` 16 files (14.2)
- `src/adapters/driving/tui/store/slices` -- 50 files (14.3)
- `src/adapters/driving/tui/zones/{update,logs,routes,edts}` -- 45 / 40 / 35 / 37 files (14.3)
- `src/core/{edt,scripts,ports,shared-types}` -- 34 / 30 / 20 / 12 files (14.4)
- `src/adapters/driving/tui/zones/edts/dialogs/create-wizard` -- 13 files; `dialogs` 12 files (14.5)
- `src/core` (13 subdirs), `src/adapters/driven` (18 subdirs), `adapters/driven/git` (21 files) (14.5)
- `src/adapters/driving/cli`, `cli/commands` (15 files each), `src/adapters/driving/tui` (15 files), `src/bin` (15 files) -- not named in epic; need a verdict
- `.dependency-cruiser.cjs` -- layering rules the target tree must satisfy (read-only)

## Tasks & Acceptance

**Execution:**
- [ ] `_bmad-output/implementation-artifacts/sprint-2-refonte-fichiers-volumineux/epic-14/directory-audit-and-target-tree.md` -- write inventory table (path, files, subdirs, verdict) and per-split target tree with full file-to-folder mapping and owning story -- single approvable reference for 14.2–14.5
- [ ] same file -- add layering check section (how each move keeps dependency-cruiser green; docs/`AGENTS.md` paths to update in 14.5) -- avoids surprises in later stories

**Acceptance Criteria:**
- Given the repo after epics 12–13, when the audit is read, then every `src/` directory over the thresholds appears with counts and a split/keep verdict.
- Given a split verdict, when the mapping is read, then each file in that directory maps to one target folder and one owning story.
- Given the proposal, when checked against `.dependency-cruiser.cjs`, then no move crosses a forbidden layer boundary and co-location of `.logic`/`.test` files is preserved.
- Given the document, when the user approves it, then 14.2 may start; no file under `src/` has changed.

## Verification

**Commands:**
- `git diff --stat devlopment -- src` -- expected: empty
- `npx depcruise src --config .dependency-cruiser.cjs` -- expected: no violations (baseline)

## Suggested Review Order

**Decisions needing approval**

- Approval checklist with a default per Ask First decision; read first.
  [`directory-audit-and-target-tree.md`](directory-audit-and-target-tree.md)

**Inventory and target tree**

- Inventory of every directory over the thresholds, with verdict and owning story.
  [`directory-audit-and-target-tree.md`](directory-audit-and-target-tree.md)

**Drift guard**

- Script rebuilding the mapping from `git ls-files`; 14.2–14.5 re-run it.
  [`audit-mapping-check.py`](audit-mapping-check.py)
