---
title: 'Story 7.2 (graft C1): Logs without-container grouping, scoped Ctrl+A, always-visible health'
type: 'feature'
created: '2026-10-05'
status: 'done'
baseline_commit: 'c9cf072c62f828100fa5359719fbc2377c2cdc8e'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Logs zone still shows container-less services mixed into the two selectable lists (or not at all), Ctrl+A only toggles the EDT-members list, health badges appear only on subscribed rows, and `restarting` does not say what is happening.

**Approach:** Add an info-only "services without container" section covering every such registry service; scope Ctrl+A to the focused selectable list; extend the existing health poll to every listed row so badges render everywhere; make a restarting row state explicitly that a restart was requested and the container is being re-verified. Prior 7.2 work (optional container end to end) is done and committed — this graft only changes Logs presentation and selection.

## Boundaries & Constraints

**Always:** Result<T> with kebab-case codes in core; never call DockerPort/ContainerPort for a container-less service; AD-17 comment rule; imports first per file; lists render immediately and never block on manifest loads (presence resolves async); follow the Update zone precedent (missing health reads as `down`); verify with `npm test && npm run typecheck && npm run depcheck`; conventional commits with `(story 7.2)` on the open story branch.

**Ask First:** None — defaults delegated; any new terminal-indistinguishability (à la Ctrl+Shift+A) found is reported, not worked around.

**Never:** Make the third section selectable, focusable, or Tab-reachable; change DockerPort/HealthState in core; persist anything new (no state-port change); touch the Update zone, the Dashboard, or the zone-layout contract (Story 7.3); rework the Ctrl+A toggle semantics (indistinguishable Ctrl+Shift+A stays a toggle).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Third group | registry holds container-less services (members or not) | info-only greyed section, unselectable, skipped by Tab and Ctrl+A | manifest unloadable → row stays in its membership list, never in the third group |
| Scoped Ctrl+A | focus on EDT-members / other-services + Ctrl+A | toggles select-all of the focused list only | third group never affected |
| Health everywhere | any listed row, subscribed or not | badge visible (polled value, else `down` default like Update) | poll failure keeps last-known, never crashes |
| Explicit restarting | pane restarting flag or health `restarting` | row/pane states restart-requested + re-verifying, not bare `restarting` | N/A |
| R on third group | keypress on info-only row | impossible (row unfocusable); slice guard stays second line of defense | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/zones/logs/logs-zone.tsx:127-170` -- rows source, EDT-membership partition, cursors, active-pane order; `:559-620` list key branches (Ctrl+A only in edt-list); `:495-500,:671-680` R guards; `:710-764` the two list renders.
- `src/adapters/driving/tui/zones/logs/logs-zone.logic.ts:35-43` -- `cycleLogsPaneFocus` (Tab order; third group is skipped, focus type unchanged); `:291-311` Ctrl+A resolver + select-all toggle.
- `src/adapters/driving/tui/store/slices/logs-slice.ts:20-41,192-229,265-278` -- pane type, health poll, EDT-only select-all actions; add other-list select-all pair + per-row container-presence resolution (manifest.load per row, async, cached in store — rows carry no container today).
- `src/core/edt/list.ts:20-40` (`ServiceBranchDivergence`) -- read-only; has no container field and must not gain one for this graft.
- `src/adapters/driving/tui/zones/logs/logs-pane-view.tsx:59-91` + `fullscreen-pane.tsx:60-92` -- pane badges; row badges reuse `healthBadgeState`/`formatHealthLabel` (`logs-zone.logic.ts:16-30`).
- `src/adapters/driving/tui/store/slices/update-slice.ts:235-257` -- the poll-every-row precedent (missing reads as down) to mirror.
- Tests: `logs-zone.logic.test.ts` (badge/cycle/Ctrl+A), `logs-zone.test.tsx` (render), `logs-zone.interaction.test.tsx:1058-1080` (Ctrl+A toggle pattern to mirror for other-list).

## Tasks & Acceptance

**Execution:**
- [x] `src/adapters/driving/tui/store/slices/logs-slice.ts` -- resolve per-row container presence (async, cached) + other-list select-all pair + extend health polling to listed-but-unsubscribed rows -- third group data without blocking render.
- [x] `src/adapters/driving/tui/zones/logs/logs-zone.tsx` -- render the info-only third section; scope Ctrl+A per focused list; badges on every row; explicit restarting label -- the visible graft.
- [x] `src/adapters/driving/tui/zones/logs/logs-zone.logic.ts` -- Tab cycle skips the info-only group; per-list select-all toggle -- no focus-model change.
- [x] Tests for every I/O-matrix row (logic + render + interaction mirror) -- locks the graft per AD-13.
- [ ] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- 7.2 stays `in-progress` until merge.

**Acceptance Criteria:**
- Given container-less services in the registry, when the Logs zone renders, then they appear only in a greyed info-only section: no cursor, no Space, no Enter, no Tab stop, no Ctrl+A effect.
- Given focus on either selectable list, when Ctrl+A, then only that list toggles.
- Given any listed row, when health is known or defaulted, then its badge is visible without subscription.
- Given a restarting service, when displayed, then row and pane state restart-requested plus re-verifying.

## Verification

**Commands:**
- `npm test` -- expected: all pass, including third-group, scoped-Ctrl+A, badge-everywhere, and restarting tests.
- `npm run typecheck` -- expected: clean.
- `npm run depcheck` -- expected: clean; no cross-zone imports (reuse within the Logs zone only).

## Suggested Review Order

**Presence and polling in the slice**

- Per-row presence resolves async and cached, with an in-flight set and stale writes contained
  [`logs-slice.ts:289`](../../../src/adapters/driving/tui/store/slices/logs-slice.ts#L289)

- Listed-row poll short-circuits on known container-less, trims before Docker, prunes on retarget
  [`logs-slice.ts:313`](../../../src/adapters/driving/tui/store/slices/logs-slice.ts#L313)

**Visible graft in the zone**

- Third section renders from the same split as the selectable lists; Ctrl+A is focus-scoped
  [`logs-zone.tsx:155`](../../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L155)

- Every row badges via pane, listed poll, then down default; restarting reads explicitly
  [`logs-zone.tsx:189`](../../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L189)

**Pure helpers**

- No-container never reads as restarting; single split predicate for both lists
  [`logs-zone.logic.ts:42`](../../../src/adapters/driving/tui/zones/logs/logs-zone.logic.ts#L42)
