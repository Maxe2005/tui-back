---
title: 'Story 7.12 — Shared Service Actions: Open in IDE, Simple/Clean Restart (AD-21)'
type: 'feature'
created: '2026-10-13'
status: 'done'
baseline_commit: '32bf01abb1b9844a84a80d15b6285f0a6e810d04'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** "Open in editor" lives privately in the Update zone (spawn + argv resolution in the TUI layer) and restart logic is split between the Logs slice (plain `docker restart`) and `core/scripts/service-restart.ts` (clean only). Logs and the upcoming Dashboard would each re-implement them and diverge.

**Approach:** Add a pure `core/service-actions` registry (ports injected) exposing `openInIde` and `restart(simple|clean)` plus per-service availability; move the editor launcher behind a new `EditorPort` driven adapter; add a presentational `ServiceActionsRow` that renders whatever the registry lists. The Update zone switches to the extracted launcher with unchanged behaviour.

## Boundaries & Constraints

**Always:** Every action returns `Result`. Editor precedence is unchanged: `general.editorCommand` → `$EDITOR` → `vi`; `<repo>` replaced, else path appended. Clean restart reuses `runRestartStep`; simple reuses `ContainerPort.restart`. A container-less service offers no restart (unavailable, reason `no container`, never a failure). Registry lives in `core/` and never imports adapters; no `child_process` outside `adapters/driven`. Adding an action = adding one registry entry, no consumer layout change. Source comments follow AD-17 (no story/AC references).

**Ask First:** Default keys for the registry entries (proposed `o` open in IDE, `r` restart simple, `c` restart clean) — HALT if any collides with a canonical key of UX-DR36 or an existing zone binding.

**Never:** Wiring the registry into the Logs zone (Story 5.7) or the Dashboard (7.5/7.6); adding the `logs.restartMode` setting; changing group-update behaviour; rewriting the launcher (it is moved).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Restart simple | manifest has container | `container.restart(name)`, `ok` | adapter error propagated |
| Clean with recipe | `restartCommands` non-empty | recipe runs in order, `ok` | first failure → `restart-failed` |
| Clean, no recipe | no `restartCommands` | simple restart, `ok` with notice "no clean-restart recipe — restarted simply" | as simple |
| Container-less | manifest omits `container` | restart entries listed unavailable (`no container`) | direct call → `err('no-container')` |
| Restart already running | lock held for the service | entries unavailable (`restart in progress`) | direct call → `update-already-running` |
| Open in IDE | editor binary missing | n/a | `err('editor-launch-failed', 'Could not launch "<bin>": …')` |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/zones/update/update-zone.logic.ts:196-256` -- `EDITOR_REPO_PLACEHOLDER`, `tokenizeCommandLine`, `resolveEditorCommand` (pure; move out, keep their tests).
- `src/adapters/driving/tui/zones/update/update-zone.tsx:320,710` -- `launchEditor` (`spawnSync`, stdio inherit) and its sole call site; replace with the port.
- `src/core/scripts/service-restart.ts` -- clean restart + `serviceRestartLockKey`; template for lock + manifest load.
- `src/core/scripts/group-update.ts:722` -- `runRestartStep` (recipe loop, container fallback, `no-container`).
- `src/core/ports/{restart,container}.ts` -- port style to mirror for `editor.ts`; `src/core/ports/manifest.ts` (`container?`, `restartCommands?`).
- `src/adapters/driven/restart/index.ts` -- adapter style; `src/bin/{tui,main}.ts` -- composition roots; `src/adapters/driving/tui/store/app-store.ts:55-90` -- `AppStoreDeps`.
- `src/adapters/driving/tui/shared/components/` -- home of `ServiceActionsRow`; footer/help generated from keybinding declarations.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/ports/editor.ts` + `src/adapters/driven/editor/{index,command}.ts` (+tests) -- `EditorPort.launch(repoPath, editorCommand): Result<void>`; move tokenizer/resolver/spawn here unchanged -- hexagonal boundary.
- [x] `src/core/service-actions/index.ts` (+test) -- `createServiceActions({manifest, container, restart, editor, lock})` with `list(repoPath, ctx)`, `openInIde`, `restart(repoPath, mode)`; entries carry `id,label,key,availability` -- AD-21.
- [x] `update-zone.tsx`/`.logic.ts`, `app-store.ts`, `src/bin/{tui,main}.ts` -- Update zone calls the port-backed action; drop TUI-side spawn; wire deps -- behaviour unchanged, existing tests pass.
- [x] `src/adapters/driving/tui/shared/components/service-actions-row.tsx` (+test) -- renders listed actions with key and greyed reason when unavailable, bounded (ellipsis) -- consumed later by 5.7/7.5.
- [x] Docs: note AD-21 registry in `AGENTS.md`/README only if they list ports or components.

**Acceptance Criteria:**
- Given any service, when `list` is called, then it returns open-in-IDE, restart simple and restart clean, each with availability and reason.
- Given a registry with an extra entry, when `ServiceActionsRow` renders, then the new action appears with no component change.
- Given the Update zone blocker "Open in editor", when chosen, then behaviour and existing tests are unchanged.
- Given `npm run lint`/depcruise, then no `child_process` import exists under `src/adapters/driving` or `src/core`.

## Design Notes

Availability is computed from manifest + lock state at `list` time, so consumers never re-derive rules. `openInIde` stays synchronous: the editor must own the terminal (stdio inherit) until it exits, as today.

## Verification

**Commands:**
- `npm test` -- expected: all green
- `npm run lint && npx tsc --noEmit` -- expected: no errors (incl. dependency-cruiser boundaries)

## Suggested Review Order

**Registry (design entry point)**

- One core registry: availability rules, restart modes, clean-restart fallback notice.
  [`index.ts:72`](../../src/core/service-actions/index.ts#L72)

- Free `openInIde` shared by the registry and the Update slice.
  [`index.ts:64`](../../src/core/service-actions/index.ts#L64)

**Editor behind a port**

- Port contract keeps `child_process` out of core and the TUI.
  [`editor.ts:5`](../../src/core/ports/editor.ts#L5)

- Driven adapter: moved launcher, now throw-safe.
  [`index.ts:8`](../../src/adapters/driven/editor/index.ts#L8)

**Update zone switch-over**

- Slice action reads `general.editorCommand` and calls the port.
  [`update-slice.ts:1327`](../../src/adapters/driving/tui/store/slices/update-slice.ts#L1327)

- Blocker menu now uses the store action instead of a local spawn.
  [`update-zone.tsx:691`](../../src/adapters/driving/tui/zones/update/update-zone.tsx#L691)

- Composition root wires the adapter.
  [`tui.ts:104`](../../src/bin/tui.ts#L104)

**Presentation**

- Bounded row rendering whatever the registry lists.
  [`service-actions-row.tsx:9`](../../src/adapters/driving/tui/shared/components/service-actions-row.tsx#L9)
