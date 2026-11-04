---
title: 'Story 8.5: Dashboard — EDT Actions & Visual Finish'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_commit: '9486f2c626050f3cd3815575fa2f9810e782f5d7'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8/epic-8-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Dashboard has no EDT actions (entering the active EDT, choosing/creating another one) and its layout does not yet match the approved mockup `key-dashboard.html`; the banner's behaviour on short terminals is unproven (deferred entry "banner clips on short terminals").

**Approach:** Add a bottom "EDT" section with two actions — `E` enters the active/last-used EDT in the EDTs zone, `e` opens Story 2.30's quick-pick (or the create wizard when no EDT exists) — then align the three states (anomalies / all clear + action running / no EDT) and the footer with the mockup and Atelier tokens, and prove with a data-filled size matrix that nothing overflows and the banner stays intact wherever it fits.

## Boundaries & Constraints

**Always:** `Enter` keeps its 8.3 meaning (open the focused service in Logs); `E` (shift) is the new "enter EDT" key, `e` stays the global EDTs mnemonic and additionally seeds the quick-pick via the existing `openEdtSwitchDialog('edt-switch')` / `openEdtCreateDialog()` store openers (consumed by `edts-zone.tsx` `currentEdtAction` effect). Default action label: `Enter <topic>`; no active EDT but EDTs exist → `Enter <last-used topic>` only if the store already exposes one, else just choose/create; zero EDTs → `Create a first EDT`. Keys gated by `useZoneInputActive`; footer/`?` help from `KEYBINDINGS` (`R refresh`, `e EDTs`, `↑/↓ service`, `Enter open`, `Ctrl+O/R/L` shown only while a service is focused, `E enter EDT`). Atelier tokens: one accent, status colours only for status, square corners, dim secondary text. The banner stays uncompacted and permanent; where it cannot fit the shell's existing too-small screen applies (`MIN_TERMINAL_*`). Rendering stays bounded (`useRowBudget`/`BoundedList`/`TruncatedText`). Zone logic in `*.logic.ts`, English, header comments ≤ 5 lines, no story/AC refs in `src/`.

**Ask First:** Changing `MIN_TERMINAL_COLUMNS/ROWS`; any change to `LaunchBanner` content; new keys other than `E`.

