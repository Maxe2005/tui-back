---
title: 'Permanent Dashboard Banner'
type: 'feature'
created: '2026-08-26'
status: 'done'
review_loop_iteration: 0
baseline_commit: '5cff68fa84241760d7b9b19601a79149aac456ac'
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-2/epic-2-context.md'
  - '_bmad-output/implementation-artifacts/deferred-work.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 1.12/UX-DR14 implemented the launch banner as a one-time display on first Dashboard visit (controlled by `launchBannerShown` store flag). The Sprint Change Proposal for Story 2.16 reverses this: the k9s-inspired ASCII banner should stay visible on the Dashboard permanently, not just the first time.

**Approach:** Remove the `launchBannerShown` store flag and its `markLaunchBannerShown` action. Make the `LaunchBanner` render unconditional in `DashboardZone`. Update tests to assert the banner is always visible.

## Boundaries & Constraints

**Always:**
- The `LaunchBanner` component renders unconditionally in `DashboardZone` (line 46 in `dashboard-zone.tsx` currently has `{launchBannerShown ? null : <LaunchBanner />}` — becomes `<LaunchBanner />`).
- Remove `launchBannerShown` state field and `markLaunchBannerShown` action from `AppState` and `createAppStore` in `app-store.ts`.
- The banner renders above all other Dashboard content (empty-registry prompt, error message, or placeholder) — same layout as today.
- No new components, no new ports, no core changes — this is a TUI-only visual change in `adapters/driving/tui`.

**Ask First:** None.

