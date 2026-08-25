---
title: 'Manifest-Gated Zone Tab Visibility & Disabled State (Story 2.13)'
type: 'feature'
created: '2026-08-25'
status: 'ready-for-dev'
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-2/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `Routes`/`shared-types` tabs render unconditionally today even when no registered repo could ever use them (over-claiming capability), and a blunt hide-when-unused would instead erase a capability that genuinely exists elsewhere in the registry.

**Approach:** Compute a per-gated-zone visibility status — `omitted` (zero registry-wide repos activate the module), `disabled` (some repo does, but no active-EDT member does), or `enabled` — by cross-referencing every registered repo's manifest module ids against active-EDT membership. Omitted tabs are never rendered or reachable; disabled tabs render dimmed+strikethrough and, when reached, show an explanatory message instead of their normal content.

## Boundaries & Constraints

**Always:**
- New core use-case reuses `listRepos`'s registry-wide `moduleIds` scan plus `listEdtBranchesDivergence`'s active-EDT-member resolution — no duplicated manifest loop. `Routes` gates on `route-explorer`; `shared-types` gates on `shared-types-source` OR `shared-types-consumer` (either counts, for both omission and disabled).
- `AppShell` loads tab visibility once on mount (existing per-zone lazy-load idiom, no store-wide bootstrap); reloads on registry-screen close (2.11) and active-EDT membership change. Before the first load resolves, gated tabs render in their default reachable state — no spinner, no flash-then-hide.
- `nextZoneId`/`shouldSwitchZone` take the reachable-zone set (all zones minus `omitted`) so wrap-nav and mnemonics skip omitted tabs and land on disabled ones — the hook Story 2.12 left for this.
- `ZoneTabBar` never renders `omitted`; `disabled` renders `text-dim` + strikethrough, never `accent`, never a badge.
- Active tab going `omitted` → `AppShell` falls back to `dashboard`. Going `disabled` → no navigation; the zone's body swaps to an explanatory message naming the carrying services (reuses `edts-zone.tsx`'s labelled-lines idiom) instead of `ZonePlaceholder`.
- Confirmed with human: `module-registry.ts` stays empty — mechanism only. Both tabs stay `omitted` in real usage until Epic 4/6; tests exercise `disabled`/`enabled` via injected fixtures.

**Ask First:** none identified.

**Never:**
- Never add real module ids to `moduleRegistry` — belongs to Epics 4/6.
- Never block `AppShell`'s render on the tab-visibility load.
- Never make a `disabled` tab's mnemonic/arrow-nav a no-op — only `omitted` is skipped.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No repo anywhere activates the module | 0 registered repos declare `route-explorer` | `Routes` fully omitted; mnemonic `r` and arrow-nav never land on it | N/A |
| Module exists, active EDT lacks a member | ≥1 registry repo declares `shared-types-source`/`-consumer`, none is an active-EDT member | `shared-types` shown `text-dim` + strikethrough | N/A |
| Disabled tab reached | mnemonic or `Left`/`Right` lands on a disabled tab | becomes active zone; shows explanatory message naming carrying services; no accent fill | N/A |
| Omitted tab targeted | mnemonic pressed, or arrow-navigated toward it | skipped entirely — never becomes active | N/A |
| Active EDT membership changes | member add/remove flips a gated tab's status | tab bar updates immediately; if the active zone becomes disabled, its content swaps in place, no forced navigation | N/A |
| Registry changes (Story 2.11) | scan/register changes whether any repo anywhere has the module | a tab can newly appear/disappear; if the active zone's tab disappears, app falls back to Dashboard | N/A |

</frozen-after-approval>

## Code Map

- `src/core/edt/resolve-tab-visibility.ts` (new) -- aggregates `listRepos`'s `moduleIds` + active-EDT-member resolution (mirrors `core/edt/list.ts:75-89`) into `{ routes, sharedTypes }: {status, carryingServices}`; exports `ROUTES_MODULE_ID`/`SHARED_TYPES_MODULE_IDS` for UI reuse
- `src/core/edt/list.ts:75-89`, `src/core/scripts/list-repos.ts` -- reuse points: active-EDT-member-path resolution and `ManagedRepo.moduleIds`, do not reimplement
- `src/adapters/driving/tui/zones/zones.ts:18-66` -- `nextZoneId`: add a reachable-zone-set param filtering wrap traversal (defaults to all zones)
- `src/adapters/driving/tui/app-shell.tsx:41-60,74-182` -- `shouldSwitchZone`, `resolveZoneArrowSwitch`, `useInput` dispatch: reachable-set gating + mount-time load + omitted-fallback effect (mirrors `edts-zone.tsx:469-471`, at shell scope)
- `src/adapters/driving/tui/store/app-store.ts:50-107` -- `tabVisibility` slice (status + `idle`/`loading`/`error`) + `loadTabVisibility()`, deps-gated like the EDT slice
- `src/adapters/driving/tui/shared/components/zone-tab-bar.tsx` -- skip `omitted`; add `disabled` visual (text-dim + strikethrough, no accent, no badge)
- `src/adapters/driving/tui/shared/theme/theme.ts:37-49` -- add `disabled-tab` typography entry
- `.../zones/routes/routes-zone.tsx`, `.../shared-types/shared-types-zone.tsx` -- explanatory message on `disabled` (idiom: `edts-zone.tsx:71-84`); `ZonePlaceholder` otherwise

## Tasks & Acceptance

**Execution:**
- [ ] `core/edt/resolve-tab-visibility.ts` + `.test.ts` -- new use-case computing per-gated-zone status/carrying-services -- core aggregation, no port change
- [ ] `zones.ts` + `zones.test.ts` -- `nextZoneId` reachable-set param -- lets wrap-nav skip omitted tabs
- [ ] `app-store.ts` + tests -- `tabVisibility` slice + `loadTabVisibility()` -- deps-gated, mirrors EDT slice
- [ ] `app-shell.tsx` + `app-shell.test.tsx`/`.interaction.test.tsx` -- mount-time load, omitted-fallback effect, reachable-set gating on mnemonic/arrow dispatch -- drives the interaction
- [ ] `zone-tab-bar.tsx` + `zone-tab-bar.test.tsx` -- omit/disabled rendering -- visual contract
- [ ] `theme.ts` -- `disabled-tab` typography token -- no new color, per DESIGN.md
- [ ] `routes-zone.tsx`, `shared-types-zone.tsx` + tests -- explanatory-message body on `disabled` -- I/O matrix rows 2-3

**Acceptance Criteria:**
- Given `moduleRegistry` stays empty (human-confirmed scope), when this story's tests run, then `disabled`/`enabled` paths are exercised via injected port fixtures, never real manifests
- Given `AppShell` mounts and the tab-visibility load hasn't resolved yet, when the tab bar renders, then no shell-wide spinner appears and no zone flashes into then out of view

## Verification

**Commands:**
- `npm test` -- all suites green, including new `resolve-tab-visibility`/`zones`/`app-shell`/`zone-tab-bar` cases
- `npm run typecheck` -- clean
- `npm run depcheck` -- no boundary violations (`core/edt/resolve-tab-visibility.ts` imports only existing ports; adapter changes confined to `adapters/driving/tui`)

**Manual checks (if no CLI):**
- With an empty registry, `Routes`/`shared-types` never appear in the tab bar and their mnemonics do nothing.

