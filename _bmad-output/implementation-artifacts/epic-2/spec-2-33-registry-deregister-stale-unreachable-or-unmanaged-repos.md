---
title: 'Registry — Deregister Stale, Unreachable, or Unmanaged Repos'
type: 'feature'
created: '2026-09-22'
status: 'in-review'
review_loop_iteration: 0
context: []
baseline_commit: '6a8813b568243bd9504598a192149d1cfef657f9'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `switchActiveEdt` walks every registered path on every `edt switch`; a path whose
repo no longer exists, or whose `.tui-back.yaml` was deleted, surfaces a `failed` row forever,
and `RegistryPort` has no way to remove a single stale entry (`reset` only replaces the whole
file, for corrupt-registry recovery).

**Approach:** Add `RegistryPort.remove(path)` (targeted, read-modify-write), a new
`core/scripts/clean-registry.ts` use-case that classifies registered paths into `unreachable` /
`manifest-not-found` stale candidates, and expose it via CLI (`registry clean`) and a new "Clean
stale entries" action on the REPO REGISTRY screen — both list-then-confirm, never automatic.

## Boundaries & Constraints

**Always:**
- Only two stale reasons: `unreachable` (`registry.exists()` → `false`) and `manifest-not-found`
  (`manifest.load()` fails with exactly that code) — any other manifest-load error is left alone.
- Every candidate is shown (path + reason) before removal; explicit confirmation or per-path
  selection required; zero candidates is reported explicitly, never silent.
- Removal is per-path isolated (one failure never blocks others), one `removed`/`failed` outcome
  row per path — mirrors `create.ts`/`switch.ts`/`delete.ts`'s per-repo isolation convention.
- `removeRegistry` is `addRegistry`'s read-modify-write shape; removing an unregistered path is a
  no-op success.
- A candidate still an EDT member (`edtRegistry`) is flagged with a note, never blocked; `edts.yaml`
  is never written by this story.
- CLI: `tui-back registry clean` — interactive list-then-confirm on a TTY; `--yes` + repeated
  `--path <path>` for scripted use, consistent with `update`'s `--all --yes`. TUI: reuses
  `repo-registry-screen.tsx`'s candidate-checkbox/results pattern, not a new component.

**Ask First:** none identified.