**Never:** Snapshot/CLI shape changes, drift lines (8.6), realign shortcut (8.8), live polling, compacting the banner, re-implementing the quick-pick.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Populated with anomalies | active EDT, attention lines | EDT line with `· updated Ns ago · [R] refresh`, services, Attention, registry, EDT section with `[E] ▸ Enter <topic>` and `[e] ▸ Choose another EDT / create one` | N/A |
| All clear, action running | no attention, a row running | success lines, running line under the focused row, same EDT section | N/A |
| No active EDT, EDTs exist | `no-active-edt` | "No active EDT." + `[e] ▸ Choose or create an EDT` | N/A |
| No EDT at all | zero EDTs | "No EDT yet." + `[e] ▸ Create a first EDT` (opens create wizard) | N/A |
| Press `E` | active EDT | active zone becomes EDTs | ignored when overlay open or no active EDT |
| Press `e` | any | EDTs zone + quick-pick (create wizard if zero EDTs) | ignored when overlay open |
| Any matrix size | 120×40, 80×24, 60×15, 40×12 with data | frame ≤ rows × columns, banner lines intact | below minimum → shell too-small screen |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/zones/dashboard/dashboard-body.tsx` -- sections layout; `bodyChromeRows` must account for the new EDT section rows; merge "updated" line into the EDT line (mockup).
- `src/adapters/driving/tui/zones/dashboard/dashboard-zone.tsx` -- `useInput` next to `R`/`a`: add `E` and `e` handling (gated by `zoneInputActive`).
- `src/adapters/driving/tui/zones/dashboard/dashboard.logic.ts` -- add EDT-section line builders (labels per matrix row), pure + tested.
- `src/adapters/driving/tui/store/slices/edt-slice.ts:463-490` -- `openEdtSwitchDialog`/`openEdtCreateDialog` (read-only reuse); `navigation-slice.ts:113` `setActiveZone`.
- `src/adapters/driving/tui/zones/edts/edts-zone.tsx:370-450` -- consumes `currentEdtAction` (read-only; confirm the quick-pick opens when the zone is already mounted).
- `src/adapters/driving/tui/keybindings/keybindings.ts:171-205` -- Dashboard rows; add `E`, adjust footer for `Ctrl+O/R/L` focused-only if the footer mechanism (`footer-contexts.ts`) supports it; update `keybindings.test.ts` guards.
- `src/adapters/driving/tui/zones/dashboard/launch-banner.tsx` -- read-only (banner 2 rows, 28 cols).
- `src/adapters/driving/tui/shared/bounds/bounds-matrix.test.tsx`, `shared/test-support/matrix.ts` -- model for a Dashboard matrix test using a store pre-filled with snapshot data (the existing matrix store has none).
- `_bmad-output/planning-artifacts/ux-designs/*/mockups/key-dashboard.html` -- visual reference (states A/B/C).
- `_bmad-output/implementation-artifacts/deferred-work.md` -- entries "banner clips on short terminals" (1.12, 2.16): mark resolved once the matrix test proves it.

## Tasks & Acceptance

**Execution:**
- [x] `dashboard.logic.ts` (+ test) -- EDT-section labels/actions per state -- pure logic for every matrix row
- [x] `dashboard-body.tsx` (+ test) -- EDT section, merged EDT/updated line, chrome-row budget, mockup structure for states A/B/C -- rendering
- [x] `dashboard-zone.tsx`, `keybindings.ts` (+ interaction/keybinding tests) -- `E`/`e` handlers, overlay inertness, footer/help -- keys
- [x] `dashboard-zone.bounds.test.tsx` (new) -- data-filled Dashboard across `MATRIX_SIZES` and the three states: bounded, banner intact -- guarantees minimum-size screen
- [x] `deferred-work.md` -- mark the banner-clipping entries resolved -- close the debt

**Acceptance Criteria:**
- Given an active EDT, when rendered, then the default action reads "Enter <topic>" and `E` opens it in the EDTs zone; `e` offers "Choose another EDT / create one" via the quick-pick.
- Given the three approved states, when rendered, then structure and tokens match the mockup.
- Given any matrix size, when rendered, then no region exceeds its bounds and both banner lines are intact.
- Given the Dashboard, when the footer renders, then it lists `[↑/↓] service`, `[Enter] open`, `[Ctrl+O]` `[Ctrl+R]` `[Ctrl+L]` while a service is focused, `[R] refresh`, `[e] EDTs`.
- Given `npm test`, `typecheck`, `depcheck`, then all pass.

## Spec Change Log

## Design Notes

The mockup shows `[enter]▸Enter <EDT>` but `Enter` already opens the focused service (8.3); the human chose a dedicated `E` to avoid two meanings of one key. The banner needs no code change: it is 2 rows × 28 cols, always inside the 40×12 minimum, so "guaranteed" is proven by the matrix test rather than by compaction.

## Verification

**Commands:**
- `npm test` -- expected: all green
- `npm run typecheck` -- expected: no errors
- `npm run depcheck` -- expected: no violations

## Suggested Review Order

**EDT section logic**

- Entry point: pure resolution of the section state (active / none active / no EDT).
  [`dashboard.logic.ts:199`](../../src/adapters/driving/tui/zones/dashboard/dashboard.logic.ts#L199)

- Action labels per state and the merged EDT line.
  [`dashboard.logic.ts:206`](../../src/adapters/driving/tui/zones/dashboard/dashboard.logic.ts#L206)

- Key-to-effect mapping for `E` / `e`.
  [`dashboard.logic.ts:233`](../../src/adapters/driving/tui/zones/dashboard/dashboard.logic.ts#L233)

**Keys**

- `E` / `e` handler, gated on ready sections and overlay inertness.
  [`dashboard-zone.tsx:115`](../../src/adapters/driving/tui/zones/dashboard/dashboard-zone.tsx#L115)

- Banner kept non-shrinkable so it is never clipped on short terminals.
  [`dashboard-zone.tsx:164`](../../src/adapters/driving/tui/zones/dashboard/dashboard-zone.tsx#L164)

**Rendering**

- Bottom EDT section and chrome-row budget.
  [`dashboard-body.tsx:209`](../../src/adapters/driving/tui/zones/dashboard/dashboard-body.tsx#L209)

**Footer and help**

- `E` row gated on an active EDT.
  [`keybindings.ts:193`](../../src/adapters/driving/tui/keybindings/keybindings.ts#L193)

- Per-service hints shown only while services are focusable.
  [`footer.tsx:29`](../../src/adapters/driving/tui/shared/components/footer.tsx#L29)

**Tests**

- Data-filled size matrix proving bounds and banner integrity.
  [`dashboard-zone.bounds.test.tsx:63`](../../src/adapters/driving/tui/zones/dashboard/dashboard-zone.bounds.test.tsx#L63)