**Never:**
- Don't add a setting to toggle the banner (that would be a separate story if ever needed).
- Don't change the banner's visual appearance (monochrome, no motion/gradient, `text-dim` color) — only its display condition.
- Don't modify `LaunchBanner` component itself — only its usage in `DashboardZone`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Dashboard first render (fresh app start) | `launchBannerShown` removed, registry empty | Banner shows + empty-registry prompt | N/A |
| Dashboard re-render after zone switch | any registry state | Banner shows above current content | N/A |
| Dashboard with active EDT, non-empty registry | any state | Banner shows above placeholder content | N/A |
| Registry check fails | `registryEmptyStatus: 'error'` | Banner shows above error message | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/zones/dashboard/dashboard-zone.tsx` -- L34: drop `launchBannerShown` from the `useStore` selector; L46: change `{launchBannerShown ? null : <LaunchBanner />}` to unconditional `<LaunchBanner />`.
- `src/adapters/driving/tui/store/app-store.ts` -- L135-136: remove `launchBannerShown: boolean` and `markLaunchBannerShown: () => void` from the `AppState` interface; L309-310: remove their initial-state value and action implementation from `createAppStore`.
- `src/adapters/driving/tui/app-shell.tsx` -- L138-142: remove the mount effect `if (activeZone !== 'dashboard' && !launchBannerShown) { markLaunchBannerShown(); }`. This effect, not `dashboard-zone.tsx`, is what *writes* the flag (the first time the active zone leaves `'dashboard'`) — it is the actual one-time mechanism and becomes dead code once the flag is gone.
- `src/adapters/driving/tui/zones/dashboard/launch-banner.tsx` -- no changes (component itself unchanged).
- `src/adapters/driving/tui/zones/dashboard/dashboard-zone.test.tsx` -- remove all `launchBannerShown: true` seeding (L53, 61, 69, 80, 95, 125); the "first visit" test (L104) becomes an unconditional-display assertion.
- `src/adapters/driving/tui/zones/dashboard/launch-banner.test.tsx` -- invert "hides the banner once the store flag is set" (L16-24) into "always shows the banner regardless of any flag"; remove the `markLaunchBannerShown()` call.
- `src/adapters/driving/tui/app-shell.test.tsx` -- rewrite "shows the launch banner on the first Dashboard visit only (AC1)" (L125-142) to assert the banner shows on every Dashboard visit, including after switching away and back; delete "prevents the launch banner from reappearing once the store flag is set (AC1 regression guard)" (L144-151) outright; drop `launchBannerShown`/`markLaunchBannerShown` from the `minimalState: AppState` object literal (L267-268).
- `src/adapters/driving/tui/store/app-store.test.ts` -- delete "marks the launch banner shown once, in-memory only, and it stays set (AC1)" (L176-183) outright.

## Tasks & Acceptance

**Execution:**
- [x] `src/adapters/driving/tui/zones/dashboard/dashboard-zone.tsx` -- make `LaunchBanner` render unconditional; remove `launchBannerShown` from the `useStore` selector -- fulfills the Intent's core behavior change
- [x] `src/adapters/driving/tui/store/app-store.ts` -- remove `launchBannerShown` field, initial state, and `markLaunchBannerShown` action from `AppState` and `createAppStore` -- the flag has no remaining reader once the banner is unconditional
- [x] `src/adapters/driving/tui/app-shell.tsx` -- remove the mount effect that calls `markLaunchBannerShown()` when the active zone leaves `'dashboard'` -- this is the writer of the flag being deleted; leaving it would call a removed action
- [x] `src/adapters/driving/tui/zones/dashboard/dashboard-zone.test.tsx` -- remove all `launchBannerShown: true` seeding; update assertions/descriptions so every case reflects the banner always being present
- [x] `src/adapters/driving/tui/zones/dashboard/launch-banner.test.tsx` -- update the "hides" test to assert the banner always shows; remove the `markLaunchBannerShown` call
- [x] `src/adapters/driving/tui/app-shell.test.tsx` -- rewrite the "first Dashboard visit only" test to cover switch-away-and-back always showing the banner; delete the reappearing-guard test; drop the removed fields from the `minimalState: AppState` literal
- [x] `src/adapters/driving/tui/store/app-store.test.ts` -- delete the "marks the launch banner shown once" test

**Acceptance Criteria:**
- Given the app starts, when the Dashboard first renders, then the banner shows exactly as today.
- Given the Dashboard has already been viewed once (this session or a prior one, including after switching to another zone and back), when the Dashboard renders again, then the banner still shows identically — never conditionally hidden after a first visit.
- Given any other Dashboard state (empty-registry prompt, populated view, registry-check error), when rendered, then the banner renders above that content, never replacing or being replaced by it.
- All tests pass (`npm test`), typecheck passes (`npm run typecheck`), depcheck passes (`npm run depcheck`).

## Spec Change Log

## Design Notes

The change touches three production files, not just `dashboard-zone.tsx` and `app-store.ts`. `markLaunchBannerShown` is also called from `app-shell.tsx`'s mount effect (L138-142), which sets the flag the first time the active zone leaves `'dashboard'` — that effect, not `DashboardZone`'s own conditional, is the actual mechanism that made the banner one-time (`DashboardZone` only *reads* the flag; `app-shell.tsx` is what *writes* it on navigation-away). It becomes dead code once the flag is removed and must be deleted with it, not left calling a now-nonexistent action.

Three test files carry coverage of the one-time behavior and must all move together: `app-shell.test.tsx`'s "first Dashboard visit only" test inverts to always-visible, and its "prevents...reappearing" regression guard is deleted outright (no flag left to set). `app-store.test.ts`'s "marks the launch banner shown once" test is deleted outright. `app-shell.test.tsx`'s `minimalState: AppState` object literal (L267-268) must drop both fields, or `tsc` rejects it as an excess property once they leave the `AppState` interface.

## Verification

**Commands:**
- `npm test` -- expected: all suites green, including updated dashboard-zone, launch-banner, app-shell, and app-store tests
- `npm run typecheck` -- expected: `tsc --noEmit` clean
- `npm run depcheck` -- expected: no boundary violations (touches only `adapters/driving/tui/**`)

**Manual checks:**
- `node src/bin/tui-back.mjs` (TUI): launch → Dashboard shows banner; press `e` (EDTs zone) → `d` (back to Dashboard) → banner still shows; quit and relaunch → banner shows on first render.

## Suggested Review Order

**Core behavior change**

- Entry point — the banner is now an unconditional line in the render tree, not a flag-gated one.
  [`dashboard-zone.tsx:48`](../../../src/adapters/driving/tui/zones/dashboard/dashboard-zone.tsx#L48)

- The actual one-time *writer* is deleted here, not in `DashboardZone` — this effect set the flag on leaving Dashboard.
  [`app-shell.tsx:136`](../../../src/adapters/driving/tui/app-shell.tsx#L136)

- The flag and its action are removed from both the `AppState` interface and `createAppStore` — no remaining reader once the banner is unconditional.
  [`app-store.ts:134`](../../../src/adapters/driving/tui/store/app-store.ts#L134)

**Test coverage — DashboardZone's four rendered states**

- Empty-registry state: banner asserted above the prompt.
  [`dashboard-zone.test.tsx:116`](../../../src/adapters/driving/tui/zones/dashboard/dashboard-zone.test.tsx#L116)

- Non-empty-registry (placeholder) state: banner assertion added by review to close the I/O matrix.
  [`dashboard-zone.test.tsx:59`](../../../src/adapters/driving/tui/zones/dashboard/dashboard-zone.test.tsx#L59)

- Before-check-resolves state: banner assertion added by review, mirroring its two siblings.
  [`dashboard-zone.test.tsx:72`](../../../src/adapters/driving/tui/zones/dashboard/dashboard-zone.test.tsx#L72)

- Registry-check-error state: banner assertion added by review to close the I/O matrix's last row.
  [`dashboard-zone.test.tsx:87`](../../../src/adapters/driving/tui/zones/dashboard/dashboard-zone.test.tsx#L87)

**Test coverage — LaunchBanner and AppShell integration**

- The two flag-based tests (first-render / hides-once-flagged) collapse into one, since no flag remains to vary.
  [`launch-banner.test.tsx:11`](../../../src/adapters/driving/tui/zones/dashboard/launch-banner.test.tsx#L11)

- Switch-away-and-back at the AppShell level: proves the banner survives navigation and never leaks into another zone's render.
  [`app-shell.test.tsx:125`](../../../src/adapters/driving/tui/app-shell.test.tsx#L125)

- Peripheral: the `minimalState: AppState` test fixture drops the two removed fields (a `tsc` excess-property requirement, not a behavior change).
  [`app-shell.test.tsx:248`](../../../src/adapters/driving/tui/app-shell.test.tsx#L248)
