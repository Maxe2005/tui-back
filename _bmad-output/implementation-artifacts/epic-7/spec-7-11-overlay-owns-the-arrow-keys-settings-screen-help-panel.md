---
title: 'Story 7.11: Overlay owns the arrow keys — settings screen & help panel'
type: 'bugfix'
created: '2026-10-13'
status: 'in-review'
baseline_commit: '0c266f90f60bd83980dc6c50260133cf69b518dd'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** With `:settings` or the `?` help panel open, ↑/↓ moved both the overlay and the zone behind it. Ink dispatches every keypress to every mounted `useInput`, and each zone gated itself with its own hand-written list of overlay flags: none included the help panel, Routes missed the reset screen, and shared-types had no gate.

**Approach:** One predicate, `useZoneInputActive(useStore)` in `tui/shared/hooks`, true only when no overlay (command bar, registry, settings, reset, help) and no resize mode is active. Every zone's `useInput` uses it; the per-zone lists disappear. A guard test mounts each zone under each overlay.

## Boundaries & Constraints

**Always:** the overlays' own handlers and AppShell's global dispatch are unchanged; a future overlay is registered in the predicate only; AD-17 comment rule; conventional commits with `(story 7.11)`; verify with `npm test && npm run typecheck && npm run depcheck`.

**Never:** change keybindings, the store shape, or how overlays open and close.

## I/O & Edge-Case Matrix

| Scenario | State | Expected |
|----------|-------|----------|
| Settings open over any zone | `settingsScreenOpen` | no zone cursor, selection, field or pane focus changes |
| Help open over Update/EDTs/Logs/Routes/shared-types | `helpOpen` | only the panel scrolls; closing restores the zone as it was |
| Registry, reset screen, command bar open | each flag | same rule, in every zone including shared-types |
| Resize mode | `resizeMode` set | zones inert, as before |
| No overlay | all closed | every zone handler live |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/shared/hooks/use-zone-input-active.ts` (new) -- `isZoneInputActive(state)` + hook.
- `zones/{edts,update,logs,routes,shared-types}/*-zone.tsx` -- `{ isActive: zoneInputActive }` replaces the flag lists; shared-types gains its first gate.
- `shared/hooks/use-zone-input-active.test.tsx` (new) -- regression guard: every zone × every overlay has no live handler; idle zones keep one.

## Tasks & Acceptance

**Execution:**
- [x] Predicate + hook -- single source of truth for zone input gating.
- [x] Adopt in the five zones with a key handler (Dashboard has none).
- [x] Guard test over zones × overlays.

**Acceptance Criteria:**
- Given `:settings` or `?` is open over any zone, when keys are pressed, then only the overlay reacts.
- Given registry, reset or command bar is open, then the same holds in every zone, shared-types included.
- Given an overlay closes, then the zone handles keys again.

## Verification

- `npm test`, `npm run typecheck`, `npm run depcheck` -- all clean.

## Review Outcome

Pending.
