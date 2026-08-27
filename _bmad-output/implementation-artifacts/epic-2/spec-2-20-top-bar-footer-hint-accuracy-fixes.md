---
title: 'Top Bar & Footer Hint Accuracy Fixes'
type: 'bugfix'
created: '2026-08-26'
status: 'done'
review_loop_iteration: 0
baseline_commit: '04c2e3ec2a5a20ad5467420fdeb99864bc400ff4'
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-2/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Two UX-DR7/UX-DR13 violations found while reviewing the top bar: it shows the active EDT's ULID instead of its human-readable `topic` (and only once the EDTs zone has been mounted, since `edts` is currently loaded only by that zone's own mount effect), and the footer's default hint set never lists the `Left`/`Right` zone-switching shortcut Story 2.12 already implemented.

**Approach:** Resolve the active EDT's `topic` from `edts` inside `TopBar`, and load `edts` once at `AppShell` mount so the label is correct regardless of which zone renders first. Add `[←→] zone` to `DEFAULT_FOOTER_HINTS` beside the existing mnemonic-zone hint. Bug fixes only — no new components, ports, or core changes.

## Boundaries & Constraints

**Always:**
- `TopBar` takes an additional `edts: EdtRegistryEntry[] | null` prop and derives its label via `edts?.find((edt) => edt.ulid === activeEdt)?.topic`, never displaying the raw ulid.
- When `activeEdt` is `null`, or the topic can't yet be resolved (`edts` is `null`/not loaded, or no matching entry), `TopBar` shows `"no active EDT"` — same placeholder text as today, never a raw id or blank string.
- `AppShell` loads `edts` once on mount (mirrors `tabVisibility`'s existing mount-once effect idiom) so the top bar's label is correct before any zone-specific mount effect (e.g. `EdtsZone`'s own `loadEdts()`) has run. `EdtsZone`'s own mount-time `loadEdts()` call is untouched — it stays as a fresh reload when that zone is visited.
- `DEFAULT_FOOTER_HINTS` gains `'[←→] zone'` immediately after `'[d/e/u/l/r/s] zone'`, per UX-DR7 frequency ordering (this pair are both zone-switching hints, kept adjacent).
- No changes to `LoadEdts`'s store logic, `EdtRegistryPort`, or any core file — this is a TUI-only accuracy fix in `adapters/driving/tui`.

**Ask First:** None.

**Never:**
- Don't add a new store field, port method, or topic cache — reuse the existing `edts`/`loadEdts` store slice as-is.
- Don't change `TopBar`'s or `Footer`'s visual chrome (colors, layout, spacing) — only the displayed label and hint list.
- Don't remove or reorder any other existing footer hint.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Active EDT, topic resolvable, any zone active | `activeEdt = '01J...'`, `edts` contains that ulid | Top bar shows the EDT's `topic` | N/A |
| No active EDT | `activeEdt = null` | Top bar shows `"no active EDT"` | N/A |
| Active EDT set, `edts` not yet loaded | `activeEdt = '01J...'`, `edts = null` | Top bar shows `"no active EDT"` (self-corrects once `loadEdts()` resolves) | N/A |
| Active EDT set, no matching entry (stale pointer, load error) | `activeEdt = '01J...'`, `edts = []` | Top bar shows `"no active EDT"` | N/A |
| Footer default hints | no zone-specific hints passed | Includes both `'[d/e/u/l/r/s] zone'` and `'[←→] zone'` | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/shared/components/top-bar.tsx` -- add `edts: EdtRegistryEntry[] | null` prop; derive `topic` via `edts?.find((edt) => edt.ulid === activeEdt)?.topic ?? null`; render `topic ? topic : 'no active EDT'` in place of the current raw `activeEdt` display (L8-11). Import `EdtRegistryEntry` from `../../../../../core/ports/edt-registry.js`.
- `src/adapters/driving/tui/app-shell.tsx` -- L108: add `const edts = useStore((state) => state.edts);` and `const loadEdts = useStore((state) => state.loadEdts);` next to the existing `activeEdt` selector. Add a mount-once `useEffect(() => { void loadEdts(); }, [])` (mirrors the existing `loadTabVisibility` mount-effect idiom at L143-145, but fires once, not on `registryScreenOpen`). L232: change `<TopBar activeEdt={activeEdt} />` to `<TopBar activeEdt={activeEdt} edts={edts} />`.
- `src/adapters/driving/tui/shared/components/footer.tsx` -- L7: insert `'[←→] zone'` as a new array entry immediately after `'[d/e/u/l/r/s] zone'` in `DEFAULT_FOOTER_HINTS`.
- `src/adapters/driving/tui/shared/components/top-bar-footer-split.test.tsx` -- update the two existing `TopBar` tests (L13-24) to pass an `edts` prop and assert the resolved `topic` (not a raw ulid) is shown; add a case for `edts: null` (not yet loaded) falling back to `"no active EDT"`. Add a `Footer` assertion that `DEFAULT_FOOTER_HINTS` contains `'[←→] zone'` adjacent to `'[d/e/u/l/r/s] zone'`.
- `src/adapters/driving/tui/app-shell.interaction.test.tsx` -- add one test (near the existing "AppShell tabVisibility load activation" describe block, L823-899) proving the top bar shows the active EDT's `topic` from a wired `loadEdts()` mount-time load, without ever switching to the EDTs zone. No existing test in this file needs a behavior change: the one seeded-store test that stubs `loadEdts: async () => {}` (L788) already covers AppShell's new mount-time call as a no-op.

## Tasks & Acceptance

**Execution:**
- [x] `src/adapters/driving/tui/shared/components/top-bar.tsx` -- add `edts` prop, derive and render the resolved `topic` -- fulfills the Intent's core behavior change (ulid → topic)
- [x] `src/adapters/driving/tui/app-shell.tsx` -- load `edts` once at mount, pass it to `TopBar` -- makes the label correct regardless of which zone renders first
- [x] `src/adapters/driving/tui/shared/components/footer.tsx` -- add `'[←→] zone'` to `DEFAULT_FOOTER_HINTS` -- fulfills the Intent's second fix
- [x] `src/adapters/driving/tui/shared/components/top-bar-footer-split.test.tsx` -- update `TopBar` tests for topic resolution (incl. `edts: null`); add `Footer` hint-list assertion
- [x] `src/adapters/driving/tui/app-shell.interaction.test.tsx` -- add a mount-level test proving the topic resolves without visiting the EDTs zone

**Acceptance Criteria:**
- Given an EDT is active, when the top bar renders, then it shows that EDT's `topic` — never its ULID — resolved regardless of which zone is currently active.
- Given no EDT is active, when the top bar renders, then it shows `"no active EDT"`, unchanged.
- Given the footer's default hint set, when rendered, then it includes `[←→] zone` alongside the existing `[d/e/u/l/r/s] zone`.
- All tests pass (`npm test`), typecheck passes (`npm run typecheck`), depcheck passes (`npm run depcheck`).

## Spec Change Log

## Verification

**Commands:**
- `npm test` -- expected: all suites green, including updated `top-bar-footer-split` and `app-shell.interaction` tests
- `npm run typecheck` -- expected: `tsc --noEmit` clean
- `npm run depcheck` -- expected: no boundary violations (touches only `adapters/driving/tui/**`)

**Manual checks:**
- `node src/bin/tui-back.mjs` (TUI): with an active EDT, launch straight into Dashboard (never visiting EDTs zone) — top bar shows the EDT's topic, not its ulid. Check the footer shows `[←→] zone`.
- Same launch, with no EDT registered yet (empty `edts.yaml`) — top bar shows `"no active EDT"`, never blank or an id, for the brief window before `loadEdts()` resolves and after.
- Press `[←→]` from Dashboard to switch zones and confirm the shortcut actually works, matching the footer's advertised hint.

## Suggested Review Order

**Top bar topic resolution**

- Entry point: `TopBar` now takes `edts` and derives the displayed label from the matching entry's `topic` instead of the raw ulid.
  [`top-bar.tsx:5`](../../../../src/adapters/driving/tui/shared/components/top-bar.tsx#L5)

- The lookup and its null-safe fallback — every unresolved case (`null` EDT, unloaded `edts`, no match) collapses to the same placeholder.
  [`top-bar.tsx:12`](../../../../src/adapters/driving/tui/shared/components/top-bar.tsx#L12)

**Mount-time `edts` load in AppShell**

- New store selectors feeding the top bar, added next to the existing `activeEdt` one.
  [`app-shell.tsx:109`](../../../../src/adapters/driving/tui/app-shell.tsx#L109)

- Mount-once effect loads `edts` regardless of which zone renders first — deliberately left with no dependency on `EdtsZone`'s own reload.
  [`app-shell.tsx:149`](../../../../src/adapters/driving/tui/app-shell.tsx#L149)

- `edts` now threaded into `TopBar` alongside `activeEdt`.
  [`app-shell.tsx:243`](../../../../src/adapters/driving/tui/app-shell.tsx#L243)

**Footer hint list**

- `[←→] zone` added immediately after the mnemonic zone hint, per UX-DR7 adjacency.
  [`footer.tsx:8`](../../../../src/adapters/driving/tui/shared/components/footer.tsx#L8)

**Tests**

- `TopBar` unit tests updated for topic resolution, plus the two new not-yet-loaded / no-match cases.
  [`top-bar-footer-split.test.tsx:24`](../../../../src/adapters/driving/tui/shared/components/top-bar-footer-split.test.tsx#L24)

- `Footer` hint-list adjacency assertion.
  [`top-bar-footer-split.test.tsx:71`](../../../../src/adapters/driving/tui/shared/components/top-bar-footer-split.test.tsx#L71)

- Mount-level proof the topic resolves without ever visiting the EDTs zone.
  [`app-shell.interaction.test.tsx:900`](../../../../src/adapters/driving/tui/app-shell.interaction.test.tsx#L900)
