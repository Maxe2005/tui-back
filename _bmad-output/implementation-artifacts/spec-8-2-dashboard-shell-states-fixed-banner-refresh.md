---
title: 'Story 8.2: Dashboard Shell — States, Fixed Banner & Refresh'
type: 'feature'
created: '2026-10-15'
status: 'in-progress'
baseline_commit: '8e15fa7be7e493c49f61c7431b24622018f9810a'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Dashboard zone only shows the banner and a generic placeholder; it has no data, no loading/empty/error states, no refresh, and the banner is not guaranteed to survive short terminals.

**Approach:** Wire the 8.1 snapshot into a `dashboard` store slice (services section and registry-health section loaded and filled independently), render the Dashboard shell under a fixed banner with per-section states, refresh on mount and `R`, and a dim "updated Ns ago" line. Minimal per-service rows only; the table, actions, Attention block and EDT actions are Stories 8.3–8.5.

## Boundaries & Constraints

**Always:** Banner never compacted or hidden; content below is bounded (`useBounds`/`useRowBudget`, `BoundedList`, `TruncatedText`) and when even the banner cannot fit, the shell's existing too-small screen applies (extend `isTerminalTooSmall` thresholds if the banner needs more rows). Precedence: registry check error → empty registry (existing prompt) → registry but no active EDT (prompt "[e]" to create/choose) → populated. Keys gated by `useZoneInputActive`. `R` = refresh (distinct from `Ctrl+R`); footer/`?` help come from `KEYBINDINGS` (`footer.zones: ['dashboard']`). Reuse `StateLine`, `RETRY_HINT`, `useFooterContext`. Core stays TUI-free; store actions degrade to an explicit error when ports are unwired. Zone logic in `*.logic.ts`, English, header comments ≤ 5 lines, no story/AC references in `src/`.

**Ask First:** Changing `isTerminalTooSmall` constants; changing signatures of existing ports.

**Never:** Services table, per-service actions, focus navigation, Attention block, EDT actions (8.3–8.5); live polling; fetching/writing git; a second copy of the snapshot assembly.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mount, populated | registry non-empty, active EDT | banner; EDT line; each section shows its own spinner then fills independently; "updated Ns ago" | N/A |
| Empty registry | `registryEmpty === true` | existing prompt only (precedence), no snapshot sections | N/A |
| No active EDT | registry non-empty, snapshot `no-active-edt` | prompt to create/choose with `[e]`; registry-health section still shown | N/A |
| Refresh | `R` pressed | both sections reload; dim line resets | ignored while a load is in flight |
| Load failure | `buildDashboardSnapshot` part returns err | that section shows error `StateLine` with `[R] retry`; other section unaffected | section-level |
| Probe error | row field `{ok:false}` | that field shows an explicit error marker (e.g. `container: error`); rest intact | field-level |
| Overlay open | settings/help/registry/command bar | `R` and all zone keys ignored | N/A |
| Tiny terminal | rows below banner + chrome minimum | shell too-small screen, never a clipped banner | N/A |

</frozen-after-approval>

## Code Map

- `src/core/dashboard/snapshot.ts` -- `buildDashboardSnapshot`; split out exported `buildDashboardServices` (status/edt/services) and `buildRegistrySummary` and compose them, so the TUI can fill each section independently.
- `src/adapters/driving/tui/store/slices/dashboard-slice.ts` (new) -- per-section `status` (`idle|loading|ready|error`), data, `updatedAt`, `loadDashboard()`; pattern of `shared-types-slice.ts`; register in `store/app-store.ts` (`AppState`, `createAppStore`); deps already hold registry/manifest/git/edtRegistry/state/docker.
- `src/adapters/driving/tui/zones/dashboard/dashboard-zone.tsx` -- keep banner + registry precedence; replace `ZonePlaceholder` with the new body; `useEffect` on mount, `activeEdt` and registry-screen flip.
- `src/adapters/driving/tui/zones/dashboard/dashboard-body.tsx`, `dashboard.logic.ts` (new) -- sections, minimal service rows (name, container, branch, error markers), `formatUpdatedAgo(now, updatedAt)`; ticking clock via interval (no data polling).
- `src/adapters/driving/tui/shared/components/{state-line,truncated-text,bounded-list}.tsx` -- reuse; `shared/hooks/use-zone-input-active.ts` -- key gate.
- `src/adapters/driving/tui/keybindings/keybindings.ts` -- add `R` refresh row, `footer.zones: ['dashboard']`; update keybinding tests.
- `src/adapters/driving/tui/app-shell.tsx:385-413`, `shared/bounds/bounds.ts` -- too-small gate and zone bounds.
- `src/adapters/driving/tui/zones/zone-layouts.ts` -- `dashboard` currently declares a list/detail boundary; make it single-pane (`boundaries: []`) unless 8.3 needs it (check Ctrl+W tests).
- `src/adapters/driving/tui/zones/dashboard/dashboard-zone.test.tsx` -- existing tests to extend.

## Tasks & Acceptance

**Execution:**
- [ ] `src/core/dashboard/snapshot.ts` (+ test) -- export the two section builders; `buildDashboardSnapshot` composes them, output unchanged -- independent fill
- [ ] `store/slices/dashboard-slice.ts` + `app-store.ts` (+ slice test) -- section states, `loadDashboard`, unwired degradation -- state
- [ ] `zones/dashboard/dashboard.logic.ts` (+ test) -- precedence resolver, "updated Ns ago", field-error labels -- pure logic
- [ ] `zones/dashboard/dashboard-body.tsx`, `dashboard-zone.tsx` (+ tests) -- bounded sections, states, refresh on mount/`R`, overlay inertness -- UI
- [ ] `keybindings/keybindings.ts`, `zone-layouts.ts` (+ tests) -- `R refresh` hint, layout contract -- discoverability
- [ ] `bounds` / `app-shell` tests -- banner survives; too-small screen when it cannot fit -- fixed banner

**Acceptance Criteria:**
- Given the Dashboard at any size, when rendered, then the banner is intact or the too-small screen replaces everything.
- Given mount or `R`, when the loads run, then each section spins and fills on its own and "updated Ns ago" appears.
- Given a failed section load, when rendered, then it shows `[R] retry` and the other section is untouched.
- Given an open overlay, when `R` is pressed, then no reload happens.
- Given `npm test`, `typecheck`, `depcheck`, then all pass (incl. bounded-rendering and comment-hygiene guards).

## Spec Change Log

## Design Notes

Sections load in parallel from one `loadDashboard()`; the snapshot CLI keeps calling the composed `buildDashboardSnapshot`, so TUI and script share the same builders. "no-active-edt" is read from the services section result, not from `activeEdt` in the store, so the Dashboard never contradicts the snapshot.

## Verification

**Commands:**
- `npm test` -- expected: all green
- `npm run typecheck` -- expected: no errors
- `npm run depcheck` -- expected: no violations