**Never:** remove entries for any manifest-load error other than `manifest-not-found`; write to
`edts.yaml`; use `RegistryPort.reset` for single-path removal; make removal automatic/silent.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output |
|----------|--------------|------------------|
| Unreachable | `registry.exists(path)` → `false` | candidate, `reason: 'unreachable'` |
| Manifest gone | `manifest.load(path)` → `manifest-not-found` | candidate, `reason: 'manifest-not-found'` |
| Other manifest error | e.g. `unknown-module` | not a candidate, left alone (2.28's territory) |
| Candidate is an EDT member | path in some `edtRegistryEntry.members` | candidate note `memberOfEdts: [topic]`, still removable |
| No candidates | registry fully healthy | explicit "no stale entries" result, never silent |
| One of several removals fails | `registry.remove(path)` errors | `failed` row for that path only; others still processed |
| Remove an unregistered path | not currently in `registry.yaml` | success, no-op |

</frozen-after-approval>

## Code Map

- `src/core/ports/registry.ts` -- `RegistryPort` (L6-12): add `remove(path): Promise<Result<void>>`.
- `src/adapters/driven/registry/index.ts` -- add `removeRegistry(registryFile, path)`, same read-modify-write shape as `addRegistry` (L78-98); wire into `createRegistryPort` (L21-28).
- `src/core/scripts/list-repos.ts` -- classification precedent to mirror: `exists()` → `unreachable`, `manifest.load()` `manifest-not-found` vs. any other error kept distinct (L44-59).
- `src/core/scripts/clean-registry.ts` (NEW) -- `classifyStaleRegistry({registry, manifest, edtRegistry})` → `{candidates: StaleRegistryEntry[]}` (`{path, reason: 'unreachable'|'manifest-not-found', memberOfEdts: string[]}`); `removeStaleRegistryEntries({registry, lock, registryResourceKey}, paths)` → per-path outcome list, mirrors `register.ts`'s `withActionLock(lock, resourceKey, () => registry.remove(path))` (L17-22).
- `src/core/edt/delete.ts` -- per-member outcome-array/isolation precedent (`DeleteEdtMemberResult`, L37-41) to mirror for per-path results.
- `src/adapters/driving/cli/subcommands.ts` -- add `registry` verb-dispatch subcommand (same shape as `edt`, L119-138) with `clean` action; parses `--yes` + repeated `--path <p>` (scripted) vs. no-args-on-a-TTY (interactive), mirroring `update`'s `--all --yes` parsing (L166-187).
- `src/bin/tui-back.e2e.test.ts` -- CLI black-box test location (AD-3) for `registry clean`.
- `src/adapters/driving/tui/store/slices/registry-slice.ts` -- session-id-guarded async pattern to mirror (`scanRegistryRoot`/`registerRegistryCandidates`, L107-190) for new stale-scan/confirm actions; `resetRegistryScreen` (L191-199) gains the new fields.
- `src/adapters/driving/tui/shared/repo-registry-screen.tsx` -- `RegistryScreenPhase` (L40-47) and `resolveRegistryScreenPhase` (L52-75) gain `clean-candidates`/`cleaning`/`clean-results` states; reuse existing checkbox rendering (L232-256) and results rendering (L265-278), no new component.
- `src/adapters/driving/tui/shared/repo-registry-screen.test.tsx`, `src/adapters/driven/registry/index.test.ts` -- existing test files to extend.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/ports/registry.ts` -- add `remove(path): Promise<Result<void>>` to `RegistryPort` -- closes AC1
- [x] `src/adapters/driven/registry/index.ts` -- implement `removeRegistry`, wire into `createRegistryPort` -- closes AC1
- [x] `src/core/scripts/clean-registry.ts` (new) -- `classifyStaleRegistry` + `removeStaleRegistryEntries` -- closes AC2, AC3, AC5
- [x] `src/adapters/driving/cli/subcommands.ts` -- `registry clean` subcommand (interactive + `--yes --path` scripted) -- closes AC4
- [x] `src/adapters/driving/tui/store/slices/registry-slice.ts` -- clean-candidate scan/confirm actions -- closes AC5
- [x] `src/adapters/driving/tui/shared/repo-registry-screen.tsx` -- "Clean stale entries" action (Ctrl+L) + new phases reusing existing checkbox/results rendering -- closes AC5
- [x] Tests: `clean-registry.ts` classification (unreachable / manifest-not-found / other-error-left-alone / EDT-member note); `removeRegistry` adapter (present path, absent-path no-op); `tui-back.e2e.test.ts` CLI coverage; `repo-registry-screen.test.tsx` new-phase interaction coverage

**Acceptance Criteria:**
- Given `RegistryPort` extended with `remove`, when called on a currently-registered path, then it's removed from `registry.yaml`; when called on a path not registered, then it's a no-op success.
- Given the registry has a mix of healthy, unreachable, manifest-not-found, and other-manifest-error paths, when `classifyStaleRegistry` runs, then only the two stale reasons are returned as candidates.
- Given a stale candidate is also an EDT member, when listed, then it carries a `memberOfEdts` note and is still offered for removal.
- Given the CLI, when `registry clean --yes --path <p1> --path <p2>` runs, then each path is removed via `RegistryPort.remove` with its own outcome row, one path's failure never blocking the other.
- Given the TUI's REPO REGISTRY screen, when "Clean stale entries" runs, then candidates render as a pre-checked `checkbox-list-item` list and confirming reports a structured per-path outcome list, same convention as scan/register.
- `npm test`, `npm run typecheck`, `npm run depcheck` pass; no `core → adapters` import (AD-1).

## Spec Change Log

## Design Notes

`clean-registry.ts` never touches `edts.yaml`: `switch.ts`'s existing `repo-not-registered`
failed-row handling (Story 2.4 review patch) already covers an EDT member whose registry entry
was removed. `memberOfEdts` (every `EdtRegistryEntry` whose `members[].repoPath` matches) is
display-only, never read by the removal path.

## Verification

**Commands:**
- `npm test` -- new/extended tests above all pass
- `npm run typecheck` -- clean
- `npm run depcheck` -- clean

**Manual checks:**
- CLI: register a path, delete its directory, run `tui-back registry clean` on a TTY — see it
  listed as `unreachable`, confirm, verify it's gone from `registry.yaml`.
- TUI: open `:registry`, trigger "Clean stale entries" with at least one stale + one EDT-member
  stale path present — verify the member note renders and removal still succeeds.
